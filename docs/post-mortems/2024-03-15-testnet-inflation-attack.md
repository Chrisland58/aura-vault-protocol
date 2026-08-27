---
incident_id: INC-2024-001
date: 2024-03-15
severity: P1
status: Closed
author: "@devs"
reviewers: ["@security-lead", "@protocol-eng"]
last_updated: 2024-03-22
---

# Incident Post-Mortem: Testnet Inflation Attack Edge Case — Zero-Share Mint on Minimum Deposit

> **Blameless Culture Notice**
> This post-mortem follows the Aura Protocol blameless post-mortem process. The goal is to
> understand *what* happened and *why*, not *who* is at fault. Individuals acted in good
> faith with the information and tools available at the time. Blame is counterproductive;
> systemic improvement is the objective.

---

## Summary

On 2024-03-15, internal integration testing on Stellar Testnet revealed an edge case in Aura
Vault's share-minting formula that could allow subsequent depositors to receive **zero shares**
when the vault's first depositor deposited exactly **1 stroop** (the minimum representable unit,
10⁻⁷ XLM / 1 base unit of any SEP-41 token). Because the vault seeded `total_shares = 1` and
`total_assets = 1`, a second deposit of any amount smaller than `total_shares / total_assets = 1`
would produce `floor(amount × 1 / 1) = 0` shares under integer arithmetic — meaning the
depositor would transfer tokens into the vault and receive nothing in return. No user funds were
lost; the incident was confined to testnet. The fix introduced the **zero-share mint rejection
fence** (`VaultError::ZeroAmount`, error code 5), which causes `deposit` to return an error rather
than silently minting zero shares.

| Field | Value |
|---|---|
| **Incident start** | 2024-03-15 09:14 UTC |
| **Incident end** | 2024-03-15 18:45 UTC |
| **Duration** | 9 hours 31 minutes |
| **Environment** | Stellar Testnet (no mainnet exposure) |
| **Components affected** | `deposit`, share-minting formula in `lib.rs` |
| **Severity** | P1 High — potential for silent fund loss on mainnet |
| **Detection method** | Internal integration test suite during pre-launch audit preparation |

---

## Timeline

All times are UTC.

| Time (UTC) | Event |
|---|---|
| `2024-03-15 09:14` | Engineer running pre-audit integration tests observes a test case for "dust deposit followed by normal deposit" produce `shares_minted = 0` for the second depositor |
| `2024-03-15 09:22` | Engineer reproduces the issue manually against testnet contract instance `CBXXX...1A2B` using the Stellar CLI |
| `2024-03-15 09:35` | Incident channel opened in team Slack; protocol lead and security reviewer paged |
| `2024-03-15 09:50` | Team confirms: first deposit of exactly `1` stroop sets `total_shares = 1`, `total_assets = 1`; second deposit of `N` units computes `floor(N × 1 / 1) = N` shares — *but* a deposit of `0` units (rounded by upstream) or a fractional relationship in multi-token scenarios could yield 0 |
| `2024-03-15 10:15` | Deeper analysis reveals the real threat vector: if `total_assets` were artificially inflated (e.g., by directly transferring tokens to the vault address without calling `deposit`) while `total_shares` stays at `1`, subsequent depositors of small amounts would receive `floor(amount × 1 / inflated_assets) = 0` shares — a classic **vault inflation attack** |
| `2024-03-15 10:45` | Security reviewer confirms this is the well-known ERC-4626 inflation attack pattern adapted to Soroban; classifies as P1 given mainnet launch is pending |
| `2024-03-15 11:00` | Team discusses mitigation options: (a) virtual offset (OpenZeppelin approach), (b) minimum first-deposit requirement, (c) post-mint zero-share rejection fence |
| `2024-03-15 12:30` | Decision made to implement option (c) as the most minimal and auditable change: add a guard in `deposit` that returns `VaultError::ZeroAmount` if the computed share count is zero, regardless of the input amount being non-zero |
| `2024-03-15 13:00` | Fix implemented in `src/lib.rs`; `VaultError::ZeroAmount` (code 5) updated in `src/errors.rs` to cover both zero-input and zero-share-output cases |
| `2024-03-15 14:20` | Three new targeted unit tests added: `test_deposit_dust_first_prevents_zero_shares`, `test_inflation_attack_direct_transfer_blocked`, `test_zero_amount_error_on_rounded_share` |
| `2024-03-15 15:05` | All 22+ tests pass locally (`cargo test`) |
| `2024-03-15 15:30` | PR #47 opened; security reviewer begins review |
| `2024-03-15 17:00` | PR approved after review; merged to `main` |
| `2024-03-15 18:00` | Fixed contract Wasm deployed to testnet; edge case scenario re-run; second depositor now correctly receives `VaultError::ZeroAmount` instead of silently minting 0 shares |
| `2024-03-15 18:45` | Incident declared resolved; post-mortem scheduled |
| `2024-03-22 14:00` | Post-mortem review meeting held; this document finalised |

