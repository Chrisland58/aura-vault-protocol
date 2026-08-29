---
incident_id: INC-2024-002
date: 2024-07-22
severity: P2
status: Closed
author: "@devs"
reviewers: ["@protocol-eng", "@keeper-ops"]
last_updated: 2024-07-30
---

# Incident Post-Mortem: Testnet Flash Loan Guard False Positives During High-Volume Harvest

> **Blameless Culture Notice**
> This post-mortem follows the Aura Protocol blameless post-mortem process. The goal is to
> understand *what* happened and *why*, not *who* is at fault. Individuals acted in good
> faith with the information and tools available at the time. Blame is counterproductive;
> systemic improvement is the objective.

---

## Summary

On 2024-07-22, load testing of Aura Vault on Stellar Testnet revealed that the flash loan guard
(the `BalanceMismatch` check introduced as a security feature) was producing **false positives**
during high-volume harvest operations. When multiple keeper transactions were submitted in rapid
succession within the same ledger close window, the vault's on-chain token balance read by the
guard reflected an intermediate settlement state rather than the fully-settled post-yield-injection
balance. This caused legitimate `harvest` calls to emit `suspicious` events and return
`VaultError::BalanceMismatch` (error code 12), blocking yield compounding entirely. No funds were
lost or at risk; the guard was over-triggering rather than under-triggering. The fix adjusted the
balance-check logic to read the vault's token balance **after** the yield transfer instruction
rather than before, ensuring the guard compares against the post-injection settled state.

| Field | Value |
|---|---|
| **Incident start** | 2024-07-22 13:07 UTC |
| **Incident end** | 2024-07-22 21:30 UTC |
| **Duration** | 8 hours 23 minutes |
| **Environment** | Stellar Testnet (no mainnet exposure) |
| **Components affected** | `harvest`, flash loan guard in `lib.rs`, `suspicious` event emitter |
| **Severity** | P2 Medium — no fund loss; feature completely broken under load |
| **Detection method** | Automated load-test script during pre-launch keeper simulation |

---

## Timeline

All times are UTC.

| Time (UTC) | Event |
|---|---|
| `2024-07-22 13:07` | Keeper simulation script begins high-volume load test: 20 concurrent harvest transactions submitted per ledger close window |
| `2024-07-22 13:09` | First `BalanceMismatch` error observed in test output; initially dismissed as a transient RPC issue |
| `2024-07-22 13:15` | Error rate reaches 100% — every harvest call is failing with `VaultError::BalanceMismatch` (code 12) |
| `2024-07-22 13:18` | Load test paused; incident channel opened |
| `2024-07-22 13:25` | On-call engineer and protocol lead engaged |
| `2024-07-22 13:40` | Initial hypothesis: keeper simulation is accidentally triggering the flash loan guard by submitting malformed transactions |
| `2024-07-22 14:00` | Hypothesis disproved: single isolated harvest transactions submitted manually also fail with `BalanceMismatch` after a burst of prior transactions, but succeed in isolation on a fresh vault |
| `2024-07-22 14:30` | Engineer examines the guard implementation in `lib.rs`; notices balance check reads `token.balance(env.current_contract_address())` at the *start* of `harvest`, before the yield transfer instruction executes |
| `2024-07-22 15:00` | Root cause hypothesised: Soroban's token `transfer` is atomic within a single contract invocation, but when multiple harvest calls are batched or when the keeper pre-submits transactions, the balance read may reflect a state that does not yet include pending incoming transfers from earlier in the same ledger |
| `2024-07-22 15:20` | Minimal reproduction case constructed: (1) submit harvest with `yield_amount = X`, (2) check shows `balance = total_deposited` (guard passes), (3) submit second harvest before first settles, (4) second harvest reads balance *still* equal to `total_deposited` (not yet `total_deposited + X`), guard sees mismatch |
| `2024-07-22 15:45` | Security reviewer joins to assess whether any loosening of the guard creates exploitable surface |
| `2024-07-22 16:30` | After analysis: moving the balance read to *after* the yield token transfer is both safe and correct — at that point the vault's balance reflects the expected post-injection amount, so the guard can verify the injection was exactly `yield_amount` and no extra tokens arrived unexpectedly |
| `2024-07-22 17:00` | Fix implemented: balance check moved to post-transfer position; guard now validates `actual_balance == total_deposited + yield_amount` rather than `actual_balance == total_deposited` |
| `2024-07-22 18:15` | Two new tests added: `test_harvest_high_volume_no_false_positive`, `test_harvest_balance_guard_still_catches_real_mismatch` |
| `2024-07-22 18:45` | All tests pass; PR #83 opened |
| `2024-07-22 19:30` | Security reviewer confirms the adjusted guard still catches genuine flash loan injection attempts; approves PR |
| `2024-07-22 20:00` | PR #83 merged to `main` |
| `2024-07-22 20:45` | Fixed Wasm deployed to testnet; load test re-run at 20 concurrent harvests per ledger window |
| `2024-07-22 21:20` | Zero false positives observed across 500 harvest transactions; genuine mismatch test case still correctly triggers error |
| `2024-07-22 21:30` | Incident declared resolved |
| `2024-07-30 10:00` | Post-mortem review meeting held; this document finalised |

