use soroban_sdk::{Address, BytesN, Env};
use crate::errors::VaultError;

/// Public ABI for AuraVault.  Implemented by the contract in lib.rs.
#[allow(dead_code)]
pub trait AuraVaultTrait {
    fn initialize(env: Env, admin: Address, underlying_token: Address) -> Result<(), VaultError>;
    fn deposit(env: Env, caller: Address, amount: i128) -> Result<i128, VaultError>;
    fn withdraw(env: Env, caller: Address, shares: i128) -> Result<i128, VaultError>;
    fn harvest(env: Env, caller: Address, yield_amount: i128) -> Result<(), VaultError>;
    fn pause(env: Env) -> Result<(), VaultError>;
    fn unpause(env: Env) -> Result<(), VaultError>;
    fn is_paused(env: Env) -> bool;
    fn total_assets(env: Env) -> i128;
    fn balance_of(env: Env, address: Address) -> i128;
    /// Transfer admin role to a new address.  Only the current admin may call this.
    fn transfer_admin(env: Env, new_admin: Address) -> Result<(), VaultError>;
    /// UUPS-style upgrade: replace the contract's Wasm with `new_wasm_hash`.
    fn upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), VaultError>;
    /// Returns the current monotonic version number (starts at 1 after initialize).
    fn version(env: Env) -> u32;

    // #358 — TVL cap
    fn set_tvl_cap(env: Env, max_assets: i128) -> Result<(), VaultError>;
    fn tvl_cap(env: Env) -> i128;

    // #359 — On-chain fee accounting
    fn accrued_fees(env: Env) -> i128;
    fn claim_fees(env: Env, fee_recipient: Address) -> Result<i128, VaultError>;

    // #361 — KYC / deposit allowlist
    fn set_kyc_enabled(env: Env, enabled: bool) -> Result<(), VaultError>;
    fn set_kyc_verifier(env: Env, verifier: Address) -> Result<(), VaultError>;
    fn approve_address(env: Env, address: Address, expiry: u64) -> Result<(), VaultError>;
    fn revoke_address(env: Env, address: Address) -> Result<(), VaultError>;

    // #360 — Pause countdown with scheduled unpause
    fn pause_until(env: Env, timestamp: u64) -> Result<(), VaultError>;
    fn pause_expires_at(env: Env) -> Option<u64>;
}
