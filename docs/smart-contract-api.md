# Aura Vault — Smart Contract API Reference

> **Contract**: `AuraVault`  
> **Platform**: [Soroban](https://soroban.stellar.org) (Stellar)  
> **Language**: Rust (`no_std`)  
> **Source**: `aura-vault/src/lib.rs`

---

## Table of Contents

1. [Overview](#overview)
2. [Core Vault Functions](#core-vault-functions)
   - [initialize](#initialize)
   - [deposit](#deposit)
   - [withdraw](#withdraw)
   - [harvest](#harvest)
   - [harvest_token](#harvest_token)
3. [View Functions](#view-functions)
   - [total_assets](#total_assets)
   - [balance_of](#balance_of)
   - [is_paused](#is_paused)
   - [total_fees_collected](#total_fees_collected)
4. [Admin: Emergency Controls](#admin-emergency-controls)
   - [pause](#pause)
   - [unpause](#unpause)
5. [Admin: Fee Management](#admin-fee-management)
   - [set_fees](#set_fees)
   - [set_treasury](#set_treasury)
   - [withdraw_fees](#withdraw_fees)
6. [Admin: Yield Token Registry](#admin-yield-token-registry)
   - [register_yield_token](#register_yield_token)
7. [Admin: Upgrade](#admin-upgrade)
   - [upgrade](#upgrade)
8. [Governance](#governance)
   - [propose_update_admin](#propose_update_admin)
   - [propose_update_token](#propose_update_token)
   - [propose_parameter_update](#propose_parameter_update)
   - [vote](#vote)
   - [execute](#execute)
   - [proposal_status](#proposal_status)
9. [Events](#events)
10. [Error Codes](#error-codes)
11. [Security Model](#security-model)
12. [Resource Notes](#resource-notes)

---

## Overview

`AuraVault` is a share-based yield vault on Soroban. It accepts deposits of a
single SEP-41-compatible underlying token, issues proportional vault shares,
and allows keepers to compound yield via `harvest`. A multisig governance
layer controls sensitive parameter changes with a 24-hour timelock.

### Share Pricing

| Scenario | Formula |
|---|---|
| First depositor (empty vault) | `shares = amount` (1:1 seed) |
| Subsequent depositors | `shares = floor(amount × total_shares / total_assets)` |
| Redemption | `tokens = floor(shares × total_assets / total_shares)` |

Yield injected via `harvest` increases `total_assets` without minting new
shares, which raises the redemption rate for all existing shareholders.

---

## Core Vault Functions

### `initialize`

One-time vault setup. Stores the admin, the underlying SEP-41 token, and the
governance signer set. Reverts if called a second time.

**Signature**

```rust
pub fn initialize(
    env: Env,
    admin: Address,
    underlying_token: Address,
    signers: Vec<Address>,
) -> Result<(), VaultError>
```

**Parameters**

| Name | Type | Description |
|---|---|---|
| `admin` | `Address` | Account authorized to call all admin-gated functions. |
| `underlying_token` | `Address` | SEP-41 token contract address accepted for deposits. |
| `signers` | `Vec<Address>` | Initial governance multisig signers (≥ 3 recommended). |

**Returns** `Ok(())`.

**Errors**

| Error | Condition |
|---|---|
| `AlreadyInitialized` | `initialize` was already called. |

**Soroban CLI example**

```bash
stellar contract invoke \
  --id <CONTRACT_ID> --source <ADMIN_KEYPAIR> --network testnet \
  -- initialize \
  --admin GADMIN... \
  --underlying_token CTOKEN... \
  --signers '["GSIGNER1...", "GSIGNER2...", "GSIGNER3..."]'
```

---

### `deposit`

Transfer underlying tokens into the vault and receive proportional vault shares.

**Signature**

```rust
pub fn deposit(
    env: Env,
    caller: Address,
    amount: i128,
) -> Result<i128, VaultError>
```

**Parameters**

| Name | Type | Description |
|---|---|---|
| `caller` | `Address` | Depositor; must sign the transaction (`require_auth`). |
| `amount` | `i128` | Underlying tokens to deposit. Must be `> 0`. |

**Returns** `Ok(shares_minted: i128)` — vault shares issued to `caller`.

**Errors**

| Error | Condition |
|---|---|
| `NotInitialized` | Vault not yet initialized. |
| `VaultPaused` | Vault is paused. |
| `ZeroAmount` | `amount ≤ 0`, or computed shares round to zero. |
| `BalanceMismatch` | Flash-loan guard: actual token balance ≠ `total_deposited`. |
| `MathOverflow` | Arithmetic overflow in share formula. |

**Event emitted**

```
topics: ("deposit", caller: Address, amount: i128)
data:   (shares_minted: i128, new_total_shares: i128, new_total_deposited: i128)
```

**Soroban CLI example**

```bash
stellar contract invoke \
  --id <CONTRACT_ID> --source <USER_KEYPAIR> --network testnet \
  -- deposit \
  --caller GUSER... \
  --amount 1000000
```

**JavaScript SDK example**

```ts
import { nativeToScVal, scValToNative } from "@stellar/stellar-sdk";

const result = await contract.call("deposit", {
  caller: userKeypair.publicKey(),
  amount: nativeToScVal(1_000_000n, { type: "i128" }),
});
const sharesMinted = scValToNative(result); // i128 as BigInt
```

---

### `withdraw`

Burn vault shares and receive the proportional underlying tokens.

**Signature**

```rust
pub fn withdraw(
    env: Env,
    caller: Address,
    shares: i128,
) -> Result<i128, VaultError>
```

**Parameters**

| Name | Type | Description |
|---|---|---|
| `caller` | `Address` | Share holder; must sign the transaction. |
| `shares` | `i128` | Vault shares to burn. Must be `> 0` and `≤ caller's balance`. |

**Returns** `Ok(tokens_redeemed: i128)` — underlying tokens transferred to `caller`.

**Errors**

| Error | Condition |
|---|---|
| `NotInitialized` | Vault not initialized. |
| `VaultPaused` | Vault is paused. |
| `ZeroAmount` | `shares ≤ 0`, or redeemable tokens round to zero. |
| `InsufficientShares` | `shares > caller's balance`. |
| `InsufficientUnderlying` | Vault cannot cover the redemption (rounding edge case). |
| `BalanceMismatch` | Flash-loan guard triggered. |
| `MathOverflow` | Arithmetic overflow. |

**Event emitted**

```
topics: ("withdraw", caller: Address, shares: i128)
data:   (tokens_redeemed: i128, new_total_shares: i128, new_total_deposited: i128)
```

**Soroban CLI example**

```bash
stellar contract invoke \
  --id <CONTRACT_ID> --source <USER_KEYPAIR> --network testnet \
  -- withdraw \
  --caller GUSER... \
  --shares 500000
```

**Example (JavaScript SDK)**

```ts
const result = await contract.call("withdraw", {
  caller: userKeypair.publicKey(),
  shares: BigInt(500_000),
});
// result.value === underlying tokens redeemed (i128 as BigInt)
```

---

### `harvest`

Inject yield (in the underlying token) into the vault without minting new
shares. Increases the redemption rate for all existing shareholders.
Permissionless — any address may act as keeper.

A performance fee (in basis points) is deducted from `yield_amount` before
crediting `total_deposited`; the fee accrues in contract storage for later
withdrawal by the admin.

**Signature**

```rust
pub fn harvest(
    env: Env,
    caller: Address,
    yield_amount: i128,
) -> Result<(), VaultError>
```

**Parameters**

| Name | Type | Description |
|---|---|---|
| `caller` | `Address` | Keeper; must sign the transaction and hold enough underlying tokens. |
| `yield_amount` | `i128` | Yield tokens to transfer into the vault. Must be `> 0`. |

**Returns** `Ok(())`.

**Errors**

| Error | Condition |
|---|---|
| `NotInitialized` | Vault not initialized. |
| `VaultPaused` | Vault is paused. |
| `ZeroAmount` | `yield_amount ≤ 0`. |
| `ZeroShares` | No shares exist; yield cannot be attributed. |
| `BalanceMismatch` | Flash-loan guard triggered. |
| `MathOverflow` | Arithmetic overflow. |

**Event emitted**

```
topics: ("harvest", caller: Address, yield_amount: i128)
data:   (net_yield: i128, fee_amount: i128, new_total_deposited: i128)
```

**Soroban CLI example**

```bash
stellar contract invoke \
  --id <CONTRACT_ID> --source <KEEPER_KEYPAIR> --network testnet \
  -- harvest \
  --caller GKEEPER... \
  --yield_amount 50000
```

**Example (JavaScript SDK)**

```ts
// Only the admin keypair will pass require_auth
const result = await contract.call("harvest", {
  caller: adminKeypair.publicKey(),
  yield_amount: BigInt(50_000),
});
// result.value === void (Ok(()))
```

---

### `harvest_token`

Multi-token variant of `harvest`. The caller transfers a whitelisted alternate
yield token; the vault credits a declared `underlying_amount` to `total_deposited`.
The alternate token must first be whitelisted via `register_yield_token`.

**Signature**

```rust
pub fn harvest_token(
    env: Env,
    caller: Address,
    alt_token: Address,
    yield_amount: i128,
    underlying_amount: i128,
) -> Result<(), VaultError>
```

**Parameters**

| Name | Type | Description |
|---|---|---|
| `caller` | `Address` | Keeper; must sign. |
| `alt_token` | `Address` | Whitelisted alternate yield token contract address. |
| `yield_amount` | `i128` | Amount of `alt_token` to transfer into the vault. |
| `underlying_amount` | `i128` | Equivalent underlying value to credit (must be `> 0`). |

**Example (JavaScript SDK)**

```ts
await contract.call("pause", {});
```

---

**Errors**

| Error | Condition |
|---|---|
| `NotInitialized` | Vault not initialized. |
| `VaultPaused` | Vault is paused. |
| `ZeroAmount` | Either amount is `≤ 0`. |
| `ZeroShares` | No shares exist. |
| `InvalidAddress` | `alt_token` is not whitelisted. |
| `BalanceMismatch` | Flash-loan guard triggered. |
| `MathOverflow` | Arithmetic overflow. |

**Event emitted**

```
topics: ("harvest_token", caller: Address, alt_token: Address)
data:   (yield_amount: i128, net_underlying: i128, fee_amount: i128)
```

**Example (JavaScript SDK)**

```ts
await contract.call("unpause", {});
```

---

## View Functions

These functions are read-only simulation calls — they write no ledger entries
and require no authorization.

### `total_assets`

Returns the total underlying tokens currently tracked in the vault.

```rust
pub fn total_assets(env: Env) -> i128
```

### `balance_of`

**Example (JavaScript SDK)**

```ts
const result = await contract.call("is_paused", {});
const paused: boolean = result.value;
```

---

```rust
pub fn balance_of(env: Env, address: Address) -> i128
```

**Soroban CLI example**

```bash
stellar contract invoke \
  --id <CONTRACT_ID> --network testnet \
  -- balance_of --address GUSER...
```

### `is_paused`

Returns `true` if the vault is currently paused.

```rust
pub fn is_paused(env: Env) -> bool
```

### `total_fees_collected`

Returns total performance fees accrued but not yet withdrawn to the treasury.

```rust
pub fn total_fees_collected(env: Env) -> i128
```

**Example (JavaScript SDK)**

```ts
const result = await contract.call("total_assets", {});
const total: bigint = result.value; // i128 as BigInt
```

---

## Admin: Emergency Controls

### `pause`

Halt `deposit`, `withdraw`, and `harvest`. Only the stored admin may call this.

```rust
pub fn pause(env: Env, admin: Address) -> Result<(), VaultError>
```

**Parameters**: `admin` — must match the stored admin address and sign the transaction.

**Event emitted**: `topics: ("paused",), data: ()`

### `unpause`

Resume operations after a pause.

```rust
pub fn unpause(env: Env, admin: Address) -> Result<(), VaultError>
```

**Example (JavaScript SDK)**

```ts
const result = await contract.call("balance_of", {
  address: userKeypair.publicKey(),
});
const shares: bigint = result.value; // i128 as BigInt, 0n for unknown addresses
```

---

## Admin: Fee Management

### `set_fees`

Set performance and management fee rates. Admin only.

```rust
pub fn set_fees(
    env: Env,
    admin: Address,
    perf_fee_bps: u32,
    mgmt_fee_bps: u32,
) -> Result<(), VaultError>
```

**Parameters**

| Name | Type | Description |
|---|---|---|
| `admin` | `Address` | Must match stored admin; must sign. |
| `perf_fee_bps` | `u32` | Performance fee in basis points (100 bps = 1%). |
| `mgmt_fee_bps` | `u32` | Management fee in basis points. |

**Errors**: `NotInitialized`, `UpgradeUnauthorized`.

### `set_treasury`

Set the treasury address that receives withdrawn fees. Admin only.

```rust
pub fn set_treasury(
    env: Env,
    admin: Address,
    treasury: Address,
) -> Result<(), VaultError>
```

### `withdraw_fees`

Transfer all accrued fees to the treasury. Returns `0` if no fees have
accumulated. Admin only.

```rust
pub fn withdraw_fees(env: Env, admin: Address) -> Result<i128, VaultError>
```

**Returns** `Ok(fees_transferred: i128)`.

**Errors**: `NotInitialized`, `UpgradeUnauthorized` (no treasury set is treated
as `NotInitialized`).

**Event emitted**

```
topics: ("fees_withdrawn", admin: Address)
data:   (amount: i128, treasury: Address)
```

**Example (JavaScript SDK)**

```ts
await contract.call("transfer_admin", {
  new_admin: newAdminKeypair.publicKey(),
});
```

---

## Admin: Yield Token Registry

### `register_yield_token`

Whitelist an alternate yield token so it can be used with `harvest_token`.
Admin only.

```rust
pub fn register_yield_token(env: Env, alt_token: Address) -> Result<(), VaultError>
```

**Event emitted**: `topics: ("yield_token_registered",), data: (alt_token: Address)`

---

## Admin: Upgrade

### `upgrade`

Atomically replace the contract's executing Wasm bytecode (UUPS-style upgrade).
The layout version is verified before the swap to prevent accidental storage
corruption. Admin only.

```rust
pub fn upgrade(
    env: Env,
    new_wasm_hash: BytesN<32>,
) -> Result<(), VaultError>
```

**Parameters**

| Name | Type | Description |
|---|---|---|
| `new_wasm_hash` | `BytesN<32>` | Hash returned by `stellar contract upload`. |

**Errors**

| Error | Condition |
|---|---|
| `NotInitialized` | Vault not initialized. |
| `UpgradeUnauthorized` | Caller is not the admin. |
| `StorageLayoutMismatch` | On-chain layout version ≠ `CURRENT_LAYOUT_VERSION` in new binary. |

**Event emitted** (before Wasm swap, so it is always recorded)

```
topics: ("upgrade", admin: Address)
data:   (old_version: u32, new_version: u32)
```

**Soroban CLI example**

```bash
# 1. Upload new Wasm
HASH=$(stellar contract upload \
  --wasm target/wasm32-unknown-unknown/release/aura_vault.wasm \
  --source <ADMIN_KEYPAIR> --network testnet)

# 2. Trigger upgrade
stellar contract invoke \
  --id <CONTRACT_ID> --source <ADMIN_KEYPAIR> --network testnet \
  -- upgrade --new_wasm_hash "$HASH"
```

**Example (JavaScript SDK)**

```ts
import { xdr, hash } from "@stellar/stellar-sdk";

// new_wasm_hash is the 32-byte hash returned by `stellar contract upload`
const newWasmHash = Buffer.from("<64-hex-chars>", "hex");
await contract.call("upgrade", {
  new_wasm_hash: newWasmHash,
});
```

---

## Governance

The governance layer implements a multisig with a 24-hour execution timelock.
Proposals require **3 approvals** (`REQUIRED_SIGNATURES = 3`) from the
registered signer set before they can be executed.

### `propose_update_admin`

Create a proposal to change the vault admin.

```rust
pub fn propose_update_admin(
    env: Env,
    proposer: Address,
    new_admin: Address,
) -> Result<u64, VaultError>
```

**Parameters**: `proposer` must be in the signer set and must sign. Returns a
`proposal_id` (`u64`).

**Errors**: `InvalidAddress` if `proposer` is not a registered signer.

### `propose_update_token`

Create a proposal to change the underlying token.

```rust
pub fn propose_update_token(
    env: Env,
    proposer: Address,
    new_token: Address,
) -> Result<u64, VaultError>
```

### `propose_parameter_update`

Create a proposal to update a named numeric parameter.

```rust
pub fn propose_parameter_update(
    env: Env,
    proposer: Address,
    name: Symbol,
    value: i128,
) -> Result<u64, VaultError>
```

### `vote`

Cast a vote on an open proposal. Each signer may vote exactly once.

```rust
pub fn vote(
    env: Env,
    voter: Address,
    proposal_id: u64,
    approve: bool,
) -> Result<(), VaultError>
```

**Parameters**

| Name | Type | Description |
|---|---|---|
| `voter` | `Address` | Must be a registered signer; must sign the transaction. |
| `proposal_id` | `u64` | ID returned by the relevant `propose_*` call. |
| `approve` | `bool` | `true` to approve, `false` to reject. |

**Example (JavaScript SDK)**

```ts
// 200 bps = 2% performance fee, 50 bps = 0.5% management fee
await contract.call("set_fees", {
  perf_fee_bps: 200,
  mgmt_fee_bps: 50,
});
```

---

### `set_treasury`

### `execute`

Execute an approved proposal after the 24-hour timelock has expired.

```rust
pub fn execute(
    env: Env,
    executor: Address,
    proposal_id: u64,
) -> Result<(), VaultError>
```

**Example (JavaScript SDK)**

```ts
await contract.call("set_treasury", {
  treasury: treasuryKeypair.publicKey(),
});
```

---

### `get_fees`

### `proposal_status`

Read the current status of a proposal. Returns `None` for unknown IDs.

```rust
pub fn proposal_status(env: Env, proposal_id: u64) -> Option<String>
```

**Example (JavaScript SDK)**

```ts
const result = await contract.call("get_fees", {});
const [perfFeeBps, mgmtFeeBps]: [number, number] = result.value;
// e.g. [200, 50]
```

---

### `total_fees_collected`

**Soroban CLI example**

```bash
stellar contract invoke \
  --id <CONTRACT_ID> --network testnet \
  -- proposal_status --proposal_id 1
```

**Example (JavaScript SDK)**

```ts
const result = await contract.call("total_fees_collected", {});
const fees: bigint = result.value; // i128 as BigInt
```

---

## Events

All events are emitted via `env.events().publish(topics, data)`.
Topics are indexed and can be queried via Horizon or a Soroban event stream.

| Topic symbol | Emitting function | Data |
|---|---|---|
| `deposit` | `deposit` | `(shares: i128, total_shares: i128, total_deposited: i128)` |
| `withdraw` | `withdraw` | `(redeemed: i128, total_shares: i128, total_deposited: i128)` |
| `harvest` | `harvest` | `(net_yield: i128, fee: i128, total_deposited: i128)` |
| `harvest_token` | `harvest_token` | `(yield_amount: i128, net_underlying: i128, fee: i128)` |
| `paused` | `pause` | _(none)_ |
| `unpaused` | `unpause` | _(none)_ |
| `upgrade` | `upgrade` | `(old_version: u32, new_version: u32)` |
| `fees_withdrawn` | `withdraw_fees` | `(amount: i128, treasury: Address)` |
| `yield_token_registered` | `register_yield_token` | `(alt_token: Address)` |
| `suspicious` | `deposit` / `withdraw` / `harvest` | `("balance_mismatch", observed: i128, tracked: i128)` |

**Filtering events (JavaScript)**

```ts
const events = await server.getEvents({
  startLedger: fromLedger,
  filters: [{ type: "contract", contractIds: [CONTRACT_ID], topics: [["deposit"]] }],
});
```

**Example (JavaScript SDK)**

```ts
const result = await contract.call("withdraw_fees", {});
const transferred: bigint = result.value; // tokens sent to treasury
```

---

## Error Codes

Soroban surfaces these as `Error(Contract, #N)` in simulation results and
transaction meta.

| Code | Variant | Trigger |
|---|---|---|
| 1 | `NotInitialized` | Vault not yet initialized. |
| 2 | `AlreadyInitialized` | `initialize` called more than once. |
| 3 | `InsufficientShares` | Withdraw exceeds caller's share balance. |
| 4 | `InsufficientUnderlying` | Vault cannot cover the redemption. |
| 5 | `ZeroAmount` | Zero/negative input, or share mint rounds to zero. |
| 6 | `MathOverflow` | Arithmetic overflow in share formula. |
| 7 | `InvalidAddress` | Not a signer / already voted / token not whitelisted / timelock active. |
| 8 | `ZeroShares` | `harvest` called when `total_shares == 0`. |
| 9 | `UpgradeUnauthorized` | Caller is not the admin. |
| 10 | `StorageLayoutMismatch` | Layout version mismatch on upgrade. |
| 11 | `VaultPaused` | Mutating operation called while vault is paused. |
| 12 | `BalanceMismatch` | Actual token balance ≠ tracked state (flash-loan guard). |

The UI helper in `ui/src/lib/errors.ts` maps every code to a user-facing message.

---

## Security Model

| Property | Implementation |
|---|---|
| Checks-Effects-Interactions (CEI) | State is written before every token transfer. |
| Flash-loan guard | `actual_balance == total_deposited` checked at the start of every mutating function; mismatch emits `suspicious` and returns `BalanceMismatch`. |
| Inflation attack prevention | Zero-share mint rejected with `ZeroAmount`. |
| Overflow safety | All arithmetic uses `checked_mul` / `checked_div` / `checked_add` / `checked_sub`; `overflow-checks = true` in the release profile. |
| No panics in production | No `unwrap()` / `expect()` outside `#[cfg(test)]`; all fallible paths return typed `VaultError`. |
| Archival safety | `bump_instance` called on every mutating function (30-day lifetime, 7-day bump threshold). |
| Emergency stop | Admin can `pause()` to halt all mutating operations at any time. |
| Multisig governance | Sensitive parameter changes require 3-of-N signer approval + 24-hour timelock. |
| Upgrade guard | Layout version verified before Wasm swap; event emitted before swap so it is always recorded. |

---

## Resource Notes

Soroban charges fees in **stroops** (1 XLM = 10,000,000 stroops) based on CPU
instructions, memory, ledger reads/writes, and network bandwidth consumed per
transaction.  The table below gives approximate ranges observed on Testnet; mainnet
fees scale with ledger state and network congestion.

### Approximate Fee Table

| Function | Ledger entries read | Ledger entries written | Typical fee (stroops) | Notes |
|---|---|---|---|---|
| `initialize` | 0 | 3 (admin, token, version) | ~500,000 | One-time cost |
| `deposit` | 3 | 4 (balance, total_shares, total_deposited, TTL) | ~800,000–1,200,000 | Scales slightly with share arithmetic |
| `withdraw` | 4 | 4 | ~900,000–1,300,000 | Similar to deposit |
| `harvest` | 3 | 2 (total_deposited, TTL) | ~700,000–1,000,000 | No balance key write for caller |
| `pause` / `unpause` | 1 | 1 | ~300,000 | Minimal state change |
| `is_paused` | 1 | 0 | ~50,000 | Simulation only — no ledger write |
| `total_assets` | 1 | 0 | ~50,000 | Simulation only |
| `balance_of` | 1 | 0 | ~50,000 | Simulation only |
| `transfer_admin` | 1 | 1 | ~300,000 | — |
| `upgrade` | 2 | 2 + Wasm upload | ~2,000,000–5,000,000 | Plan during low-traffic windows |
| `version` | 1 | 0 | ~50,000 | Simulation only |
| `set_fees` | 1 | 1 | ~300,000 | — |
| `set_treasury` | 1 | 1 | ~300,000 | — |
| `get_fees` | 1 | 0 | ~50,000 | Simulation only |
| `total_fees_collected` | 1 | 0 | ~50,000 | Simulation only |
| `withdraw_fees` | 3 | 2 | ~700,000 | Includes token transfer |

> **How to get exact fees:** Use `stellar contract simulate` before submitting any
> transaction.  The simulator returns the exact resource cost breakdown.

```bash
stellar contract simulate \
  --id <CONTRACT_ID> \
  --source <KEYPAIR> \
  --network testnet \
  -- deposit \
  --caller GUSER... \
  --amount 1000000
# Output includes: cpu_insns, mem_bytes, ledger_reads, ledger_writes, min_resource_fee
```

### TTL / Archival Costs

Every mutating function calls `bump_instance` (30-day lifetime, 7-day threshold)
and `bump_persistent` on the caller's balance key.  If an entry has already been
bumped within the threshold window Soroban skips the write, so the actual ledger
write count may be lower than the table shows under normal usage.

Under high-frequency load (many deposits/withdrawals per ledger) the two bump
operations per call become the dominant cost driver.  If you are building an
automated keeper or batching tool, consider tracking the last-bumped ledger and
skipping voluntary bumps when the entry is already near its maximum TTL.

---

## Soroban Natspec Note

Soroban is a Rust (`no_std`) environment — there is no Solidity or EVM ABI.
This document **is** the canonical API reference for `AuraVault`.

The Rust source uses standard `///` doc-comments on every public function and
type.  To view them locally:

```bash
cd aura-vault
cargo doc --open
```

This generates an HTML reference in `target/doc/aura_vault/`.  The content
mirrors the signatures and parameter tables in this document, but the HTML view
includes cross-links to internal types and trait implementations.

> **For Solidity/EVM developers:** think of Soroban `#[contractimpl]` as the
> equivalent of a Solidity contract's public ABI, and `VaultError` variants as
> the equivalent of `revert` reasons.  There is no ABI JSON file — the interface
> is defined by `aura-vault/src/interface.rs` (`AuraVaultTrait`).
