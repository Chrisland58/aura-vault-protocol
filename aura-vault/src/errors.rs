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
    /// Caller is not the admin — upgrade rejected.
    UpgradeUnauthorized    = 9,
    /// On-chain layout version doesn't match CURRENT_LAYOUT_VERSION.
    StorageLayoutMismatch  = 10,
    /// Vault is paused — mutating operations are disabled.
    VaultPaused            = 11,
    /// Token balance is inconsistent with tracked state (flash loan guard).
    BalanceMismatch        = 12,
    /// Caller is not the admin — harvest rejected.
    HarvestUnauthorized    = 13,
    /// Deposit would exceed the TVL cap.
    TvlCapExceeded         = 14,
    /// No accrued fees available to claim.
    NoFeesToClaim          = 15,
    /// Caller is not the KYC verifier.
    KycUnauthorized        = 16,
    /// Address is not approved for deposits (KYC required).
    KycNotApproved         = 17,
    /// KYC approval has expired.
    KycExpired             = 18,
}
