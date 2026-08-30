# Aura Vault Protocol

A production-ready, share-based yield vault smart contract built on **Soroban** for the Stellar ecosystem.

## Overview

Aura solves fragmented liquidity and manual yield compounding in Soroban DeFi. It aggregates deposits of a single SEP-41-compatible underlying token, issues proportional vault shares to depositors, and auto-compounds yield through permissionless keeper harvests — all in a trust-minimized, `no_std` on-chain environment.

## How It Works

- **Deposit** — Transfer underlying tokens into the vault and receive shares proportional to your contribution. First depositor gets a 1:1 seed ratio; subsequent depositors get `floor(amount × total_shares / total_assets)` shares.
- **Withdraw** — Burn your shares to redeem `floor(shares × total_assets / total_shares)` underlying tokens, including any accrued yield.
- **Harvest** — Any keeper injects yield tokens into the vault without minting new shares, increasing the exchange rate for all existing shareholders.
- **View** — `total_assets` and `balance_of` are gas-free read-only calls.

## Architecture

```
aura-vault/
├── Cargo.toml
└── src/
    ├── lib.rs        # AuraVault contract — initialize, deposit, withdraw, harvest, views
    ├── errors.rs     # VaultError (8 typed variants)
    ├── storage.rs    # DataKey, TTL constants, get/set/bump helpers
    ├── interface.rs  # AuraVaultTrait public ABI
    └── test.rs       # 22 unit + integration tests
```

## Security Properties

- **Checks-Effects-Interactions (CEI)** ordering on every mutating function
- **Inflation attack prevention** — zero-share mint rejection fence
- **Overflow safety** — all arithmetic uses `checked_mul` / `checked_div`; `overflow-checks = true` in release profile
- **No `unwrap()` / `expect()`** outside `#[cfg(test)]`
- **Soroban archival safety** — TTL extended on every mutating call (30-day lifetime, 7-day threshold)
- **Flash loan guard** — `deposit`, `withdraw`, and `harvest` verify that the vault's actual on-chain token balance equals `total_deposited` before executing; any discrepancy emits a `suspicious` event and returns `BalanceMismatch`
- **Emergency pause** — admin can call `pause()` to halt all mutating operations (`deposit`, `withdraw`, `harvest`); `unpause()` resumes; current state readable via `is_paused()`
- **Event logging** — `deposit`, `withdraw`, `harvest`, `pause`, `unpause`, and `upgrade` all emit typed events; balance mismatches emit a `suspicious` event with observed vs. tracked amounts

## Building

Requires Rust with the `wasm32-unknown-unknown` target:

```bash
rustup default stable
rustup target add wasm32-unknown-unknown

cd aura-vault
cargo test                                              # run all 22 tests
cargo build --target wasm32-unknown-unknown --release   # build deployable Wasm
```

The compiled binary will be at:
```
aura-vault/target/wasm32-unknown-unknown/release/aura_vault.wasm
```

## Deployment (Stellar Testnet / Mainnet)

```bash
# Upload Wasm
stellar contract upload \
  --wasm target/wasm32-unknown-unknown/release/aura_vault.wasm \
  --source <your-keypair> \
  --network testnet

# Deploy instance
stellar contract deploy \
  --wasm-hash <hash-from-upload> \
  --source <your-keypair> \
  --network testnet

# Initialize
stellar contract invoke \
  --id <contract-id> \
  --source <admin-keypair> \
  --network testnet \
  -- initialize \
  --admin <admin-address> \
  --underlying_token <token-contract-id>
```

## Contract Interface

| Function | Description |
|---|---|
| `initialize(admin, underlying_token)` | One-time setup; stores admin and token address |
| `deposit(caller, amount)` | Mint shares proportional to deposit |
| `withdraw(caller, shares)` | Burn shares and redeem underlying tokens |
| `harvest(caller, yield_amount)` | Inject yield without minting shares |
| `pause()` | Admin-only: halt all mutating operations |
| `unpause()` | Admin-only: resume operations |
| `is_paused()` | Read current pause state |
| `total_assets()` | Read current total underlying tokens in vault |
| `balance_of(address)` | Read share balance for any address |

## Error Codes

| Code | Variant | Trigger |
|---|---|---|
| 1 | `NotInitialized` | Vault not yet initialized |
| 2 | `AlreadyInitialized` | `initialize` called more than once |
| 3 | `InsufficientShares` | Withdraw amount exceeds caller's balance |
| 4 | `InsufficientUnderlying` | Vault cannot cover redemption |
| 5 | `ZeroAmount` | Zero or negative input; or share mint rounds to zero |
| 6 | `MathOverflow` | Arithmetic overflow in share formula |
| 7 | `InvalidAddress` | Reserved for future address validation |
| 8 | `ZeroShares` | Harvest called when total shares is zero |
| 9 | `UpgradeUnauthorized` | Caller is not the admin |
| 10 | `StorageLayoutMismatch` | On-chain layout version mismatch on upgrade |
| 11 | `VaultPaused` | Mutating operation called while vault is paused |
| 12 | `BalanceMismatch` | Actual token balance differs from tracked state (flash loan guard) |
| 13 | `TimelockNotExpired` | Governance proposal execution attempted before timelock has elapsed |
| 14 | `NotApproved` | Governance proposal has not reached required signature threshold |
| 15 | `AlreadyVoted` | Signer has already cast a vote on this proposal |

## Deployment Strategy

Aura Vault Protocol uses a **blue-green deployment strategy** for zero-downtime releases of the backend infrastructure. This ensures:

- Instant atomic traffic switches between deployment slots
- Automated smoke tests before and after each deployment
- 30-minute rollback window with instant one-command reversion
- Deployment duration under 5 minutes

See [BLUE_GREEN_DEPLOYMENT.md](./BLUE_GREEN_DEPLOYMENT.md) for the complete runbook, architecture details, and rollback procedures.

## Documentation

- **[Deployment Guide](./DEPLOYMENT_GUIDE.md)** — Smart contract deployment to Stellar testnet/mainnet
- **[Blue-Green Strategy](./BLUE_GREEN_DEPLOYMENT.md)** — Backend zero-downtime deployment runbook
- **[Operations Runbook](./OPERATIONS_RUNBOOK.md)** — Day-to-day operational procedures
- **[Backup & Recovery](./docs/backup-recovery.md)** — PostgreSQL backup, encryption, restore procedures
- **[Governance](./GOVERNANCE.md)** — Multi-signature governance and timelock system
- **[Security](./SECURITY.md)** — Security model, audit results, and vulnerability reporting

## Database Backup

Daily automated PostgreSQL backups with AES-256 encryption and S3 storage.

| Feature | Implementation |
|---|---|
| Schedule | Daily 02:00 UTC via K8s CronJob |
| Encryption | AES-256-CBC (PBKDF2, 600k iterations) + S3 SSE-KMS |
| Retention | 30 days (STANDARD → STANDARD_IA → GLACIER_IR → expire) |
| Restore testing | Weekly Sunday 04:00 UTC in CI |
| Alerting | Prometheus alerts: `BackupMissed`, `BackupFailed`, `BackupRestoreTestFailed` |

See [docs/backup-recovery.md](./docs/backup-recovery.md) for setup instructions and runbooks.

## License

MIT
