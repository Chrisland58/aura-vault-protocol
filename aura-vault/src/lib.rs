#![no_std]

mod errors;
mod interface;
mod storage;
mod fee;

pub use errors::VaultError;

#[cfg(test)]
mod test;

#[cfg(test)]
mod fuzz;

use soroban_sdk::{contract, contractimpl, token, Address, BytesN, Env, Symbol};

use storage::{
    bump_instance, bump_persistent, get_admin, get_balance, get_layout_version, get_token,
    get_total_deposited, get_total_shares, get_version, is_paused as storage_is_paused, set_admin,
    set_balance, set_layout_version, set_paused, set_token, set_total_deposited, set_total_shares,
    set_version, CURRENT_LAYOUT_VERSION,
};

#[contract]
pub struct AuraVault;

#[contractimpl]
impl AuraVault {
    // -----------------------------------------------------------------------
    // initialize
    // -----------------------------------------------------------------------
    pub fn initialize(
        env: Env,
        admin: Address,
        underlying_token: Address,
    ) -> Result<(), VaultError> {
        if get_admin(&env).is_some() {
            return Err(VaultError::AlreadyInitialized);
        }
        set_admin(&env, &admin);
        set_token(&env, &underlying_token);
        set_total_shares(&env, 0);
        set_total_deposited(&env, 0);
        set_version(&env, 1);
        set_layout_version(&env, CURRENT_LAYOUT_VERSION);
        // TVL cap defaults to 0 (unlimited) — no explicit write needed
        // KYC defaults to disabled — no explicit write needed
        bump_instance(&env);
        Ok(())
    }

    // -----------------------------------------------------------------------
    // deposit
    // -----------------------------------------------------------------------
    pub fn deposit(env: Env, caller: Address, amount: i128) -> Result<i128, VaultError> {
        caller.require_auth();

        if amount <= 0 {
            return Err(VaultError::ZeroAmount);
        }
        if get_admin(&env).is_none() {
            return Err(VaultError::NotInitialized);
        }

        // #360 — auto-unpause if a scheduled unpause time has passed
        Self::maybe_auto_unpause(&env);

        if storage_is_paused(&env) {
            return Err(VaultError::VaultPaused);
        }

        // #361 — KYC check
        if storage::is_kyc_enabled(&env) {
            let now = env.ledger().timestamp();
            match storage::get_kyc_approval(&env, &caller) {
                None => return Err(VaultError::KycNotApproved),
                Some(expiry) if expiry < now => return Err(VaultError::KycExpired),
                Some(_) => {} // approved and not expired
            }
            storage::bump_kyc_approval(&env, &caller);
        }

        let token_addr = get_token(&env).ok_or(VaultError::NotInitialized)?;
        let token = token::Client::new(&env, &token_addr);

        // Flash-loan guard: actual token balance must equal tracked state before deposit.
        // Note: total_deposited does NOT include accrued fees (they live in AccruedFees).
        let balance_before = token.balance(&env.current_contract_address());
        let total_deposited = get_total_deposited(&env);
        let accrued_fees = storage::get_accrued_fees(&env);
        // The on-chain balance should equal total_deposited + accrued_fees
        if balance_before != total_deposited + accrued_fees {
            env.events().publish(
                (Symbol::new(&env, "suspicious"),),
                (Symbol::new(&env, "balance_mismatch"), balance_before, total_deposited + accrued_fees),
            );
            return Err(VaultError::BalanceMismatch);
        }

        // #358 — TVL cap check
        let cap = storage::get_tvl_cap(&env);
        if cap > 0 {
            let new_total = total_deposited
                .checked_add(amount)
                .ok_or(VaultError::MathOverflow)?;
            if new_total > cap {
                return Err(VaultError::TvlCapExceeded);
            }
        }

        let total_shares = get_total_shares(&env);

        // Compute shares to mint (checked arithmetic, overflow returns MathOverflow)
        let new_shares: i128 = if total_shares == 0 || total_deposited == 0 {
            amount
        } else {
            let numerator = amount
                .checked_mul(total_shares)
                .ok_or(VaultError::MathOverflow)?;
            numerator
                .checked_div(total_deposited)
                .ok_or(VaultError::MathOverflow)?
        };

        if new_shares <= 0 {
            return Err(VaultError::ZeroAmount);
        }

        // CEI — Interaction: pull tokens from caller into vault
        token.transfer(&caller, &env.current_contract_address(), &amount);

        // Effects: write state after successful transfer
        let old_balance = get_balance(&env, &caller);
        let new_balance = old_balance + new_shares;
        set_balance(&env, &caller, new_balance);
        let new_total_shares = total_shares
            .checked_add(new_shares)
            .ok_or(VaultError::MathOverflow)?;
        set_total_shares(&env, new_total_shares);
        let new_total_deposited = total_deposited
            .checked_add(amount)
            .ok_or(VaultError::MathOverflow)?;
        set_total_deposited(&env, new_total_deposited);

        env.events().publish(
            (Symbol::new(&env, "deposit"),),
            (caller.clone(), amount, new_shares),
        );

        bump_persistent(&env, &caller);
        bump_instance(&env);

        Ok(new_shares)
    }

