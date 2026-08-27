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
/// | 1–2  | Initialisation errors |
/// | 3–6  | Input / arithmetic errors |
/// | 7–8  | State precondition errors |
/// | 9–12 | Authorization / invariant errors |
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum VaultError {
    /// The vault has not yet been initialised via [`initialize`].
    ///
    /// Returned by any function that reads vault state before `initialize` has
    /// been called.
    ///
    /// [`initialize`]: crate::AuraVault::initialize
    NotInitialized = 1,

    /// [`initialize`] has already been called on this contract instance.
    ///
    /// The vault can only be initialised once. Subsequent calls to
    /// `initialize` return this error.
    ///
    /// [`initialize`]: crate::AuraVault::initialize
    AlreadyInitialized = 2,

    /// The caller does not hold enough shares to fulfil the withdrawal.
    ///
    /// Returned by [`withdraw`] when `shares > balance_of(caller)`.
    ///
    /// [`withdraw`]: crate::AuraVault::withdraw
    InsufficientShares = 3,

    /// The vault's tracked underlying balance is insufficient to cover the
    /// redemption amount.
    ///
    /// This should not occur under normal circumstances (it implies a
    /// discrepancy between share accounting and the underlying balance). If
    /// encountered, the vault should be paused and investigated.
    ///
    /// Returned by [`withdraw`].
    ///
    /// [`withdraw`]: crate::AuraVault::withdraw
    InsufficientUnderlying = 4,
    ZeroAmount             = 5,
    MathOverflow           = 6,
    InvalidAddress         = 7,
    ZeroShares             = 8,
    UpgradeUnauthorized    = 9,
    StorageLayoutMismatch  = 10,
    VaultPaused            = 11,
    BalanceMismatch        = 12,
    /// Governance: proposal timelock has not expired yet
    TimelockNotExpired     = 13,
    /// Governance: proposal has not been approved by enough signers
    NotApproved            = 14,
    /// Governance: signer has already cast a vote on this proposal
    AlreadyVoted           = 15,
    /// Deposit would exceed the configured TVL cap
    TvlCapExceeded         = 16,
    /// Yield amount is too small to distribute (rounds to zero per-share)
    YieldTooSmall          = 17,
    /// Yield distribution accuracy check failed (>0.01% rounding error)
    DistributionAccuracyError = 18,
    /// Harvest attempted before the configured cooldown period has elapsed
    HarvestCooldown        = 19,
    /// Withdrawal is queued and will be processed after the unbonding period
    WithdrawalQueued       = 20,
    /// Withdrawal queue entry does not exist or has already been processed
    QueueEntryNotFound     = 21,
    /// Withdrawal queue entry is still within the unbonding period
    QueueUnbondingPending  = 22,
    /// Withdrawal fee rate exceeds the allowed maximum
    InvalidWithdrawalFee   = 23,
    /// A token.transfer cross-contract call did not move the expected amount
    /// (post-transfer balance assertion failed).
    TransferFailed         = 24,
    /// Oracle price is zero — feed returned a nonsensical value.
    OraclePriceZero        = 25,
    /// Oracle price exceeds the sanity-cap (unreasonably large value that
    /// may indicate a manipulation attempt or mis-configured feed).
    OraclePriceTooHigh     = 26,
    /// Oracle data is stale: the `updated_at` timestamp is older than the
    /// configured maximum age.
    OraclePriceStale       = 27,
}
