# On-Call Rotation & Escalation Policy

**Issue:** #518 — Set up on-call rotation and escalation policy  
**Effective:** 2026-07-25  
**Owner:** Engineering Lead  
**Review cadence:** Quarterly (next review 2026-10-25)

---

## 1. Overview

Aura Vault operates a weekly on-call rotation for all production incidents.
The on-call engineer is the first responder for alerts fired by PagerDuty,
Prometheus/Alertmanager, and Grafana dashboards.

This document covers:
- Weekly schedule and rotation mechanics
- Primary / secondary on-call roles
- Escalation paths and timers
- Runbook links
- Post-on-call review
- Compensation policy

---

## 2. PagerDuty Setup

### Service configuration

| Setting              | Value                                      |
|---------------------|--------------------------------------------|
| Service name         | `aura-vault-production`                    |
| Integration key env  | `PAGERDUTY_INTEGRATION_KEY`                |
| Escalation policy    | `aura-vault-escalation` (defined below)    |
| Alert grouping       | By alert name, 5-minute window             |
| Auto-resolve         | After 10 minutes silence                   |
| Notification channel | PagerDuty mobile app + SMS + phone call    |

### Schedule

Rotation period: **7 days (Mon 09:00 UTC → following Mon 09:00 UTC)**

The schedule is managed in PagerDuty under **Schedules → aura-vault-primary**
and **aura-vault-secondary**.

**Rotation members** (update in PagerDuty when team changes):

| Slot | Primary | Secondary |
|------|---------|-----------|
| Week 1 | Engineer A | Engineer B |
| Week 2 | Engineer B | Engineer C |
| Week 3 | Engineer C | Engineer D |
| Week 4 | Engineer D | Engineer A |

> Team leads update this table in PagerDuty; this doc reflects the policy.

### Override procedure

1. Go to PagerDuty → Schedules → Select week to override.
2. Click **Create Override** and set the replacement engineer and time window.
3. Notify the team in `#on-call-handoff` Slack channel.

---

## 3. Escalation Policy

Policy name in PagerDuty: **`aura-vault-escalation`**

```
Layer 1: Primary on-call
  → Alert fires
  → Notify via: PagerDuty push + SMS
  → Acknowledgement window: 5 minutes

  If NOT acknowledged within 5 minutes:

Layer 2: Secondary on-call
  → Notify via: PagerDuty push + SMS + phone call
  → Acknowledgement window: 10 minutes (i.e. 15 min from initial alert)

  If NOT acknowledged within 10 minutes:

Layer 3: Engineering Lead
  → Notify via: PagerDuty push + SMS + phone call + Slack DM
  → No auto-escalation above this layer; lead may call CTO directly
```

### Severity levels

| Severity | Definition | Expected response time |
|----------|------------|------------------------|
| P1 — Critical | Vault contract unreachable; funds at risk; >5% error rate | Acknowledge < 5 min, bridge call < 10 min |
| P2 — High | Backend API degraded; partial data loss; auth failures | Acknowledge < 15 min |
| P3 — Medium | Single endpoint down; monitoring gap; slow queries | Acknowledge < 1 hour |
| P4 — Low | Non-production environment; minor UX bugs | Next business day |

---

## 4. On-Call Runbook Links

Every Alertmanager and Grafana alert **must** include a `runbook_url` annotation
pointing to the relevant runbook. The runbook URL format is:

```
https://github.com/soterika/aura-vault-protocol/blob/main/docs/disaster-recovery/runbook.md#<anchor>
```

Core runbook: [`docs/disaster-recovery/runbook.md`](../disaster-recovery/runbook.md)

| Alert | Runbook anchor |
|-------|----------------|
| `AuraVaultContractUnreachable` | `#contract-unreachable` |
| `BackendHighErrorRate` | `#backend-high-error-rate` |
| `RedisDown` | `#redis-down` |
| `PostgresReplicationLag` | `#postgres-replication-lag` |
| `HighMemoryUsage` | `#high-memory-usage` |
| `CertificateExpiringSoon` | `#certificate-expiry` |

**Each alert rule in `monitoring/prometheus/alert.rules.yml` must contain:**

