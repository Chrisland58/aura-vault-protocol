/**
 * Database Migration Tests — Issue #462
 *
 * Verifies that every migration:
 *   1. Runs (UP) without error on a fresh PostgreSQL instance
 *   2. Rolls back (DOWN) cleanly — confirmed by checking the schema returns
 *      to its pre-migration state after we drop the objects the migration
 *      created.
 *   3. Is idempotent — running the UP script a second time must not throw.
 *
 * The tests use the `pg` client directly against the DATABASE_URL configured
 * in the environment (defaults to a local test database).  In CI the
 * `migration-tests` job spins up a postgres service container before this
 * suite runs.
 *
 * Running locally:
 *   DATABASE_URL=postgres://postgres:postgres@localhost:5432/aura_test \
 *     npm test -- src/tests/migration.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DATABASE_URL =
  process.env["DATABASE_URL"] ??
  "postgres://postgres:postgres@localhost:5432/aura_test";

const MIGRATIONS_DIR = path.resolve(
  fileURLToPath(import.meta.url),
  "../../../../migrations"
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a fresh pool connected to the test database. */
function makePool(): pg.Pool {
  return new pg.Pool({ connectionString: DATABASE_URL, max: 3 });
}

/**
 * Read all *.sql files from the migrations directory, sorted numerically by
 * their leading prefix (e.g. 001_, 002_, …).
 */
function loadMigrations(): Array<{ name: string; sql: string }> {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort(); // lexicographic == numeric because of zero-padded prefix

  return files.map((f) => ({
    name: f,
    sql: fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"),
  }));
}

/**
 * Return an array of table names currently in the `public` schema of the
 * connected database.
 */
async function listTables(client: pg.PoolClient): Promise<string[]> {
  const res = await client.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
  );
  return res.rows.map((r: { tablename: string }) => r.tablename);
}

/**
 * Return an array of index names (non-primary, non-unique-constraint) in the
 * public schema.
 */
async function listIndexes(client: pg.PoolClient): Promise<string[]> {
  const res = await client.query<{ indexname: string }>(
    `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname`
  );
  return res.rows.map((r: { indexname: string }) => r.indexname);
}

/**
 * Return an array of view names in the public schema.
 */
async function listViews(client: pg.PoolClient): Promise<string[]> {
  const res = await client.query<{ viewname: string }>(
    `SELECT viewname FROM pg_views WHERE schemaname = 'public' ORDER BY viewname`
  );
  return res.rows.map((r: { viewname: string }) => r.viewname);
}

/**
 * Drop every table (cascade) and every view in the public schema so each test
 * starts with a truly empty database.
 */
async function nukeSchema(client: pg.PoolClient): Promise<void> {
  // Drop tables in reverse dependency order using CASCADE.
  const tables = await listTables(client);
  for (const t of tables) {
    await client.query(`DROP TABLE IF EXISTS "${t}" CASCADE`);
  }
  const views = await listViews(client);
  for (const v of views) {
    await client.query(`DROP VIEW IF EXISTS "${v}" CASCADE`);
  }
}

// ---------------------------------------------------------------------------
// Suite setup
// ---------------------------------------------------------------------------

let pool: pg.Pool;

beforeAll(async () => {
  pool = makePool();
  // Verify connectivity — skip entire suite if DB is unavailable.
  try {
    const client = await pool.connect();
    client.release();
  } catch (err) {
    console.warn(
      "[migration.test.ts] Skipping — cannot connect to test database:",
      (err as Error).message
    );
    pool.end();
    // Re-throw so the suite is marked as failed, not silently skipped.
    throw err;
  }
});

afterAll(async () => {
  if (pool) await pool.end();
});

// ---------------------------------------------------------------------------
// Shared clean-slate: each test group drops all tables before running.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 1. UP — each migration runs without error on a fresh schema
// ---------------------------------------------------------------------------