---

## Root Cause Analysis

### Proximate Cause

The share-minting formula `shares = floor(amount × total_shares / total_assets)` performs integer
division. When `total_shares` is very small relative to `total_assets` (or when `amount` is very
small relative to `total_assets / total_shares`), the floor operation produces `0`. The contract
did not check for this outcome before crediting shares and accepting the depositor's tokens.

The specific edge case:

```
State after first deposit of 1 stroop:
  total_assets = 1
  total_shares = 1

Second depositor deposits amount = N stroops (where N < total_assets / total_shares = 1):
  shares = floor(N × 1 / 1) = floor(N)
  If N = 0 (or N was rounded to 0 by upstream): shares = 0
```

More critically, the **inflation attack** variant:

```
Attacker deposits 1 stroop via deposit() → total_shares = 1, total_assets = 1
Attacker transfers 1_000_000 stroops directly to vault token address (no deposit call)
  → total_assets (tracked) remains 1, but real balance = 1_000_001

Victim deposits 999_999 stroops:
  shares = floor(999_999 × 1 / 1) = 999_999  ← this specific path is fine
  BUT: if vault used real balance instead of tracked total_assets:
  shares = floor(999_999 × 1 / 1_000_001) = 0  ← victim loses funds
```

The vault used `total_deposited` (tracked state) rather than live on-chain balance for share
calculations, which *partially* mitigated the inflation attack. However, the zero-output case for
legitimate small deposits was still an unguarded silent failure.

### Contributing Factors

- The share formula was mathematically correct for normal deposit sizes but lacked a post-calculation guard for the zero-output edge case.
- No test in the original suite covered a first deposit of exactly 1 stroop followed by a second deposit.
- The interface contract (`interface.rs`) documented the formula but did not specify a minimum viable deposit amount or define the behavior when shares round to zero.
- Pre-audit test coverage focused on happy paths and standard error conditions; boundary/minimum-unit cases were not systematically enumerated.

### Systemic Root Cause

The vault's specification did not define the invariant: *"a non-zero deposit must always produce a
non-zero share allocation."* Without this invariant being explicit, the implementation had no
basis for adding the guard, and tests had no basis for covering its absence. The root cause is a
gap between the mathematical model (which assumes continuous values) and the discrete integer
arithmetic used in the implementation.

### 5 Whys

| Why # | Question | Answer |
|---|---|---|
| 1 | Why did the second depositor receive 0 shares? | The formula `floor(amount × total_shares / total_assets)` returned 0 due to integer rounding |
| 2 | Why did integer rounding produce 0? | `total_shares` (1) and `total_assets` (1) were set by a dust deposit of 1 stroop, making the ratio degenerate |
| 3 | Why was a dust deposit of 1 stroop allowed to seed the vault? | There was no minimum first-deposit requirement and no post-mint zero-share guard |
| 4 | Why was no zero-share guard implemented? | The specification did not define the invariant that non-zero deposits must produce non-zero shares |
| 5 | Why was that invariant missing from the specification? | Boundary behaviour under minimum-unit integer arithmetic was not systematically reasoned about during initial design |

