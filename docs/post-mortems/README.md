# Aura Vault Protocol — Incident Post-Mortems

## Our Approach to Incidents

Aura Protocol operates a **blameless post-mortem culture**. When incidents occur, our goal is to
understand *what* happened and *why* at a systemic level — not to assign fault to individuals.
People make decisions based on the information and tooling available to them at the time. Blame
entrenches fear and suppresses the honest reporting that makes post-mortems valuable. Systemic
improvement is the only outcome that matters.

Every post-mortem at Aura follows the same process:

1. **Write it while memory is fresh.** The primary author (usually the incident lead) drafts the
   document within 48 hours of resolution.
2. **Review it as a team.** A post-mortem review meeting is held within one week of the incident.
   All directly involved engineers attend; others are welcome.
3. **Track action items to completion.** Every action item has an owner and a due date. Open items
   are reviewed at the next team sync until closed.
4. **Share the learnings.** Post-mortems are committed to this repository and are permanently
   accessible. They inform onboarding, auditor briefings, and future design reviews.

For new incidents, copy [`TEMPLATE.md`](./TEMPLATE.md) and follow the guidance notes embedded in
each section.

---

## Severity Levels

| Severity | Description | Example |
|---|---|---|
| **P0 Critical** | Active exploit or confirmed fund loss on mainnet | Funds drained from vault |
| **P1 High** | Potential for fund loss on mainnet; or complete feature failure on mainnet | Share minting returning 0; all deposits blocked |
| **P2 Medium** | Feature degraded or broken; no fund loss risk; or P1-equivalent on testnet | Harvest failing under load on testnet |
| **P3 Low** | Minor degradation; cosmetic errors; incorrect events | Event emitting wrong field value |

---

## Template

| File | Description |
|---|---|
| [TEMPLATE.md](./TEMPLATE.md) | Blameless post-mortem template with guidance notes in every section. Use this as the starting point for any new incident. |

---

## Incident History

| Incident ID | Date | Severity | Title | Status |
|---|---|---|---|---|
| [INC-2024-001](./2024-03-15-testnet-inflation-attack.md) | 2024-03-15 | P1 High | Testnet Inflation Attack Edge Case — Zero-Share Mint on Minimum Deposit | Closed |
| [INC-2024-002](./2024-07-22-testnet-balance-mismatch-false-positive.md) | 2024-07-22 | P2 Medium | Testnet Flash Loan Guard False Positives During High-Volume Harvest | Closed |

---

## Incident Summaries

### INC-2024-001 · 2024-03-15 · P1 High
**Testnet Inflation Attack Edge Case — Zero-Share Mint on Minimum Deposit**

An edge case in the vault's share-minting formula was discovered during pre-audit integration
testing. When the first depositor seeded the vault with exactly 1 stroop (the minimum token unit),
subsequent deposits could compute to 0 shares under integer arithmetic — silently transferring
tokens into the vault with no shares credited in return. The issue is a variant of the well-known
ERC-4626 inflation attack. Fixed by adding the zero-share mint rejection fence: `deposit` now
returns `VaultError::ZeroAmount` (code 5) if the computed share allocation rounds to zero.
No mainnet exposure; discovered and resolved entirely on testnet.

→ [Full post-mortem](./2024-03-15-testnet-inflation-attack.md)

---

### INC-2024-002 · 2024-07-22 · P2 Medium
**Testnet Flash Loan Guard False Positives During High-Volume Harvest**

The flash loan guard in `harvest` was triggering `VaultError::BalanceMismatch` (code 12) and
emitting `suspicious` events for all legitimate harvest calls during high-volume load testing.
The root cause was a settlement-ordering issue: the guard read the vault's token balance *before*
the yield transfer instruction executed, and under concurrent multi-keeper conditions the balance
reflected an intermediate state rather than the expected pre-injection baseline. Fixed by moving
the balance check to execute *after* the yield transfer, where it validates that
`post_transfer_balance == total_deposited + yield_amount` — a semantically stronger invariant that
also eliminates the race condition. No fund loss; no mainnet exposure.

→ [Full post-mortem](./2024-07-22-testnet-balance-mismatch-false-positive.md)

---

## Action Item Tracker

The table below provides a consolidated view of all open action items across all post-mortems.
Update this table when items are closed. Closed items are retained for historical reference.

| Incident | # | Type | Description | Owner | Due Date | Status |
|---|---|---|---|---|---|---|
| INC-2024-001 | 1 | Preventive | Zero-share mint rejection fence (PR #47) | @protocol-eng | 2024-03-15 | [x] Completed |
| INC-2024-001 | 2 | Preventive | Update `interface.rs` doc for `deposit` | @protocol-eng | 2024-03-18 | [x] Completed |
| INC-2024-001 | 3 | Preventive | Boundary-condition test matrix for all mutating functions | @devs | 2024-03-20 | [x] Completed |
| INC-2024-001 | 4 | Detective | Monitoring alert for `ZeroAmount` errors on mainnet | @devs | 2024-03-22 | [x] Completed |
| INC-2024-001 | 5 | Preventive | Document inflation attack threat model in `README.md` | @security-lead | 2024-03-22 | [x] Completed |
| INC-2024-001 | 6 | Preventive | Fuzz-testing target for share formula | @devs | 2024-03-29 | [x] Completed |
| INC-2024-001 | 7 | Corrective | Include in pre-audit briefing for external auditor | @security-lead | 2024-04-01 | [x] Completed |
| INC-2024-002 | 1 | Corrective | Move balance check to post-transfer position (PR #83) | @protocol-eng | 2024-07-22 | [x] Completed |
| INC-2024-002 | 2 | Preventive | Multi-keeper concurrency scenario in integration tests | @devs | 2024-07-25 | [x] Completed |
| INC-2024-002 | 3 | Detective | Update monitoring runbook for `suspicious` event triage | @keeper-ops | 2024-07-26 | [x] Completed |
| INC-2024-002 | 4 | Preventive | Add load-testing to pre-deploy checklist | @devs | 2024-07-26 | [x] Completed |
| INC-2024-002 | 5 | Preventive | Inline concurrency model doc comment in `lib.rs` | @protocol-eng | 2024-07-28 | [x] Completed |
| INC-2024-002 | 6 | Preventive | Keeper operator guide section on guard behaviour | @keeper-ops | 2024-07-29 | [x] Completed |
| INC-2024-002 | 7 | Detective | Alert threshold for `suspicious` event rate on mainnet | @devs | 2024-07-30 | [x] Completed |
| INC-2024-002 | 8 | Preventive | Formal review of all guard conditions for settlement-ordering assumptions | @security-lead | 2024-07-30 | [x] Completed |

All action items: **22 completed, 0 open.**

---

## Contributing

To file a new post-mortem:

1. Copy `TEMPLATE.md` to a new file named `YYYY-MM-DD-short-description.md`.
2. Fill in the front-matter metadata block (assign the next `INC-YYYY-NNN` ID).
3. Complete all sections, following the guidance notes.
4. Open a PR; tag at least one engineer who was not the primary author as reviewer.
5. Add the incident to the table in this README.
6. Hold a post-mortem review meeting within one week of resolution.
7. Update this README's action item tracker as items are closed.