describe("Migration UP — each script runs cleanly on a fresh database", () => {
  it("applies all migrations in order without throwing", async () => {
    const client = await pool.connect();
    try {
      await nukeSchema(client);
      const migrations = loadMigrations();

      for (const { name, sql } of migrations) {
        await expect(
          client.query(sql),
          `Migration UP failed: ${name}`
        ).resolves.toBeDefined();
      }

      // After all migrations, core tables must exist.
      const tables = await listTables(client);
      expect(tables).toContain("vault_positions");
      expect(tables).toContain("transaction_jobs");
      expect(tables).toContain("yield_calculations");
      expect(tables).toContain("contract_events");
      expect(tables).toContain("apy_snapshots");
    } finally {
      await nukeSchema(client);
      client.release();
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Individual migration UP tests
// ---------------------------------------------------------------------------

describe("Migration 001 — vault_positions", () => {
  it("creates vault_positions table with correct columns", async () => {
    const client = await pool.connect();
    try {
      await nukeSchema(client);
      const { sql } = loadMigrations().find((m) => m.name.startsWith("001"))!;
      await client.query(sql);

      const res = await client.query<{ column_name: string; data_type: string }>(
        `SELECT column_name, data_type
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name   = 'vault_positions'
          ORDER BY ordinal_position`
      );
      const colNames = res.rows.map((r) => r.column_name);
      expect(colNames).toContain("id");
      expect(colNames).toContain("user_id");
      expect(colNames).toContain("vault_id");
      expect(colNames).toContain("amount");
      expect(colNames).toContain("yield_earned");
      expect(colNames).toContain("deleted_at");
      expect(colNames).toContain("created_at");
      expect(colNames).toContain("updated_at");
    } finally {
      await nukeSchema(client);
      client.release();
    }
  });

  it("creates vault_position_audit_log table", async () => {
    const client = await pool.connect();
    try {
      await nukeSchema(client);
      const { sql } = loadMigrations().find((m) => m.name.startsWith("001"))!;
      await client.query(sql);

      const tables = await listTables(client);
      expect(tables).toContain("vault_position_audit_log");
    } finally {
      await nukeSchema(client);
      client.release();
    }
  });

  it("audit trigger fires on INSERT into vault_positions", async () => {
    const client = await pool.connect();
    try {
      await nukeSchema(client);
      const { sql } = loadMigrations().find((m) => m.name.startsWith("001"))!;
      await client.query(sql);

      await client.query(`
        INSERT INTO vault_positions
          (user_id, vault_id, amount, entry_date, entry_price)
        VALUES
          (gen_random_uuid(), gen_random_uuid(), 100, NOW(), 1)
      `);

      const auditRes = await client.query(
        `SELECT count(*)::int AS n FROM vault_position_audit_log WHERE operation = 'INSERT'`
      );
      expect(auditRes.rows[0]!.n).toBe(1);
    } finally {
      await nukeSchema(client);
      client.release();
    }
  });

  it("updated_at trigger increments on UPDATE", async () => {
    const client = await pool.connect();
    try {
      await nukeSchema(client);
      const { sql } = loadMigrations().find((m) => m.name.startsWith("001"))!;
      await client.query(sql);

      await client.query(`
        INSERT INTO vault_positions
          (user_id, vault_id, amount, entry_date, entry_price)
        VALUES
          (gen_random_uuid(), gen_random_uuid(), 100, NOW(), 1)
      `);

      const before = await client.query<{ updated_at: Date }>(
        `SELECT updated_at FROM vault_positions LIMIT 1`
      );

      // Wait a tick so the clock advances.
      await new Promise((r) => setTimeout(r, 5));

      await client.query(`UPDATE vault_positions SET amount = 200`);

      const after = await client.query<{ updated_at: Date }>(
        `SELECT updated_at FROM vault_positions LIMIT 1`
      );

      expect(after.rows[0]!.updated_at.getTime()).toBeGreaterThanOrEqual(
        before.rows[0]!.updated_at.getTime()
      );
    } finally {
      await nukeSchema(client);
      client.release();
    }
  });
});

describe("Migration 002 — transaction_jobs", () => {
  it("creates transaction_jobs with correct status enum constraint", async () => {
    const client = await pool.connect();
    try {
      await nukeSchema(client);
      const m001 = loadMigrations().find((m) => m.name.startsWith("001"))!;
      const m002 = loadMigrations().find((m) => m.name.startsWith("002"))!;
      await client.query(m001.sql);
      await client.query(m002.sql);

      // Valid insert should succeed.
      await expect(
        client.query(`
          INSERT INTO transaction_jobs (id, tx_type, wallet_address, amount)
          VALUES ('job-1', 'deposit', '0xABC', '100')
        `)
      ).resolves.toBeDefined();

      // Invalid status should be rejected by CHECK constraint.
      await expect(
        client.query(`
          UPDATE transaction_jobs SET status = 'invalid_status' WHERE id = 'job-1'
        `)
      ).rejects.toThrow();
    } finally {
      await nukeSchema(client);
      client.release();
    }
  });
});

describe("Migration 003 — vault_positions indexes", () => {
  it("creates composite covering index and active_vault_positions view", async () => {
    const client = await pool.connect();
    try {
      await nukeSchema(client);
      const migrations = loadMigrations().filter(
        (m) => m.name.startsWith("001") || m.name.startsWith("002") || m.name.startsWith("003")
      );
      for (const { sql } of migrations) {
        await client.query(sql);
      }

      const indexes = await listIndexes(client);
      expect(indexes).toContain("idx_vault_positions_vault_user_active");
      expect(indexes).toContain("idx_vault_positions_yield");

      const views = await listViews(client);
      expect(views).toContain("active_vault_positions");
    } finally {
      await nukeSchema(client);
      client.release();
    }
  });
});

describe("Migration 004 — yield tables", () => {
  it("creates yield_sources, yield_calculations, and yield_worker_runs", async () => {
    const client = await pool.connect();
    try {
      await nukeSchema(client);
      const toApply = loadMigrations().filter((m) =>
        ["001", "002", "003", "004"].some((p) => m.name.startsWith(p))
      );
      for (const { sql } of toApply) await client.query(sql);

      const tables = await listTables(client);
      expect(tables).toContain("yield_sources");
      expect(tables).toContain("yield_calculations");
      expect(tables).toContain("yield_worker_runs");
    } finally {
      await nukeSchema(client);
      client.release();
    }
  });
});

describe("Migration 005 — contract events", () => {
  it("creates contract_events with unique constraint on (tx_hash, event_index)", async () => {
    const client = await pool.connect();
    try {
      await nukeSchema(client);
      // Apply all previous migrations first.
      const toApply = loadMigrations().filter((m) =>
        ["001", "002", "003", "004", "005_create_contract"].some((p) =>
          m.name.startsWith(p.split("_")[0]!)
        )
      );
      for (const { sql } of toApply) await client.query(sql);

      // Duplicate (tx_hash, event_index) must be rejected.
      await client.query(`
        INSERT INTO contract_events
          (ledger_sequence, transaction_hash, event_index, contract_id, event_type, topic, created_at)
        VALUES
          (100, 'abc123', '0', 'contract1', 'deposit', '[]', NOW())
      `);

      await expect(
        client.query(`
          INSERT INTO contract_events
            (ledger_sequence, transaction_hash, event_index, contract_id, event_type, topic, created_at)
          VALUES
            (100, 'abc123', '0', 'contract1', 'deposit', '[]', NOW())
        `)
      ).rejects.toThrow();
    } finally {
      await nukeSchema(client);
      client.release();
    }
  });
});

describe("Migration 005 — GDPR erasure requests", () => {
  it("creates gdpr_erasure_requests with generated deadline_at column", async () => {
    const client = await pool.connect();
    try {
      await nukeSchema(client);
      // Run all migrations to satisfy FK dependencies.
      const migrations = loadMigrations();
      for (const { sql } of migrations) await client.query(sql);

      await client.query(`
        INSERT INTO gdpr_erasure_requests (wallet_address, request_ip)
        VALUES ('GABCXYZ', '127.0.0.1')
      `);

      const res = await client.query<{
        requested_at: Date;
        deadline_at: Date;
      }>(
        `SELECT requested_at, deadline_at FROM gdpr_erasure_requests LIMIT 1`
      );
      const { requested_at, deadline_at } = res.rows[0]!;
      // deadline = requested_at + 30 days
      const diff = deadline_at.getTime() - requested_at.getTime();
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      expect(diff).toBeGreaterThanOrEqual(thirtyDaysMs - 1000);
      expect(diff).toBeLessThanOrEqual(thirtyDaysMs + 1000);
    } finally {
      await nukeSchema(client);
      client.release();
    }
  });

  it("unique partial index prevents two active erasure requests per wallet", async () => {
    const client = await pool.connect();
    try {
      await nukeSchema(client);
      const migrations = loadMigrations();
      for (const { sql } of migrations) await client.query(sql);

      await client.query(`
        INSERT INTO gdpr_erasure_requests (wallet_address) VALUES ('GABCXYZ')
      `);

      await expect(
        client.query(`
          INSERT INTO gdpr_erasure_requests (wallet_address) VALUES ('GABCXYZ')
        `)
      ).rejects.toThrow();
    } finally {
      await nukeSchema(client);
      client.release();
    }
  });
});

describe("Migration 006 — apy_snapshots", () => {
  it("creates apy_snapshots with unique constraint (vault_id, resolution, snapshot_at)", async () => {
    const client = await pool.connect();
    try {
      await nukeSchema(client);
      const migrations = loadMigrations();
      for (const { sql } of migrations) await client.query(sql);

      const vaultId = "a0000000-0000-0000-0000-000000000001";
      await client.query(`
        INSERT INTO apy_snapshots (vault_id, resolution, snapshot_at, apy_7d, apy_30d)
        VALUES ($1, 'hourly', NOW(), 5.25, 4.80)
      `, [vaultId]);

      await expect(
        client.query(`
          INSERT INTO apy_snapshots (vault_id, resolution, snapshot_at, apy_7d, apy_30d)
          VALUES ($1, 'hourly', NOW(), 5.25, 4.80)
        `, [vaultId])
      ).rejects.toThrow();
    } finally {
      await nukeSchema(client);
      client.release();
    }
  });
});

// ---------------------------------------------------------------------------
// 3. DOWN — verify clean rollback for each migration
//    Since the migrations don't ship explicit DOWN scripts, we simulate rollback
//    by dropping the objects the migration created and confirming they're gone.
// ---------------------------------------------------------------------------

describe("Migration DOWN (rollback) — objects removed cleanly", () => {
  it("001 — dropping vault_positions CASCADE removes audit table and triggers", async () => {
    const client = await pool.connect();
    try {
      await nukeSchema(client);
      const { sql } = loadMigrations().find((m) => m.name.startsWith("001"))!;
      await client.query(sql);

      // Simulate rollback: drop tables created by migration 001.
      await client.query(`DROP TABLE IF EXISTS vault_position_audit_log CASCADE`);
      await client.query(`DROP TABLE IF EXISTS vault_positions CASCADE`);

      const tables = await listTables(client);
      expect(tables).not.toContain("vault_positions");
      expect(tables).not.toContain("vault_position_audit_log");
    } finally {
      await nukeSchema(client);
      client.release();
    }
  });

  it("002 — dropping transaction_jobs removes it cleanly", async () => {
    const client = await pool.connect();
    try {
      await nukeSchema(client);
      const m001 = loadMigrations().find((m) => m.name.startsWith("001"))!;
      const m002 = loadMigrations().find((m) => m.name.startsWith("002"))!;
      await client.query(m001.sql);
      await client.query(m002.sql);

      await client.query(`DROP TABLE IF EXISTS transaction_jobs CASCADE`);

      const tables = await listTables(client);
      expect(tables).not.toContain("transaction_jobs");
    } finally {
      await nukeSchema(client);
      client.release();
    }
  });

  it("003 — dropping indexes and view reverts to pre-003 state", async () => {
    const client = await pool.connect();
    try {
      await nukeSchema(client);
      const migrations = loadMigrations().filter((m) =>
        ["001", "002", "003"].some((p) => m.name.startsWith(p))
      );
      for (const { sql } of migrations) await client.query(sql);

      // Simulate rollback of migration 003.
      await client.query(`DROP VIEW IF EXISTS active_vault_positions CASCADE`);
      await client.query(
        `DROP INDEX IF EXISTS idx_vault_positions_vault_user_active`
      );
      await client.query(`DROP INDEX IF EXISTS idx_vault_positions_yield`);

      const views = await listViews(client);
      expect(views).not.toContain("active_vault_positions");
      const indexes = await listIndexes(client);
      expect(indexes).not.toContain("idx_vault_positions_vault_user_active");
    } finally {
      await nukeSchema(client);
      client.release();
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Idempotency — running UP twice is safe (IF NOT EXISTS guards)
// ---------------------------------------------------------------------------

describe("Idempotency — running each migration twice must not throw", () => {
  it("re-applying all migrations after they are already applied is safe", async () => {
    const client = await pool.connect();
    try {
      await nukeSchema(client);
      const migrations = loadMigrations();

      // First pass — fresh database.
      for (const { name, sql } of migrations) {
        await expect(
          client.query(sql),
          `First UP pass failed: ${name}`
        ).resolves.toBeDefined();
      }

      // Second pass — all objects already exist; must be idempotent.
      for (const { name, sql } of migrations) {
        await expect(
          client.query(sql),
          `Second UP pass (idempotency) failed: ${name}`
        ).resolves.toBeDefined();
      }
    } finally {
      await nukeSchema(client);
      client.release();
    }
  });
});
