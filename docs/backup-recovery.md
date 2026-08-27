# Backup & Disaster Recovery

Runbook for the Aura Vault Protocol off-chain infrastructure (indexer, API, UI config).
The on-chain state lives on Stellar and is inherently replicated by the network — this
document covers everything else.

---

## Scope

| Component | Storage | Backup Required |
|---|---|---|
| Indexer database (PostgreSQL) | Self-hosted / managed | Yes |
| API server config & secrets | Environment / Vault | Yes |
| Frontend static assets | CDN / object storage | Low — reproducible from source |
| On-chain contract state | Stellar ledger | No — network provides this |

---

## Automated Daily Backups

Backups run via a scheduled GitHub Actions workflow (`.github/workflows/backup.yml`)
or a cron job on the host, depending on deployment topology.

### Backup Script

```bash
#!/usr/bin/env bash
# scripts/backup.sh
set -euo pipefail

TIMESTAMP=$(date -u +"%Y%m%dT%H%M%SZ")
DB_NAME="${DB_NAME:?DB_NAME not set}"
S3_BUCKET="${S3_BUCKET:?S3_BUCKET not set}"
GPG_KEY_ID="${GPG_KEY_ID:?GPG_KEY_ID not set}"
BACKUP_FILE="/tmp/aura_backup_${TIMESTAMP}.sql.gz"
ENCRYPTED_FILE="${BACKUP_FILE}.gpg"

echo "[backup] Starting dump: $TIMESTAMP"
pg_dump "$DB_NAME" | gzip > "$BACKUP_FILE"

echo "[backup] Encrypting"
gpg --batch --yes --recipient "$GPG_KEY_ID" --output "$ENCRYPTED_FILE" --encrypt "$BACKUP_FILE"
rm "$BACKUP_FILE"

echo "[backup] Uploading to s3://$S3_BUCKET/backups/$TIMESTAMP/"
aws s3 cp "$ENCRYPTED_FILE" "s3://${S3_BUCKET}/backups/${TIMESTAMP}/db.sql.gz.gpg" \
  --sse aws:kms --storage-class STANDARD_IA

echo "[backup] Verifying upload"
aws s3 ls "s3://${S3_BUCKET}/backups/${TIMESTAMP}/db.sql.gz.gpg"

rm "$ENCRYPTED_FILE"
echo "[backup] Done: $TIMESTAMP"
```

### GitHub Actions Schedule

```yaml
# .github/workflows/backup.yml
name: Database Backup
on:
  schedule:
    - cron: '0 2 * * *'   # 02:00 UTC daily
  workflow_dispatch:

jobs:
  backup:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run backup
        env:
          DB_NAME: ${{ secrets.DB_NAME }}
          S3_BUCKET: ${{ secrets.BACKUP_S3_BUCKET }}
          GPG_KEY_ID: ${{ secrets.BACKUP_GPG_KEY_ID }}
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          AWS_DEFAULT_REGION: us-east-1
        run: bash scripts/backup.sh
```

---

## Cross-Region Replication

Configure S3 cross-region replication on the primary bucket to a secondary region.

```json
{
  "Rules": [{
    "Status": "Enabled",
    "Filter": { "Prefix": "backups/" },
    "Destination": {
      "Bucket": "arn:aws:s3:::aura-vault-backups-replica",
      "StorageClass": "STANDARD_IA"
    }
  }]
}
```

---

## Point-in-Time Recovery (PITR)

Enable WAL archiving on PostgreSQL to support PITR between daily snapshots.

```ini
# postgresql.conf
wal_level = replica
archive_mode = on
archive_command = 'aws s3 cp %p s3://${S3_BUCKET}/wal/%f'
```

Recover to an arbitrary timestamp:

```bash
# Restore base backup, then replay WAL up to target time
restore_command = 'aws s3 cp s3://${S3_BUCKET}/wal/%f %p'
recovery_target_time = '2026-06-24 15:30:00 UTC'
```

---

## Recovery Procedures

### RTO / RPO Targets

| Scenario | RPO | RTO |
|---|---|---|
| Single table corruption | < 24 h | < 2 h |
| Full database loss | < 24 h | < 4 h |
| Region outage | < 24 h | < 8 h |

### Step-by-step: Restore from Backup

```bash
# 1. Identify the backup to restore
aws s3 ls s3://${S3_BUCKET}/backups/ --recursive | sort | tail -5

# 2. Download
aws s3 cp s3://${S3_BUCKET}/backups/<TIMESTAMP>/db.sql.gz.gpg /tmp/

# 3. Decrypt
gpg --batch --decrypt --output /tmp/restore.sql.gz /tmp/db.sql.gz.gpg

# 4. Restore
createdb ${DB_NAME}_restore
gunzip -c /tmp/restore.sql.gz | psql ${DB_NAME}_restore

# 5. Validate row counts
psql ${DB_NAME}_restore -c "SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC;"

# 6. Swap (with maintenance window)
psql -c "ALTER DATABASE ${DB_NAME} RENAME TO ${DB_NAME}_old;"
psql -c "ALTER DATABASE ${DB_NAME}_restore RENAME TO ${DB_NAME};"
```

---

## Backup Monitoring

A weekly scheduled workflow (`backup-verify.yml`) downloads the latest backup,
decrypts it, and runs a smoke-test restore to verify integrity.

Alert on:
- Backup job failure (GitHub Actions notification or PagerDuty)
- Backup file missing from S3 after expected window
- Restore smoke-test failure

---

## Secrets Backup

Application secrets (Stellar keypairs, API keys) are stored in a secrets manager
(AWS Secrets Manager or HashiCorp Vault). Ensure:

1. Secrets manager has automated snapshots enabled.
2. Recovery keys for the GPG backup key are stored offline in a physical safe.
3. At least two team members have access to the recovery keys.
