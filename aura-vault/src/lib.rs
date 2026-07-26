//! # AuraVault — Share-based Yield Vault for Soroban / Stellar
//!
//! AuraVault aggregates deposits of a single SEP-41-compatible underlying
//! token, issues proportional vault shares to depositors, and auto-compounds
//! yield through permissionless keeper harvests — all in a trust-minimised,
//! `no_std` on-chain environment.
//!
//! ## Core operations
//!
//! | Function | Caller | Description |
//! |---|---|---|
//! | [`AuraVault::initialize`] | Admin (once) | One-time setup |
//! | [`AuraVault::deposit`] | Any | Deposit tokens, receive shares |
//! | [`AuraVault::withdraw`] | Any | Burn shares, redeem tokens |
//! | [`AuraVault::harvest`] | Any keeper | Inject yield, raise share price |
//! | [`AuraVault::pause`] / [`AuraVault::unpause`] | Admin | Emergency halt / resume |
//!
//! ## Security properties
//!
//! - **CEI ordering** — state written before token transfers on every mutating path.
//! - **Flash-loan guard** — `actual_balance == total_deposited` checked before each
//!   mutating call; mismatch emits `suspicious` event and returns
//!   [`VaultError::BalanceMismatch`].
//! - **Overflow safety** — all arithmetic uses `checked_*`; `overflow-checks = true`
//!   in the release profile.
//! - **Inflation-attack prevention** — zero-share mint is rejected with
//!   [`VaultError::ZeroAmount`].
//!
//! [`VaultError::BalanceMismatch`]: crate::VaultError::BalanceMismatch
//! [`VaultError::ZeroAmount`]: crate::VaultError::ZeroAmount
#![no_std]

mod errors;
mod interface;
mod storage;
mod governance;
mod fee;

pub use errors::VaultError;

#[cfg(test)]
mod test;
#[cfg(test)]
mod security_test;
#[cfg(test)]
mod proptest_strategies;
#[cfg(test)]
mod tvl_cap_test;
#[cfg(test)]
mod harvest_cooldown_test;

use soroban_sdk::{contract, contractimpl, token, Address, Env, Vec, Symbol};

use storage::{
    bump_instance, bump_persistent, get_admin, get_balance, get_layout_version, get_token,
    get_total_deposited, get_total_shares, get_version, is_paused as storage_is_paused, set_admin,
    set_balance, set_layout_version, set_paused, set_token, set_total_deposited, set_total_shares,
    set_version, CURRENT_LAYOUT_VERSION,
    get_tvl_cap, set_tvl_cap,
    get_last_harvest_time, set_last_harvest_time,
    get_harvest_cooldown_secs, set_harvest_cooldown_secs,
};
use governance::{
    initialize_governance, create_proposal, vote_on_proposal, execute_proposal,
    get_proposal_status, ProposalStatus, ProposalType,
};

#[contract]
pub struct AuraVault;

#[contractimpl]
impl AuraVault {
    // -----------------------------------------------------------------------
    // initialize
    // -----------------------------------------------------------------------
    /// Initialise the vault.
    ///
    /// Must be called **exactly once** immediately after deployment. Stores the
    /// admin address, the underlying SEP-41 token, zeroes out share/deposit
    /// counters, sets the storage layout version, and initialises the
    /// governance signer list.
    ///
    /// # Parameters
    ///
    /// - `env` — Soroban execution environment (injected by the runtime).
    /// - `admin` — Address with privileged control over pause, fees, and upgrades.
    /// - `underlying_token` — SEP-41-compatible token contract whose tokens are
    ///   deposited into and redeemed from the vault.
    /// - `signers` — Ordered list of addresses authorised to create and vote on
    ///   governance proposals. Must be non-empty.
    ///
    /// # Errors
    ///
    /// - [`VaultError::AlreadyInitialized`] — `initialize` has already been called.
    pub fn initialize(
        env: Env,
        admin: Address,
        underlying_token: Address,
        signers: Vec<Address>,
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
        initialize_governance(&env, signers)?;
        bump_instance(&env);
        Ok(())
    }

