# Secrets management

Aura Vault uses AWS Secrets Manager as the managed secrets vault for API keys,
database credentials, webhook signing keys, JWT signing material, and email
provider credentials. Secret values must not be committed to source, Terraform
variable files, Docker images, or user data.

## Environment layout

Each environment has isolated secrets:

- `aura-vault/dev/app`
- `aura-vault/staging/app`
- `aura-vault/prod/app`
- `aura-vault/<env>/database/master`

The backend receives only secret ARNs and non-secret configuration:

- `SECRETS_PROVIDER=aws`
- `APP_SECRETS_ID=<environment app secret ARN>`
- `AWS_REGION=<deployment region>`
- `DB_SECRET_ID=<environment database secret ARN>`

## Creating and updating values

Seed values out of band so Terraform state does not contain API keys:

```bash
aws secretsmanager put-secret-value \
  --secret-id aura-vault/prod/app \
  --secret-string file://secrets.prod.json
```

Delete the local JSON file immediately after the value is loaded. Do not commit
it or add it to ticket attachments.

## Rotation

Database and application secret rotation are defined in Terraform with a 30-day
schedule. Set `secrets_rotation_lambda_arn` to the approved rotation Lambda ARN
for the environment before applying Terraform.

Rotation runbook:

1. Confirm the rotation Lambda has provider-specific permissions.
2. Run `terraform plan` and verify `aws_secretsmanager_secret_rotation` resources
   are present for the target environment.
3. Apply Terraform.
4. Trigger a manual rotation in AWS Secrets Manager.
5. Confirm the backend logs `secret_access` events without authentication or
   email delivery errors.

## Access control and auditing

Backend instances use an IAM instance profile that allows only
`secretsmanager:DescribeSecret` and `secretsmanager:GetSecretValue` on the
current environment's app and database secrets. Human access is limited to the
production break-glass role and audited administrator roles.

Secrets Manager API calls are written to the
`/aws/aura-vault/<env>/secrets-audit` CloudWatch log group through EventBridge
CloudTrail events. The backend also emits structured `secret_access` audit
events on cache hits, cache misses, and errors.

## Local development

Use `backend/.env.example` as the template, then create an untracked
`backend/.env.local` for local-only values. The root `.gitignore` blocks `.env`
and `.env.*` files while preserving checked-in examples.

Local development may use `SECRETS_PROVIDER=env`. Production must use
`SECRETS_PROVIDER=aws`; the backend rejects production startup paths that try to
read directly from process environment secrets.

## Emergency access

Emergency access is break-glass only:

1. Open an incident with reason, affected environment, and expected duration.
2. Assume the production break-glass IAM role with MFA.
3. Retrieve only the named secret version required for mitigation.
4. Rotate the accessed secret immediately after the incident is stable.
5. Attach CloudWatch audit log excerpts and rotation confirmation to the
   incident before closure.

If a secret is suspected to be exposed, disable affected provider credentials,
rotate through Secrets Manager, redeploy affected services, and invalidate any
tokens signed with the exposed material.
