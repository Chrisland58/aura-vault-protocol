# API Reference — Aura Vault Protocol

Contract interface for `AuraVault`, a share-based yield vault built on Soroban (Stellar).

---

## Invocation

All functions are invoked via the Stellar CLI or any Soroban SDK.

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <KEYPAIR_OR_ALIAS> \
  --network <testnet|mainnet> \
  -- <function_name> [args]
```

---

## Functions

### `initialize`

One-time vault setup. Stores the admin address and the SEP-41 underlying token.
Fails if called more than once.

**Requires auth:** admin

```bash
stellar contract invoke --id <ID> --source admin --network testnet \
  -- initialize \
  --admin GADMIN... \
  --underlying_token GTOKEN...
```

| Parameter | Type | Description |
|---|---|---|
| `admin` | `Address` | Account that controls privileged operations |
| `underlying_token` | `Address` | SEP-41 token contract deposited into the vault |

| Return | Type | Description |
|---|---|---|
| success | `()` | Void on success |
| error | `VaultError` | See error table below |

Errors: `AlreadyInitialized`

---

### `deposit`

Transfer underlying tokens from `caller` into the vault and mint proportional shares.

First depositor receives shares 1:1 with their deposit amount.
Subsequent depositors receive `floor(amount × total_shares / total_assets)` shares.

**Requires auth:** caller

```bash
stellar contract invoke --id <ID> --source caller --network testnet \
  -- deposit \
  --caller GCALLER... \
  --amount 1000000
```

| Parameter | Type | Description |
|---|---|---|
| `caller` | `Address` | Account depositing tokens |
| `amount` | `i128` | Token amount in the token's native units (must be > 0) |

| Return | Type | Description |
|---|---|---|
| success | `i128` | Shares minted to caller |
| error | `VaultError` | See error table below |

Errors: `NotInitialized`, `ZeroAmount`, `MathOverflow`

---

### `withdraw`

Burn `shares` from `caller`'s balance and return the proportional underlying tokens.

Redemption amount: `floor(shares × total_assets / total_shares)`

**Requires auth:** caller

```bash
stellar contract invoke --id <ID> --source caller --network testnet \
  -- withdraw \
  --caller GCALLER... \
  --shares 500000
```

| Parameter | Type | Description |
|---|---|---|
| `caller` | `Address` | Account redeeming shares |
| `shares` | `i128` | Number of shares to burn (must be > 0 and ≤ caller's balance) |

| Return | Type | Description |
|---|---|---|
| success | `i128` | Underlying tokens returned to caller |
| error | `VaultError` | See error table below |

Errors: `NotInitialized`, `ZeroAmount`, `InsufficientShares`, `InsufficientUnderlying`, `MathOverflow`

---

### `harvest`

Inject `yield_amount` tokens into the vault without minting new shares.
This increases the exchange rate for all existing shareholders.
Permissionless — any keeper may call this.

**Requires auth:** caller

```bash
stellar contract invoke --id <ID> --source keeper --network testnet \
  -- harvest \
  --caller GKEEPER... \
  --yield_amount 50000
```

| Parameter | Type | Description |
|---|---|---|
| `caller` | `Address` | Account providing the yield tokens |
| `yield_amount` | `i128` | Yield token amount (must be > 0) |

| Return | Type | Description |
|---|---|---|
| success | `()` | Void on success |
| error | `VaultError` | See error table below |

Errors: `NotInitialized`, `ZeroAmount`, `ZeroShares`, `MathOverflow`

---

### `total_assets`

Read-only. Returns the total underlying tokens currently held by the vault,
including all deposited principal and harvested yield.

```bash
stellar contract invoke --id <ID> --network testnet -- total_assets
```

| Return | Type | Description |
|---|---|---|
| `i128` | Token amount | Total underlying tokens in the vault |

No errors.

---

### `balance_of`

Read-only. Returns the share balance for any address.

```bash
stellar contract invoke --id <ID> --network testnet \
  -- balance_of \
  --address GCALLER...
```

| Parameter | Type | Description |
|---|---|---|
| `address` | `Address` | Account to query |

| Return | Type | Description |
|---|---|---|
| `i128` | Share balance | 0 if address has never deposited or has fully withdrawn |

No errors.

---

## Error Codes

| Code | Variant | Trigger |
|---|---|---|
| 1 | `NotInitialized` | Any mutating call before `initialize` |
| 2 | `AlreadyInitialized` | `initialize` called a second time |
| 3 | `InsufficientShares` | `withdraw` shares exceed caller's balance |
| 4 | `InsufficientUnderlying` | Vault cannot cover the computed redemption amount |
| 5 | `ZeroAmount` | Input is ≤ 0, or share mint rounds down to zero (inflation-attack fence) |
| 6 | `MathOverflow` | `checked_mul` / `checked_div` overflow in share formula |
| 7 | `InvalidAddress` | Reserved for future address validation |
| 8 | `ZeroShares` | `harvest` called when `total_shares == 0` |

---

## Share Formula Reference

### Minting (deposit)

```
new_shares = floor(amount × total_shares / total_assets)   // total_shares > 0
new_shares = amount                                         // first deposit (1:1 seed)
```

### Redemption (withdraw)

```
redeem_amount = floor(shares × total_assets / total_shares)
```

### Exchange Rate (informational)

```
exchange_rate = total_assets × 1_000_000 / total_shares   // scaled by 1e6
```

---

## Storage & TTL

All state uses Soroban's ledger storage with automatic TTL extension on every mutating call.

| Key | Storage type | TTL |
|---|---|---|
| `Admin` | Instance | 30 days (bumped on every write) |
| `UnderlyingToken` | Instance | 30 days |
| `TotalShares` | Instance | 30 days |
| `TotalDeposited` | Instance | 30 days |
| `Balance(Address)` | Persistent | 30 days (bumped on deposit/withdraw) |

Threshold for bump: 7 days remaining before expiry.

---

## Security Properties

- **CEI ordering** — effects written before interactions on withdraw; transfer happens before effects on deposit.
- **Inflation-attack fence** — `ZeroAmount` error if share mint rounds to 0.
- **Overflow safety** — all arithmetic uses `checked_mul` / `checked_div`; `overflow-checks = true` in release profile.
- **No `unwrap()`** outside `#[cfg(test)]`.
