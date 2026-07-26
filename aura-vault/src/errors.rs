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
}
