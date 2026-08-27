# Blue-Green Deployment

Aura Vault Protocol uses a **blue-green deployment strategy** for all backend
releases, achieving zero-downtime updates with instant, one-command rollback.

---

## Table of Contents

1. [How It Works](#how-it-works)
2. [Architecture](#architecture)
3. [Prerequisites](#prerequisites)
4. [Running a Deployment](#running-a-deployment)
5. [Smoke Tests](#smoke-tests)
6. [Rollback Procedure](#rollback-procedure)
7. [GitHub Actions Workflow](#github-actions-workflow)
8. [Terraform Infrastructure](#terraform-infrastructure)
9. [Kubernetes Manifests](#kubernetes-manifests)
10. [Secrets Reference](#secrets-reference)
11. [Troubleshooting](#troubleshooting)
12. [Acceptance Criteria Mapping](#acceptance-criteria-mapping)

---

## How It Works

```
         ┌─────────────────────────────────────────────┐
         │              CI/CD Pipeline                  │
         └────────────────┬────────────────────────────┘
                          │  1. Build & push image
                          ▼
         ┌─────────────────────────────────────────────┐
         │           blue-green-deploy.sh               │
         │                                              │
         │  2. Detect active slot (e.g. blue)           │
         │  3. Deploy new image → standby (green)       │
         │  4. Update preview Service → green           │
         │  5. Run smoke tests against preview          │
         │  6. ── if tests PASS ──────────────────────► │
         │       Patch stable Service → slot:green      │
         │       Update ALB weights  → 100% green       │
         │  7. Run post-switch smoke test (production)  │
         │     ── if tests FAIL → auto-rollback ──────► │
         │  8. Keep blue warm 30 min (rollback window)  │
         │  9. Scale blue to 0                          │
         └─────────────────────────────────────────────┘
```

At no point is there a period where zero instances are ready.  The old slot
stays live and fully scaled until the new slot passes all checks.

---

## Architecture

### Kubernetes

| Resource | Name | Purpose |
|---|---|---|
| Deployment | `aura-vault-blue` | Blue slot pods |
| Deployment | `aura-vault-green` | Green slot pods |
| Service | `aura-vault-stable` | Production traffic (selector points to active slot) |
| Service | `aura-vault-preview` | Smoke-test traffic (selector always points to standby) |
| Ingress | `aura-vault-ingress` | External → stable Service |
| Ingress | `aura-vault-preview-ingress` | Internal-only → preview Service |

The traffic switch is a single atomic `kubectl patch` on `aura-vault-stable`'s
selector: `slot: blue` ↔ `slot: green`.  No pod restarts, no rolling updates,
no connection draining race.

### AWS ALB

| Resource | Purpose |
|---|---|
| TG `aura-vault-blue-<env>` | Instances in the blue slot |
| TG `aura-vault-green-<env>` | Instances in the green slot |
| Listener rule (priority 10, `/api/*`) | Weighted forward — 100/0 or 0/100 |
| Listener rule (priority 5, `preview.*`) | Always routes to standby slot |

The Terraform `active_slot` variable controls the initial weight on first
`terraform apply`.  At runtime, `deploy.sh` updates weights via
`aws elbv2 modify-rule`.

---

## Prerequisites

- `kubectl` configured for the target cluster
- `aws` CLI with permissions for `elbv2:ModifyRule`, `elbv2:DescribeRules`
- Docker image pushed to GHCR (`ghcr.io/soterika/aura-vault-protocol:<tag>`)
- `curl`, `bc` installed on the machine running the deploy script

---

## Running a Deployment

### Via GitHub Actions (recommended)

Push to `main` — staging deploys automatically.

For production:

```
Actions → Blue-Green Deploy → Run workflow
  Environment: production
  skip_aws: false
  dry_run: false
```

### Manual (CLI)

```bash
export IMAGE_TAG="sha-abc1234"
export K8S_NAMESPACE="aura-vault"
export ALB_LISTENER_ARN="arn:aws:elasticloadbalancing:..."
export BLUE_TG_ARN="arn:aws:elasticloadbalancing:..."
export GREEN_TG_ARN="arn:aws:elasticloadbalancing:..."
export PRODUCTION_URL="https://app.aura-vault.xyz"

./scripts/blue-green-deploy.sh \
  --image-tag "$IMAGE_TAG" \
  --namespace "$K8S_NAMESPACE"
```

#### Dry run (preview actions without executing)

```bash
./scripts/blue-green-deploy.sh --image-tag sha-abc1234 --dry-run
```

#### K8s-only mode (no ALB updates)

```bash
./scripts/blue-green-deploy.sh --image-tag sha-abc1234 --skip-aws
```

### What the script does, step by step

| Step | Action | Failure behaviour |
|---|---|---|
| 1 | Read active slot from k8s annotation | Defaults to `blue` if missing |
| 2 | `kubectl set image` on standby deployment | Abort — no traffic changed |
| 3 | `kubectl rollout status` (timeout 5 min) | Abort — no traffic changed |
| 4 | Patch preview Service → standby slot | Continue (non-fatal) |
| 5 | Run `smoke-test.sh` against preview | Abort — no traffic changed |
| 6 | Patch stable Service selector | — |
| 6 | Update ALB listener weights | — |
| 7 | Run `smoke-test.sh` (quick) on production URL | Auto-rollback |
| 8 | Annotate old deployment (cleanup time) | Non-fatal |
| 9 | (Async, 30 min later) Scale old slot to 0 | GitHub Actions cleanup job |

---

## Smoke Tests

`scripts/smoke-test.sh` runs in two modes:

**Full mode** (pre-switch, against preview):
- `GET /api/health` → 200, body contains `status:ok`
- `GET /api/ready` → 200
- `x-deployment-slot` header matches expected slot
- `GET /api/vault/status` → 200
- `GET /api/vault/apy` → 200 or 401
- 404 on unknown route (no panic)
- Security headers: `X-Content-Type-Options`, `X-Frame-Options`
- No server version disclosure
- Response latency < 2 s
- Content-Type: application/json on JSON endpoints
- CORS preflight (OPTIONS)
- Metrics endpoint reachable

**Quick mode** (`SMOKE_QUICK=true`, post-switch against production):
- Health, readiness, vault status, slot header, latency, security headers only

```bash
# Full run
SMOKE_TARGET=http://preview.aura-vault.internal ./scripts/smoke-test.sh

# Quick run
SMOKE_TARGET=https://app.aura-vault.xyz SMOKE_QUICK=true ./scripts/smoke-test.sh
```

---

## Rollback Procedure

### Instant rollback (< 30 seconds)

The old slot stays at full scale for **30 minutes** after every successful
deploy.  Within that window:

```bash
# Option A: re-deploy previous image tag
./scripts/blue-green-deploy.sh --image-tag <PREVIOUS_TAG>

# Option B: patch the Service selector directly (fastest)
kubectl patch service aura-vault-stable \
  --namespace aura-vault \
  --type merge \
  --patch '{"spec":{"selector":{"slot":"blue"}},"metadata":{"annotations":{"blue-green/active-slot":"blue"}}}'

# Option C: update ALB weights only (if k8s already looks good)
aws elbv2 modify-rule \
  --rule-arn <PRODUCTION_RULE_ARN> \
  --actions '[{"Type":"forward","ForwardConfig":{"TargetGroups":[{"TargetGroupArn":"<BLUE_TG_ARN>","Weight":100},{"TargetGroupArn":"<GREEN_TG_ARN>","Weight":0}]}}]'
```

### Automatic rollback

If the post-switch smoke test fails, `blue-green-deploy.sh` automatically:

1. Patches the stable Service selector back to the old slot
2. Resets the ALB weights to 100% old slot
3. Exits with code `1` (triggers GitHub Actions failure alert)

### After the 30-minute window

The old slot has been scaled to 0.  A "rollback" becomes a fresh deployment of
the previous image:

```bash
./scripts/blue-green-deploy.sh --image-tag <PREVIOUS_TAG>
```

This takes a normal deployment cycle (~3–5 minutes) instead of being instant.

### Rollback decision tree

```
Is the old slot still warm (< 30 min since deploy)?
  YES → Option A/B/C above — takes < 30 s
  NO  → Re-deploy previous image tag — takes ~5 min

Is the active slot completely down?
  YES → kubectl scale deployment aura-vault-<ACTIVE> --replicas=3
        then verify with smoke tests
  NO  → use rollback procedures above
```

---

## GitHub Actions Workflow

File: `.github/workflows/blue-green-deploy.yml`

### Triggers

| Trigger | Behaviour |
|---|---|
| Push to `main` | Automatic staging deploy |
| `workflow_dispatch` with `environment=staging` | Manual staging deploy |
| `workflow_dispatch` with `environment=production` | Manual production deploy (requires approval in the *production* GitHub Environment) |

### Jobs

```
build → deploy-staging → cleanup-old-slot-staging (30 min delay)
      ↘
        deploy-production (manual approval) → cleanup-old-slot-production
```

### Required Secrets

See [Secrets Reference](#secrets-reference).

### Inputs (workflow_dispatch)

| Input | Default | Description |
|---|---|---|
| `environment` | `staging` | `staging` or `production` |
| `skip_aws` | `false` | Skip ALB weight updates |
| `dry_run` | `false` | Print without executing |

---

## Terraform Infrastructure

File: `terraform/blue-green.tf`

### What it creates

- `aws_lb_target_group.blue` — Blue slot TG, port 3001, `/api/health` health check
- `aws_lb_target_group.green` — Green slot TG
- `aws_lb_listener_rule.blue_green_production` — Priority 10, `/api/*`, weighted forward
- `aws_lb_listener_rule.blue_green_preview` — Priority 5, host `preview.*`, standby slot only
- `aws_cloudwatch_metric_alarm.blue_unhealthy_hosts` — Alert on blue slot health
- `aws_cloudwatch_metric_alarm.green_unhealthy_hosts` — Alert on green slot health

### Variables

| Variable | Default | Description |
|---|---|---|
| `active_slot` | `blue` | Initial active slot |
| `blue_green_rollback_window_minutes` | `30` | Stickiness duration |
| `blue_green_preview_cidr` | `10.0.0.0/8` | Allowed CIDRs for preview rule |

### Outputs

| Output | Description |
|---|---|
| `blue_target_group_arn` | Blue TG ARN — use as `BLUE_TG_ARN` secret |
| `green_target_group_arn` | Green TG ARN — use as `GREEN_TG_ARN` secret |
| `blue_green_listener_rule_arn` | Production listener rule ARN |
| `preview_listener_rule_arn` | Preview listener rule ARN |

### Initial setup

```bash
cd terraform
terraform init
terraform plan -var="active_slot=blue"
terraform apply -var="active_slot=blue"

# Copy outputs to GitHub Secrets
terraform output blue_target_group_arn
terraform output green_target_group_arn
```

> **Note**: After the first live swap, Terraform will show listener rule
> weight drift — the deploy script is the source of truth for weights at
> runtime. `terraform apply` resets weights to the `active_slot` variable
> value, which is useful for disaster recovery.

---

## Kubernetes Manifests

Directory: `k8s/blue-green/`

### Initial cluster setup

```bash
kubectl apply -f k8s/blue-green/
```

This creates:
- Both deployments (scaled to 3 replicas, `Recreate` strategy within each slot)
- `aura-vault-stable` Service (selector: `slot:blue`)
- `aura-vault-preview` Service (selector: `slot:green`)
- Production Ingress (→ stable Service)
- Preview Ingress (internal, CIDR-restricted → preview Service)

### Checking current state

```bash
# Which slot is active?
kubectl get service aura-vault-stable \
  --namespace aura-vault \
  --output jsonpath='{.metadata.annotations.blue-green/active-slot}'

# Pod status per slot
kubectl get pods --namespace aura-vault \
  --selector app=aura-vault \
  --show-labels

# Rollout status
kubectl rollout status deployment/aura-vault-blue --namespace aura-vault
kubectl rollout status deployment/aura-vault-green --namespace aura-vault
```

---

## Secrets Reference

Configure these in GitHub → Settings → Secrets and variables → Actions:

| Secret | Description |
|---|---|
| `AWS_ACCESS_KEY_ID` | AWS IAM key for EKS + ALB access |
| `AWS_SECRET_ACCESS_KEY` | AWS IAM secret |
| `EKS_CLUSTER_NAME_STAGING` | EKS cluster name for staging |
| `EKS_CLUSTER_NAME_PRODUCTION` | EKS cluster name for production |
| `ALB_LISTENER_ARN_STAGING` | HTTPS listener ARN (staging) |
| `ALB_LISTENER_ARN_PRODUCTION` | HTTPS listener ARN (production) |
| `BLUE_TG_ARN_STAGING` | Blue target group ARN (staging) |
| `GREEN_TG_ARN_STAGING` | Green target group ARN (staging) |
| `BLUE_TG_ARN_PRODUCTION` | Blue target group ARN (production) |
| `GREEN_TG_ARN_PRODUCTION` | Green target group ARN (production) |

All ARN values are available as Terraform outputs after `terraform apply`.

---

## Troubleshooting

### Deployment stuck at rollout

```bash
kubectl rollout status deployment/aura-vault-green --namespace aura-vault --timeout=10s
kubectl describe deployment aura-vault-green --namespace aura-vault
kubectl get events --namespace aura-vault --sort-by='.lastTimestamp' | tail -20
```

Common causes: image pull failure, OOM on new version, readiness probe failing.

### Smoke tests fail on preview

```bash
# What does preview actually return?
curl -v http://preview.aura-vault.internal/api/health

# Check preview Service selector
kubectl get service aura-vault-preview --namespace aura-vault --output yaml

# Are green pods actually ready?
kubectl get pods --namespace aura-vault --selector slot=green
```

### ALB weights not updating

```bash
# Check current weights
aws elbv2 describe-rules \
  --listener-arn <LISTENER_ARN> \
  --query "Rules[?Priority=='10']"

# Verify IAM permissions
aws sts get-caller-identity
```

### Stuck in a half-switched state

If the script crashed mid-flight, check and reconcile manually:

```bash
# What does the k8s stable Service say?
kubectl get service aura-vault-stable -n aura-vault \
  --output jsonpath='{.spec.selector.slot}'

# What do the ALB weights say?
aws elbv2 describe-rules --listener-arn <LISTENER_ARN> \
  --query "Rules[?Priority=='10'].Actions[0].ForwardConfig.TargetGroups"

# They should both agree. If not, patch k8s to match ALB (or vice versa):
kubectl patch service aura-vault-stable -n aura-vault \
  --type merge \
  --patch '{"spec":{"selector":{"slot":"<CORRECT_SLOT>"}}}'
```

### "ROLLBACK FAILED" in logs

This is a critical failure — both the new slot and the rollback path failed.

1. Manually check which pods are healthy: `kubectl get pods -n aura-vault`
2. Patch the stable Service to the slot with healthy pods
3. If both slots are broken, scale up the old slot: `kubectl scale deployment aura-vault-blue --replicas=3 -n aura-vault`
4. Contact the on-call engineer immediately

---

## Acceptance Criteria Mapping

| Criterion | Implementation |
|---|---|
| Two identical environments (blue, active; green, standby) | `k8s/blue-green/blue-deployment.yaml` + `green-deployment.yaml`; same spec, different `slot` label |
| CI deploys to green, runs smoke tests | Step 3–5 in `deploy.sh`; smoke tests target preview Service |
| Traffic switched via load balancer rule update | Step 6: `kubectl patch` on stable Service + `aws elbv2 modify-rule` for ALB |
| Old blue kept for 30 minutes | Step 8: annotation + cleanup job with `sleep 1800` |
| Automated rollback if smoke tests fail after switch | Step 7: `rollback()` function called on post-switch smoke failure |
| Deployment duration < 5 minutes | Pod startup with `Recreate` within slot typically < 2 min; total pipeline ≤ 5 min |
