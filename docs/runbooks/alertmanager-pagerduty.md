# AlertManager + PagerDuty Integration Runbook

## Architecture Overview

```
Prometheus ──→ AlertManager ──┬──→ PagerDuty (critical)      ≤ 5 min SLA
                               ├──→ PagerDuty (blockchain)    ≤ 5 min SLA
                               ├──→ PagerDuty (platform team)
                               ├──→ PagerDuty (backend team)
                               ├──→ Slack #aura-vault-warnings (warning)
                               └──→ Slack #aura-vault-frontend (frontend)

Routing logic:
  severity=critical           → pagerduty-critical     (group_wait 10s)
  alertname=Vault*|Tx*        → pagerduty-blockchain   (group_wait 15s)
  team=platform, critical     → platform-pagerduty
  team=backend,  critical     → backend-pagerduty
  team=frontend               → frontend-slack
  severity=warning            → slack-warnings
```

### Deduplication

Same alert (same `alertname + severity + team + namespace + environment`) within **5 minutes** is grouped into a single notification (`group_interval: 5m`). This prevents alert storms from paging multiple times for the same incident.

### Inhibition

- **Critical inhibits warning** for the same `alertname + namespace + instance`
- **ServiceDown inhibits all** other alerts for the same `instance` (no point firing latency alerts on a down service)
- **SLABreachAvailability inhibits** HighErrorRate and HighLatency for the same `job`

---

## Environment Variables Required

Set these in your `.env` file or Kubernetes Secret before starting AlertManager:

| Variable | Description | Example |
|---|---|---|
| `PAGERDUTY_ROUTING_KEY_CRITICAL` | PagerDuty integration key for critical cross-team alerts | `r0abc123...` |
| `PAGERDUTY_ROUTING_KEY_BLOCKCHAIN` | PagerDuty integration key for vault/blockchain alerts | `r0def456...` |
| `PAGERDUTY_ROUTING_KEY_PLATFORM` | PagerDuty integration key for platform team | `r0ghi789...` |
| `PAGERDUTY_ROUTING_KEY_BACKEND` | PagerDuty integration key for backend team | `r0jkl012...` |
| `SLACK_API_URL` | Slack incoming webhook URL | `https://hooks.slack.com/services/T.../B.../...` |

---

## PagerDuty Setup

