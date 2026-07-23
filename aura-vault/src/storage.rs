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
    Treasury,
    PerfFeeBps,
    MgmtFeeBps,
    TotalFeeCollected,
    LastMgmtFeeTime,
    /// Whitelisted alternative yield tokens (Issue #48)
    YieldToken(Address),
    /// Monotonically increasing distribution epoch counter.
    DistributionEpoch,
    /// Cumulative yield-per-share (in underlying token stroops) scaled by
    /// YIELD_PRECISION, updated on each distribution. Using a global
    /// accumulator avoids per-user O(n) writes and keeps gas bounded.
    CumulativeYieldPerShare,
    /// The last cumulative-yield-per-share snapshot at which `addr` settled.
    /// Stored in persistent storage so it survives archival bumps.
    UserYieldCheckpoint(Address),
    /// Accrued but uncollected yield for `addr` (underlying token stroops).
    UserPendingYield(Address),
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
// Yield-token whitelist helpers (instance storage — Issue #48)
// ---------------------------------------------------------------------------

pub fn is_yield_token(env: &Env, token: &Address) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::YieldToken(token.clone()))
        .unwrap_or(false)
}

pub fn set_yield_token(env: &Env, token: &Address, enabled: bool) {
    env.storage()
        .instance()
        .set(&DataKey::YieldToken(token.clone()), &enabled);
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

// ---------------------------------------------------------------------------
// Yield-distribution helpers (instance + persistent storage)
//
// Design: global accumulator pattern (a.k.a. "dividends per share" or
// "reward-debt" pattern from Sushi/Compound).  No per-user O(n) writes.
//
//   cumulative_yps  += net_yield * YIELD_PRECISION / total_shares
//   user_pending    += user_shares * (cumulative_yps - user_checkpoint) / YIELD_PRECISION
//   user_checkpoint  = cumulative_yps
//
// YIELD_PRECISION = 1_000_000_000_000 (1e12) gives 12 significant digits of
// sub-share precision while staying safely inside i128 range:
//   max(cumulative_yps) = i128::MAX / total_shares
//   For total_shares = 1 (worst case), headroom is ~1.7e38 / 1e12 ≈ 1.7e26
//   years of continuous yield — effectively unbounded for any realistic vault.
// ---------------------------------------------------------------------------

/// Fixed-point precision multiplier for cumulative-yield-per-share.
pub const YIELD_PRECISION: i128 = 1_000_000_000_000; // 1e12

pub fn get_distribution_epoch(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::DistributionEpoch)
        .unwrap_or(0)
}

pub fn set_distribution_epoch(env: &Env, epoch: u64) {
    env.storage()
        .instance()
        .set(&DataKey::DistributionEpoch, &epoch);
}

/// Global cumulative yield-per-share (scaled by YIELD_PRECISION).
pub fn get_cumulative_yps(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::CumulativeYieldPerShare)
        .unwrap_or(0)
}

pub fn set_cumulative_yps(env: &Env, val: i128) {
    env.storage()
        .instance()
        .set(&DataKey::CumulativeYieldPerShare, &val);
}

/// The cumulative-yps value at which `addr` last settled their yield.
pub fn get_user_checkpoint(env: &Env, addr: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::UserYieldCheckpoint(addr.clone()))
        .unwrap_or(0)
}

pub fn set_user_checkpoint(env: &Env, addr: &Address, val: i128) {
    env.storage()
        .persistent()
        .set(&DataKey::UserYieldCheckpoint(addr.clone()), &val);
}

/// Bump TTL for user yield checkpoint & pending yield records.
pub fn bump_user_yield(env: &Env, addr: &Address) {
    let key_cp = DataKey::UserYieldCheckpoint(addr.clone());
    let key_py = DataKey::UserPendingYield(addr.clone());
    if env.storage().persistent().has(&key_cp) {
        env.storage().persistent().extend_ttl(
            &key_cp,
            PERSISTENT_LIFETIME_THRESHOLD,
            PERSISTENT_BUMP_AMOUNT,
        );
    }
    if env.storage().persistent().has(&key_py) {
        env.storage().persistent().extend_ttl(
            &key_py,
            PERSISTENT_LIFETIME_THRESHOLD,
            PERSISTENT_BUMP_AMOUNT,
        );
    }
}

/// Accrued but uncollected yield for `addr` (underlying token stroops).
pub fn get_user_pending_yield(env: &Env, addr: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::UserPendingYield(addr.clone()))
        .unwrap_or(0)
}

pub fn set_user_pending_yield(env: &Env, addr: &Address, val: i128) {
    env.storage()
        .persistent()
        .set(&DataKey::UserPendingYield(addr.clone()), &val);
}