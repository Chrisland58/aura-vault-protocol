# Aura Vault Protocol — Monitoring & Alerting Runbook

> **Issue:** [#398 — Write monitoring and alerting runbook for operations team](https://github.com/soterika/aura-vault-protocol/issues/398)  
> **Audience:** On-call engineers, SREs, and incident commanders.  
> **Review status:** Draft — must be reviewed by on-call team before going live.

## Table of Contents

1. [Quick Reference](#quick-reference)
2. [Monitoring Stack Overview](#monitoring-stack-overview)
3. [Incident Commander Checklist](#incident-commander-checklist)
4. [Alert Runbooks](#alert-runbooks)
   - [ServiceDown](#servicedown)
   - [HighErrorRate](#higherrorrate)
   - [HighLatency](#highlatency)
   - [HighMemoryUsage](#highmemoryusage)
   - [SLABreachAvailability](#slabreachavailability)
   - [SLABreachLatency](#slabreachlatency)
   - [TransactionFailureRate](#transactionfailurerate)
   - [VaultBalanceLow](#vaultbalancelow)
5. [Escalation Matrix](#escalation-matrix)
6. [Post-Incident Review Template](#post-incident-review-template)
7. [Dashboard Reference](#dashboard-reference)
8. [Common Log Queries](#common-log-queries)

---

## Quick Reference

| Service | URL (local Docker) | URL (K8s) |
|---------|-------------------|-----------|
| Grafana | http://localhost:3001 | https://grafana.your-domain.com |
| Prometheus | http://localhost:9090 | port-forward or ingress |
| Alertmanager | http://localhost:9093 | port-forward or ingress |
| Jaeger | http://localhost:16686 | port-forward or ingress |
| Loki (via Grafana) | Grafana → Explore → Loki | same |
| Stellar Explorer | https://stellar.expert/explorer/public | — |
| SDF Status | https://status.stellar.org | — |

```bash
# Access Prometheus in K8s without ingress
kubectl port-forward svc/kube-prometheus-stack-prometheus 9090:9090 -n aura-monitoring

# Access Grafana in K8s without ingress
kubectl port-forward svc/kube-prometheus-stack-grafana 3001:80 -n aura-monitoring

# Access Alertmanager in K8s without ingress
kubectl port-forward svc/kube-prometheus-stack-alertmanager 9093:9093 -n aura-monitoring
```

Grafana credentials:
- **Username:** `admin`
- **Password:** stored in the `aura-vault-secrets` Kubernetes Secret under `GF_ADMIN_PASSWORD`  
  (`kubectl get secret aura-vault-secrets -n aura-vault -o jsonpath='{.data.GF_ADMIN_PASSWORD}' | base64 -d`)

---

## Monitoring Stack Overview

```
Application metrics (Prometheus scrape /metrics)
       │
       ▼
  Prometheus  ──────────────────────────────── Alertmanager
  (stores     evaluates alert.rules.yml        (routes alerts to
   TSDB)       every 15s                        PagerDuty / Slack)
       │
       ▼
   Grafana ◄──── Loki (structured logs via Promtail)
   (dashboards)      │
                      └── Jaeger (distributed traces, OTLP)
```

| Component | Version | Role |
|-----------|---------|------|
| Prometheus | 2.53.0 | Metrics collection and alert evaluation |
| Grafana | 11.1.0 | Dashboards and log exploration |
| Loki | 3.1.0 | Centralised log aggregation |
| Promtail | 3.1.0 | Log shipping agent |
| Jaeger | 1.58 | Distributed tracing (OTLP) |
| Alertmanager | 0.27.0 | Alert deduplication and routing |

Alert rule groups:

| Group | Alerts |
|-------|--------|
| `aura-vault-critical` | ServiceDown, HighErrorRate, HighLatency, HighMemoryUsage |
| `aura-vault-sla` | SLABreachAvailability, SLABreachLatency |
| `aura-vault-blockchain` | TransactionFailureRate, VaultBalanceLow |

---

## Incident Commander Checklist

Use this checklist at the start of every P0 or P1 incident.

- [ ] **Acknowledge** the alert in Alertmanager / PagerDuty within SLA (P0: 15 min, P1: 60 min)
- [ ] **Open a war-room** channel in Slack: `#incident-YYYYMMDD-<short-description>`
- [ ] **Assign roles:** Incident Commander (IC), Scribe, Subject Matter Expert (SME)
- [ ] **Scope the blast radius:** How many users are affected? Which components are failing?
- [ ] **Check Grafana** → System Health dashboard for the failing service
- [ ] **Check Prometheus alerts** at http://localhost:9090/alerts (or port-forward)
- [ ] **Check recent deployments** — did anything ship in the last 2 hours?
- [ ] **Run the relevant alert runbook** (see sections below)
- [ ] **Communicate status** to stakeholders every 30 minutes while the incident is active
- [ ] **Resolve** the alert and verify recovery in Grafana
- [ ] **Write post-incident review** within 48 hours (use the [template](#post-incident-review-template))
- [ ] **Close the incident** channel, link PIR document

---

## Alert Runbooks

---

### ServiceDown

**Alert name:** `ServiceDown`  
**Severity:** 🔴 Critical  
**Rule file:** `monitoring/prometheus/alert.rules.yml`

```yaml
alert: ServiceDown
expr: up == 0
for: 1m
```

**What it means:**  
A Prometheus scrape target has been unreachable for at least 1 minute. This can be the frontend, backend API, or any monitored sidecar.

**Symptoms:**
- Grafana System Health dashboard shows a red "down" indicator for the affected service
- Users may report 502/504 errors or blank pages
- Alertmanager fires a `ServiceDown` notification

**Immediate actions:**

1. Identify which target is down:
   ```
   Prometheus → Status → Targets
   # OR
   curl http://localhost:9090/api/v1/query?query=up==0
   ```

2. Check if the pod is running:
   ```bash
   kubectl get pods -n aura-vault
   kubectl describe pod -n aura-vault <pod-name>
   kubectl logs -n aura-vault <pod-name> --previous
   ```

3. If it is a crash loop, check the last 100 log lines:
   ```bash
   kubectl logs -n aura-vault deployment/aura-backend --tail=100
   ```

4. Attempt a restart (only if logs show a recoverable error):
   ```bash
   kubectl rollout restart deployment/aura-backend -n aura-vault
   ```

5. If the issue is a bad deployment, roll back:
   ```bash
   kubectl rollout undo deployment/aura-backend -n aura-vault
   kubectl rollout status deployment/aura-backend -n aura-vault
   ```

6. If infrastructure is unhealthy (node gone, PV lost), escalate to platform team.

**Escalation:**  
If not resolved within 15 minutes → page the on-call platform engineer.

**Grafana link:**  
Grafana → Dashboards → System Health → Service Uptime panel

**Related logs:**  
Grafana → Explore → Loki: `{job="aura-vault"} |= "error"`

---

### HighErrorRate

**Alert name:** `HighErrorRate`  
**Severity:** 🔴 Critical  
**Rule file:** `monitoring/prometheus/alert.rules.yml`

```yaml
alert: HighErrorRate
expr: rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m]) > 0.05
for: 5m
```

**What it means:**  
More than 5% of HTTP responses returned a 5xx status code over a 5-minute window.

**Symptoms:**
- Users reporting errors when depositing, withdrawing, or harvesting
- Grafana Error Rate panel shows a spike above 5%
- High volume of `ERROR` log entries in Loki

**Immediate actions:**

1. Check the error rate panel:
   ```
   Grafana → System Health → Error Rate (5xx %)
   ```

2. Identify which endpoint is failing in Loki:
   ```
   {job="aura-vault"} | json | status >= 500 | line_format "{{.method}} {{.path}} {{.status}} {{.error}}"
   ```

3. Check the backend logs for stack traces:
   ```bash
   kubectl logs -n aura-vault deployment/aura-backend --tail=200 | grep -i "error\|exception\|panic"
   ```

4. Check if the Soroban RPC endpoint is healthy:
   ```bash
   curl -s https://soroban-testnet.stellar.org/health
   # Production: check https://status.stellar.org
   ```

5. If the error is RPC-related, check for a Stellar network incident at https://status.stellar.org

6. If errors are contract-specific (transaction simulation failing), check recent contract transactions on [Stellar Expert](https://stellar.expert/).

7. If a specific code path is causing 500s and cannot be fixed immediately, consider enabling the circuit breaker or applying a feature flag.

**Escalation:**  
If error rate exceeds 20% or is sustained for more than 10 minutes → P0, page backend engineer.

**Grafana link:**  
Grafana → Dashboards → System Health → Error Rate panel

**Related logs:**  
Loki: `{job="aura-vault"} | json | level="error"`  
Jaeger: Search by service `aura-backend`, filter by `error=true`

---

### HighLatency

**Alert name:** `HighLatency`  
**Severity:** 🟡 Warning  
**Rule file:** `monitoring/prometheus/alert.rules.yml`

```yaml
alert: HighLatency
expr: histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 2
for: 5m
```

**What it means:**  
The 95th percentile response time for HTTP requests has exceeded 2 seconds for 5 consecutive minutes.

**Symptoms:**
- Users reporting slow transactions or page loads
- Grafana latency panel shows p95 above 2s
- HPA may be scaling up additional backend pods

**Immediate actions:**

1. Identify the slow endpoints in Grafana:
   ```
   Grafana → System Health → p95 Latency by Endpoint
   ```

2. Check for resource saturation on pods:
   ```bash
   kubectl top pods -n aura-vault
   ```

3. Check if HPA is already responding:
   ```bash
   kubectl get hpa -n aura-vault
   kubectl describe hpa aura-backend-hpa -n aura-vault
   ```

4. If pods are CPU or memory bound, HPA should scale within 60 seconds. If it does not:
   - Verify `metrics-server` is running: `kubectl top nodes`
   - Check HPA events: `kubectl describe hpa -n aura-vault`

5. Look for slow database queries in Loki:
   ```
   {job="aura-vault"} | json | duration_ms > 1000 | line_format "{{.query}} took {{.duration_ms}}ms"
   ```

6. Check for slow Soroban RPC calls in Jaeger traces.

7. If the latency is caused by a memory leak (memory growing over time), restart the affected pods and create a ticket to investigate.

**Escalation:**  
If p95 exceeds 5 seconds or persists after scale-out → escalate to backend/infra team.

**Grafana link:**  
Grafana → Dashboards → System Health → Latency (p50/p95/p99) panel

**Related traces:**  
Jaeger UI → Service: `aura-backend` → Sort by duration descending

---

### HighMemoryUsage

**Alert name:** `HighMemoryUsage`  
**Severity:** 🟡 Warning  
**Rule file:** `monitoring/prometheus/alert.rules.yml`

```yaml
alert: HighMemoryUsage
expr: process_resident_memory_bytes / 1024 / 1024 > 512
for: 10m
```

**What it means:**  
A process is using more than 512 MB of resident memory for at least 10 minutes, which may indicate a memory leak or insufficient resource limits.

**Symptoms:**
- Pods approaching or hitting memory limits (`OOMKilled`)
- Degraded performance due to garbage collection pressure
- Grafana memory panel shows sustained high usage

**Immediate actions:**

1. Identify which pod is high-memory:
   ```bash
   kubectl top pods -n aura-vault --sort-by memory
   ```

2. Check if any pod has been OOMKilled recently:
   ```bash
   kubectl get pods -n aura-vault -o json | jq '.items[].status.containerStatuses[].lastState.terminated | select(. != null) | {reason, exitCode}'
   ```

3. If memory is trending upward (not just a spike), the process likely has a memory leak:
   - Note current memory value in Prometheus
   - Schedule a rolling restart during low-traffic hours:
     ```bash
     kubectl rollout restart deployment/aura-backend -n aura-vault
     ```

4. If memory is stable above the threshold but below the pod limit, consider raising the alert threshold and opening a ticket to reduce memory footprint.

5. If OOMKill is imminent, temporarily increase the pod memory limit:
   ```bash
   kubectl set resources deployment/aura-backend \
     -c backend \
     --limits=memory=2Gi \
     -n aura-vault
   ```

**Escalation:**  
If pods are repeatedly OOMKilled or memory grows indefinitely → escalate to backend engineer for root cause analysis.

**Grafana link:**  
Grafana → Dashboards → System Health → Memory Usage panel

---

### SLABreachAvailability

**Alert name:** `SLABreachAvailability`  
**Severity:** 🔴 Critical  
**Rule file:** `monitoring/prometheus/alert.rules.yml`

```yaml
alert: SLABreachAvailability
expr: avg_over_time(up{job="aura-vault-api"}[1h]) < 0.999
for: 5m
```

**What it means:**  
The API availability over the past hour has dropped below the 99.9% SLA target. At 99.9% availability, the allowed downtime is approximately 43 seconds per hour.

**Symptoms:**
- This alert firing means a `ServiceDown` likely already fired and was not resolved quickly enough
- SLA reporting dashboards will show a breach
- Stakeholder escalation required

**Immediate actions:**

1. This is an escalation of `ServiceDown`. Follow the ServiceDown runbook first.

2. Calculate the current availability:
   ```
   Prometheus query:
   avg_over_time(up{job="aura-vault-api"}[1h]) * 100
   ```

3. Notify the engineering lead and product manager immediately — SLA breaches affect commercial commitments.

4. Document the downtime window precisely (start time, end time, affected services) for the PIR.

5. If the root cause was a deployment, initiate a rollback and add the deployment to the post-incident review.

6. Verify recovery: availability must return above 99.9% for at least 10 minutes before the alert resolves.

**Escalation:**  
Immediately notify: Engineering Lead, Product Manager. If breach exceeds 5 minutes → escalate to CTO.

**Grafana link:**  
Grafana → Dashboards → System Health → Availability (1h rolling) panel

---

### SLABreachLatency

**Alert name:** `SLABreachLatency`  
**Severity:** 🟡 Warning  
**Rule file:** `monitoring/prometheus/alert.rules.yml`

```yaml
alert: SLABreachLatency
expr: histogram_quantile(0.99, rate(http_request_duration_seconds_bucket{job="aura-vault-api"}[1h])) > 5
for: 5m
```

**What it means:**  
The p99 latency over the past hour has exceeded the 5-second SLA threshold. 99th percentile means 1 in 100 requests is taking longer than 5 seconds.

**Symptoms:**
- Some users experiencing very slow transactions
- SLA latency panel in Grafana above 5s for p99

**Immediate actions:**

1. Follow the `HighLatency` runbook to identify the slow path.

2. Determine whether latency is caused by:
   - Database bottleneck: check Postgres query times in Loki
   - Soroban RPC slowness: check https://status.stellar.org
   - Backend processing: check Jaeger traces for long spans
   - Cold start (pods just scaled up): monitor for 5 minutes after scale-out

3. If the Soroban RPC is slow but operational, consider adding a timeout to RPC calls and returning a graceful error rather than a hanging request.

4. Document whether this was an isolated spike or a sustained breach for the SLA report.

**Escalation:**  
If p99 > 5s sustained for more than 15 minutes → escalate to backend and infra teams.

**Grafana link:**  
Grafana → Dashboards → System Health → Latency p99 (1h rolling) panel

---

### TransactionFailureRate

**Alert name:** `TransactionFailureRate`  
**Severity:** 🔴 Critical  
**Rule file:** `monitoring/prometheus/alert.rules.yml`

```yaml
alert: TransactionFailureRate
expr: rate(blockchain_transactions_total{status="failed"}[10m]) / rate(blockchain_transactions_total[10m]) > 0.1
for: 5m
```

**What it means:**  
More than 10% of blockchain (Stellar/Soroban) transactions are failing over a 10-minute window.

**Symptoms:**
- Users receiving transaction error messages in the UI (deposit, withdraw, harvest failing)
- Grafana blockchain panel showing elevated failure rate
- Loki logs containing `transaction failed` or `VaultError` codes

**Immediate actions:**

1. Identify the error codes in Loki:
   ```
   {job="aura-vault"} |= "blockchain" | json | level="error"
   | line_format "tx={{.tx_id}} error={{.error_code}} msg={{.message}}"
   ```

2. Classify the failure type:

   | Error Code | Meaning | Action |
   |-----------|---------|--------|
   | `NotInitialized` (1) | Contract not initialized | Re-initialize or check contract ID |
   | `InsufficientShares` (3) | User over-withdrawing | UI validation issue, not critical |
   | `VaultPaused` (11) | Admin paused the vault | Check if pause was intentional |
   | `BalanceMismatch` (12) | Flash loan guard triggered | **Security incident — escalate immediately** |
   | `MathOverflow` (6) | Arithmetic overflow | Contract bug, escalate to development team |

3. If `BalanceMismatch` (12) is appearing, treat this as a **security incident**:
   - Do not attempt to resolve it through normal operations
   - Escalate to the security team immediately
   - Check Stellar Explorer for suspicious transactions on the vault contract

4. If the failure is `VaultPaused`, verify whether the admin intentionally paused:
   ```bash
   stellar contract invoke \
     --id <CONTRACT_ID> \
     --network mainnet \
     -- is_paused
   ```

5. If failures are caused by Soroban RPC errors (not contract errors), check https://status.stellar.org.

6. If failures are caused by insufficient XLM for transaction fees, the `VaultBalanceLow` alert should also be firing — address that first.

**Escalation:**  
`BalanceMismatch` errors → immediate security escalation.  
All other causes > 15 minutes unresolved → page backend engineer.

**Grafana link:**  
Grafana → Dashboards → System Health → Transaction Success Rate panel

**Related logs:**  
Loki: `{job="aura-vault"} |= "blockchain" |= "failed"`

---

### VaultBalanceLow

**Alert name:** `VaultBalanceLow`  
**Severity:** 🟡 Warning  
**Rule file:** `monitoring/prometheus/alert.rules.yml`

```yaml
alert: VaultBalanceLow
expr: vault_balance_xlm < 100
for: 5m
```

**What it means:**  
The vault's XLM balance (used for Stellar transaction fees) has dropped below 100 XLM. If XLM is exhausted, all on-chain operations will fail.

**Symptoms:**
- Grafana Blockchain panel showing vault balance below 100 XLM
- May precede a `TransactionFailureRate` alert if left unaddressed
- Backend logs showing fee-related transaction errors

**Immediate actions:**

1. Check the current vault XLM balance on Stellar Expert:
   ```
   https://stellar.expert/explorer/public/account/<VAULT_CONTRACT_ID>
   ```

2. Verify no unauthorized withdrawals have occurred:
   - Review the last 20 transactions on Stellar Expert
   - Confirm all withdrawals match expected user activity in your backend logs
   - If suspicious transactions are found, escalate to security immediately

3. If the balance drop is legitimate (high transaction volume):
   - Fund the vault account with additional XLM from the treasury
   - Target balance: at minimum 500 XLM to provide a buffer

4. After funding, verify the balance metric updates in Prometheus within the next scrape interval (default 15 seconds).

5. Investigate why the balance dropped unexpectedly and adjust the minimum balance threshold or auto-refill mechanism accordingly.

**Escalation:**  
If balance drops to 0 and transactions start failing → this becomes P1.  
If unauthorized withdrawals are detected → immediately escalate as security incident (P0).

**Grafana link:**  
Grafana → Dashboards → System Health → Vault XLM Balance panel

---

## Escalation Matrix

| Severity | Response SLA | First Contact | Escalation (if unresolved) |
|----------|-------------|---------------|---------------------------|
| P0 — Service completely down | 15 minutes | On-call engineer (PagerDuty) | Engineering Lead at 30 min |
| P1 — Major feature broken | 60 minutes | On-call engineer | Engineering Lead at 2 hours |
| P2 — Minor degradation | 4 hours | Slack `#ops-alerts` | Team lead next business day |
| P3 — Cosmetic / non-urgent | Next business day | GitHub Issue | Product Manager review |
| Security incident | Immediate | Security team + CTO | External audit if breach confirmed |

### Contact List (fill in for your team)

| Role | Name | Contact |
|------|------|---------|
| On-call engineer (rotation) | — | PagerDuty schedule |
| Engineering Lead | — | Slack DM / phone |
| Security Lead | — | `security@aura-vault.dev` |
| Product Manager | — | Slack |
| CTO | — | Phone (P0 only) |

---

## Post-Incident Review Template

Copy this template into a shared document within 48 hours of incident resolution.

```markdown
# PIR — <Short Incident Title>

**Date:** YYYY-MM-DD  
**Duration:** HH:MM (from first alert to resolution)  
**Severity:** P0 / P1 / P2  
**Incident Commander:** <name>  
**Scribe:** <name>

## Summary

One paragraph describing what happened, who was affected, and the outcome.

## Timeline

| Time (UTC) | Event |
|-----------|-------|
| HH:MM | Alert fired |
| HH:MM | IC acknowledged |
| HH:MM | Root cause identified |
| HH:MM | Fix applied |
| HH:MM | Alert resolved, monitoring confirmed |

## Root Cause

Technical explanation of why the incident occurred.

## Impact

- Users affected: <number or percentage>
- Duration of user impact: <HH:MM>
- SLA breach: Yes / No

## What Went Well

- ...

## What Could Be Improved

- ...

## Action Items

| Action | Owner | Due Date |
|--------|-------|---------|
| ... | ... | YYYY-MM-DD |
```

---

## Dashboard Reference

| Dashboard | URL Path | Key Panels |
|-----------|----------|-----------|
| System Health | `/d/system-health` | Uptime, Error Rate, Latency, Memory |
| Blockchain | `/d/blockchain` | Tx Success Rate, Vault Balance, Failed Txs |
| SLA | `/d/sla` | 24h / 7d / 30d availability and latency |

To access a dashboard:
1. Open Grafana (see Quick Reference URLs above)
2. Click Dashboards → Browse
3. Select the dashboard from the list

---

## Common Log Queries

All queries are for the **Loki** datasource in Grafana (Explore tab).

### All errors in the last hour

```logql
{job="aura-vault"} | json | level="error"
```

### 5xx HTTP errors with path and status

```logql
{job="aura-vault"} | json | status >= 500
| line_format "{{.method}} {{.path}} → {{.status}} ({{.error}})"
```

### Slow requests (>1 second)

```logql
{job="aura-vault"} | json | duration_ms > 1000
| line_format "{{.method}} {{.path}} took {{.duration_ms}}ms"
```

### Blockchain transaction failures

```logql
{job="aura-vault"} |= "blockchain" | json | tx_status="failed"
| line_format "tx={{.tx_id}} err={{.error_code}}: {{.message}}"
```

### Vault pause / unpause events

```logql
{job="aura-vault"} |~ "paused|unpaused"
```

### BalanceMismatch (flash loan guard)

```logql
{job="aura-vault"} |= "BalanceMismatch"
| line_format "observed={{.observed}} tracked={{.tracked}} diff={{.diff}}"
```

### Startup and crash events

```logql
{job="aura-vault"} |~ "started|crashed|panic|fatal"
```

---

*Related documentation:*  
*[docs/DEPLOYMENT.md](DEPLOYMENT.md) — Docker and Stellar deployment guide*  
*[docs/KUBERNETES.md](KUBERNETES.md) — Kubernetes deployment and HPA configuration*  
*[AUDIT.md](../AUDIT.md) — Security audit findings and remediations*
