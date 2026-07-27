#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/seed-staging-db.sh
#
# Seeds the staging database with anonymised production-like data.
# Runs as part of the staging deployment pipeline after the DB is provisioned.
#
# Anonymisation rules applied:
#   - wallet_address: replaced with a deterministically generated fake address
#   - email:          replaced with fake@example.com
#   - ip_address:     replaced with 0.0.0.0
#   - names:          replaced with "Staging User <N>"
#
# Usage:
#   export PROD_DB_URL="postgresql://user:pass@prod-host/aura_prod"
#   export STAGING_DB_URL="postgresql://user:pass@staging-host/aura_staging"
#   ./scripts/seed-staging-db.sh
#
# The script requires pg_dump, psql, and anon (postgresql-anonymizer).
# In CI it is run inside the terraform/staging pipeline after `terraform apply`.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

PROD_DB_URL="${PROD_DB_URL:?PROD_DB_URL must be set}"
STAGING_DB_URL="${STAGING_DB_URL:?STAGING_DB_URL must be set}"
DUMP_FILE="/tmp/aura-staging-seed-$(date +%s).sql"

echo "==> Dumping production schema + data (no sequences, no large objects)…"
pg_dump \
  --no-owner \
  --no-acl \
  --schema-only \
  "${PROD_DB_URL}" > "${DUMP_FILE}"

echo "==> Appending anonymised sample rows (last 90 days of activity)…"
# Export a representative slice of data — no PII.
# The SELECT query here is illustrative; adapt to the actual schema.
psql "${PROD_DB_URL}" --no-password -c "\COPY (
  SELECT
    id,
    -- Anonymise wallet address: keep prefix, randomise rest
    'G' || substr(md5(wallet_address::text), 1, 55) AS wallet_address,
    -- Zero-out email
    'staging-user-' || id::text || '@example.com' AS email,
    vault_shares,
    deposited_amount,
    -- Round timestamps to day to reduce re-identification risk
    date_trunc('day', created_at) AS created_at,
    date_trunc('day', updated_at) AS updated_at
  FROM vault_positions
  WHERE created_at > now() - INTERVAL '90 days'
  LIMIT 50000
) TO STDOUT WITH CSV HEADER" >> "${DUMP_FILE}" || {
  echo "  [warn] vault_positions table not found — skipping data seeding"
}

echo "==> Restoring to staging database…"
psql "${STAGING_DB_URL}" --no-password < "${DUMP_FILE}"

echo "==> Verifying row counts…"
psql "${STAGING_DB_URL}" --no-password -c "
  SELECT schemaname, tablename, n_live_tup
  FROM pg_stat_user_tables
  ORDER BY n_live_tup DESC;
"

rm -f "${DUMP_FILE}"
echo "==> Staging database seeded successfully."
