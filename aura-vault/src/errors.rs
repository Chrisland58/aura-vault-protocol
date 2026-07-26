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
    /// Harvest called before the minimum cooldown period has elapsed.
    HarvestCooldown        = 13,
    /// Deposit would push total assets above the configured TVL cap.
    TvlCapExceeded         = 14,
}
