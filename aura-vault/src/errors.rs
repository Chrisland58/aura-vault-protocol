#![allow(unused)]

use soroban_sdk::contracterror;

/// All error codes that AuraVault contract functions may return.
///
/// Errors are represented as `u32` discriminants and are part of the public
/// ABI — changing a discriminant value is a **breaking change** that requires a
/// storage-layout version bump and a governance upgrade proposal.
///
/// # Mapping to HTTP-style categories
///
/// | Range | Category |
/// |---|---|
/// | 1–2   | Initialisation errors |
/// | 3–6   | Input / arithmetic errors |
/// | 7–8   | State precondition errors |
/// | 9–12  | Authorization / invariant errors |
/// | 13–15 | Governance errors |
/// | 16–19 | Operational / configuration errors |
/// | 20–23 | Withdrawal queue errors |
/// | 24    | Circuit-breaker errors |
///
/// # ABI metadata
///
/// Each variant exposes a human-readable string through [`VaultError::message`]
/// which is included in the contract ABI metadata and can be surfaced directly
/// by wallet and explorer UIs without additional localisation lookup.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum VaultError {
    // -----------------------------------------------------------------------
    // 1–2: Initialisation errors
    // -----------------------------------------------------------------------

    /// The vault has not yet been initialised via [`initialize`].
    ///
    /// **Trigger:** Any function that reads vault state is called before
    /// `initialize` has been called on this contract instance.
    ///
    /// **Resolution:** Call `initialize(admin, underlying_token, signers)`
    /// first, or connect to the correct contract address.
    ///
    /// [`initialize`]: crate::AuraVault::initialize
    NotInitialized = 1,

    /// [`initialize`] has already been called on this contract instance.
    ///
    /// **Trigger:** A second call to `initialize` after the vault has already
    /// been set up. The vault can only be initialised once.
    ///
    /// **Resolution:** No action needed — the vault is already active. If you
    /// intended to change parameters, use the appropriate admin setter instead.
    ///
    /// [`initialize`]: crate::AuraVault::initialize
    AlreadyInitialized = 2,

    // -----------------------------------------------------------------------
    // 3–6: Input / arithmetic errors
    // -----------------------------------------------------------------------

    /// The caller does not hold enough vault shares to fulfil the withdrawal.
    ///
    /// **Trigger:** `withdraw(shares)` called when `shares > balance_of(caller)`.
    ///
    /// **Resolution:** Reduce the number of shares to withdraw, or check your
    /// current share balance with `balance_of(your_address)`.
    ///
    /// [`withdraw`]: crate::AuraVault::withdraw
    InsufficientShares = 3,

    /// The vault's tracked underlying balance cannot cover the redemption.
    ///
    /// **Trigger:** `withdraw` would pay out more tokens than the vault holds.
    /// This should not occur under normal circumstances; it implies a
    /// discrepancy between share accounting and the underlying balance.
    ///
    /// **Resolution:** Contact the vault admin immediately. The vault should be
    /// paused and audited before any further withdrawals.
    ///
    /// [`withdraw`]: crate::AuraVault::withdraw
    InsufficientUnderlying = 4,

    /// The supplied amount is zero or would produce zero output.
    ///
    /// **Trigger:**
    /// - `deposit(amount)` called with `amount <= 0`.
    /// - `withdraw(shares)` called with `shares <= 0`.
    /// - `harvest(yield_amount)` called with `yield_amount <= 0`.
    /// - A deposit is so small relative to the vault size that the share
    ///   formula rounds to zero shares.
    ///
    /// **Resolution:** Increase the input amount. If depositing, the minimum
    /// viable deposit is approximately `total_deposited / total_shares` tokens.
    ZeroAmount = 5,

    /// An arithmetic operation overflowed the `i128` range.
    ///
    /// **Trigger:** The share formula or fee calculation produced a value that
    /// cannot be represented as a 128-bit signed integer. This can occur with
    /// extremely large vault balances or very large input amounts.
    ///
    /// **Resolution:** Reduce the transaction amount. If the error persists at
    /// normal amounts, contact the vault admin — it may indicate a bug.
    MathOverflow = 6,

    // -----------------------------------------------------------------------
    // 7–8: State precondition errors
    // -----------------------------------------------------------------------

    /// An address argument failed validation, or is not on the required whitelist.
    ///
    /// **Trigger:**
    /// - An alternative yield token passed to `harvest_token` or
    ///   `distribute_yield_token` has not been registered via
    ///   `register_yield_token`.
    /// - A governance operation was attempted by an address not in the signer
    ///   whitelist.
    ///
    /// **Resolution:** Use a whitelisted token address, or ensure the caller
    /// address has been added to the governance signer list.
    InvalidAddress = 7,

    /// A harvest was attempted but the vault has no outstanding shares.
    ///
    /// **Trigger:** `harvest` or `distribute_yield` called when
    /// `total_shares == 0`, meaning there are no depositors to receive yield.
    ///
    /// **Resolution:** Wait until at least one depositor has joined the vault
    /// before harvesting yield.
    ZeroShares = 8,

    // -----------------------------------------------------------------------
    // 9–12: Authorization / invariant errors
    // -----------------------------------------------------------------------

    /// The caller is not authorised to perform this admin-only operation.
    ///
    /// **Trigger:** A privileged function (`pause`, `unpause`, `set_fees`,
    /// `upgrade`, `set_tvl_cap`, `set_harvest_cooldown`, etc.) was called by
    /// an address that does not match the stored admin.
    ///
    /// **Resolution:** Only the vault admin can call this function. Connect
    /// with the admin keypair and try again.
    UpgradeUnauthorized = 9,

    /// The on-chain storage layout version does not match the compiled code.
    ///
    /// **Trigger:** `upgrade` was attempted but the stored layout version
    /// differs from `CURRENT_LAYOUT_VERSION`. This guards against running new
    /// code against an incompatible storage schema.
    ///
    /// **Resolution:** Perform any required storage migration first, then
    /// retry the upgrade.
    StorageLayoutMismatch = 10,

    /// All mutating operations are halted because the vault is paused.
    ///
    /// **Trigger:** `deposit`, `withdraw`, or `harvest` called while the admin
    /// has activated the emergency pause.
    ///
    /// **Resolution:** Wait for the vault admin to call `unpause()`. Follow
    /// official Aura Vault channels for status updates.
    VaultPaused = 11,

    /// The vault's actual token balance does not match its tracked state.
    ///
    /// **Trigger:** The flash-loan guard detected that the vault's real on-chain
    /// token balance differs from `total_deposited`. This indicates a potential
    /// flash-loan attack or an accounting bug.
    ///
    /// **Resolution:** The vault has emitted a `suspicious` event. Contact the
    /// vault admin immediately. Do not interact until the discrepancy has been
    /// investigated.
    BalanceMismatch = 12,

    // -----------------------------------------------------------------------
    // 13–15: Governance errors
    // -----------------------------------------------------------------------

    /// A governance proposal cannot be executed because its timelock has not
    /// yet expired.
    ///
    /// **Trigger:** `execute(proposal_id)` called before the required waiting
    /// period after approval has elapsed.
    ///
    /// **Resolution:** Wait for the timelock period to expire, then retry.
    TimelockNotExpired = 13,

    /// A governance proposal has not received enough approval votes to execute.
    ///
    /// **Trigger:** `execute(proposal_id)` called on a proposal that has not
    /// yet reached the required signature threshold.
    ///
    /// **Resolution:** Collect more approval votes from whitelisted signers
    /// before executing.
    NotApproved = 14,

    /// This signer has already voted on this governance proposal.
    ///
    /// **Trigger:** `vote(proposal_id, approve)` called by an address that
    /// already cast a vote on the same proposal.
    ///
    /// **Resolution:** Each signer may only vote once per proposal. No further
    /// action is needed if the vote was already recorded.
    AlreadyVoted = 15,

    // -----------------------------------------------------------------------
    // 16–19: Operational / configuration errors
    // -----------------------------------------------------------------------

    /// The deposit would push the vault's total assets above the configured cap.
    ///
    /// **Trigger:** `deposit(amount)` would make `total_assets > tvl_cap` when
    /// a non-zero TVL cap is set.
    ///
    /// **Resolution:** Deposit a smaller amount, or wait for other users to
    /// withdraw. Admins can raise or remove the cap with `set_tvl_cap`.
    TvlCapExceeded = 16,

    /// The yield amount is too small to distribute: it rounds to zero per share.
    ///
    /// **Trigger:** `distribute_yield` or `distribute_yield_token` called with
    /// a `yield_amount` so small that `yield_amount * YIELD_PRECISION /
    /// total_shares == 0`.
    ///
    /// **Resolution:** Accumulate more yield before distributing, or wait for
    /// the vault to grow in share count.
    YieldTooSmall = 17,

    /// Yield distribution accuracy check failed (rounding error exceeds 0.01%).
    ///
    /// **Trigger:** After computing the per-share yield increment, the
    /// re-derived total distributed amount differs from the net yield by more
    /// than 0.01%. This guards against precision loss on very large or very
    /// uneven vaults.
    ///
    /// **Resolution:** This is an internal safeguard; adjust the yield amount
    /// slightly or contact the vault admin if it persists.
    DistributionAccuracyError = 18,

    /// A harvest was attempted before the configured cooldown period has elapsed.
    ///
    /// **Trigger:** `harvest` called within `harvest_cooldown_secs` seconds of
    /// the last successful harvest.
    ///
    /// **Resolution:** Wait for the cooldown period to pass before harvesting
    /// again. The cooldown resets after each successful harvest.
    HarvestCooldown = 19,

    // -----------------------------------------------------------------------
    // 20–23: Withdrawal queue errors
    // -----------------------------------------------------------------------

    /// The withdrawal has been queued and will be available after the unbonding
    /// period.
    ///
    /// **Trigger:** `withdraw(shares)` called with an amount exceeding the
    /// instant-withdrawal threshold while a withdrawal unbonding period is
    /// configured. This is an informational status, not a fatal error.
    ///
    /// **Resolution:** No action needed. Retrieve your entry ID from the
    /// emitted event and call `claim_withdrawal(entry_id)` after the unbonding
    /// period expires.
    WithdrawalQueued = 20,

    /// The withdrawal queue entry does not exist or has already been claimed.
    ///
    /// **Trigger:** `claim_withdrawal(entry_id)` called with an ID that was
    /// never created, or that has already been processed.
    ///
    /// **Resolution:** Verify the entry ID. If you have already claimed this
    /// withdrawal, the tokens should already be in your wallet.
    QueueEntryNotFound = 21,

    /// The queued withdrawal is still within the unbonding period.
    ///
    /// **Trigger:** `claim_withdrawal(entry_id)` called before the
    /// `claimable_after` timestamp on the queue entry has passed.
    ///
    /// **Resolution:** Wait for the unbonding period to expire, then retry.
    QueueUnbondingPending = 22,

    /// The withdrawal fee rate exceeds the allowed maximum (5%).
    ///
    /// **Trigger:** `set_withdrawal_fee_bps(bps)` called with `bps > 500`
    /// (where 500 basis points = 5%).
    ///
    /// **Resolution:** Use a fee value between 0 and 500 basis points.
    InvalidWithdrawalFee = 23,

    // -----------------------------------------------------------------------
    // 24: Circuit-breaker errors
    // -----------------------------------------------------------------------

    /// A harvest was rejected because the share price would move beyond the
    /// configured circuit-breaker limit; the vault has been auto-paused.
    ///
    /// **Trigger:** `harvest(yield_amount)` would change the share price by
    /// more than `price_movement_limit` basis points in a single transaction.
    /// The vault has been automatically paused and a `suspicious` event
    /// emitted.
    ///
    /// **Resolution:** The vault admin must review the harvest source, confirm
    /// it is legitimate, and then call `unpause()` to resume operations.
    CircuitBreakerTripped = 24,
}

