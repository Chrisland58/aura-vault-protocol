#!/usr/bin/env tsx
/**
 * Contract Event Backfill Script
 *
 * Usage:
 *   npm run backfill -- --from-ledger=<N> --to-ledger=<N> [--dry-run] [--contract=<id>]
 *
 * Options:
 *   --from-ledger   Starting ledger sequence (required)
 *   --to-ledger     Ending ledger sequence (required)
 *   --dry-run       Show what would be inserted without writing to DB
 *   --contract      Contract ID (defaults to VAULT_CONTRACT_ID env var)
 *
 * Exit codes: 0 = success, 1 = error
 */

import pg from "pg";

const { Pool } = pg;

// ── CLI Argument Parsing ─────────────────────────────────────────────────────

interface CliArgs {
  fromLedger: number;
  toLedger: number;
  dryRun: boolean;
  contractId: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const entry = args.find((a) => a.startsWith(`--${flag}=`));
    return entry?.split("=").slice(1).join("=");
  };
  const has = (flag: string): boolean => args.includes(`--${flag}`);

  const fromLedger = parseInt(get("from-ledger") ?? "", 10);
  const toLedger = parseInt(get("to-ledger") ?? "", 10);

  if (isNaN(fromLedger) || isNaN(toLedger)) {
    console.error(
      "Error: --from-ledger and --to-ledger are required integer arguments.\n" +
        "Usage: npm run backfill -- --from-ledger=1000 --to-ledger=2000 [--dry-run]"
    );
    process.exit(1);
  }

  if (fromLedger > toLedger) {
    console.error("Error: --from-ledger must be <= --to-ledger");
    process.exit(1);
  }

  const contractId =
    get("contract") ??
    process.env.VAULT_CONTRACT_ID ??
    "";

  if (!contractId) {
    console.error(
      "Error: --contract or VAULT_CONTRACT_ID env var is required"
    );
    process.exit(1);
  }

  return {
    fromLedger,
    toLedger,
    dryRun: has("dry-run"),
    contractId,
  };
}

// ── Progress Bar ─────────────────────────────────────────────────────────────

export function renderProgressBar(current: number, total: number, width = 40): string {
  const pct = total === 0 ? 1 : Math.min(current / total, 1);
  const filled = Math.round(pct * width);
  const empty = width - filled;
  const bar = "=".repeat(Math.max(filled - 1, 0)) + (pct < 1 ? ">" : "=") + " ".repeat(empty);
  const percent = Math.round(pct * 100);
  return `[${bar}] ${percent}% (${current}/${total} ledgers)`;
}

function printProgress(current: number, total: number): void {
  process.stdout.write(`\r${renderProgressBar(current, total)}  `);
}

// ── Horizon Event Types ───────────────────────────────────────────────────────

interface HorizonEvent {
  id: string;
  ledger: number;
  ledger_closed_at: string;
  paging_token: string;
  transaction_hash: string;
  type: string;
  contract_id: string;
  topic: unknown[];
  value: unknown;
}

interface HorizonEventsPage {
  _embedded: { records: HorizonEvent[] };
  _links: { self: { href: string }; next?: { href: string } };
}

// ── Horizon Fetching ─────────────────────────────────────────────────────────

const PAGE_SIZE = 200;

export async function fetchEventPage(
  horizonUrl: string,
  contractId: string,
  startLedger: number,
  cursor?: string
): Promise<HorizonEventsPage> {
  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    order: "asc",
  });

  if (cursor) {
    params.set("cursor", cursor);
  } else {
    params.set("start_ledger", String(startLedger));
  }

  // Horizon uses repeated query params for contract filter
  params.append("filter[contract_ids][]", contractId);

  const url = `${horizonUrl}/events?${params.toString()}`;

  const resp = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });

  if (!resp.ok) {
    throw new Error(`Horizon responded ${resp.status} for ${url}`);
  }

  return resp.json() as Promise<HorizonEventsPage>;
}

// ── Database Upsert ───────────────────────────────────────────────────────────

