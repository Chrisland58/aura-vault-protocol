# Contract Event Backfill Procedure

Use this procedure when Soroban contract events are missing from the database — for example after a database restore, an ingestion outage, or a new deployment that needs historical data.

## When to Use

- Database was restored from a backup and event records are missing
- The event ingestion service was offline for an extended period
- Initial setup requiring historical event data
- Discrepancy detected between on-chain state and database records

## Prerequisites

- Access to the backend deployment environment
- `DATABASE_URL` set to the target PostgreSQL instance (primary/write)
- `VAULT_CONTRACT_ID` set to the contract you want to backfill
- `HORIZON_URL` pointing to the correct Horizon endpoint (testnet or mainnet)
- Network access to the Horizon endpoint
- The `005_create_contract_events.sql` migration has been run

## Step 1 — Identify the Ledger Range

Find the ledger range you need to backfill:

```bash
# Latest ledger on Horizon (mainnet)
curl -s https://horizon.stellar.org/ | jq .core_latest_ledger

# Or check the last event in your DB to find where ingestion stopped
psql "$DATABASE_URL" -c "SELECT MAX(ledger_sequence) FROM contract_events;"
```

## Step 2 — Dry Run First

**Always run in dry-run mode before writing.** This shows you exactly how many events will be inserted and their type breakdown, without touching the database.

```bash
npm run backfill -- \
  --from-ledger=50000000 \
  --to-ledger=50100000 \
  --dry-run
```

Expected output:
```
  Total fetched : 347
  Mode          : DRY RUN — no records written

  Event type breakdown:
    deposit                        201
    withdraw                        98
    harvest                         48
```

## Step 3 — Write Mode

Once you've confirmed the expected event count, run without `--dry-run`:

```bash
npm run backfill -- \
  --from-ledger=50000000 \
  --to-ledger=50100000
```

The script will:
1. Fetch events in pages of 200 from Horizon
2. Upsert each event (ON CONFLICT DO NOTHING — safe to re-run)
3. Display a live progress bar
4. Print a summary of inserted vs. skipped (duplicate) records

## Step 4 — Verify

After the backfill completes, verify the data:

```bash
# Count events in range
psql "$DATABASE_URL" -c "
  SELECT event_type, COUNT(*)
  FROM contract_events
  WHERE ledger_sequence BETWEEN 50000000 AND 50100000
  GROUP BY event_type
  ORDER BY event_type;
"
```

Cross-reference against the dry-run counts from Step 2.

## Step 5 — Large Ranges (Chunking)

For very large ledger ranges (> 1,000,000 ledgers), split into chunks to avoid timeouts and allow progress checkpointing:

```bash
for START in $(seq 40000000 500000 50000000); do
  END=$((START + 499999))
  echo "Backfilling $START → $END"
  npm run backfill -- --from-ledger=$START --to-ledger=$END
done
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes (write mode) | PostgreSQL connection string |
| `VAULT_CONTRACT_ID` | Yes | Soroban contract ID to backfill |
| `HORIZON_URL` | No | Defaults to `https://horizon-testnet.stellar.org` |

## Troubleshooting

**"Horizon responded 429"** — You are being rate-limited. Add a sleep between chunks:
```bash
npm run backfill -- --from-ledger=... --to-ledger=... && sleep 60
```

**"DATABASE_URL is required in write mode"** — Export the env var before running:
```bash
export DATABASE_URL="postgres://user:pass@host:5432/auravault"
```

**Progress bar stalls** — Horizon may be slow. The script uses a 30-second timeout per page request. Check Horizon status at https://status.stellar.org.

**Duplicate key errors** — The script uses `ON CONFLICT DO NOTHING`, so re-running is safe. No duplicates will be inserted.