---

## Root Cause Analysis

### Proximate Cause

The flash loan guard in `harvest` read the vault's token balance **before** the yield token
transfer instruction, then compared it against `total_deposited`. Under normal single-transaction
conditions this comparison is valid: the balance should equal `total_deposited` exactly (the
invariant maintained by `deposit` and `withdraw`). However, under high-throughput conditions where
multiple ledger operations overlap, the balance visible at the start of a `harvest` invocation
could transiently differ from `total_deposited` because a previous `harvest` transaction's yield
tokens had been received by the vault but not yet reflected in `total_deposited`'s updated storage
write — creating a window where the guard fired falsely.

The guard logic before the fix:

```rust
// BEFORE FIX — guard runs before yield transfer
let actual_balance = token_client.balance(&env.current_contract_address());
let tracked = storage::get_total_deposited(&env);

if actual_balance != tracked {
    events::emit_suspicious(&env, actual_balance, tracked);
    return Err(VaultError::BalanceMismatch);
}

// ... yield transfer happens here ...
storage::set_total_deposited(&env, tracked + yield_amount);
```

The guard logic after the fix:

```rust
// AFTER FIX — transfer first, then validate post-settlement balance
token_client.transfer(&caller, &env.current_contract_address(), &yield_amount);

let actual_balance = token_client.balance(&env.current_contract_address());
let expected_balance = storage::get_total_deposited(&env) + yield_amount;

if actual_balance != expected_balance {
    events::emit_suspicious(&env, actual_balance, expected_balance);
    return Err(VaultError::BalanceMismatch);
}

storage::set_total_deposited(&env, expected_balance);
```

In the fixed version, any discrepancy between the post-transfer balance and the expected
post-injection total is a genuine anomaly (tokens arrived that were not part of this transaction),
correctly signalling a potential flash loan or re-entrancy attempt.

### Contributing Factors

- The original guard was designed and tested against single-transaction scenarios; concurrent and
  batched transaction behaviour was not modelled during the security design phase.
- Soroban's execution model processes each contract invocation atomically, but the ordering of
  storage reads relative to pending token balance changes from concurrent transactions in the same
  ledger window was not explicitly accounted for in the guard's design.
- The load test that surfaced this issue was a new addition to the test suite; earlier testing
  had only exercised `harvest` with one call at a time.
- The `suspicious` event was emitting before the transaction reverted, which made log analysis
  slightly misleading: analysts initially suspected a real attack attempt rather than a guard
  mis-fire.

### Systemic Root Cause

The flash loan guard was designed against a threat model that assumed single-caller, single-ledger
sequential execution. The guard's correctness depended on an implicit assumption — that no other
transaction could affect the vault's token balance between the guard's balance read and the yield
transfer — that does not hold in a concurrent multi-keeper environment. The root cause is an
under-specified concurrency model in the guard's security design, combined with a lack of
multi-transaction load testing earlier in the development cycle.

### 5 Whys

| Why # | Question | Answer |
|---|---|---|
| 1 | Why were legitimate harvest calls failing? | The flash loan guard returned `BalanceMismatch` when `actual_balance != total_deposited` |
| 2 | Why did `actual_balance` differ from `total_deposited`? | A prior harvest transaction had transferred yield tokens to the vault, but the `total_deposited` storage update had not yet committed from the perspective of the next transaction's read |
| 3 | Why did the guard read balance before the transfer rather than after? | The original design intent was to verify the vault's state was clean *before* accepting yield, analogous to a pre-condition check |
| 4 | Why was a pre-condition check insufficient here? | The "clean state" invariant is only valid in single-caller sequential execution; concurrent keepers break the assumption |
| 5 | Why was concurrency not modelled in the guard's design? | The initial threat model focused on flash loan atomicity within a single transaction and did not enumerate multi-keeper concurrent scenarios |

---

## Impact Assessment

### User Impact

**Testnet only — no mainnet exposure.** During the incident window on testnet, no `harvest`
operations could complete successfully under load-test conditions. In a production equivalent,
this would mean yield compounding would be entirely halted for the duration of the incident.
Existing depositors would not lose principal but would miss yield accrual. Keeper operators
would waste gas on failing transactions.

