use soroban_sdk::{Address, Env, Vec, Symbol, BytesN, String};
use crate::errors::VaultError;

/// Public ABI for AuraVault.  Implemented by the contract in lib.rs.
#[allow(dead_code)]
pub trait AuraVaultTrait {
    fn initialize(env: Env, admin: Address, underlying_token: Address, signers: Vec<Address>) -> Result<(), VaultError>;
    fn deposit(env: Env, caller: Address, amount: i128) -> Result<i128, VaultError>;
    fn withdraw(env: Env, caller: Address, shares: i128) -> Result<i128, VaultError>;

    // -- Yield injection (underlying token) --
    fn harvest(env: Env, caller: Address, yield_amount: i128) -> Result<(), VaultError>;

    // -- Yield injection (alternative token, whitelisted) --
    fn harvest_token(env: Env, caller: Address, alt_token: Address, yield_amount: i128, underlying_amount: i128) -> Result<(), VaultError>;
    fn register_yield_token(env: Env, alt_token: Address) -> Result<(), VaultError>;

    // -- Yield distribution (new, explicit per-shareholder mechanism) --

    /// Accept `yield_amount` of the underlying token from `caller` and
    /// distribute it proportionally to all shareholders via the global
    /// cumulative-yield-per-share accumulator.  Emits `yield_distributed`.
    fn distribute_yield(env: Env, caller: Address, yield_amount: i128) -> Result<(), VaultError>;

    /// Distribute an alternative (whitelisted) yield token.  The caller
    /// supplies the alt-token amount and its equivalent underlying value.
    fn distribute_yield_token(
        env: Env,
        caller: Address,
        alt_token: Address,
        yield_amount: i128,
        underlying_amount: i128,
    ) -> Result<(), VaultError>;

    /// Pull-pattern alias for distribute_yield: strategy or keeper calls this
    /// to collect and record yield in one step.
    fn collect_yield(env: Env, caller: Address, amount: i128) -> Result<(), VaultError>;

    /// Read-only preview: returns (net_yield, delta_yps, distributed_tokens, accuracy_ok)
    /// for a hypothetical distribution of `yield_amount`.
    fn preview_distribution(env: Env, yield_amount: i128) -> Result<(i128, i128, i128, bool), VaultError>;

    /// Caller claims all accrued yield, receiving underlying tokens.
    fn collect_pending_yield(env: Env, caller: Address) -> Result<i128, VaultError>;

    /// Read-only: pending claimable yield for `addr`.
    fn pending_yield(env: Env, addr: Address) -> i128;

    /// Read-only: current distribution epoch counter.
    fn distribution_epoch(env: Env) -> u64;

    // -- Pause --
    fn pause(env: Env, admin: Address) -> Result<(), VaultError>;
    fn unpause(env: Env, admin: Address) -> Result<(), VaultError>;
    fn is_paused(env: Env) -> bool;

    // -- Fees --
    fn set_fees(env: Env, admin: Address, perf_fee_bps: u32, mgmt_fee_bps: u32) -> Result<(), VaultError>;
    fn set_treasury(env: Env, admin: Address, treasury: Address) -> Result<(), VaultError>;
    fn withdraw_fees(env: Env, admin: Address) -> Result<i128, VaultError>;
    fn total_fees_collected(env: Env) -> i128;

    // -- Views --
    fn total_assets(env: Env) -> i128;
    fn balance_of(env: Env, address: Address) -> i128;

    // -- Upgrade --
    fn upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), VaultError>;

    // -- Governance --
    fn propose_update_admin(env: Env, proposer: Address, new_admin: Address) -> Result<u64, VaultError>;
    fn propose_update_token(env: Env, proposer: Address, new_token: Address) -> Result<u64, VaultError>;
    fn propose_parameter_update(env: Env, proposer: Address, name: Symbol, value: i128) -> Result<u64, VaultError>;
    fn vote(env: Env, voter: Address, proposal_id: u64, approve: bool) -> Result<(), VaultError>;
    fn execute(env: Env, executor: Address, proposal_id: u64) -> Result<(), VaultError>;
    fn proposal_status(env: Env, proposal_id: u64) -> Option<String>;
}