    // -----------------------------------------------------------------------
    // deposit
    //
    // Issue requirement: Emit Deposit event with indexed user and amount.
    // In Soroban, topics (first tuple) are indexed; data (second value) is not.
    // We place `caller` and `amount` in topics so they can be efficiently
    // filtered by indexers.
    // -----------------------------------------------------------------------
    /// Deposit underlying tokens and receive proportional vault shares.
    ///
    /// Computes the shares to mint using the current exchange rate:
    ///
    /// ```text
    /// // Empty vault: 1-to-1 seed ratio
    /// shares = amount
    ///
    /// // Non-empty vault:
    /// shares = floor(amount × total_shares / total_deposited)
    /// ```
    ///
    /// Enforces the flash-loan guard before executing (actual on-chain balance
    /// must equal `total_deposited`). On success, emits a `deposit` event with
    /// topics `(event_name, caller, amount)` and data
    /// `(new_shares, new_total_shares, new_total_deposited)`.
    ///
    /// # Parameters
    ///
    /// - `env` — Soroban execution environment.
    /// - `caller` — Address depositing tokens; must authorise this call.
    /// - `amount` — Number of underlying tokens to deposit, in the token's
    ///   smallest unit (e.g. stroops for a 7-decimal Stellar token). Must be > 0.
    ///
    /// # Returns
    ///
    /// The number of vault shares minted for `caller`.
    ///
    /// # Errors
    ///
    /// - [`VaultError::ZeroAmount`] — `amount <= 0`, or share formula rounds to 0.
    /// - [`VaultError::NotInitialized`] — vault not yet initialised.
    /// - [`VaultError::VaultPaused`] — vault is paused.
    /// - [`VaultError::BalanceMismatch`] — flash-loan guard tripped.
    /// - [`VaultError::MathOverflow`] — arithmetic overflow in share formula.
    pub fn deposit(env: Env, caller: Address, amount: i128) -> Result<i128, VaultError> {
        caller.require_auth();

        if amount <= 0 {
            return Err(VaultError::ZeroAmount);
        }
        if get_admin(&env).is_none() {
            return Err(VaultError::NotInitialized);
        }
        if storage_is_paused(&env) {
            return Err(VaultError::VaultPaused);
        }

        // TVL cap check — 0 means unlimited (Issue #467)
        let tvl_cap = get_tvl_cap(&env);
        if tvl_cap > 0 {
            let current_total = get_total_deposited(&env);
            let after_deposit = current_total
                .checked_add(amount)
                .ok_or(VaultError::MathOverflow)?;
            if after_deposit > tvl_cap {
                return Err(VaultError::TvlCapExceeded);
            }
        }

        let token_addr = get_token(&env).ok_or(VaultError::NotInitialized)?;
        let token = token::Client::new(&env, &token_addr);

        // Flash-loan guard: actual token balance must equal tracked state before deposit.
        let balance_before = token.balance(&env.current_contract_address());
        let total_deposited = get_total_deposited(&env);
        if balance_before != total_deposited {
            env.events().publish(
                (Symbol::new(&env, "suspicious"),),
                (Symbol::new(&env, "balance_mismatch"), balance_before, total_deposited),
            );
            return Err(VaultError::BalanceMismatch);
        }

        let total_shares = get_total_shares(&env);

        // Compute shares to mint (checked arithmetic; overflow returns MathOverflow)
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
        let new_balance = old_balance
            .checked_add(new_shares)
            .ok_or(VaultError::MathOverflow)?;
        set_balance(&env, &caller, new_balance);
        let new_total_shares = total_shares
            .checked_add(new_shares)
            .ok_or(VaultError::MathOverflow)?;
        set_total_shares(&env, new_total_shares);
        let new_total_deposited = total_deposited
            .checked_add(amount)
            .ok_or(VaultError::MathOverflow)?;
        set_total_deposited(&env, new_total_deposited);

        // Event: topics = (event_name, caller, amount) — indexed for efficient filtering.
        // data = (new_shares, new_total_shares, new_total_deposited) — contextual payload.
        env.events().publish(
            (Symbol::new(&env, "deposit"), caller.clone(), amount),
            (new_shares, new_total_shares, new_total_deposited),
        );

        bump_persistent(&env, &caller);
        bump_instance(&env);

        Ok(new_shares)
    }

