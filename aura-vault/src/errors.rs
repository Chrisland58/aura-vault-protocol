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

    // ---------------------------------------------------------------------------
    // Multi-sig admin operations (Issue #375)
    // ---------------------------------------------------------------------------
    /// Caller is not in the multi-sig signer set
    NotASigner             = 13,
    /// Proposal/operation ID does not exist
    OperationNotFound      = 14,
    /// Operation has passed its 72-hour expiry window
    OperationExpired       = 15,
    /// This signer has already signed this operation
    OperationAlreadySigned = 16,
    /// Operation has already been executed
    OperationAlreadyExecuted = 17,
    /// Not enough signatures collected to meet the M-of-N threshold
    ThresholdNotMet        = 18,
    /// Attempt to set an invalid threshold (0 or > signer count)
    InvalidThreshold       = 19,
}
