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

    /// A zero or negative amount was provided, or a deposit would mint zero
    /// shares due to integer floor-division rounding.
    ///
    /// Returned when:
    /// - `amount <= 0` in [`deposit`]
    /// - `shares <= 0` in [`withdraw`]
    /// - `yield_amount <= 0` in [`harvest`]
    /// - The share formula `floor(amount × total_shares / total_assets)`
    ///   evaluates to `0` (inflation-attack prevention fence)
    ///
    /// [`deposit`]: crate::AuraVault::deposit
    /// [`withdraw`]: crate::AuraVault::withdraw
    /// [`harvest`]: crate::AuraVault::harvest
    ZeroAmount = 5,

    /// An arithmetic operation overflowed `i128`.
    ///
    /// All arithmetic in the contract uses `checked_mul` / `checked_div` /
    /// `checked_add` / `checked_sub`. If any of these return `None`, this
    /// error is returned. The `overflow-checks = true` release profile flag
    /// acts as an additional compile-time safety net.
    MathOverflow = 6,

    /// An address argument failed validation.
    ///
    /// Currently returned by [`harvest_token`] when the `alt_token` address
    /// is not on the admin-managed yield-token whitelist.
    ///
    /// Reserved for future address-validation use cases.
    ///
    /// [`harvest_token`]: crate::AuraVault::harvest_token
    InvalidAddress = 7,

    /// [`harvest`] was called when `total_shares == 0`.
    ///
    /// Injecting yield into a vault with no shareholders has no effect and is
    /// likely a caller error.
    ///
    /// [`harvest`]: crate::AuraVault::harvest
    ZeroShares = 8,

    /// A caller attempted an admin-only operation without being the admin.
    ///
    /// Returned by [`pause`], [`unpause`], [`set_fees`], [`set_treasury`],
    /// [`withdraw_fees`], and [`upgrade`] when the supplied address does not
    /// match the stored admin address.
    ///
    /// [`pause`]: crate::AuraVault::pause
    /// [`unpause`]: crate::AuraVault::unpause
    /// [`set_fees`]: crate::AuraVault::set_fees
    /// [`set_treasury`]: crate::AuraVault::set_treasury
    /// [`withdraw_fees`]: crate::AuraVault::withdraw_fees
    /// [`upgrade`]: crate::AuraVault::upgrade
    UpgradeUnauthorized = 9,

    /// The on-chain storage layout version does not match
    /// [`CURRENT_LAYOUT_VERSION`].
    ///
    /// Returned by [`upgrade`] as a safety check before applying a new Wasm
    /// binary. If this error is encountered, the Wasm being deployed expects a
    /// different storage schema than what is currently on-chain. A migration
    /// step is required.
    ///
    /// [`CURRENT_LAYOUT_VERSION`]: crate::storage::CURRENT_LAYOUT_VERSION
    /// [`upgrade`]: crate::AuraVault::upgrade
    StorageLayoutMismatch = 10,

    /// A mutating operation was called while the vault is paused.
    ///
    /// The admin can pause the vault via [`pause`] to halt all deposits,
    /// withdrawals, and harvests in an emergency. Call [`unpause`] to resume.
    ///
    /// Affected functions: [`deposit`], [`withdraw`], [`harvest`],
    /// [`harvest_token`].
    ///
    /// [`pause`]: crate::AuraVault::pause
    /// [`unpause`]: crate::AuraVault::unpause
    /// [`deposit`]: crate::AuraVault::deposit
    /// [`withdraw`]: crate::AuraVault::withdraw
    /// [`harvest`]: crate::AuraVault::harvest
    /// [`harvest_token`]: crate::AuraVault::harvest_token
    VaultPaused = 11,

    /// The vault's actual on-chain token balance differs from the internally
    /// tracked `total_deposited` value.
    ///
    /// This is the **flash-loan guard**. Before every mutating operation the
    /// contract checks:
    ///
    /// ```text
    /// token.balance(contract_address) == total_deposited
    /// ```
    ///
    /// Any discrepancy (e.g. from a direct token transfer intended to
    /// manipulate the share price) causes this error and emits a `suspicious`
    /// event with the observed vs. tracked amounts.
    BalanceMismatch = 12,
}
