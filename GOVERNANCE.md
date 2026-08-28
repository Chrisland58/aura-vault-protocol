# Aura Vault — Governance Documentation & Voting Guide

> **Issue**: #409  
> **Version**: 0.2.0  
> **Last Updated**: 2026-08-28

---

## Table of Contents

1. [Overview](#overview)
2. [Governance Participants](#governance-participants)
3. [Proposal Lifecycle](#proposal-lifecycle)
4. [Creating a Proposal](#creating-a-proposal)
5. [Voting Power Calculation](#voting-power-calculation)
6. [Quorum and Approval Thresholds](#quorum-and-approval-thresholds)
7. [Timelock](#timelock)
8. [Step-by-Step: Participating via UI](#step-by-step-participating-via-ui)
9. [Step-by-Step: Participating via Contract](#step-by-step-participating-via-contract)
10. [What Can Be Governed](#what-can-be-governed)
11. [Emergency Actions](#emergency-actions)
12. [Governance Roadmap](#governance-roadmap)

---

## Overview

Aura Vault governance allows **vault share holders** to collectively control protocol parameters, fee settings, contract upgrades, and treasury management. Governance is designed to be progressive — starting with admin multisig and evolving toward full on-chain token governance as the protocol matures.

### Current Governance Stage (v0.2.0)

**Stage 1 — Admin Multisig**

All protocol changes are currently controlled by a 3-of-5 admin multisig. Major changes (fee adjustments, contract upgrades) require a public comment period of at least 7 days before execution.

The path to on-chain governance is documented in the [Governance Roadmap](#governance-roadmap) section. Share holders can participate in off-chain signalling at any time using GitHub Discussions or community calls.

---

## Governance Participants

### Admin (Multisig)

- **Who**: A 3-of-5 multisig of founding contributors.
- **Powers**: Execute all on-chain parameter changes, contract upgrades, treasury withdrawals.
- **Constraints**: Cannot set fees outside the contract-enforced bounds (performance fee 10–20%, management fee 0–1%). Cannot change these bounds without deploying a new contract.

### Vault Share Holders

- **Who**: Any address holding Aura Vault shares (`balance_of(address) > 0`).
- **Current powers**: Off-chain signalling via GitHub Discussions and community calls.
- **Future powers**: On-chain proposal creation and voting (see [Governance Roadmap](#governance-roadmap)).

### Keepers

- **Who**: Anyone who calls `harvest()`.
- **Powers**: Trigger yield injection (permissionless). No governance power.

### Integrators

- **Who**: Protocols or individuals who build on top of Aura Vault.
- **Powers**: Off-chain signalling. No on-chain governance power in the current stage.

---

## Proposal Lifecycle

```
DRAFT → OPEN FOR COMMENT → VOTING → TIMELOCK → EXECUTED
                                  ↘ DEFEATED
                                  ↘ CANCELLED
```

| Stage | Duration | Description |
|---|---|---|
| **Draft** | Unlimited | Author refines the proposal in GitHub Discussions |
| **Open for Comment** | ≥ 7 days | Public comment period; community feedback |
| **Voting** | 5 days | (On-chain governance) Votes cast by share holders |
| **Timelock** | 48 hours | Mandatory delay between approval and execution |
| **Executed** | — | Admin (or on-chain executor) applies the change |
| **Defeated** | — | Did not reach quorum or approval threshold |
| **Cancelled** | — | Author or admin withdraws before execution |

---

## Creating a Proposal

### Off-Chain Proposal (Current Process)

1. **Open a GitHub Discussion** in the `governance` category at:  
   `https://github.com/soterika/aura-vault-protocol/discussions`

2. **Use the proposal template**:

   ```markdown
   ## Proposal: [Short Title]

   **Type**: [Fee Change | Contract Upgrade | Treasury | Parameter Change]
   **Author**: [Your GitHub username or Stellar address]
   **Status**: Draft

   ### Summary
   One paragraph describing what the proposal does and why.

   ### Motivation
   Why is this change needed? What problem does it solve?

   ### Specification
   Exact on-chain call(s) that would be made:
   - Function: `set_fees(perf_fee_bps=1500, mgmt_fee_bps=50)`
   - Network: mainnet
   - Contract: <CONTRACT_ID>

   ### Risks & Mitigations
   What could go wrong and how it is mitigated.

   ### Voting Options
   - For: Apply the change as specified.
   - Against: Keep current parameters.
   - Abstain: No preference.
   ```

3. **Comment period**: The proposal must stay open for community comment for a minimum of **7 days**.

4. **Admin review**: After the comment period, the multisig reviews and — if there is clear consensus — executes the change.

5. **Execution announcement**: The admin posts the TX hash in the same Discussion thread.

### On-Chain Proposal (Planned — See Roadmap)

Once on-chain governance is deployed, proposals will be submitted directly via the governance contract. See [Step-by-Step: Participating via Contract](#step-by-step-participating-via-contract) for the planned flow.

---

## Voting Power Calculation

### Current Stage (Off-Chain)

Voting weight is calculated by **vault share balance at snapshot time**. Snapshot is taken at the block height when the proposal enters the voting stage.

```
voting_power(address) = balance_of(address) at snapshot_block
```

Shares represent proportional ownership of the vault, so voting power scales with economic stake.

### Example

```
Total shares: 1,000,000
Alice: 250,000 shares → 25% voting power
Bob:   100,000 shares → 10% voting power
Carol: 650,000 shares → 65% voting power
```

### Delegation (Planned)

In the on-chain governance system, share holders will be able to delegate their voting power to another address without transferring shares:

```bash
# Delegate to another address
stellar contract invoke \
  --id <GOVERNANCE_CONTRACT_ID> \
  --source <YOUR_KEYPAIR> \
  --network mainnet \
  -- delegate \
  --delegatee <DELEGATEE_ADDRESS>
```

Delegation is revocable at any time. Delegating to yourself reclaims your own voting power.

---

## Quorum and Approval Thresholds

### Current Thresholds (Admin Multisig)

| Change Type | Signers Required | Comment Period |
|---|---|---|
| Fee parameter change | 3 of 5 | 7 days |
| Contract upgrade | 4 of 5 | 14 days |
| Treasury withdrawal | 3 of 5 | 7 days |
| Emergency pause | 2 of 5 | None (immediate) |

### Planned On-Chain Thresholds

| Change Type | Quorum | Approval | Timelock |
|---|---|---|---|
| Fee parameter change | 10% of supply | >50% yes | 48 hours |
| Contract upgrade | 20% of supply | >66% yes | 7 days |
| Treasury withdrawal | 15% of supply | >60% yes | 48 hours |
| Emergency pause | 5% of supply | >50% yes | None |
| Threshold change | 30% of supply | >75% yes | 14 days |

**Quorum** is the minimum percentage of total shares that must vote (for, against, or abstain) for the result to be binding.  
**Approval** is the percentage of non-abstain votes that must be "for" to pass.

---

## Timelock

All non-emergency governance actions are subject to a **mandatory timelock** between approval and execution. This gives users time to exit the vault before a change they disagree with takes effect.

### Timelock Periods

| Action | Timelock |
|---|---|
| Fee change | 48 hours |
| Treasury withdrawal | 48 hours |
| Contract upgrade | 7 days |
| Emergency pause | 0 (immediate) |

### How Timelock Works

1. A proposal is approved (meets quorum and approval threshold).
2. The `execute_after` timestamp is set to `now + timelock_period`.
3. Anyone can call `execute(proposal_id)` after this timestamp.
4. The admin multisig (or on-chain executor) cannot execute before the timelock expires.
5. During the timelock window, any user who disagrees can withdraw their shares.

---

## Step-by-Step: Participating via UI

> The governance UI is planned for a future release. The following describes the intended flow.

### Viewing Proposals

1. Navigate to the Aura Vault app at `https://app.aura-vault.dev`.
2. Click **Governance** in the top navigation.
3. Active proposals are displayed with their current vote counts, quorum progress, and time remaining.

### Voting on a Proposal

1. Connect your Stellar wallet (Freighter or compatible).
2. Open the proposal you want to vote on.
3. Review the specification, discussion, and risks.
4. Click **Vote For**, **Vote Against**, or **Abstain**.
5. Sign the transaction in your wallet. Your voting power equals your share balance at the snapshot block.
6. Confirmation appears in the toast notification.

### Creating a Proposal via UI

1. Connect your wallet. You must hold at least **1,000 shares** (planned minimum) to create a proposal.
2. Click **New Proposal**.
3. Fill in: Title, Type, Summary, Specification (exact contract call), Motivation, and Risks.
4. Click **Submit Proposal**. This posts it as a Draft.
5. After your 7-day comment period, click **Open for Voting** to start the voting period.

---

## Step-by-Step: Participating via Contract

These commands use the Stellar CLI directly. Replace placeholders with actual values.

### Check Your Voting Power

```bash
# Your share balance = your voting power at snapshot
stellar contract invoke \
  --id <VAULT_CONTRACT_ID> \
  --network mainnet \
  -- balance_of \
  --address <YOUR_ADDRESS>
```

### Query Total Supply (for power percentage)

```bash
# Total shares outstanding
stellar contract invoke \
  --id <VAULT_CONTRACT_ID> \
  --network mainnet \
  -- total_assets
# Note: total_shares is a separate storage query; use the block explorer for this.
```

### Cast a Vote (Planned On-Chain Governance)

```bash
stellar contract invoke \
  --id <GOVERNANCE_CONTRACT_ID> \
  --source <YOUR_KEYPAIR> \
  --network mainnet \
  -- cast_vote \
  --proposal_id <PROPOSAL_ID> \
  --support 1   # 0=Against, 1=For, 2=Abstain
```

### Execute an Approved Proposal

```bash
# Anyone can call this after the timelock expires
stellar contract invoke \
  --id <GOVERNANCE_CONTRACT_ID> \
  --source <ANY_KEYPAIR> \
  --network mainnet \
  -- execute \
  --proposal_id <PROPOSAL_ID>
```

### Cancel a Proposal (Author or Admin Only)

```bash
stellar contract invoke \
  --id <GOVERNANCE_CONTRACT_ID> \
  --source <AUTHOR_OR_ADMIN_KEYPAIR> \
  --network mainnet \
  -- cancel \
  --proposal_id <PROPOSAL_ID>
```

---

## What Can Be Governed

### In Scope

| Parameter | Current Value | Bounds |
|---|---|---|
| Performance fee (`perf_fee_bps`) | 1500 (15%) | 1000–2000 |
| Management fee (`mgmt_fee_bps`) | 0 (0%) | 0–100 |
| Treasury address | Multisig | Any valid address |
| Contract upgrade (new WASM hash) | v0.2.0 | Admin + governance |
| Emergency pause | Unpaused | Admin only |

### Out of Scope (Not Governable)

These properties are hard-coded in the contract and cannot be changed without deploying a new contract:

- Maximum performance fee ceiling (20%)
- Maximum management fee ceiling (1%)
- Minimum performance fee floor (10%)
- CEI ordering and flash loan guard logic
- Overflow protection (`checked_mul`, `checked_div`)

---

## Emergency Actions

### Emergency Pause

The admin can pause the vault immediately without a governance vote in the event of a detected exploit or critical vulnerability.

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <ADMIN_KEYPAIR> \
  --network mainnet \
  -- pause
```

While paused:
- `deposit()` is blocked (returns `VaultError::VaultPaused`)
- `withdraw()` is blocked (returns `VaultError::VaultPaused`)
- `harvest()` is blocked (returns `VaultError::VaultPaused`)
- Read operations (`total_assets`, `balance_of`, `is_paused`) remain available

**Unpausing** requires a governance proposal and 48-hour timelock (unless the emergency was a false alarm, in which case the admin multisig can unpause with a 3-of-5 vote after posting an incident report).

### Incident Response

If you notice suspicious behavior:
1. Report immediately in the `#security` channel or via email to `security@aura-vault.dev`.
2. Do **not** share exploit details publicly before the team has responded.
3. The team will assess within 24 hours and post a public incident report within 72 hours.

---

## Governance Roadmap

| Stage | Target | Description |
|---|---|---|
| **Stage 1** (current) | v0.2.0 | Admin multisig + off-chain signalling |
| **Stage 2** | v0.3.0 | On-chain proposal contract; voting by share holders; results advisory |
| **Stage 3** | v0.4.0 | Binding on-chain governance; timelock enforced; admin multisig becomes executor |
| **Stage 4** | v1.0.0 | Full DAO: admin multisig abolished; governance contract is sole admin |

Community feedback on the timeline and design is tracked in GitHub Discussions under the `governance` label.

---

*For fee governance details see [/docs/fees.md](docs/fees.md). For contract upgrade procedures see [/docs/UPGRADE_PLAYBOOK.md](docs/UPGRADE_PLAYBOOK.md).*