async function upsertEvents(
  pool: pg.Pool,
  events: HorizonEvent[]
): Promise<{ inserted: number; skipped: number }> {
  if (events.length === 0) return { inserted: 0, skipped: 0 };

  let inserted = 0;
  let skipped = 0;

  // Upsert one-by-one to count actual inserts vs conflicts
  for (const ev of events) {
    const result = await pool.query(
      `INSERT INTO contract_events
         (ledger_sequence, transaction_hash, event_index, contract_id,
          event_type, topic, value, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (transaction_hash, event_index) DO NOTHING`,
      [
        ev.ledger,
        ev.transaction_hash,
        ev.id,
        ev.contract_id,
        ev.type,
        JSON.stringify(ev.topic),
        JSON.stringify(ev.value),
        ev.ledger_closed_at,
      ]
    );

    if ((result.rowCount ?? 0) > 0) {
      inserted++;
    } else {
      skipped++;
    }
  }

  return { inserted, skipped };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs();
  const horizonUrl =
    process.env.HORIZON_URL ?? "https://horizon-testnet.stellar.org";

  const isDryRun = args.dryRun;
  const totalLedgers = args.toLedger - args.fromLedger + 1;

  console.log("╔════════════════════════════════════════╗");
  console.log("║    Aura Vault — Event Backfill Script  ║");
  console.log("╚════════════════════════════════════════╝");
  console.log(`  Contract  : ${args.contractId}`);
  console.log(`  Ledgers   : ${args.fromLedger} → ${args.toLedger} (${totalLedgers} ledgers)`);
  console.log(`  Horizon   : ${horizonUrl}`);
  console.log(`  Mode      : ${isDryRun ? "DRY RUN (no DB writes)" : "WRITE"}`);
  console.log();

  // DB pool — only needed in write mode
  let pool: pg.Pool | null = null;
  if (!isDryRun) {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      console.error("Error: DATABASE_URL is required in write mode");
      process.exit(1);
    }
    pool = new Pool({ connectionString: dbUrl });
  }

  let cursor: string | undefined;
  let totalFetched = 0;
  let totalInserted = 0;
  let totalSkipped = 0;
  let currentLedger = args.fromLedger;

  // Event type distribution for dry-run report
  const typeCounts: Record<string, number> = {};

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      printProgress(currentLedger - args.fromLedger, totalLedgers);

      const page = await fetchEventPage(
        horizonUrl,
        args.contractId,
        args.fromLedger,
        cursor
      );

      const records = page._embedded?.records ?? [];
      if (records.length === 0) break;

      // Filter to our ledger range
      const inRange = records.filter(
        (ev) => ev.ledger >= args.fromLedger && ev.ledger <= args.toLedger
      );

      totalFetched += inRange.length;

      for (const ev of inRange) {
        typeCounts[ev.type] = (typeCounts[ev.type] ?? 0) + 1;
      }

      if (!isDryRun && pool && inRange.length > 0) {
        const { inserted, skipped } = await upsertEvents(pool, inRange);
        totalInserted += inserted;
        totalSkipped += skipped;
      }

      // Emit structured log line to stderr for machine consumers
      process.stderr.write(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: "info",
          event: "page_processed",
          ledger: records[records.length - 1]?.ledger,
          records: inRange.length,
          cursor: page._links.next?.href,
        }) + "\n"
      );

      // Stop if there's no next page or we've passed our range
      const lastLedger = records[records.length - 1]?.ledger ?? 0;
      if (!page._links.next || lastLedger >= args.toLedger) break;

      // Advance cursor for next page
      cursor = records[records.length - 1]?.paging_token;
      currentLedger = lastLedger;
    }

    // Finish progress bar
    printProgress(totalLedgers, totalLedgers);
    process.stdout.write("\n\n");

    // ── Summary ──────────────────────────────────────────────────────────────
    console.log("════════ Backfill Summary ════════");
    console.log(`  Total fetched : ${totalFetched}`);

    if (isDryRun) {
      console.log("  Mode          : DRY RUN — no records written");
      console.log("\n  Event type breakdown:");
      for (const [type, count] of Object.entries(typeCounts)) {
        console.log(`    ${type.padEnd(30)} ${count}`);
      }
    } else {
      console.log(`  Inserted      : ${totalInserted}`);
      console.log(`  Skipped (dup) : ${totalSkipped}`);
    }

    console.log("\n  ✅ Backfill complete");
  } finally {
    await pool?.end();
  }
}

// Only run when this file is the entrypoint (not when imported by tests)
const isEntrypoint =
  process.argv[1] !== undefined &&
  new URL(import.meta.url).pathname === new URL(
    process.argv[1].startsWith("/") ? `file://${process.argv[1]}` : process.argv[1]
  ).pathname;

if (isEntrypoint) {
  main().catch((err) => {
    console.error("\n❌ Backfill failed:", err);
    process.exit(1);
  });
}
