# Secrets Rotation — AWS Lambda

Automated rotation of database passwords and JWT secrets using AWS Lambda triggered by Secrets Manager.

## Architecture

```
Secrets Manager (schedule)
        │
        ├─ every 30 days ──▶  db-rotation Lambda
        │                         │
        │                    4-step protocol:
        │                    1. createSecret  → generate new password
        │                    2. setSecret     → ALTER USER in Postgres
        │                    3. testSecret    → verify connection
        │                    4. finishSecret  → promote AWSPENDING → AWSCURRENT
        │                         │
        │                    AWSPREVIOUS kept for 1h (grace period)
        │
        └─ every 7 days  ──▶  jwt-rotation Lambda
                                  │
                              Same 4-step protocol
                              AWSPREVIOUS kept for 1h (dual-token grace)
```

### Zero-Downtime Rotation (Grace Period)

During the 1-hour grace period after rotation, the application accepts tokens/connections using **both** the new (AWSCURRENT) and old (AWSPREVIOUS) secret. The `SecretsPoller` fetches both versions and exposes them via `getDualSecrets()`.

The polling interval is **4 minutes** (< the 5-minute SLA), so within 4 minutes of rotation completing, all application instances will have the new secret cached.

## Directory Structure

```
infrastructure/
├── lambda/secrets-rotation/
│   ├── src/
│   │   ├── db-rotation.ts     # DB password rotation handler
│   │   ├── jwt-rotation.ts    # JWT secret rotation handler
│   │   └── secret-poller.ts   # Application-side polling module
│   ├── package.json
│   └── tsconfig.json
└── terraform/secrets-rotation/
    ├── main.tf                # Lambda, IAM, rotation schedule, alarms
    ├── variables.tf
    └── outputs.tf
```

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `GRACE_PERIOD_SECONDS` | How long AWSPREVIOUS remains usable | `3600` |
| `DB_PORT` | PostgreSQL port | `5432` |
| `JWT_SECRET_BYTES` | Entropy bytes for JWT secret | `64` |
| `SECRETS_MANAGER_ENDPOINT` | Custom SM endpoint (for tests) | — |

## Terraform Variables

| Variable | Description | Default |
|---|---|---|
| `environment` | `staging` or `production` | required |
| `db_secret_arn` | ARN of the DB credentials secret | required |
| `jwt_secret_arn` | ARN of the JWT secret | required |
| `db_rotation_days` | DB rotation frequency (days) | `30` |
| `jwt_rotation_days` | JWT rotation frequency (days) | `7` |
| `alert_email` | Email for rotation failure alerts | `""` |
| `aws_region` | AWS region | `us-east-1` |

## Deployment

### Prerequisites

- AWS CLI configured with sufficient permissions
- Terraform >= 1.8.0
- Node.js 20, npm

### 1. Build Lambda deployment package

```bash
cd infrastructure/lambda/secrets-rotation
npm install
npm run package
# Produces: lambda-deployment.zip
```

### 2. Create the Secrets Manager secrets (if not already existing)

```bash
# Database credentials
aws secretsmanager create-secret \
  --name aura-vault/staging/db-credentials \
  --description "Aura Vault DB credentials" \
  --secret-string '{"username":"aura","password":"initial-password","host":"db.example.com","port":5432,"dbname":"aura_vault"}'

# JWT secret
aws secretsmanager create-secret \
  --name aura-vault/staging/jwt-secret \
  --description "Aura Vault JWT signing secret" \
  --secret-string '{"secret":"initial-64-byte-hex","createdAt":"2026-01-01T00:00:00Z","generation":0}'
```

### 3. Deploy Terraform (staging first)

```bash
cd infrastructure/terraform/secrets-rotation

terraform init
terraform plan -var="environment=staging" \
               -var="db_secret_arn=arn:aws:secretsmanager:us-east-1:123456789:secret:aura-vault/staging/db-credentials" \
               -var="jwt_secret_arn=arn:aws:secretsmanager:us-east-1:123456789:secret:aura-vault/staging/jwt-secret" \
               -var="alert_email=oncall@example.com"

terraform apply  # review plan, type 'yes'
```

### 4. Enable in production (after staging validation)

```bash
terraform apply -var="environment=production" \
                -var="db_secret_arn=arn:aws:secretsmanager:us-east-1:123456789:secret:aura-vault/production/db-credentials" \
                -var="jwt_secret_arn=arn:aws:secretsmanager:us-east-1:123456789:secret:aura-vault/production/jwt-secret"
```

## Testing Rotation Manually

### Trigger immediate rotation

```bash
# DB rotation
aws secretsmanager rotate-secret \
  --secret-id aura-vault/staging/db-credentials \
  --rotate-immediately

# JWT rotation
aws secretsmanager rotate-secret \
  --secret-id aura-vault/staging/jwt-secret \
  --rotate-immediately
```

### Verify rotation completed

```bash
# Check version stages
aws secretsmanager describe-secret \
  --secret-id aura-vault/staging/db-credentials \
  --query 'VersionIdsToStages'

# Check Lambda logs
aws logs tail /aws/lambda/aura-vault-staging-db-rotation --follow
```

### Test with curl (staging)

```bash
# Fetch the new secret to verify it was rotated
aws secretsmanager get-secret-value \
  --secret-id aura-vault/staging/db-credentials \
  --version-stage AWSCURRENT \
  --query SecretString \
  --output text | jq .
```

## Application Integration

Import `SecretsPoller` from `secret-poller.ts` in your backend service:

```typescript
import { getPoller, JwtSecretPayload, DbSecretPayload } from './secret-poller';

// Singletons — created once at startup
const jwtPoller = getPoller<JwtSecretPayload>(process.env.JWT_SECRET_ARN!);
const dbPoller  = getPoller<DbSecretPayload>(process.env.DB_SECRET_ARN!);

// JWT middleware — accept tokens signed by current OR previous secret
async function verifyJwt(token: string): Promise<Payload> {
  const [current, previous] = await jwtPoller.getDualSecrets();
  const secrets = [current.secret, previous?.secret].filter(Boolean);
  for (const secret of secrets) {
    try { return jwt.verify(token, secret) as Payload; } catch {}
  }
  throw new Error('Invalid token');
}

// DB connection
async function getDbConfig() {
  const db = await dbPoller.getSecret();
  return { host: db.host, user: db.username, password: db.password, database: db.dbname };
}
```

## Monitoring and Alerts

Rotation failures trigger CloudWatch alarms that publish to the SNS topic.  Subscribe additional endpoints (PagerDuty, Slack) to `aura-vault-{env}-rotation-alerts` as needed.

Check the CloudWatch dashboard for:
- `AWS/Lambda` → `Errors` for each rotation function
- `AWS/SecretsManager` → `RotationSuccessful` / `RotationFailed`

## Staging vs Production

Always validate rotation in **staging** before enabling in production:

1. Deploy to staging, trigger manual rotation, verify application continues working
2. Monitor for 1 complete rotation cycle (30 days for DB, 7 days for JWT)
3. Enable in production only after staging validation passes
