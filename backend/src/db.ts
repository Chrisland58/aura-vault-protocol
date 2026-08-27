/**
 * Database connection pools.
 *
 * - getWritePool() → primary RDS instance (INSERT / UPDATE / DELETE)
 * - getReadPool()  → read replica (SELECT analytics queries)
 *
 * If DATABASE_REPLICA_URL is not set, getReadPool() falls back to the
 * primary so the app works in environments without a replica (e.g. dev).
 */

import pg from "pg";

const { Pool } = pg;

let writePool: pg.Pool | null = null;
let readPool: pg.Pool | null = null;

function createPool(connectionString: string, label: string): pg.Pool {
  const pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl:
      process.env.NODE_ENV === "production"
        ? { rejectUnauthorized: true }
        : false,
  });

  pool.on("error", (err) => {
    console.error(`[db:${label}] Unexpected pool error`, err);
  });

  return pool;
}

/**
 * Returns the write (primary) pool.
 * Lazily initialised on first call.
 */
export function getWritePool(): pg.Pool {
  if (!writePool) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL environment variable is not set");
    }
    writePool = createPool(url, "write");
  }
  return writePool;
}

/**
 * Returns the read (replica) pool.
 * Falls back to the primary if DATABASE_REPLICA_URL is not configured.
 * Lazily initialised on first call.
 */
export function getReadPool(): pg.Pool {
  if (!readPool) {
    const replicaUrl = process.env.DATABASE_REPLICA_URL ?? process.env.DATABASE_URL;
    if (!replicaUrl) {
      throw new Error(
        "Neither DATABASE_REPLICA_URL nor DATABASE_URL environment variable is set"
      );
    }
    const isReplica = !!process.env.DATABASE_REPLICA_URL;
    readPool = createPool(replicaUrl, isReplica ? "read-replica" : "read-fallback-primary");
  }
  return readPool;
}

/**
 * Pings both pools; resolves to { write: boolean, read: boolean }.
 * Used by the health endpoint.
 */
export async function dbHealthCheck(): Promise<{ write: boolean; read: boolean }> {
  const check = async (pool: pg.Pool): Promise<boolean> => {
    try {
      const client = await pool.connect();
      await client.query("SELECT 1");
      client.release();
      return true;
    } catch {
      return false;
    }
  };

  const [write, read] = await Promise.all([
    check(getWritePool()),
    check(getReadPool()),
  ]);

  return { write, read };
}

/**
 * Gracefully close all pools.  Call during server shutdown.
 */
export async function closePools(): Promise<void> {
  await Promise.all([
    writePool?.end(),
    readPool?.end(),
  ]);
  writePool = null;
  readPool = null;
}