impl VaultError {
    /// Return a short, end-user-facing English description of this error.
    ///
    /// These strings are embedded in the contract ABI metadata so that wallet
    /// and explorer UIs can display them directly without a separate lookup.
    /// Localised versions of every message are available via the
    /// `vault_errors` namespace in the frontend i18n files.
    ///
    /// # Examples
    ///
    /// ```no_run
    /// use aura_vault::VaultError;
    /// assert_eq!(
    ///     VaultError::VaultPaused.message(),
    ///     "The vault is currently paused. Please wait for the admin to resume operations.",
    /// );
    /// ```
    pub const fn message(self) -> &'static str {
        match self {
            VaultError::NotInitialized =>
                "The vault has not been initialized yet. Contact the admin or verify the contract address.",
            VaultError::AlreadyInitialized =>
                "The vault has already been initialized and cannot be set up again.",
            VaultError::InsufficientShares =>
                "You do not have enough vault shares to complete this withdrawal. Check your share balance.",
            VaultError::InsufficientUnderlying =>
                "The vault does not have enough underlying tokens to cover this redemption. Contact the admin.",
            VaultError::ZeroAmount =>
                "Amount must be greater than zero. Increase the input amount and try again.",
            VaultError::MathOverflow =>
                "Arithmetic overflow: the transaction amount is too large. Try a smaller amount.",
            VaultError::InvalidAddress =>
                "The address or token is not recognized. Ensure it has been whitelisted by the admin.",
            VaultError::ZeroShares =>
                "The vault has no shareholders yet. Yield cannot be distributed until someone deposits.",
            VaultError::UpgradeUnauthorized =>
                "Only the vault admin can perform this action. Connect with the admin account and try again.",
            VaultError::StorageLayoutMismatch =>
                "Contract upgrade failed: storage layout version mismatch. A migration is required first.",
            VaultError::VaultPaused =>
                "The vault is currently paused. Please wait for the admin to resume operations.",
            VaultError::BalanceMismatch =>
                "Security alert: the vault's token balance does not match its records. The vault has been flagged — contact the admin immediately.",
            VaultError::TimelockNotExpired =>
                "This governance proposal cannot be executed yet. The timelock period has not elapsed.",
            VaultError::NotApproved =>
                "This governance proposal has not received enough approvals to execute.",
            VaultError::AlreadyVoted =>
                "You have already voted on this proposal. Each signer may only vote once.",
            VaultError::TvlCapExceeded =>
                "This deposit would exceed the vault's total-value-locked cap. Try a smaller amount or wait for capacity.",
            VaultError::YieldTooSmall =>
                "The yield amount is too small to distribute — it rounds to zero per share. Accumulate more yield first.",
            VaultError::DistributionAccuracyError =>
                "Yield distribution precision check failed. Adjust the yield amount slightly and retry.",
            VaultError::HarvestCooldown =>
                "A harvest was performed too recently. Wait for the cooldown period to expire before harvesting again.",
            VaultError::WithdrawalQueued =>
                "Your withdrawal has been queued. Claim it after the unbonding period expires using your queue entry ID.",
            VaultError::QueueEntryNotFound =>
                "Withdrawal queue entry not found. It may not exist or may have already been claimed.",
            VaultError::QueueUnbondingPending =>
                "Your withdrawal is still in the unbonding period. Please wait and retry after the unlock time.",
            VaultError::InvalidWithdrawalFee =>
                "Withdrawal fee exceeds the maximum allowed rate of 5%. Use a value between 0 and 500 basis points.",
            VaultError::CircuitBreakerTripped =>
                "Harvest rejected: the share price movement exceeded the safety limit. The vault has been auto-paused pending admin review.",
        }
    }
}
