---
incident_id: INC-YYYY-NNN
date: YYYY-MM-DD
severity: P0 | P1 | P2 | P3
status: Open | In Progress | Resolved | Closed
author: "@handle"
reviewers: []
last_updated: YYYY-MM-DD
---

# Incident Post-Mortem: [Short Title]

> **Blameless Culture Notice**
> This post-mortem follows the Aura Protocol blameless post-mortem process. The goal is to
> understand *what* happened and *why*, not *who* is at fault. Individuals acted in good
> faith with the information and tools available at the time. Blame is counterproductive;
> systemic improvement is the objective.

---

## Summary

<!--
2–4 sentences covering:
  - What happened (the observable symptom)
  - What environment was affected (testnet / mainnet / local)
  - What the user-facing impact was
  - How it was resolved (one sentence)

Keep this brief. A reader skimming the document should understand the whole story from this block alone.
-->

| Field | Value |
|---|---|
| **Incident start** | YYYY-MM-DD HH:MM UTC |
| **Incident end** | YYYY-MM-DD HH:MM UTC |
| **Duration** | X hours Y minutes |
| **Environment** | Testnet / Mainnet |
| **Components affected** | e.g., `deposit`, `withdraw`, `harvest` |
| **Severity** | P0 Critical / P1 High / P2 Medium / P3 Low |
| **Detection method** | Monitoring alert / User report / Internal testing |

---

## Timeline

<!--
List events in chronological order with UTC timestamps. Use the following format.
Be specific: "engineer noticed X in log Y" is more useful than "engineer investigated".
Include both the problem progression AND the response actions. Do not omit near-misses
or failed remediation attempts — these are valuable learning signals.
-->

All times are UTC.

| Time (UTC) | Event |
|---|---|
| `YYYY-MM-DD HH:MM` | _Describe what happened or what action was taken_ |
| `YYYY-MM-DD HH:MM` | _..._ |
| `YYYY-MM-DD HH:MM` | _First detection or alert fired_ |
| `YYYY-MM-DD HH:MM` | _On-call engineer paged / team notified_ |
| `YYYY-MM-DD HH:MM` | _Root cause identified_ |
| `YYYY-MM-DD HH:MM` | _Fix deployed / mitigation applied_ |
| `YYYY-MM-DD HH:MM` | _Incident declared resolved_ |
| `YYYY-MM-DD HH:MM` | _Post-mortem review meeting held_ |

---

## Root Cause Analysis

<!--
Explain the technical root cause in depth. Use the "5 Whys" method or a fault tree if helpful.
The goal is to identify the *deepest contributing factor*, not just the proximate trigger.

Structure:
1. Proximate cause — the immediate trigger (e.g., "function X returned 0 when Y was expected")
2. Contributing factors — conditions that made the system susceptible (e.g., "no integration test covered this edge case")
3. Systemic root cause — the underlying process or design gap (e.g., "edge cases for minimum unit inputs were not specified in the interface contract")

Code snippets, transaction IDs, or log excerpts are highly encouraged here.
-->

### Proximate Cause

_Describe the immediate trigger._

### Contributing Factors

- _Factor 1_
- _Factor 2_

### Systemic Root Cause

_What deeper process, design gap, or assumption failure ultimately enabled this incident?_

### 5 Whys

| Why # | Question | Answer |
|---|---|---|
| 1 | Why did the incident occur? | _..._ |
| 2 | Why did [answer to #1] happen? | _..._ |
| 3 | Why did [answer to #2] happen? | _..._ |
| 4 | Why did [answer to #3] happen? | _..._ |
| 5 | Why did [answer to #4] happen? | _..._ |

---

## Impact Assessment

<!--
Quantify impact wherever possible. Use real numbers from on-chain data, logs, or monitoring.
For testnet incidents, note that mainnet was not affected but estimate what the impact *would*
have been had this reached production.

Consider:
  - User-facing impact (failed transactions, incorrect state, funds at risk)
  - Financial impact (TVL at risk, lost yield, protocol fees affected)
  - Reputational impact
  - Developer/operator impact (time spent, processes disrupted)
-->

### User Impact

_Describe what users experienced. Quantify how many users or transactions were affected._

### Financial Impact

_Estimate TVL at risk, lost yield, or other monetary exposure. For testnet: estimate what
mainnet exposure would have been under equivalent conditions._

### Operational Impact

_Hours of engineer time spent on investigation and remediation. Any processes or deployments blocked._

### Reputational Impact

_Was the incident publicly visible? Were users, partners, or auditors informed?_

---

## Resolution

<!--
Describe exactly what was done to resolve the incident:
1. Immediate mitigation (what stopped the bleeding)
2. Permanent fix (what was changed in code, config, or process)
3. Verification (how you confirmed the fix worked)

Include PR/commit references, transaction hashes, or test output where applicable.
-->

### Immediate Mitigation

_What was done first to stop or limit the impact while a proper fix was developed?_

### Permanent Fix

_Describe the code or configuration change. Link to the PR or commit._

```
PR: #NNN — [title]
Commit: abc1234
```

### Verification

_How was the fix tested and confirmed? Include test names, transaction IDs, or log excerpts._

---

## Action Items

<!--
Each action item must have: a clear description, an owner, a due date, and a status.
Distinguish between:
  - Preventive: stops this class of bug from reoccurring
  - Detective: improves our ability to notice it faster next time
  - Corrective: repairs something that was broken as a result of this incident

Mark all items with one of: [ ] Open  [~] In Progress  [x] Completed
-->

| # | Type | Description | Owner | Due Date | Status |
|---|---|---|---|---|---|
| 1 | Preventive | _Add input validation / test coverage / spec clarification_ | @handle | YYYY-MM-DD | [ ] Open |
| 2 | Detective | _Add monitoring alert / log enrichment_ | @handle | YYYY-MM-DD | [ ] Open |
| 3 | Corrective | _Update documentation / runbook_ | @handle | YYYY-MM-DD | [ ] Open |

---

## Lessons Learned

<!--
Reflect on what the team learned. Keep this blameless and forward-looking.
Separate into three categories:

  What went well — things that helped contain or detect the incident quickly.
    Highlight these so the team can deliberately preserve them.

  What went poorly — things that slowed detection, diagnosis, or resolution.
    Be specific without assigning blame to individuals.

  Where we got lucky — near-misses or conditions that prevented worse outcomes.
    These are particularly important: lucky escapes often reveal latent risks.
-->

### What Went Well

- _..._

### What Went Poorly

- _..._

### Where We Got Lucky

- _..._

---

## Appendix

<!--
Optional. Include supporting material that is too detailed for the main body but useful
for future reference: raw logs, transaction hashes, relevant code snippets, architecture
diagrams, monitoring screenshots, or links to related issues.
-->

### Related Links

- Issue: [#NNN](https://github.com/...)
- PR / Fix: [#NNN](https://github.com/...)
- Monitoring dashboard: _link_
- Audit report section: _reference_

### Raw Evidence

```
Paste relevant log lines, transaction IDs, or test output here.
```
