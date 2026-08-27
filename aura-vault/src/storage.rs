use soroban_sdk::{contracttype, Address, Env};

#[contracttype]
pub enum DataKey {
    Admin,
    UnderlyingToken,
    TotalShares,
    TotalDeposited,
    Balance(Address),
    Version,
    LayoutVersion,
    /// Emergency pause flag — when true, deposit/withdraw/harvest are blocked.
    Paused,
    // Fee system
    Treasury,
    PerfFeeBps,
    MgmtFeeBps,
    TotalFeeCollected,
    LastMgmtFeeTime,
    // #359 — on-chain accrued fees (claimable, excluded from total_assets)
    AccruedFees,
    // #358 — TVL cap (0 = unlimited)
    TvlCap,
    // #361 — KYC / deposit allowlist
    KycVerifier,
    KycEnabled,
    KycApproval(Address),
    // #360 — pause countdown / scheduled unpause
    PauseExpiresAt,
}

pub const DAY_IN_LEDGERS: u32 = 17_280;
pub const INSTANCE_LIFETIME_THRESHOLD: u32 = DAY_IN_LEDGERS * 7;
pub const INSTANCE_BUMP_AMOUNT: u32 = DAY_IN_LEDGERS * 30;
pub const PERSISTENT_LIFETIME_THRESHOLD: u32 = DAY_IN_LEDGERS * 7;
pub const PERSISTENT_BUMP_AMOUNT: u32 = DAY_IN_LEDGERS * 30;

// ---------------------------------------------------------------------------
// Instance-storage helpers
// ---------------------------------------------------------------------------

pub fn get_admin(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::Admin)
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

pub fn get_token(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::UnderlyingToken)
}

pub fn set_token(env: &Env, token: &Address) {
    env.storage().instance().set(&DataKey::UnderlyingToken, token);
}

pub fn get_total_shares(env: &Env) -> i128 {
    env.storage().instance().get(&DataKey::TotalShares).unwrap_or(0)
}

pub fn set_total_shares(env: &Env, val: i128) {
    env.storage().instance().set(&DataKey::TotalShares, &val);
}

pub fn get_total_deposited(env: &Env) -> i128 {
    env.storage().instance().get(&DataKey::TotalDeposited).unwrap_or(0)
}

pub fn set_total_deposited(env: &Env, val: i128) {
    env.storage().instance().set(&DataKey::TotalDeposited, &val);
}

// ---------------------------------------------------------------------------
// Persistent-storage helpers
// ---------------------------------------------------------------------------

pub fn get_balance(env: &Env, addr: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::Balance(addr.clone()))
        .unwrap_or(0)
}

pub fn set_balance(env: &Env, addr: &Address, val: i128) {
    env.storage()
        .persistent()
        .set(&DataKey::Balance(addr.clone()), &val);
}

// ---------------------------------------------------------------------------
// Fee storage helpers (instance storage)
// ---------------------------------------------------------------------------

pub fn get_treasury(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::Treasury)
}

pub fn set_treasury(env: &Env, treasury: &Address) {
    env.storage().instance().set(&DataKey::Treasury, treasury);
}

pub fn get_perf_fee_bps(env: &Env) -> u32 {
    env.storage().instance().get(&DataKey::PerfFeeBps).unwrap_or(1000)
}

pub fn set_perf_fee_bps(env: &Env, bps: u32) {
    env.storage().instance().set(&DataKey::PerfFeeBps, &bps);
}

pub fn get_mgmt_fee_bps(env: &Env) -> u32 {
    env.storage().instance().get(&DataKey::MgmtFeeBps).unwrap_or(0)
}

pub fn set_mgmt_fee_bps(env: &Env, bps: u32) {
    env.storage().instance().set(&DataKey::MgmtFeeBps, &bps);
}

pub fn get_total_fee_collected(env: &Env) -> i128 {
    env.storage().instance().get(&DataKey::TotalFeeCollected).unwrap_or(0)
}

pub fn set_total_fee_collected(env: &Env, val: i128) {
    env.storage().instance().set(&DataKey::TotalFeeCollected, &val);
}

pub fn get_last_mgmt_fee_time(env: &Env) -> u64 {
    env.storage().instance().get(&DataKey::LastMgmtFeeTime).unwrap_or(0)
}

pub fn set_last_mgmt_fee_time(env: &Env, time: u64) {
    env.storage().instance().set(&DataKey::LastMgmtFeeTime, &time);
}

// ---------------------------------------------------------------------------
// #359 — Accrued fees helpers (instance storage)
// ---------------------------------------------------------------------------

pub fn get_accrued_fees(env: &Env) -> i128 {
    env.storage().instance().get(&DataKey::AccruedFees).unwrap_or(0)
}

