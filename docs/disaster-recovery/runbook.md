# Disaster Recovery Runbook

**RTO target: < 2 hours | RPO target: < 1 hour**

## Backup Strategy (3-2-1 Rule)
- **3 copies**: production data + daily snapshot + cross-region replica
- **2 media types**: RDS automated snapshots + S3 exports
- **1 offsite**: cross-region replication to `us-west-2` (primary region: `us-east-1`)

| Backup Type | Retention | Schedule |
|---|---|---|
| RDS daily snapshot | 7 days | 02:00 UTC |
| RDS weekly snapshot | 30 days | Sunday 03:00 UTC |
| RDS monthly snapshot | 365 days | 1st of month 04:00 UTC |
| S3 versioning | 90 days | Continuous |

## Restore Procedure

### RDS Restore (target: < 90 min)
```bash
# 1. Identify latest snapshot
aws rds describe-db-snapshots \
  --db-instance-identifier aura-vault-prod \
  --query 'reverse(sort_by(DBSnapshots, &SnapshotCreateTime))[0].DBSnapshotIdentifier' \
  --output text

# 2. Restore to new instance
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier aura-vault-restore \
  --db-snapshot-identifier <snapshot-id> \
  --db-instance-class db.t3.medium \
  --no-multi-az

# 3. Update SSM parameter / Secrets Manager with new endpoint
aws secretsmanager update-secret \
  --secret-id aura-vault/prod/db \
  --secret-string '{"host":"<new-endpoint>","port":5432}'

# 4. Trigger ECS service restart to pick up new endpoint
aws ecs update-service --cluster aura-vault-prod --service backend --force-new-deployment
```

### Point-in-Time Recovery
```bash
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier aura-vault-prod \
  --target-db-instance-identifier aura-vault-pitr \
  --restore-time <ISO8601-timestamp>
```

### S3 Object Recovery
```bash
aws s3api list-object-versions --bucket aura-vault-static-prod --prefix <key>
aws s3api get-object --bucket aura-vault-static-prod --key <key> \
  --version-id <version-id> recovered-file
```

## Monthly Restore Test Checklist
- [ ] Run `restore-test` Lambda (or manually trigger restore procedure)
- [ ] Verify application health on restored instance
- [ ] Record actual RTO/RPO in `docs/disaster-recovery/test-log.md`
- [ ] Confirm restored instance is terminated after test
- [ ] Update this runbook if any steps failed

## Contacts
| Role | Name | On-call |
|---|---|---|
| Primary DR Lead | See on-call rotation | PagerDuty |
| DBA | See on-call rotation | PagerDuty |
| Infra Lead | See on-call rotation | PagerDuty |
