# Aura Vault Protocol — Security Documentation

> Last updated: 2026-06-25 | Contract version: v1

---

## Table of Contents

1. [Disclaimer & Terms of Use](#1-disclaimer--terms-of-use)
2. [Audit Status](#2-audit-status)
3. [Risk Factors](#3-risk-factors)
4. [Security Architecture](#4-security-architecture)
5. [Known Limitations](#5-known-limitations)
6. [Insurance Coverage](#6-insurance-coverage)
7. [Security Best Practices for Users](#7-security-best-practices-for-users)
8. [Vulnerability Disclosure Policy](#8-vulnerability-disclosure-policy)

---

## 1. Disclaimer & Terms of Use

**READ CAREFULLY BEFORE USING THIS PROTOCOL.**

Aura Vault Protocol ("the Protocol") is experimental, open-source software deployed on the Stellar/Soroban blockchain. By interacting with the Protocol you acknowledge and agree to the following:

- **No guarantees.** The Protocol is provided "as-is" without warranty of any kind, express or implied, including fitness for a particular purpose or freedom from bugs.
- **Financial risk.** You may lose some or all funds you deposit. Past performance of any yield strategy is not indicative of future results.
- **Irreversibility.** Blockchain transactions are final. Erroneous or malicious transactions cannot be reversed by any party.
- **Not financial advice.** Nothing in this documentation or the Protocol constitutes investment, legal, or financial advice.
- **Regulatory uncertainty.** DeFi protocols may be subject to evolving regulation. Users are solely responsible for compliance with applicable laws in their jurisdiction.
- **No recourse.** The Protocol has no legal entity, treasury, or insurance fund obligated to compensate you for losses.

By depositing funds you accept all risks described in this document.

---

## 2. Audit Status

### Current Status: **UNAUDITED**

The Aura Vault smart contract has **not undergone a formal third-party security audit** as of the date above. The codebase has been reviewed internally and includes 22 automated tests covering core invariants, but internal review is not a substitute for an independent audit.

### What Has Been Done

| Activity | Status |
|---|---|
| Internal code review | ✅ Complete |
| Automated unit & integration tests (22 tests) | ✅ Passing |
| Overflow-checks enabled in release profile | ✅ Enabled |
| Static analysis (manual review for `unwrap`/`expect` usage) | ✅ None outside `#[cfg(test)]` |
| Formal third-party audit | ❌ Pending |
| Formal verification | ❌ Not performed |

### Planned Audit Scope

When an audit is commissioned it will cover:

- Integer arithmetic and overflow paths in `deposit`, `withdraw`, and `harvest`
- Share-price manipulation and inflation-attack vectors
- CEI ordering across all mutating functions
- Storage key collision and TTL archival edge cases
- UUPS upgrade authorization and layout version guard
- Token transfer failure modes

**Do not deposit funds you cannot afford to lose until a formal audit has been completed and published.**

---

## 3. Risk Factors

### 3.1 Smart Contract Risk

Smart contracts may contain bugs or design flaws that cause loss of funds. Key attack surfaces in this contract:

**Share price manipulation.** The exchange rate between shares and underlying tokens is `total_assets / total_shares`. If `total_assets` can be manipulated — for example by direct token transfers outside the `harvest` function — the share price changes in ways not reflected by any depositor action. The contract tracks its own `total_deposited` ledger rather than querying the live token balance, limiting but not eliminating this surface.

**Inflation attack.** A first-depositor attack can dilute subsequent depositors by donating assets to manipulate the share ratio. The contract mitigates this by rejecting any deposit that rounds down to zero shares (`ZeroAmount` error), and by seeding the first deposit at a 1:1 ratio.

**Rounding.** All share and redemption calculations use integer floor division. Small rounding losses accumulate in the vault over time and are effectively socialized across all depositors. Individual transactions may redeem slightly fewer underlying tokens than expected.

**Upgrade risk.** The contract implements UUPS-style upgrades. The admin key holder can replace the contract's Wasm with any new code. A compromised or malicious admin could deploy code that steals funds. The upgrade emits an on-chain event (`upgrade`) that can be monitored.

### 3.2 Keeper / Harvest Risk

The `harvest` function is permissionless — any address can call it to inject yield. A keeper that injects incorrect amounts or interacts with a malicious token contract may behave unexpectedly. There is currently no allowlist for approved keepers.

### 3.3 Admin Key Risk

The admin address set at initialization controls the `upgrade` function. There is no multi-sig requirement, timelock, or on-chain governance enforced by the current contract. If the admin private key is lost or compromised:

- Lost key: upgrades are permanently blocked.
- Compromised key: an attacker can deploy arbitrary replacement code.

### 3.4 Underlying Token Risk

The Protocol only accepts a single SEP-41-compatible token set at initialization. Risks include:

- The token contract itself may have bugs or malicious logic (fee-on-transfer tokens are not explicitly handled).
- The token issuer may freeze or clawback balances (relevant for Stellar asset tokens with these flags enabled).
- Token contract upgrades by the token issuer are outside the vault's control.

### 3.5 Soroban Platform Risk

- **Archival / state expiry.** Soroban storage entries expire unless TTL is extended. The contract bumps TTLs on every mutating call (30-day lifetime, 7-day bump threshold). Accounts that never interact may eventually have their balance entry archived, requiring a restore transaction before withdrawing.
- **Protocol upgrades.** Changes to the Soroban runtime or Stellar protocol could affect contract behavior.
- **Network risk.** Stellar network outages, forks, or consensus failures are outside the Protocol's control.

### 3.6 Economic / Liquidity Risk

- Yield is only realized when a keeper calls `harvest`. There is no guarantee of when or how often this occurs.
- The vault holds 100% of deposits in a single token. There is no diversification.
- No mechanism prevents a bank-run scenario beyond the vault's actual token balance.

---

## 4. Security Architecture

The following controls are implemented in the contract:

### Checks-Effects-Interactions (CEI)

All mutating functions follow strict CEI ordering:

- `deposit`: validates inputs and computes shares → transfers tokens from caller → writes state
- `withdraw`: validates inputs → **writes state first** (burns shares) → transfers tokens to caller
- `harvest`: validates inputs → transfers tokens from caller → writes state

This ordering ensures the contract's state is consistent even if a token transfer reverts or re-enters.

### Overflow Safety

All arithmetic uses `checked_mul` and `checked_div`. The `MathOverflow` error (code 6) is returned instead of panicking. The release profile also sets `overflow-checks = true` as a secondary safety net.

### Inflation Attack Prevention

A zero-share mint fence in `deposit` rejects any deposit whose computed shares round to zero or below, closing the classic ERC-4626 inflation attack vector.

### Archival Safety

`bump_instance` is called on every mutating function. `bump_persistent` is called per-user on `deposit` and `withdraw`, extending the per-account balance entry TTL.

### Upgrade Authorization & Layout Guard

`upgrade` requires admin authorization and verifies that the on-chain `LayoutVersion` matches `CURRENT_LAYOUT_VERSION`. This prevents silently deploying a new Wasm that misinterprets existing storage keys.

### No `unwrap` / `expect` in Production

All `unwrap()` and `expect()` calls are gated behind `#[cfg(test)]`. Production paths use `?`-propagated `Result` types.

---

## 5. Known Limitations

| Limitation | Detail |
|---|---|
| No multi-sig admin | Single EOA controls upgrades |
| No timelock on upgrades | Upgrades take effect immediately |
| Permissionless harvest | No keeper allowlist |
| No fee-on-transfer handling | Deflationary tokens will cause accounting drift |
| No native slippage protection | Callers must verify received amounts off-chain |
| Single token only | No diversification |
| No governance | Admin is a single address |

---

## 6. Insurance Coverage

**There is currently no insurance coverage for funds deposited in the Aura Vault Protocol.**

- The Protocol has no relationship with any DeFi insurance provider (e.g., Nexus Mutual, InsurAce, or equivalents on Stellar).
- There is no protocol treasury or reserve fund to compensate users in the event of an exploit.
- Users who wish to purchase coverage must do so independently. Be aware that most DeFi insurance products require the covered protocol to be listed and may not cover unaudited contracts.

---

## 7. Security Best Practices for Users

**Before depositing:**

- Only deposit amounts you can afford to lose entirely.
- Verify the contract ID you are interacting with against official sources. Do not trust links from social media or DMs.
- Check that the contract is initialized and the underlying token address matches what you expect by calling `total_assets()` and reviewing on-chain state.

**While depositing:**

- Review the exact transaction payload before signing. Confirm `amount`, `caller`, and contract ID.
- Use a dedicated wallet for DeFi interactions, separate from your main holdings.

**Monitoring your position:**

- Periodically call `balance_of(<your-address>)` and `total_assets()` to verify your position is intact.
- Watch for on-chain `upgrade` events emitted by the contract. An unexpected upgrade is a red flag — withdraw immediately if you see one you did not authorize.
- If your balance entry approaches archival (30 days without interaction), perform a `deposit` or `withdraw` of any amount to reset the TTL, or submit a restore transaction.

**Withdrawing:**

- Verify the `redeem_amount` returned before assuming the full value. Floor rounding means you may receive slightly less than the raw share-to-asset ratio suggests.

---

## 8. Vulnerability Disclosure Policy

### Scope

The following are in scope for responsible disclosure:

- `aura-vault/src/lib.rs` — core contract logic
- `aura-vault/src/storage.rs` — storage helpers and TTL management
- `aura-vault/src/errors.rs` — error definitions
- Any deployed instance of the compiled Wasm on Stellar Testnet or Mainnet

Out of scope: front-end UI bugs that do not affect on-chain funds, documentation typos, theoretical issues with no realistic exploit path.

### Severity Classification

| Severity | Description | Examples |
|---|---|---|
| Critical | Direct loss or theft of user funds | Arithmetic bypass allowing over-redemption, admin check bypass in `upgrade` |
| High | Significant disruption or indirect fund risk | Permanent DoS on withdraw, harvest manipulation affecting all depositors |
| Medium | Limited impact or requires privileged access to exploit | Rounding exploitation below 1% impact, TTL miscalculation |
| Low | Informational, best-practice deviation | Minor code quality issues, no fund risk |

### How to Report

1. **Do not disclose publicly** until the issue has been acknowledged and a fix has been deployed or a coordinated disclosure date has been agreed.

2. **Submit your report** via GitHub Security Advisories on this repository (Settings → Security → Advisories → New draft security advisory), or by emailing the address listed in the repository's GitHub profile.

3. **Include in your report:**
   - Severity assessment and rationale
   - Affected function(s) and contract version
   - Step-by-step reproduction (test case or PoC transaction sequence preferred)
   - Estimated impact (funds at risk, affected users)
   - Suggested fix (optional but appreciated)

4. **Response timeline:**
   - Acknowledgement: within 72 hours
   - Severity triage: within 7 days
   - Fix deployed or coordinated disclosure: within 30 days for Critical/High; 90 days for Medium/Low

5. **No bounty program** is currently active. Reporters of Critical and High issues will be credited publicly (with consent) in the changelog and audit notes.

### Safe Harbor

Security researchers acting in good faith under this policy — who do not exploit vulnerabilities beyond proof-of-concept, do not access or exfiltrate user data, and report promptly — will not face legal action from the Protocol maintainers.

---

*This document is provided for informational purposes only and does not constitute legal or financial advice. It may be updated as the Protocol evolves.*