    // -----------------------------------------------------------------------
    // withdraw
    // -----------------------------------------------------------------------
    pub fn withdraw(env: Env, caller: Address, shares: i128) -> Result<i128, VaultError> {
        caller.require_auth();

        if shares <= 0 {
            return Err(VaultError::ZeroAmount);
        }
        if get_admin(&env).is_none() {
            return Err(VaultError::NotInitialized);
        }

        // #360 — auto-unpause if scheduled
        Self::maybe_auto_unpause(&env);

        if storage_is_paused(&env) {
            return Err(VaultError::VaultPaused);
        }

        let token_addr = get_token(&env).ok_or(VaultError::NotInitialized)?;
        let token = token::Client::new(&env, &token_addr);

        // Flash-loan guard: actual token balance must equal tracked state.
        let balance_before = token.balance(&env.current_contract_address());
        let total_deposited = get_total_deposited(&env);
        let accrued_fees = storage::get_accrued_fees(&env);
        if balance_before != total_deposited + accrued_fees {
            env.events().publish(
                (Symbol::new(&env, "suspicious"),),
                (Symbol::new(&env, "balance_mismatch"), balance_before, total_deposited + accrued_fees),
            );
            return Err(VaultError::BalanceMismatch);
        }

        let user_balance = get_balance(&env, &caller);
        if shares > user_balance {
            return Err(VaultError::InsufficientShares);
        }

        let total_shares = get_total_shares(&env);

        let numerator = shares
            .checked_mul(total_deposited)
            .ok_or(VaultError::MathOverflow)?;
        let redeem_amount = numerator
            .checked_div(total_shares)
            .ok_or(VaultError::MathOverflow)?;

        if redeem_amount <= 0 {
            return Err(VaultError::ZeroAmount);
        }
        if total_deposited < redeem_amount {
            return Err(VaultError::InsufficientUnderlying);
        }

        // CEI — Effects first: burn shares before token transfer
        let new_balance = user_balance - shares;
        set_balance(&env, &caller, new_balance);
        let new_total_shares = total_shares
            .checked_sub(shares)
            .ok_or(VaultError::MathOverflow)?;
        set_total_shares(&env, new_total_shares);
        let new_total_deposited = total_deposited
            .checked_sub(redeem_amount)
            .ok_or(VaultError::MathOverflow)?;
        set_total_deposited(&env, new_total_deposited);

        // Interaction: send tokens to caller after state is settled
        token.transfer(&env.current_contract_address(), &caller, &redeem_amount);

        env.events().publish(
            (Symbol::new(&env, "withdraw"),),
            (caller.clone(), shares, redeem_amount),
        );

        bump_persistent(&env, &caller);
        bump_instance(&env);

        Ok(redeem_amount)
    }