pub fn set_accrued_fees(env: &Env, val: i128) {
    env.storage().instance().set(&DataKey::AccruedFees, &val);
}

// ---------------------------------------------------------------------------
// #358 — TVL cap helpers (instance storage)
// ---------------------------------------------------------------------------

/// Returns the TVL cap. 0 means unlimited.
pub fn get_tvl_cap(env: &Env) -> i128 {
    env.storage().instance().get(&DataKey::TvlCap).unwrap_or(0)
}

pub fn set_tvl_cap(env: &Env, cap: i128) {
    env.storage().instance().set(&DataKey::TvlCap, &cap);
}

// ---------------------------------------------------------------------------
// #361 — KYC / allowlist helpers
// ---------------------------------------------------------------------------

pub fn get_kyc_verifier(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::KycVerifier)
}

pub fn set_kyc_verifier(env: &Env, verifier: &Address) {
    env.storage().instance().set(&DataKey::KycVerifier, verifier);
}

pub fn is_kyc_enabled(env: &Env) -> bool {
    env.storage().instance().get(&DataKey::KycEnabled).unwrap_or(false)
}

pub fn set_kyc_enabled(env: &Env, enabled: bool) {
    env.storage().instance().set(&DataKey::KycEnabled, &enabled);
}

/// Returns the expiry timestamp (seconds since epoch) for the given address,
/// or `None` if no approval record exists.
pub fn get_kyc_approval(env: &Env, addr: &Address) -> Option<u64> {
    env.storage()
        .persistent()
        .get(&DataKey::KycApproval(addr.clone()))
}

pub fn set_kyc_approval(env: &Env, addr: &Address, expiry: u64) {
    env.storage()
        .persistent()
        .set(&DataKey::KycApproval(addr.clone()), &expiry);
}

pub fn remove_kyc_approval(env: &Env, addr: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::KycApproval(addr.clone()));
}

pub fn bump_kyc_approval(env: &Env, addr: &Address) {
    if env
        .storage()
        .persistent()
        .has(&DataKey::KycApproval(addr.clone()))
    {
        env.storage().persistent().extend_ttl(
            &DataKey::KycApproval(addr.clone()),
            PERSISTENT_LIFETIME_THRESHOLD,
            PERSISTENT_BUMP_AMOUNT,
        );
    }
}

// ---------------------------------------------------------------------------
// #360 — Pause countdown helpers (instance storage)
// ---------------------------------------------------------------------------

/// Returns `Some(timestamp)` if there is a scheduled unpause, `None` otherwise.
pub fn get_pause_expires_at(env: &Env) -> Option<u64> {
    env.storage().instance().get(&DataKey::PauseExpiresAt)
}

pub fn set_pause_expires_at(env: &Env, ts: u64) {
    env.storage().instance().set(&DataKey::PauseExpiresAt, &ts);
}

pub fn clear_pause_expires_at(env: &Env) {
    env.storage().instance().remove(&DataKey::PauseExpiresAt);
}

// ---------------------------------------------------------------------------
// TTL bump helpers
// ---------------------------------------------------------------------------

pub fn bump_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
}

pub fn bump_persistent(env: &Env, addr: &Address) {
    env.storage()
        .persistent()
        .extend_ttl(
            &DataKey::Balance(addr.clone()),
            PERSISTENT_LIFETIME_THRESHOLD,
            PERSISTENT_BUMP_AMOUNT,
        );
}

// ---------------------------------------------------------------------------
// Version helpers (instance storage — same TTL as the rest of state)
// ---------------------------------------------------------------------------

/// Current storage layout constant. Bump this in source whenever a new
/// DataKey variant changes an existing key's meaning.
pub const CURRENT_LAYOUT_VERSION: u32 = 1;

pub fn get_version(env: &Env) -> u32 {
    env.storage().instance().get(&DataKey::Version).unwrap_or(0)
}

pub fn set_version(env: &Env, v: u32) {
    env.storage().instance().set(&DataKey::Version, &v);
}

pub fn get_layout_version(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::LayoutVersion)
        .unwrap_or(0)
}

pub fn set_layout_version(env: &Env, v: u32) {
    env.storage().instance().set(&DataKey::LayoutVersion, &v);
}

// ---------------------------------------------------------------------------
// Pause helpers (instance storage)
// ---------------------------------------------------------------------------

pub fn is_paused(env: &Env) -> bool {
    env.storage().instance().get(&DataKey::Paused).unwrap_or(false)
}

pub fn set_paused(env: &Env, paused: bool) {
    env.storage().instance().set(&DataKey::Paused, &paused);
}