On testnet: no real user impact. Simulated impact: 0 principal at risk, but 100% of harvest
throughput blocked for the ~8-hour window.

### Financial Impact

Testnet: $0. Estimated mainnet equivalent: yield compounding halted for 8+ hours. Depending on
TVL and yield rate, this represents foregone yield rather than capital loss. At a hypothetical
$1M TVL and 10% APY, 8 hours of missed compounding ≈ $91 in foregone yield. More significantly,
if the false-positive rate were high enough to make harvesting economically unviable, the vault
would effectively stop compounding indefinitely — a severe degradation of the vault's core value
proposition.

### Operational Impact

- ~8.5 hours of engineer time across 3 team members (investigation, fix, review, re-test)
- Keeper simulation load test had to be halted and rescheduled
- Pre-launch timeline for keeper operator documentation delayed by approximately 3 days
- The `suspicious` event false positives created noise in the monitoring system that required
  manual triage to distinguish from genuine security signals

### Reputational Impact

Incident was internal and testnet-only. The incident was disclosed to the security reviewer as
part of the normal review process. No external disclosure required. The reviewer noted that the
guard still provides correct protection after the fix; the incident improved overall confidence
in the guard's design.

---

## Resolution

### Immediate Mitigation

The load test was halted to stop generating false-positive `suspicious` events, which were
polluting the testnet event log and creating ambiguity about whether a real attack had occurred.
The team also added a note to the testnet contract's README that the instance was running a
pre-release version of the guard.

### Permanent Fix

The balance check was moved to execute *after* the `token.transfer` call within `harvest`. The
guard now validates:

```
post_transfer_balance == total_deposited + yield_amount
```

instead of:

```
pre_transfer_balance == total_deposited
```

This is semantically stronger: it confirms not only that the vault was in a clean state, but
that the exact expected amount of yield was injected and nothing else arrived unexpectedly. It
also eliminates the settlement-window race condition entirely, because the balance is read after
the atomic transfer has completed within the same invocation.

```
PR: #83 — "fix: move harvest balance guard to post-transfer position"
Commit: 7c2e409
```

### Verification

Two new tests confirmed correct behaviour:

```
test test_harvest_high_volume_no_false_positive ... ok
test test_harvest_balance_guard_still_catches_real_mismatch ... ok

test result: ok. 27 passed; 0 failed; 0 ignored
```

The `test_harvest_balance_guard_still_catches_real_mismatch` test verifies that the guard still
correctly detects and rejects a harvest call where the post-transfer balance does not match the
expected value (simulating a scenario where additional tokens were injected by an external actor
within the same transaction envelope).

Load test re-run on testnet: 500 harvest transactions at 20 concurrent per ledger window —
zero `BalanceMismatch` errors, zero false-positive `suspicious` events.

---

## Action Items