```yaml
annotations:
  runbook_url: "https://github.com/soterika/aura-vault-protocol/blob/main/docs/disaster-recovery/runbook.md#<anchor>"
  summary: "One-sentence description"
  description: "Detailed description with {{ $labels }} and {{ $value }}"
```

---

## 5. Handoff Process

### Start-of-week handoff (Monday 09:00 UTC)

Outgoing on-call posts in `#on-call-handoff`:

```
🔄 ON-CALL HANDOFF — Week of YYYY-MM-DD

Outgoing: @outgoing-engineer
Incoming: @incoming-engineer

Active incidents: [none | link to PD incident]
Known issues: [list or "none"]
Deployments this week: [link to CHANGELOG]
Dashboard: https://grafana.auravault.io/d/vault-operations
```

### During on-call duties

- Keep PagerDuty mobile app installed and notifications enabled.
- Acknowledge alerts within the escalation window.
- For every P1/P2: open a PagerDuty incident, post to `#incidents`, and follow the
  [Incident Response Playbook](../disaster-recovery/incident-response-playbook.md).
- Log all actions taken in the PagerDuty incident timeline.

---

## 6. Post-On-Call Review

A **30-minute review meeting** is held every Monday at 10:00 UTC.

Agenda:
1. Review incidents from the past week (PagerDuty report)
2. Were escalation timers appropriate? (adjust policy if not)
3. Runbook gaps — any incident that had no runbook gets one this week
4. Alert fatigue — noisy alerts that woke the on-call get re-evaluated
5. Action items → GitHub issues assigned to owners

Meeting notes go in `docs/disaster-recovery/weekly-review-YYYY-MM-DD.md`.

---

## 7. Compensation Policy

On-call compensation is intended to acknowledge the burden of being available
outside normal working hours.

### Base on-call stipend

| Duration | Compensation |
|----------|-------------|
| Full week on-call (7 days) | **$200 USD** per week (added to next payroll) |
| Partial week (override, ≥3 days) | Pro-rated at $200 / 7 × days |

### Incident response bonus

Compensation is awarded per P1/P2 incident that requires hands-on work
**outside business hours** (before 09:00 or after 18:00 local time):

| Severity | Payout |
|----------|--------|
| P1 — Critical (>1 hour active) | **$150 USD** per incident |
| P1 — Critical (<1 hour) | **$75 USD** per incident |
| P2 — High (>30 min active) | **$50 USD** per incident |

> "Active" means the engineer was paged, acknowledged, and performed
> remediation steps. Incidents auto-resolved before acknowledgement do not
> qualify.

### Time-off compensation

Engineers may take compensatory time off instead of monetary payment:
- P1 incident overnight (midnight–06:00): up to **4 hours** comp time
- Full weekend on-call with ≥1 P1: up to **1 day** comp time

Comp time must be agreed with the team lead within 2 weeks of the incident.

### Process

1. On-call engineer logs qualifying incidents in the weekly review.
2. Engineering lead approves and submits to payroll by the 25th of the month.
3. Disputes resolved by Engineering Lead → CTO.

---

## 8. Alertmanager Integration

Add the PagerDuty receiver to `monitoring/alertmanager/alertmanager.yml`:

```yaml
receivers:
  - name: pagerduty-primary
    pagerduty_configs:
      - routing_key: "${PAGERDUTY_INTEGRATION_KEY}"
        severity: "{{ .CommonLabels.severity }}"
        description: "{{ .CommonAnnotations.summary }}"
        details:
          runbook: "{{ .CommonAnnotations.runbook_url }}"
          dashboard: "https://grafana.auravault.io/d/vault-operations"

route:
  receiver: pagerduty-primary
  group_by: [alertname, cluster]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
```

---

## 9. Contact List

| Role | PagerDuty handle | Slack handle |
|------|-----------------|--------------|
| Primary on-call | See schedule | `#on-call-handoff` |
| Engineering Lead | `eng-lead` | `@eng-lead` |
| CTO | `cto` | `@cto` |
| Security | `security-team` | `#security` |

---

*Last updated: 2026-07-25.  To propose changes, open a PR targeting `main`.*