    // -----------------------------------------------------------------------
    // harvest
    // -----------------------------------------------------------------------
    pub fn harvest(env: Env, caller: Address, yield_amount: i128) -> Result<(), VaultError> {
        caller.require_auth();

        if yield_amount <= 0 {
            return Err(VaultError::ZeroAmount);
        }
        if get_admin(&env).is_none() {
            return Err(VaultError::NotInitialized);
        }

        // #360 — auto-unpause if scheduled
        Self::maybe_auto_unpause(&env);

        if storage_is_paused(&env) {
            return Err(VaultError::VaultPaused);
        }

        // Only the admin may call harvest.
        let admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
        if caller != admin {
            return Err(VaultError::HarvestUnauthorized);
        }

        let total_shares = get_total_shares(&env);
        if total_shares == 0 {
            return Err(VaultError::ZeroShares);
        }

        let total_deposited = get_total_deposited(&env);

        let token_addr = get_token(&env).ok_or(VaultError::NotInitialized)?;
        let token = token::Client::new(&env, &token_addr);

        // Flash-loan guard: actual token balance must equal tracked state before harvest.
        let balance_before = token.balance(&env.current_contract_address());
        let accrued_fees = storage::get_accrued_fees(&env);
        if balance_before != total_deposited + accrued_fees {
            env.events().publish(
                (Symbol::new(&env, "suspicious"),),
                (Symbol::new(&env, "balance_mismatch"), balance_before, total_deposited + accrued_fees),
            );
            return Err(VaultError::BalanceMismatch);
        }

        // #359 — compute performance fee and accrue it separately
        let perf_fee_bps = storage::get_perf_fee_bps(&env);
        let fee_amount = fee::calc_perf_fee(yield_amount, perf_fee_bps)?;
        let yield_after_fee = yield_amount
            .checked_sub(fee_amount)
            .ok_or(VaultError::MathOverflow)?;

        // Interaction: pull yield tokens into vault
        token.transfer(&caller, &env.current_contract_address(), &yield_amount);

        // Effect: increase total deposited with yield after fees
        let new_total = total_deposited
            .checked_add(yield_after_fee)
            .ok_or(VaultError::MathOverflow)?;
        set_total_deposited(&env, new_total);

        // #359 — Accrue the protocol fee separately (excluded from total_assets)
        if fee_amount > 0 {
            let new_accrued = accrued_fees
                .checked_add(fee_amount)
                .ok_or(VaultError::MathOverflow)?;
            storage::set_accrued_fees(&env, new_accrued);
        }

        env.events().publish(
            (Symbol::new(&env, "harvest"),),
            (caller, yield_amount, yield_after_fee, fee_amount),
        );

        bump_instance(&env);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // pause / unpause — admin-only emergency controls
    // -----------------------------------------------------------------------
    pub fn pause(env: Env) -> Result<(), VaultError> {
        let admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
        admin.require_auth();
        set_paused(&env, true);
        // Clear any scheduled unpause when manually pausing
        storage::clear_pause_expires_at(&env);
        env.events().publish((Symbol::new(&env, "paused"),), ());
        bump_instance(&env);
        Ok(())
    }

    pub fn unpause(env: Env) -> Result<(), VaultError> {
        let admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
        admin.require_auth();
        set_paused(&env, false);
        storage::clear_pause_expires_at(&env);
        env.events().publish((Symbol::new(&env, "unpaused"),), ());
        bump_instance(&env);
        Ok(())
    }

    pub fn is_paused(env: Env) -> bool {
        storage_is_paused(&env)
    }

    // -----------------------------------------------------------------------
    // #360 — pause_until: schedule an automatic unpause
    // -----------------------------------------------------------------------
    /// Pauses the vault and schedules an automatic unpause at `timestamp`
    /// (Unix seconds). Any mutating call after that timestamp will
    /// automatically unpause the vault before executing.
    pub fn pause_until(env: Env, timestamp: u64) -> Result<(), VaultError> {
        let admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
        admin.require_auth();

        let now = env.ledger().timestamp();
        if timestamp <= now {
            return Err(VaultError::ZeroAmount); // timestamp must be in the future
        }

        set_paused(&env, true);
        storage::set_pause_expires_at(&env, timestamp);

        env.events().publish(
            (Symbol::new(&env, "scheduled_unpause"),),
            (timestamp,),
        );

        bump_instance(&env);
        Ok(())
    }

    /// Returns `Some(timestamp)` if a scheduled unpause is pending, `None` otherwise.
    pub fn pause_expires_at(env: Env) -> Option<u64> {
        storage::get_pause_expires_at(&env)
    }

    // -----------------------------------------------------------------------
    // total_assets  (read-only — no bumps, no writes)
    // -----------------------------------------------------------------------
    /// Returns total underlying tokens managed by the vault (accrued but
    /// unclaimed protocol fees are excluded per #359).
    pub fn total_assets(env: Env) -> i128 {
        get_total_deposited(&env)
    }

    // -----------------------------------------------------------------------
    // balance_of  (read-only — no bumps, no writes)
    // -----------------------------------------------------------------------
    pub fn balance_of(env: Env, address: Address) -> i128 {
        get_balance(&env, &address)
    }

    // -----------------------------------------------------------------------
    // transfer_admin — admin is no longer immutable
    // -----------------------------------------------------------------------
    pub fn transfer_admin(env: Env, new_admin: Address) -> Result<(), VaultError> {
        let admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
        admin.require_auth();

        set_admin(&env, &new_admin);
        bump_instance(&env);

        env.events().publish(
            (Symbol::new(&env, "admin_transferred"),),
            (admin, new_admin),
        );

        Ok(())
    }

    // -----------------------------------------------------------------------
    // upgrade — UUPS-style: admin-only Wasm replacement
    // -----------------------------------------------------------------------
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), VaultError> {
        let admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
        admin.require_auth();

        if get_layout_version(&env) != CURRENT_LAYOUT_VERSION {
            return Err(VaultError::StorageLayoutMismatch);
        }

        let next_version = get_version(&env)
            .checked_add(1)
            .ok_or(VaultError::MathOverflow)?;
        set_version(&env, next_version);
        bump_instance(&env);

        env.events().publish(
            (Symbol::new(&env, "upgrade"),),
            (admin, next_version, new_wasm_hash.clone()),
        );

        env.deployer().update_current_contract_wasm(new_wasm_hash);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // version  (read-only)
    // -----------------------------------------------------------------------
    pub fn version(env: Env) -> u32 {
        get_version(&env)
    }

    // -----------------------------------------------------------------------
    // Fee Management Functions
    // -----------------------------------------------------------------------

    /// Set performance and management fees (admin only)
    pub fn set_fees(env: Env, perf_fee_bps: u32, mgmt_fee_bps: u32) -> Result<(), VaultError> {
        let admin = storage::get_admin(&env).ok_or(VaultError::NotInitialized)?;
        admin.require_auth();

        fee::validate_fees(perf_fee_bps, mgmt_fee_bps)?;

        storage::set_perf_fee_bps(&env, perf_fee_bps);
        storage::set_mgmt_fee_bps(&env, mgmt_fee_bps);
        storage::bump_instance(&env);

        Ok(())
    }

    /// Set treasury address (admin only)
    pub fn set_treasury(env: Env, treasury: Address) -> Result<(), VaultError> {
        let admin = storage::get_admin(&env).ok_or(VaultError::NotInitialized)?;
        admin.require_auth();

        storage::set_treasury(&env, &treasury);
        storage::bump_instance(&env);

        Ok(())
    }

    /// Get current fee settings
    pub fn get_fees(env: Env) -> (u32, u32) {
        (storage::get_perf_fee_bps(&env), storage::get_mgmt_fee_bps(&env))
    }

    /// Get total fees collected (legacy — see also accrued_fees)
    pub fn total_fees_collected(env: Env) -> i128 {
        storage::get_total_fee_collected(&env)
    }

    /// Withdraw legacy fees to treasury (admin only)
    pub fn withdraw_fees(env: Env) -> Result<i128, VaultError> {
        let admin = storage::get_admin(&env).ok_or(VaultError::NotInitialized)?;
        admin.require_auth();

        let treasury = storage::get_treasury(&env).ok_or(VaultError::InvalidAddress)?;
        let fees = storage::get_total_fee_collected(&env);

        if fees > 0 {
            let token_addr = storage::get_token(&env).ok_or(VaultError::NotInitialized)?;
            token::Client::new(&env, &token_addr).transfer(
                &env.current_contract_address(),
                &treasury,
                &fees,
            );

            storage::set_total_fee_collected(&env, 0);
            storage::bump_instance(&env);
        }

        Ok(fees)
    }

    // -----------------------------------------------------------------------
    // #359 — On-chain fee accounting
    // -----------------------------------------------------------------------

    /// Returns the accumulated but unclaimed protocol fees.
    /// These are excluded from `total_assets`.
    pub fn accrued_fees(env: Env) -> i128 {
        storage::get_accrued_fees(&env)
    }

    /// Transfers all accrued protocol fees to `fee_recipient`. Admin only.
    /// Emits a `fees_claimed` event.
    pub fn claim_fees(env: Env, fee_recipient: Address) -> Result<i128, VaultError> {
        let admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
        admin.require_auth();

        let fees = storage::get_accrued_fees(&env);
        if fees == 0 {
            return Err(VaultError::NoFeesToClaim);
        }

        let token_addr = get_token(&env).ok_or(VaultError::NotInitialized)?;
        let token = token::Client::new(&env, &token_addr);

        // CEI — Effect: zero out accrued fees before transfer
        storage::set_accrued_fees(&env, 0);

        // Interaction: transfer fees to recipient
        token.transfer(&env.current_contract_address(), &fee_recipient, &fees);

        env.events().publish(
            (Symbol::new(&env, "fees_claimed"),),
            (fee_recipient, fees),
        );

        bump_instance(&env);
        Ok(fees)
    }

    // -----------------------------------------------------------------------
    // #358 — TVL cap
    // -----------------------------------------------------------------------

    /// Sets the maximum total underlying tokens the vault will accept.
    /// A cap of `0` means unlimited. Admin only.
    pub fn set_tvl_cap(env: Env, max_assets: i128) -> Result<(), VaultError> {
        let admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
        admin.require_auth();

        if max_assets < 0 {
            return Err(VaultError::ZeroAmount);
        }

        storage::set_tvl_cap(&env, max_assets);

        env.events().publish(
            (Symbol::new(&env, "tvl_cap_updated"),),
            (max_assets,),
        );

        bump_instance(&env);
        Ok(())
    }

    /// Returns the current TVL cap. `0` means unlimited.
    pub fn tvl_cap(env: Env) -> i128 {
        storage::get_tvl_cap(&env)
    }

    // -----------------------------------------------------------------------
    // #361 — KYC / deposit allowlist
    // -----------------------------------------------------------------------

    /// Enable or disable KYC mode. Admin only.
    /// When enabled, only addresses with a valid, unexpired approval may deposit.
    pub fn set_kyc_enabled(env: Env, enabled: bool) -> Result<(), VaultError> {
        let admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
        admin.require_auth();
        storage::set_kyc_enabled(&env, enabled);
        bump_instance(&env);
        Ok(())
    }

    /// Set the KYC verifier address. Admin only.
    /// The verifier is the only address allowed to call `approve_address` and
    /// `revoke_address`.
    pub fn set_kyc_verifier(env: Env, verifier: Address) -> Result<(), VaultError> {
        let admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
        admin.require_auth();
        storage::set_kyc_verifier(&env, &verifier);
        bump_instance(&env);
        Ok(())
    }

    /// Grant deposit approval to `address` until `expiry` (Unix seconds).
    /// Callable by the KYC verifier only.
    pub fn approve_address(env: Env, address: Address, expiry: u64) -> Result<(), VaultError> {
        let verifier = storage::get_kyc_verifier(&env).ok_or(VaultError::KycUnauthorized)?;
        verifier.require_auth();

        storage::set_kyc_approval(&env, &address, expiry);
        storage::bump_kyc_approval(&env, &address);

        env.events().publish(
            (Symbol::new(&env, "kyc_approved"),),
            (address, expiry),
        );

        bump_instance(&env);
        Ok(())
    }

    /// Revoke deposit approval for `address` immediately.
    /// Callable by the KYC verifier only.
    pub fn revoke_address(env: Env, address: Address) -> Result<(), VaultError> {
        let verifier = storage::get_kyc_verifier(&env).ok_or(VaultError::KycUnauthorized)?;
        verifier.require_auth();

        storage::remove_kyc_approval(&env, &address);

        env.events().publish(
            (Symbol::new(&env, "kyc_revoked"),),
            (address,),
        );

        bump_instance(&env);
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    /// Auto-unpause the vault if a scheduled unpause time has passed.
    /// Called at the start of every mutating function.
    fn maybe_auto_unpause(env: &Env) {
        if let Some(expires_at) = storage::get_pause_expires_at(env) {
            if env.ledger().timestamp() >= expires_at {
                set_paused(env, false);
                storage::clear_pause_expires_at(env);
                env.events().publish(
                    (Symbol::new(env, "auto_unpaused"),),
                    (expires_at,),
                );
            }
        }
    }
}
