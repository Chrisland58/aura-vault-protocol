#![allow(unused)]

use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum VaultError {
    NotInitialized         = 1,
    AlreadyInitialized     = 2,
    InsufficientShares     = 3,
    InsufficientUnderlying = 4,
    ZeroAmount             = 5,
    MathOverflow           = 6,
    InvalidAddress         = 7,
    ZeroShares             = 8,
    UpgradeUnauthorized    = 9,
    StorageLayoutMismatch  = 10,
    VaultPaused            = 11,
    BalanceMismatch        = 12,
    /// Yield amount is too small to distribute with at least 0.01% accuracy
    /// relative to total shares (net yield rounds to zero stroop per share).
    YieldTooSmall          = 13,
    /// Post-distribution accuracy check: the distributed amount deviates more
    /// than the allowed 0.01% tolerance from the requested yield_amount.
    DistributionAccuracyError = 14,
}