| # | Type | Description | Owner | Due Date | Status |
|---|---|---|---|---|---|
| 1 | Corrective | Move balance check to post-transfer position in `harvest` (PR #83) | @protocol-eng | 2024-07-22 | [x] Completed |
| 2 | Preventive | Add multi-keeper concurrency scenario to the standard integration test suite | @devs | 2024-07-25 | [x] Completed |
| 3 | Detective | Update monitoring runbook: distinguish `suspicious` events caused by guard false-positives from genuine anomalies by correlating with the `harvest` caller address and yield amount | @keeper-ops | 2024-07-26 | [x] Completed |
| 4 | Preventive | Add load-testing (concurrent keeper harvest) to the pre-deploy checklist for all future contract upgrades | @devs | 2024-07-26 | [x] Completed |
| 5 | Preventive | Document the concurrency model and assumptions of the flash loan guard in an inline comment block in `lib.rs` adjacent to the guard implementation | @protocol-eng | 2024-07-28 | [x] Completed |
| 6 | Preventive | Add a section to the keeper operator guide explaining the guard, what triggers it legitimately, and how to interpret `suspicious` events vs. `BalanceMismatch` errors | @keeper-ops | 2024-07-29 | [x] Completed |
| 7 | Detective | Add an alert threshold: if `suspicious` event emission rate exceeds 2 per hour on mainnet, page on-call immediately | @devs | 2024-07-30 | [x] Completed |
| 8 | Preventive | Conduct a formal review of all other guard conditions in `deposit` and `withdraw` for analogous settlement-ordering assumptions | @security-lead | 2024-07-30 | [x] Completed |

---

## Lessons Learned

### What Went Well

- The guard was *over-protective* rather than *under-protective*. A false positive that blocks
  legitimate operations is far preferable to a false negative that lets an attack through. The
  security design philosophy of "fail closed" was correct.
- The load-testing phase that surfaced this issue was a deliberate addition to the pre-launch
  checklist; it worked exactly as intended.
- Root cause identification was efficient. Once the team replicated the issue with a minimal
  reproduction case (2.5 hours after incident start), the fix path was clear and took under
  2 hours to implement and verify.
- The security reviewer's involvement was timely and their analysis that the post-transfer guard
  is actually *stronger* than the pre-transfer guard was a valuable insight that turned a bug fix
  into a security improvement.
- No keeper operator (external) was affected; the incident was fully contained within internal
  testing infrastructure.

### What Went Poorly

- The flash loan guard's design document did not model multi-keeper concurrent scenarios. Security
  designs for shared-state smart contracts should include concurrency analysis as a mandatory
  section, not an optional one.
- False-positive `suspicious` events created alert noise that was difficult to triage. The
  monitoring system treated all `suspicious` events identically, making it hard to distinguish
  a guard mis-fire from a genuine security signal during the incident.
- The initial hypothesis (malformed transactions) wasted approximately 45 minutes before being
  disproved. A more systematic "rule out the simplest cases first" diagnostic approach would
  have shortened this.
- Load testing was added relatively late in the development cycle. Running concurrent-keeper
  simulations earlier would have surfaced this issue with less schedule impact.

### Where We Got Lucky

- The false positive happened during load testing on testnet, not during a genuine high-volume
  harvest period on mainnet (which could have blocked yield compounding during a high-yield
  period when keeper activity is highest — the worst possible time for the guard to fire falsely).
- The fix was simple and localized — a single re-ordering of two instructions — rather than
  requiring a redesign of the guard. More complex fixes carry higher risk of introducing new bugs.
- The adjusted guard (post-transfer check) is provably equivalent in security guarantees but
  superior in its handling of the concurrent case. The incident inadvertently drove an improvement
  to the guard's design.

---

## Appendix

### Related Links

- Fix PR: [#83 — fix: move harvest balance guard to post-transfer position](https://github.com/aura-protocol/aura-vault/pull/83)
- Flash loan guard design doc: `docs/architecture/flash-loan-guard.md`
- Keeper operator guide: `docs/keeper-operations.md`
- Soroban token interface docs: https://developers.stellar.org/docs/smart-contracts/tokens

### Raw Evidence

```
# Load test output — vulnerable version (100% failure rate)

[2024-07-22T13:15:00Z] harvest tx 1: VaultError::BalanceMismatch (code 12)
[2024-07-22T13:15:01Z] harvest tx 2: VaultError::BalanceMismatch (code 12)
[2024-07-22T13:15:01Z] harvest tx 3: VaultError::BalanceMismatch (code 12)
[2024-07-22T13:15:02Z] harvest tx 4: VaultError::BalanceMismatch (code 12)
[2024-07-22T13:15:02Z] suspicious event emitted: observed=1000150, tracked=1000000
[2024-07-22T13:15:02Z] suspicious event emitted: observed=1000150, tracked=1000000
... (500 failures total)

# Load test output — fixed version (zero failures)

[2024-07-22T21:00:00Z] harvest tx 1: ok — yield_injected=150, total_assets=1000150
[2024-07-22T21:00:01Z] harvest tx 2: ok — yield_injected=150, total_assets=1000300
[2024-07-22T21:00:01Z] harvest tx 3: ok — yield_injected=150, total_assets=1000450
... (500 successes, 0 suspicious events)
```

```
# Minimal reproduction case (simplified pseudocode)

# Setup: vault with total_deposited = 1_000_000 stroops

# Harvest 1 submits transfer of 150 stroops to vault
# → vault balance becomes 1_000_150
# → but total_deposited storage write is still in-flight

# Harvest 2 reads balance = 1_000_150
# Harvest 2 reads total_deposited = 1_000_000  (stale — write from Harvest 1 not yet committed)
# Guard: 1_000_150 != 1_000_000 → BalanceMismatch!

# After fix:
# Harvest 2 executes transfer first (+150) → balance = 1_000_300
# Guard: 1_000_300 == total_deposited(1_000_150 after Harvest 1 committed) + 150 → OK
```

```
# Test output after fix

running 27 tests
test test_harvest ... ok
test test_harvest_zero_shares_error ... ok
test test_harvest_high_volume_no_false_positive ... ok
test test_harvest_balance_guard_still_catches_real_mismatch ... ok
[... 23 more tests ...]
test result: ok. 27 passed; 0 failed; 0 ignored
```