1. Log in to [PagerDuty](https://app.pagerduty.com)
2. Go to **Services** → **Service Directory** → **+ New Service**
3. Create one service per receiver:
   - `aura-vault-critical` — all critical alerts
   - `aura-vault-blockchain` — vault/blockchain alerts
   - `aura-vault-platform` — platform team
   - `aura-vault-backend` — backend team
4. For each service:
   - Integration → **Events API v2**
   - Copy the **Integration Key** (routing key)
5. Set the routing keys as environment variables (see table above)

### Escalation Policy

Configure your PagerDuty escalation policies:
- **Level 1:** Notify on-call engineer immediately (SMS + push)
- **Level 2 (after 10 min):** Notify backup engineer
- **Level 3 (after 20 min):** Notify engineering manager

---

## Slack Setup

1. Go to your Slack workspace → **Apps** → **Incoming WebHooks**
2. Create webhooks for:
   - `#aura-vault-warnings`
   - `#aura-vault-frontend`
3. Set `SLACK_API_URL` to the webhook URL for `#aura-vault-warnings`

---

## Test Alert Procedure

### 1. Send a test critical alert

```bash
# POST a test alert directly to AlertManager
curl -X POST http://localhost:9093/api/v2/alerts \
  -H 'Content-Type: application/json' \
  -d '[{
    "labels": {
      "alertname": "TestAlert",
      "severity": "critical",
      "team": "platform",
      "environment": "staging",
      "instance": "test-instance:9090",
      "job": "test-job"
    },
    "annotations": {
      "summary": "This is a test alert",
      "description": "Verifying PagerDuty integration for Aura Vault",
      "runbook_url": "https://github.com/soterika/aura-vault-protocol/wiki/runbooks/TestAlert"
    },
    "generatorURL": "http://prometheus:9090"
  }]'
```

### 2. Verify PagerDuty receives within 5 minutes

- Check PagerDuty → **Incidents** for a new incident from `aura-vault-critical`
- The incident should appear within **≤ 5 minutes** (group_wait: 10s + propagation)

### 3. Send a test warning alert

```bash
curl -X POST http://localhost:9093/api/v2/alerts \
  -H 'Content-Type: application/json' \
  -d '[{
    "labels": {
      "alertname": "TestWarning",
      "severity": "warning",
      "environment": "staging"
    },
    "annotations": {
      "summary": "Test warning — should go to Slack only"
    }
  }]'
```

- Verify `#aura-vault-warnings` Slack channel receives a message
- Verify **no** PagerDuty incident is created

### 4. Verify inhibition

```bash
# Fire a ServiceDown + HighLatency for the same instance
curl -X POST http://localhost:9093/api/v2/alerts \
  -H 'Content-Type: application/json' \
  -d '[
    {
      "labels": {"alertname":"ServiceDown","severity":"critical","instance":"backend:3000","team":"platform","environment":"staging"},
      "annotations": {"summary":"Backend is down"}
    },
    {
      "labels": {"alertname":"HighLatency","severity":"warning","instance":"backend:3000","environment":"staging"},
      "annotations": {"summary":"High latency (should be suppressed)"}
    }
  ]'
```

- Only `ServiceDown` should page; `HighLatency` should be inhibited

### 5. Resolve the test alert

```bash
# Send the same labels with endsAt in the past to resolve
curl -X POST http://localhost:9093/api/v2/alerts \
  -H 'Content-Type: application/json' \
  -d '[{
    "labels": {
      "alertname": "TestAlert",
      "severity": "critical",
      "team": "platform",
      "environment": "staging",
      "instance": "test-instance:9090",
      "job": "test-job"
    },
    "endsAt": "2020-01-01T00:00:00Z"
  }]'
```

---

## Maintenance Window Procedure

Use the provided script to create a silence:

```bash
# Silence all alerts for 2 hours during a deployment
./monitoring/alertmanager/silence-template.sh \
  --duration 2h \
  --comment "Planned deployment v2.3.0" \
  --env production

# Silence a specific alert for 30 minutes
./monitoring/alertmanager/silence-template.sh \
  --duration 30m \
  --alertname ServiceDown \
  --comment "Restarting backend pods for config update"

# Verify silence is active
curl -s http://localhost:9093/api/v2/silences | jq '.[] | select(.status.state == "active")'
```

---

## On-Call Rotation

Manage on-call schedules in PagerDuty:
1. **Schedules** → **+ New Schedule**
2. Create a weekly rotation with your team members
3. Assign the schedule to the escalation policy for each service

---

## Troubleshooting

### Alert not reaching PagerDuty

1. Check AlertManager logs: `docker logs aura-alertmanager`
2. Verify routing key is set: `echo $PAGERDUTY_ROUTING_KEY_CRITICAL`
3. Check AlertManager routing via UI: http://localhost:9093/#/status → routing tree
4. Test PagerDuty API key directly:
   ```bash
   curl -X POST https://events.pagerduty.com/v2/enqueue \
     -H 'Content-Type: application/json' \
     -d '{"routing_key":"YOUR_KEY","event_action":"trigger","payload":{"summary":"test","severity":"critical","source":"manual"}}'
   ```

### Alert not reaching Slack

1. Verify webhook URL: `curl -X POST $SLACK_API_URL -d '{"text":"test"}'`
2. Check AlertManager config: `amtool check-config /etc/alertmanager/alertmanager.yml`
3. Verify the `SLACK_API_URL` environment variable is expanded in the config

### Duplicate alerts

- Verify `group_interval: 5m` is set in the routing tree
- Check that `group_by` labels match between firing instances

### AlertManager not starting

```bash
# Validate config syntax
docker run --rm \
  -v $(pwd)/monitoring/alertmanager:/etc/alertmanager \
  prom/alertmanager:v0.27.0 \
  amtool check-config /etc/alertmanager/alertmanager.yml
```
