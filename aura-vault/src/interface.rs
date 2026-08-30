use soroban_sdk::{Address, BytesN, Env, String, Symbol, Vec};
use crate::errors::VaultError;
use crate::governance::OpType;

/// Public ABI for AuraVault.  Implemented by the contract in lib.rs.
#[allow(dead_code)]
pub trait AuraVaultTrait {
    // -----------------------------------------------------------------------
    // Core vault
    // -----------------------------------------------------------------------
    fn initialize(env: Env, admin: Address, underlying_token: Address, signers: Vec<Address>) -> Result<(), VaultError>;
    fn deposit(env: Env, caller: Address, amount: i128) -> Result<i128, VaultError>;
    fn withdraw(env: Env, caller: Address, shares: i128) -> Result<i128, VaultError>;
    fn harvest(env: Env, caller: Address, yield_amount: i128) -> Result<(), VaultError>;
    fn pause(env: Env, admin: Address) -> Result<(), VaultError>;
    fn unpause(env: Env, admin: Address) -> Result<(), VaultError>;
    fn is_paused(env: Env) -> bool;
    fn set_fees(env: Env, admin: Address, perf_fee_bps: u32, mgmt_fee_bps: u32) -> Result<(), VaultError>;
    fn set_treasury(env: Env, admin: Address, treasury: Address) -> Result<(), VaultError>;
    fn withdraw_fees(env: Env, admin: Address) -> Result<i128, VaultError>;
    fn total_fees_collected(env: Env) -> i128;
    fn total_assets(env: Env) -> i128;
    fn balance_of(env: Env, address: Address) -> i128;
    fn upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), VaultError>;

    // -----------------------------------------------------------------------
    // Multi-sig admin operations (Issue #375)
    // -----------------------------------------------------------------------

    /// Propose a new multi-sig operation. Proposer is auto-signed as the
    /// first signature. Returns the new operation ID.
    fn propose_operation(env: Env, proposer: Address, op_type: OpType) -> Result<u64, VaultError>;

    /// Sign an existing pending operation. Once signature count reaches
    /// the configured threshold, the operation becomes executable.
    fn sign_operation(env: Env, signer: Address, op_id: u64) -> Result<(), VaultError>;

    /// Execute a Ready operation. Applies the state change on-chain.
    fn execute_operation(env: Env, executor: Address, op_id: u64) -> Result<(), VaultError>;

    /// Read the status string of a multi-sig operation.
    fn operation_status(env: Env, op_id: u64) -> Option<String>;

    // -----------------------------------------------------------------------
    // Admin-set management (convenience wrappers — also usable standalone
    // by the admin address without going through multi-sig for bootstrapping)
    // -----------------------------------------------------------------------

    /// Add a signer to the multi-sig set (must be executed via multi-sig in prod).
    fn add_signer(env: Env, admin: Address, new_signer: Address) -> Result<(), VaultError>;

    /// Remove a signer from the multi-sig set (must be executed via multi-sig in prod).
    fn remove_signer(env: Env, admin: Address, target: Address) -> Result<(), VaultError>;

    /// Update the M-of-N threshold (must be executed via multi-sig in prod).
    fn set_threshold(env: Env, admin: Address, threshold: u32) -> Result<(), VaultError>;

    // -----------------------------------------------------------------------
    // Legacy governance (kept for backward compatibility with existing tests)
    // -----------------------------------------------------------------------
    fn propose_update_admin(env: Env, proposer: Address, new_admin: Address) -> Result<u64, VaultError>;
    fn propose_update_token(env: Env, proposer: Address, new_token: Address) -> Result<u64, VaultError>;
    fn propose_parameter_update(env: Env, proposer: Address, name: Symbol, value: i128) -> Result<u64, VaultError>;
    fn vote(env: Env, voter: Address, proposal_id: u64, approve: bool) -> Result<(), VaultError>;
    fn execute(env: Env, executor: Address, proposal_id: u64) -> Result<(), VaultError>;
    fn proposal_status(env: Env, proposal_id: u64) -> Option<String>;
}