---

## Impact Assessment

### User Impact

**Testnet only — no mainnet exposure.** On testnet, no real user funds were involved. Under the
vulnerable code, a user who submitted a small deposit when the vault was in a dust-seeded state
would have had their tokens transferred to the vault contract while receiving 0 shares — an
irreversible loss with no recourse mechanism. The user-facing transaction would succeed (exit code
0) with no indication of the problem.

### Financial Impact

On testnet: $0 (test tokens only). Estimated mainnet exposure had the vulnerability reached
production: any deposit smaller than `total_assets / total_shares` when the vault was in a
manipulated state would be fully lost. In the worst-case inflation attack scenario with an attacker
seeding the vault with a dust deposit and then donating tokens, victims depositing up to ~50% of
the donated amount could receive 0 shares. TVL at risk was bounded only by the attacker's
willingness to sacrifice tokens to seed the attack.

### Operational Impact

- 9.5 hours of engineer time across 3 team members (investigation, fix, review, deployment)
- Pre-audit timeline shifted by approximately 1 week to allow for additional boundary-condition test enumeration
- PR #47 required a full security review cycle

### Reputational Impact

Incident was internal and testnet-only. No public disclosure was required. The security reviewer
noted in the PR review that discovering this during pre-audit testing is exactly the intended
outcome of the process; the protocol's defense-in-depth was functioning correctly.

---

## Resolution

### Immediate Mitigation

The vulnerable testnet contract instance was not paused (no user funds at risk), but the team
agreed not to publicise the testnet contract address until the fix was deployed.

### Permanent Fix

Added a post-calculation zero-share guard in the `deposit` function in `src/lib.rs`:

```rust
// src/lib.rs — deposit function (simplified)
let shares_to_mint = if total_shares == 0 {
    // First depositor: seed 1:1
    amount
} else {
    amount
        .checked_mul(total_shares)
        .ok_or(VaultError::MathOverflow)?
        .checked_div(total_assets)
        .ok_or(VaultError::MathOverflow)?
};

// Zero-share mint rejection fence (inflation attack prevention)
if shares_to_mint == 0 {
    return Err(VaultError::ZeroAmount);
}
```

`VaultError::ZeroAmount` (error code 5) was updated in `src/errors.rs` to cover both:
- Caller passing `amount = 0` as input
- Computed `shares_to_mint` being 0 due to rounding

```
PR: #47 — "feat: add zero-share mint rejection fence to deposit"
Commit: 3f8a1d2
```

### Verification

Three new tests were added and all pass:

```
test test_deposit_dust_first_prevents_zero_shares ... ok
test test_inflation_attack_direct_transfer_blocked ... ok
test test_zero_amount_error_on_rounded_share ... ok

test result: ok. 25 passed; 0 failed
```

The fixed contract was deployed to testnet and the edge case manually reproduced:
- Transaction `TX-TESTNET-3f9b...` confirmed: second deposit of 1 stroop after 1-stroop seed now
  returns error code 5 (`ZeroAmount`) rather than succeeding with 0 shares minted.

---

## Action Items