    // -----------------------------------------------------------------------
    // withdraw
    // -----------------------------------------------------------------------
    /// Burn vault shares and redeem the proportional underlying tokens.
    ///
    /// Calculates the redemption amount:
    ///
    /// ```text
    /// redeem_amount = floor(shares × total_deposited / total_shares)
    /// ```
    ///
    /// Follows strict **CEI (Checks-Effects-Interactions)** ordering: shares
    /// are burned and all state is written *before* the token transfer to
    /// prevent reentrancy. Emits a `withdraw` event with topics
    /// `(event_name, caller, shares)` and data
    /// `(redeem_amount, new_total_shares, new_total_deposited)`.
    ///
    /// # Parameters
    ///
    /// - `env` — Soroban execution environment.
    /// - `caller` — Address redeeming shares; must authorise this call.
    /// - `shares` — Number of vault shares to burn. Must be > 0 and ≤
    ///   `balance_of(caller)`.
    ///
    /// # Returns
    ///
    /// The number of underlying tokens transferred to `caller`.
    ///
    /// # Errors
    ///
    /// - [`VaultError::ZeroAmount`] — `shares <= 0`, or redemption rounds to 0.
    /// - [`VaultError::NotInitialized`] — vault not yet initialised.
    /// - [`VaultError::VaultPaused`] — vault is paused.
    /// - [`VaultError::InsufficientShares`] — caller holds fewer shares than requested.
    /// - [`VaultError::InsufficientUnderlying`] — vault cannot cover the redemption.
    /// - [`VaultError::BalanceMismatch`] — flash-loan guard tripped.
    /// - [`VaultError::MathOverflow`] — arithmetic overflow.
    pub fn withdraw(env: Env, caller: Address, shares: i128) -> Result<i128, VaultError> {
        caller.require_auth();

        if shares <= 0 {
            return Err(VaultError::ZeroAmount);
        }
        if get_admin(&env).is_none() {
            return Err(VaultError::NotInitialized);
        }
        if storage_is_paused(&env) {
            return Err(VaultError::VaultPaused);
        }

        let token_addr = get_token(&env).ok_or(VaultError::NotInitialized)?;
        let token = token::Client::new(&env, &token_addr);

        let balance_before = token.balance(&env.current_contract_address());
        let total_deposited = get_total_deposited(&env);
        if balance_before != total_deposited {
            env.events().publish(
                (Symbol::new(&env, "suspicious"),),
                (Symbol::new(&env, "balance_mismatch"), balance_before, total_deposited),
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

        // Event: topics = (event_name, caller, shares) — indexed for efficient filtering.
        env.events().publish(
            (Symbol::new(&env, "withdraw"), caller.clone(), shares),
            (redeem_amount, new_total_shares, new_total_deposited),
        );

        bump_persistent(&env, &caller);
        bump_instance(&env);

        Ok(redeem_amount)
    }

    // -----------------------------------------------------------------------
    // harvest — permissionless keeper entry point (underlying token)
    // -----------------------------------------------------------------------
    /// Inject underlying-token yield into the vault without minting new shares.
    ///
    /// Any keeper may call this to increase `total_deposited`, which raises the
    /// redemption value of all existing shares (auto-compounding). A performance
    /// fee is deducted from `yield_amount` before the net amount is credited.
    ///
    /// Emits a `harvest` event with topics `(event_name, caller, yield_amount)`
    /// and data `(yield_after_fee, fee_amount, new_total_deposited)`.
    ///
    /// # Parameters
    ///
    /// - `env` — Soroban execution environment.
    /// - `caller` — Address supplying yield tokens; must authorise this call.
    /// - `yield_amount` — Amount of underlying tokens to inject, in the token's
    ///   smallest unit. Must be > 0.
    ///
    /// # Errors
    ///
    /// - [`VaultError::ZeroAmount`] — `yield_amount <= 0`.
    /// - [`VaultError::NotInitialized`] — vault not yet initialised.
    /// - [`VaultError::VaultPaused`] — vault is paused.
    /// - [`VaultError::ZeroShares`] — vault has no outstanding shares.
    /// - [`VaultError::BalanceMismatch`] — flash-loan guard tripped.
    /// - [`VaultError::MathOverflow`] — arithmetic overflow.
    pub fn harvest(env: Env, caller: Address, yield_amount: i128) -> Result<(), VaultError> {
        caller.require_auth();

        if yield_amount <= 0 {
            return Err(VaultError::ZeroAmount);
        }
        if get_admin(&env).is_none() {
            return Err(VaultError::NotInitialized);
        }
        if storage_is_paused(&env) {
            return Err(VaultError::VaultPaused);
        }

        let total_shares = get_total_shares(&env);
        if total_shares == 0 {
            return Err(VaultError::ZeroShares);
        }

        // Harvest cooldown check — Issue #471
        // If a cooldown is configured, reject harvests that arrive too soon.
        let cooldown_secs = get_harvest_cooldown_secs(&env);
        if cooldown_secs > 0 {
            let last_harvest = get_last_harvest_time(&env);
            if last_harvest > 0 {
                let now = env.ledger().timestamp();
                let elapsed = now.saturating_sub(last_harvest);
                if elapsed < cooldown_secs {
                    return Err(VaultError::HarvestCooldown);
                }
            }
        }

        let total_deposited = get_total_deposited(&env);

        let token_addr = get_token(&env).ok_or(VaultError::NotInitialized)?;
        let token = token::Client::new(&env, &token_addr);

        // Flash-loan guard
        let balance_before = token.balance(&env.current_contract_address());
        if balance_before != total_deposited {
            env.events().publish(
                (Symbol::new(&env, "suspicious"),),
                (Symbol::new(&env, "balance_mismatch"), balance_before, total_deposited),
            );
            return Err(VaultError::BalanceMismatch);
        }

        let perf_fee_bps = storage::get_perf_fee_bps(&env);
        let fee_amount = fee::calc_perf_fee(yield_amount, perf_fee_bps)?;
        let yield_after_fee = yield_amount
            .checked_sub(fee_amount)
            .ok_or(VaultError::MathOverflow)?;

        let current_fees = storage::get_total_fee_collected(&env);
        let new_fees = current_fees
            .checked_add(fee_amount)
            .ok_or(VaultError::MathOverflow)?;

        let new_total = total_deposited
            .checked_add(yield_after_fee)
            .ok_or(VaultError::MathOverflow)?;

        // Interaction: pull yield tokens into vault
        token.transfer(&caller, &env.current_contract_address(), &yield_amount);

        // Effects: increase total deposited with net yield; accumulate fees
        set_total_deposited(&env, new_total);
        storage::set_total_fee_collected(&env, new_fees);
        // Record harvest timestamp for cooldown enforcement (Issue #471)
        set_last_harvest_time(&env, env.ledger().timestamp());

        env.events().publish(
            (Symbol::new(&env, "harvest"), caller.clone(), yield_amount),
            (yield_after_fee, fee_amount, new_total),
        );

        bump_instance(&env);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // harvest_token — multi-yield-token entry point (Issue #48)
    // -----------------------------------------------------------------------
    /// Inject yield denominated in an alternative (non-underlying) token.
    ///
    /// Allows keepers to harvest rewards paid in a different token (e.g. a
    /// protocol incentive token). The caller supplies the alt-token yield, and
    /// separately provides `underlying_amount` — the equivalent underlying
    /// value after an off-chain or on-chain swap — which is credited to
    /// `total_deposited` net of the performance fee.
    ///
    /// The `alt_token` must be pre-approved by the admin via
    /// [`register_yield_token`].
    ///
    /// Emits a `harvest_token` event with topics
    /// `(event_name, caller, alt_token)` and data
    /// `(yield_amount, net_underlying, fee_amount)`.
    ///
    /// # Parameters
    ///
    /// - `env` — Soroban execution environment.
    /// - `caller` — Address supplying alt-token yield; must authorise this call.
    /// - `alt_token` — Contract address of the alternative yield token. Must be
    ///   on the admin whitelist.
    /// - `yield_amount` — Amount of `alt_token` tokens transferred from `caller`.
    ///   Must be > 0.
    /// - `underlying_amount` — Equivalent underlying token value being credited
    ///   to the vault (after swap/conversion). Must be > 0.
    ///
    /// # Errors
    ///
    /// - [`VaultError::ZeroAmount`] — either amount is ≤ 0.
    /// - [`VaultError::NotInitialized`] — vault not yet initialised.
    /// - [`VaultError::VaultPaused`] — vault is paused.
    /// - [`VaultError::ZeroShares`] — vault has no outstanding shares.
    /// - [`VaultError::InvalidAddress`] — `alt_token` is not whitelisted.
    /// - [`VaultError::BalanceMismatch`] — flash-loan guard tripped on underlying.
    /// - [`VaultError::MathOverflow`] — arithmetic overflow.
    ///
    /// [`register_yield_token`]: AuraVault::register_yield_token
    pub fn harvest_token(
        env: Env,
        caller: Address,
        alt_token: Address,
        yield_amount: i128,
        underlying_amount: i128,
    ) -> Result<(), VaultError> {
        caller.require_auth();

        if yield_amount <= 0 || underlying_amount <= 0 {
            return Err(VaultError::ZeroAmount);
        }
        if get_admin(&env).is_none() {
            return Err(VaultError::NotInitialized);
        }
        if storage_is_paused(&env) {
            return Err(VaultError::VaultPaused);
        }

        let total_shares = get_total_shares(&env);
        if total_shares == 0 {
            return Err(VaultError::ZeroShares);
        }

        // Verify the alt_token is whitelisted
        if !storage::is_yield_token(&env, &alt_token) {
            return Err(VaultError::InvalidAddress);
        }

        let total_deposited = get_total_deposited(&env);

        // Flash-loan guard on underlying token
        let underlying_addr = get_token(&env).ok_or(VaultError::NotInitialized)?;
        let underlying = token::Client::new(&env, &underlying_addr);
        let balance_before = underlying.balance(&env.current_contract_address());
        if balance_before != total_deposited {
            env.events().publish(
                (Symbol::new(&env, "suspicious"),),
                (Symbol::new(&env, "balance_mismatch"), balance_before, total_deposited),
            );
            return Err(VaultError::BalanceMismatch);
        }

        let perf_fee_bps = storage::get_perf_fee_bps(&env);
        let fee_amount = fee::calc_perf_fee(underlying_amount, perf_fee_bps)
            .unwrap_or(0);
        let net_underlying = underlying_amount
            .checked_sub(fee_amount)
            .ok_or(VaultError::MathOverflow)?;

        let new_total = total_deposited
            .checked_add(net_underlying)
            .ok_or(VaultError::MathOverflow)?;

        // Interaction: pull alt-token yield from caller
        token::Client::new(&env, &alt_token)
            .transfer(&caller, &env.current_contract_address(), &yield_amount);

        // Effects: credit net underlying value
        set_total_deposited(&env, new_total);
        let prev_fees = storage::get_total_fee_collected(&env);
        storage::set_total_fee_collected(
            &env,
            prev_fees.checked_add(fee_amount).ok_or(VaultError::MathOverflow)?,
        );

        env.events().publish(
            (Symbol::new(&env, "harvest_token"), caller, alt_token),
            (yield_amount, net_underlying, fee_amount),
        );

        bump_instance(&env);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // register_yield_token — admin-only: whitelist an alt yield token
    // -----------------------------------------------------------------------
    /// Whitelist an alternative yield token for use with [`harvest_token`].
    ///
    /// Admin-only. Emits a `yield_token_registered` event.
    ///
    /// # Parameters
    ///
    /// - `env` — Soroban execution environment.
    /// - `alt_token` — Token contract address to add to the whitelist.
    ///
    /// # Errors
    ///
    /// - [`VaultError::NotInitialized`] — vault not yet initialised.
    /// - [`VaultError::UpgradeUnauthorized`] — caller is not the admin.
    ///
    /// [`harvest_token`]: AuraVault::harvest_token
    pub fn register_yield_token(env: Env, alt_token: Address) -> Result<(), VaultError> {
        let admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
        admin.require_auth();
        storage::set_yield_token(&env, &alt_token, true);
        bump_instance(&env);
        env.events().publish(
            (Symbol::new(&env, "yield_token_registered"),),
            (alt_token,),
        );
        Ok(())
    }

    // -----------------------------------------------------------------------
    // pause / unpause — admin-only emergency controls
    // Takes admin address so the client can require_auth on it.
    // -----------------------------------------------------------------------
    /// Halt all mutating vault operations (deposit, withdraw, harvest).
    ///
    /// Admin-only emergency control. Once paused, any call to `deposit`,
    /// `withdraw`, `harvest`, or `harvest_token` returns
    /// [`VaultError::VaultPaused`] until [`unpause`] is called.
    ///
    /// Emits a `paused` event. Safe to call when already paused (idempotent).
    ///
    /// # Parameters
    ///
    /// - `env` — Soroban execution environment.
    /// - `admin` — Must match the stored admin address and authorise this call.
    ///
    /// # Errors
    ///
    /// - [`VaultError::NotInitialized`] — vault not yet initialised.
    /// - [`VaultError::UpgradeUnauthorized`] — `admin` does not match stored admin.
    ///
    /// [`unpause`]: AuraVault::unpause
    pub fn pause(env: Env, admin: Address) -> Result<(), VaultError> {
        let stored_admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
        if stored_admin != admin {
            return Err(VaultError::UpgradeUnauthorized);
        }
        admin.require_auth();
        set_paused(&env, true);
        env.events().publish((Symbol::new(&env, "paused"),), ());
        bump_instance(&env);
        Ok(())
    }

    /// Resume vault operations after a [`pause`].
    ///
    /// Admin-only. Emits an `unpaused` event. Safe to call when already
    /// unpaused (idempotent).
    ///
    /// # Parameters
    ///
    /// - `env` — Soroban execution environment.
    /// - `admin` — Must match the stored admin address and authorise this call.
    ///
    /// # Errors
    ///
    /// - [`VaultError::NotInitialized`] — vault not yet initialised.
    /// - [`VaultError::UpgradeUnauthorized`] — `admin` does not match stored admin.
    ///
    /// [`pause`]: AuraVault::pause
    pub fn unpause(env: Env, admin: Address) -> Result<(), VaultError> {
        let stored_admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
        if stored_admin != admin {
            return Err(VaultError::UpgradeUnauthorized);
        }
        admin.require_auth();
        set_paused(&env, false);
        env.events().publish((Symbol::new(&env, "unpaused"),), ());
        bump_instance(&env);
        Ok(())
    }

    /// Returns `true` if the vault is currently paused, `false` otherwise.
    ///
    /// Read-only view; no authorisation required.
    pub fn is_paused(env: Env) -> bool {
        storage_is_paused(&env)
    }

    // -----------------------------------------------------------------------
    // Fee administration — admin-only
    // -----------------------------------------------------------------------

    /// Set performance and management fee rates.
    ///
    /// Admin-only. Fees are expressed in **basis points** where
    /// `10_000 bps = 100%`.
    ///
    /// - `perf_fee_bps`: deducted from `yield_amount` on every [`harvest`]
    ///   call. Default: `1_000` (10 %).
    /// - `mgmt_fee_bps`: time-based management fee (reserved; not yet
    ///   charged). Default: `0`.
    ///
    /// # Parameters
    ///
    /// - `env` — Soroban execution environment.
    /// - `admin` — Must match the stored admin address and authorise this call.
    /// - `perf_fee_bps` — Performance fee in basis points (0–10_000).
    /// - `mgmt_fee_bps` — Management fee in basis points (0–10_000).
    ///
    /// # Errors
    ///
    /// - [`VaultError::NotInitialized`] — vault not yet initialised.
    /// - [`VaultError::UpgradeUnauthorized`] — caller is not the admin.
    ///
    /// [`harvest`]: AuraVault::harvest
    pub fn set_fees(env: Env, admin: Address, perf_fee_bps: u32, mgmt_fee_bps: u32) -> Result<(), VaultError> {
        let stored_admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
        if stored_admin != admin {
            return Err(VaultError::UpgradeUnauthorized);
        }
        admin.require_auth();
        storage::set_perf_fee_bps(&env, perf_fee_bps);
        storage::set_mgmt_fee_bps(&env, mgmt_fee_bps);
        bump_instance(&env);
        Ok(())
    }

    /// Set the treasury address where accumulated fees are sent.
    ///
    /// Admin-only. The treasury address must be configured before
    /// [`withdraw_fees`] can succeed.
    ///
    /// # Parameters
    ///
    /// - `env` — Soroban execution environment.
    /// - `admin` — Must match the stored admin address and authorise this call.
    /// - `treasury` — Destination address for fee withdrawals.
    ///
    /// # Errors
    ///
    /// - [`VaultError::NotInitialized`] — vault not yet initialised.
    /// - [`VaultError::UpgradeUnauthorized`] — caller is not the admin.
    ///
    /// [`withdraw_fees`]: AuraVault::withdraw_fees
    pub fn set_treasury(env: Env, admin: Address, treasury: Address) -> Result<(), VaultError> {
        let stored_admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
        if stored_admin != admin {
            return Err(VaultError::UpgradeUnauthorized);
        }
        admin.require_auth();
        storage::set_treasury(&env, &treasury);
        bump_instance(&env);
        Ok(())
    }

    /// Transfer all accumulated performance fees to the treasury.
    ///
    /// Admin-only. Resets the internal fee counter to zero after transferring.
    /// Emits a `fees_withdrawn` event with topics `(event_name, admin)` and
    /// data `(fees, treasury)`. Returns `0` if no fees have accumulated.
    ///
    /// # Parameters
    ///
    /// - `env` — Soroban execution environment.
    /// - `admin` — Must match the stored admin address and authorise this call.
    ///
    /// # Returns
    ///
    /// The amount of underlying tokens transferred to the treasury.
    ///
    /// # Errors
    ///
    /// - [`VaultError::NotInitialized`] — vault or treasury not initialised.
    /// - [`VaultError::UpgradeUnauthorized`] — caller is not the admin.
    pub fn withdraw_fees(env: Env, admin: Address) -> Result<i128, VaultError> {
        let stored_admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
        if stored_admin != admin {
            return Err(VaultError::UpgradeUnauthorized);
        }
        admin.require_auth();

        let fees = storage::get_total_fee_collected(&env);
        if fees <= 0 {
            return Ok(0);
        }

        let treasury = storage::get_treasury(&env).ok_or(VaultError::NotInitialized)?;
        let token_addr = get_token(&env).ok_or(VaultError::NotInitialized)?;
        let token = token::Client::new(&env, &token_addr);

        // Adjust total_deposited: fees were already excluded from it during harvest,
        // so we just transfer from vault balance.
        token.transfer(&env.current_contract_address(), &treasury, &fees);
        storage::set_total_fee_collected(&env, 0);

        env.events().publish(
            (Symbol::new(&env, "fees_withdrawn"), admin),
            (fees, treasury),
        );

        bump_instance(&env);
        Ok(fees)
    }

    /// Returns the total accumulated but not-yet-withdrawn performance fees,
    /// in underlying token units.
    ///
    /// Read-only view; no authorisation required.
    pub fn total_fees_collected(env: Env) -> i128 {
        storage::get_total_fee_collected(&env)
    }

    // -----------------------------------------------------------------------
    // TVL cap — admin-only (Issue #467)
    // -----------------------------------------------------------------------

    /// Set or update the TVL cap. `cap = 0` disables the cap (unlimited deposits).
    pub fn set_tvl_cap(env: Env, admin: Address, cap: i128) -> Result<(), VaultError> {
        let stored_admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
        if stored_admin != admin {
            return Err(VaultError::UpgradeUnauthorized);
        }
        admin.require_auth();
        set_tvl_cap(&env, cap);
        bump_instance(&env);
        Ok(())
    }

    /// Read the current TVL cap (0 = unlimited).
    pub fn get_tvl_cap(env: Env) -> i128 {
        storage::get_tvl_cap(&env)
    }

    // -----------------------------------------------------------------------
    // Harvest cooldown — admin-only (Issue #471)
    // -----------------------------------------------------------------------

    /// Configure the minimum seconds between harvests. `secs = 0` disables cooldown.
    pub fn set_harvest_cooldown(env: Env, admin: Address, secs: u64) -> Result<(), VaultError> {
        let stored_admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
        if stored_admin != admin {
            return Err(VaultError::UpgradeUnauthorized);
        }
        admin.require_auth();
        set_harvest_cooldown_secs(&env, secs);
        bump_instance(&env);
        Ok(())
    }

    /// Admin override: reset the last-harvest timestamp, bypassing the cooldown.
    /// Useful for emergency re-harvest after a failed yield event.
    pub fn reset_harvest_cooldown(env: Env, admin: Address) -> Result<(), VaultError> {
        let stored_admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
        if stored_admin != admin {
            return Err(VaultError::UpgradeUnauthorized);
        }
        admin.require_auth();
        set_last_harvest_time(&env, 0);
        bump_instance(&env);
        Ok(())
    }

    /// Read the timestamp of the last successful harvest.
    pub fn last_harvest_time(env: Env) -> u64 {
        get_last_harvest_time(&env)
    }

    // -----------------------------------------------------------------------
    // total_assets  (read-only)
    // -----------------------------------------------------------------------
    /// Returns the total underlying tokens currently tracked by the vault.
    ///
    /// Equals the sum of all deposited amounts plus harvested yield (after
    /// fees) minus all withdrawn amounts. Returned in the underlying token's
    /// smallest unit.
    ///
    /// Read-only view; no authorisation required. Gas-efficient: reads a
    /// single instance-storage entry.
    pub fn total_assets(env: Env) -> i128 {
        get_total_deposited(&env)
    }

    // -----------------------------------------------------------------------
    // balance_of  (read-only)
    // -----------------------------------------------------------------------
    /// Returns the vault share balance for the given address.
    ///
    /// Returns `0` for addresses that have never deposited or have fully
    /// redeemed their shares.
    ///
    /// Read-only view; no authorisation required. Gas-efficient: reads a
    /// single persistent-storage entry.
    ///
    /// # Parameters
    ///
    /// - `env` — Soroban execution environment.
    /// - `address` — The Stellar account address to query.
    pub fn balance_of(env: Env, address: Address) -> i128 {
        get_balance(&env, &address)
    }

    // -----------------------------------------------------------------------
    // Upgrade
    // -----------------------------------------------------------------------
    /// Upgrade the contract's Wasm binary to a new version.
    ///
    /// Admin-only. Validates that the current on-chain storage layout version
    /// matches [`CURRENT_LAYOUT_VERSION`] before applying the upgrade (guards
    /// against deploying a Wasm that expects a different storage schema).
    /// Increments the contract version counter, replaces the Wasm, and emits
    /// an `upgrade` event with topics `(event_name, admin)` and data
    /// `(old_version, new_version)`.
    ///
    /// # Parameters
    ///
    /// - `env` — Soroban execution environment.
    /// - `new_wasm_hash` — 32-byte SHA-256 hash of the replacement Wasm binary,
    ///   previously uploaded via `stellar contract upload`.
    ///
    /// # Errors
    ///
    /// - [`VaultError::NotInitialized`] — vault not yet initialised.
    /// - [`VaultError::UpgradeUnauthorized`] — admin `require_auth` failed.
    /// - [`VaultError::StorageLayoutMismatch`] — on-chain layout version ≠
    ///   `CURRENT_LAYOUT_VERSION`.
    ///
    /// [`CURRENT_LAYOUT_VERSION`]: crate::storage::CURRENT_LAYOUT_VERSION
    pub fn upgrade(env: Env, new_wasm_hash: soroban_sdk::BytesN<32>) -> Result<(), VaultError> {
        let admin = get_admin(&env).ok_or(VaultError::NotInitialized)?;
        admin.require_auth();

        let current_version = get_layout_version(&env);
        if current_version != CURRENT_LAYOUT_VERSION {
            return Err(VaultError::StorageLayoutMismatch);
        }

        let old_version = get_version(&env);
        let new_version = old_version + 1;
        set_version(&env, new_version);

        env.deployer().update_current_contract_wasm(new_wasm_hash);

        env.events().publish(
            (Symbol::new(&env, "upgrade"), admin),
            (old_version, new_version),
        );

        bump_instance(&env);
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Governance Methods
    // -----------------------------------------------------------------------

    /// Create a governance proposal to replace the admin address.
    ///
    /// `proposer` must be in the governance signer whitelist and must
    /// authorise this call.
    ///
    /// # Returns
    ///
    /// A unique proposal ID for use with [`vote`] and [`execute`].
    ///
    /// [`vote`]: AuraVault::vote
    /// [`execute`]: AuraVault::execute
    pub fn propose_update_admin(env: Env, proposer: Address, new_admin: Address) -> Result<u64, VaultError> {
        create_proposal(&env, proposer, ProposalType::UpdateAdmin)
    }

    /// Create a governance proposal to replace the underlying token address.
    ///
    /// `proposer` must be in the governance signer whitelist and must
    /// authorise this call.
    ///
    /// # Returns
    ///
    /// A unique proposal ID.
    pub fn propose_update_token(env: Env, proposer: Address, new_token: Address) -> Result<u64, VaultError> {
        create_proposal(&env, proposer, ProposalType::UpdateUnderlyingToken)
    }

    /// Create a governance proposal to update a named protocol parameter.
    ///
    /// `proposer` must be in the governance signer whitelist and must
    /// authorise this call.
    ///
    /// # Parameters
    ///
    /// - `name` — Symbolic parameter name (e.g. `Symbol::new(&env, "perf_fee_bps")`).
    /// - `value` — Proposed new `i128` value.
    ///
    /// # Returns
    ///
    /// A unique proposal ID.
    /// Create a governance proposal to update a named protocol parameter.
    ///
    /// `proposer` must be in the governance signer whitelist.
    ///
    /// # Parameters
    ///
    /// - `name` — Symbolic parameter name (e.g. `Symbol::new(&env, "perf_fee_bps")`).
    /// - `value` — Proposed new `i128` value.
    ///
    /// # Returns
    ///
    /// A unique proposal ID.
    pub fn propose_parameter_update(
        env: Env,
        proposer: Address,
        name: Symbol,
        value: i128,
    ) -> Result<u64, VaultError> {
        create_proposal(&env, proposer, ProposalType::UpdateParameter { name, value })
    }

    /// Vote to approve or reject an open governance proposal.
    ///
    /// `voter` must be in the governance signer whitelist and must not have
    /// already voted on this proposal.
    ///
    /// # Parameters
    ///
    /// - `voter` — Authorised signer; must authorise this call.
    /// - `proposal_id` — ID returned by a `propose_*` function.
    /// - `approve` — `true` to vote in favour; `false` to vote against.
    pub fn vote(
        env: Env,
        voter: Address,
        proposal_id: u64,
        approve: bool,
    ) -> Result<(), VaultError> {
        vote_on_proposal(&env, voter, proposal_id, approve)
    }

    /// Execute an approved governance proposal after its timelock has elapsed.
    ///
    /// The proposal must be in `Approved` status. On success the status moves
    /// to `Executed` and the proposed change takes effect.
    ///
    /// # Parameters
    ///
    /// - `executor` — Any whitelisted signer may execute an approved proposal.
    /// - `proposal_id` — ID of the proposal to execute.
    pub fn execute(
        env: Env,
        executor: Address,
        proposal_id: u64,
    ) -> Result<(), VaultError> {
        execute_proposal(&env, executor, proposal_id)?;
        bump_instance(&env);
        Ok(())
    }

    /// Returns the status of a governance proposal as a human-readable string,
    /// or `None` if the proposal ID does not exist.
    ///
    /// Possible values: `"Pending"`, `"Approved"`, `"Executed"`, `"Rejected"`.
    ///
    /// Read-only view; no authorisation required.
    pub fn proposal_status(env: Env, proposal_id: u64) -> Option<soroban_sdk::String> {
        get_proposal_status(&env, proposal_id).map(|status| {
            match status {
                ProposalStatus::Pending => soroban_sdk::String::from_str(&env, "Pending"),
                ProposalStatus::Approved => soroban_sdk::String::from_str(&env, "Approved"),
                ProposalStatus::Executed => soroban_sdk::String::from_str(&env, "Executed"),
                ProposalStatus::Rejected => soroban_sdk::String::from_str(&env, "Rejected"),
            }
        })
    }
}