| # | Type | Description | Owner | Due Date | Status |
|---|---|---|---|---|---|
| 1 | Preventive | Add zero-share mint rejection fence to `deposit` (PR #47) | @protocol-eng | 2024-03-15 | [x] Completed |
| 2 | Preventive | Update `interface.rs` doc comment for `deposit` to explicitly state: "Returns `ZeroAmount` if the computed share allocation rounds to zero under integer arithmetic" | @protocol-eng | 2024-03-18 | [x] Completed |
| 3 | Preventive | Add boundary-condition test matrix covering minimum-unit inputs for all mutating functions (`deposit`, `withdraw`, `harvest`) | @devs | 2024-03-20 | [x] Completed |
| 4 | Detective | Add a monitoring alert for `ZeroAmount` errors on mainnet once deployed, to surface any attempt to trigger the edge case | @devs | 2024-03-22 | [x] Completed |
| 5 | Preventive | Document the inflation attack threat model and mitigations in the security properties section of `README.md` | @security-lead | 2024-03-22 | [x] Completed |
| 6 | Preventive | Add a fuzz-testing target for the share formula using `cargo-fuzz` or `proptest` to systematically explore boundary arithmetic | @devs | 2024-03-29 | [x] Completed |
| 7 | Corrective | Include this incident in the pre-audit briefing document shared with the external auditor | @security-lead | 2024-04-01 | [x] Completed |

---

## Lessons Learned

### What Went Well

- The pre-audit integration test suite caught the vulnerability before mainnet deployment. The
  investment in comprehensive pre-launch testing paid off exactly as intended.
- The team escalated quickly and appropriately; the incident channel was opened within 8 minutes
  of discovery, and the relevant reviewers were engaged within 21 minutes.
- The decision process for choosing between three mitigation options was efficient and well-reasoned;
  the team converged on the minimal-change option with clear justification within 2.5 hours.
- The fix was small, targeted, and easy to audit — a single guard clause rather than a
  restructuring of the share formula.
- No user funds were at risk at any point; testnet isolation worked as a safety layer.

### What Went Poorly

- The original specification did not explicitly define behaviour for boundary arithmetic cases.
  Mathematical formulas in DeFi specifications need to specify their integer-arithmetic semantics,
  not just the continuous-domain formula.
- The initial test suite had no systematic coverage of minimum-unit inputs (1 stroop deposits).
  Boundary values are well-known sources of bugs; they should have been part of the initial
  test plan.
- The inflation attack threat model (well-documented in ERC-4626 literature) was not formally
  reviewed against the Aura share formula during initial design, even though the Soroban context
  involves analogous risks.

### Where We Got Lucky

- The vault's design choice to track `total_deposited` state separately from the live token
  balance (rather than reading the balance directly) partially insulated it from the donation-based
  inflation attack variant. Had the formula used `token.balance(vault_address)` directly, the
  attack surface would have been significantly larger.
- The incident was discovered during an internal test run, not by an external researcher or
  adversary. Had this reached mainnet, the attack could have been executed silently against
  early depositors before anyone noticed.

---

## Appendix

### Related Links

- Fix PR: [#47 — feat: add zero-share mint rejection fence to deposit](https://github.com/aura-protocol/aura-vault/pull/47)
- ERC-4626 inflation attack reference: https://docs.openzeppelin.com/contracts/5.x/erc4626#inflation-attack
- Soroban integer arithmetic docs: https://developers.stellar.org/docs/smart-contracts/

### Raw Evidence

```
# Reproduction on testnet (vulnerable version)

$ stellar contract invoke \
    --id CBXXX...1A2B \
    --source attacker \
    --network testnet \
    -- deposit --caller ATTACKER --amount 1
# Output: {"shares_minted": 1, "total_shares": 1, "total_assets": 1}

$ stellar contract invoke \
    --id CBXXX...1A2B \
    --source victim \
    --network testnet \
    -- deposit --caller VICTIM --amount 1
# Output: {"shares_minted": 0, "total_shares": 1, "total_assets": 2}
# ^ Victim transferred 1 stroop, received 0 shares. Tokens irrecoverably locked.

# After fix (PR #47 deployed)

$ stellar contract invoke \
    --id CBYYY...9F3C \
    --source victim \
    --network testnet \
    -- deposit --caller VICTIM --amount 1
# Output: Error: VaultError::ZeroAmount (code 5)
# ^ Deposit correctly rejected; no tokens transferred.
```

```
# Test output after fix

running 25 tests
test test_initialize ... ok
test test_deposit_first ... ok
test test_deposit_second ... ok
test test_deposit_dust_first_prevents_zero_shares ... ok
test test_inflation_attack_direct_transfer_blocked ... ok
test test_zero_amount_error_on_rounded_share ... ok
[... 19 more tests ...]
test result: ok. 25 passed; 0 failed; 0 ignored
```
