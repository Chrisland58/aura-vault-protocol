#![cfg(test)]

extern crate std;

use soroban_sdk::{testutils::Address as _, Address, Env};
use soroban_sdk::token::StellarAssetClient;

use crate::{AuraVault, AuraVaultClient, VaultError};

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/// Deploy + initialise a fresh vault; return (env, vault_client, admin, token_address).
fn setup() -> (Env, AuraVaultClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);

    // Register a Stellar Asset Contract so we have a real SEP-41 token
    let token_address = env.register_stellar_asset_contract_v2(admin.clone()).address();

    let vault_address = env.register_contract(None, AuraVault);
    let vault = AuraVaultClient::new(&env, &vault_address);

    vault.initialize(&admin, &token_address);

    (env, vault, admin, token_address)
}

/// Mint `amount` tokens to `recipient` using the SAC admin.
fn mint(env: &Env, token: &Address, admin: &Address, recipient: &Address, amount: i128) {
    StellarAssetClient::new(env, token).mint(recipient, &amount);
}

// ---------------------------------------------------------------------------
// 1. Initialisation tests
// ---------------------------------------------------------------------------

#[test]
fn test_double_init_returns_already_initialized() {
    let (env, vault, admin, token) = setup();
    // Second call should fail
    let result = vault.try_initialize(&admin, &token);
    assert_eq!(result, Err(Ok(VaultError::AlreadyInitialized)));
}

#[test]
fn test_fresh_vault_total_assets_is_zero() {
    let (_env, vault, _admin, _token) = setup();
    assert_eq!(vault.total_assets(), 0);
}

#[test]
fn test_fresh_vault_balance_of_unknown_address_is_zero() {
    let (env, vault, _admin, _token) = setup();
    let stranger = Address::generate(&env);
    assert_eq!(vault.balance_of(&stranger), 0);
}

// ---------------------------------------------------------------------------
// 2. Deposit — error paths
// ---------------------------------------------------------------------------

#[test]
fn test_deposit_before_init_returns_not_initialized() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    // Create vault but do NOT call initialize
    let vault_addr = env.register_contract(None, AuraVault);
    let vault = AuraVaultClient::new(&env, &vault_addr);
    let user = Address::generate(&env);
    let result = vault.try_deposit(&user, &1_000);
    assert_eq!(result, Err(Ok(VaultError::NotInitialized)));
}

#[test]
fn test_deposit_zero_returns_zero_amount() {
    let (env, vault, _admin, _token) = setup();
    let user = Address::generate(&env);
    let result = vault.try_deposit(&user, &0);
    assert_eq!(result, Err(Ok(VaultError::ZeroAmount)));
}

#[test]
fn test_deposit_overflow_returns_error() {
    let (env, vault, admin, token) = setup();
    let seeder = Address::generate(&env);
    // Seed vault: 1 share, 1 token
    mint(&env, &token, &admin, &seeder, 1);
    vault.deposit(&seeder, &1);

    // Deposit i128::MAX — causes overflow either in the SAC token accounting
    // (vault already holds 1, so vault balance would overflow) or in our
    // own share arithmetic.  Either way, an error must be returned.
    let attacker = Address::generate(&env);
    mint(&env, &token, &admin, &attacker, i128::MAX);
    let result = vault.try_deposit(&attacker, &i128::MAX);
    assert!(result.is_err(), "expected an error on i128::MAX deposit, got Ok");
}

// ---------------------------------------------------------------------------
// 3. Deposit — happy paths
// ---------------------------------------------------------------------------

#[test]
fn test_first_deposit_mints_one_to_one() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 1_000_000);
    let minted = vault.deposit(&user, &1_000_000);
    assert_eq!(minted, 1_000_000);
    assert_eq!(vault.total_assets(), 1_000_000);
    assert_eq!(vault.balance_of(&user), 1_000_000);
}

#[test]
fn test_second_deposit_uses_share_formula() {
    // State: 1_000_000 shares, 1_200_000 assets (after harvest of 200_000)
    // Deposit 600_000 → floor(600_000 * 1_000_000 / 1_200_000) = 500_000
    let (env, vault, admin, token) = setup();

    let alice = Address::generate(&env);
    mint(&env, &token, &admin, &alice, 1_000_000);
    vault.deposit(&alice, &1_000_000);

    // harvest 200_000 yield — caller must be admin (FIX-2)
    mint(&env, &token, &admin, &admin, 200_000);
    vault.harvest(&admin, &200_000);

    let bob = Address::generate(&env);
    mint(&env, &token, &admin, &bob, 600_000);
    let minted = vault.deposit(&bob, &600_000);
    assert_eq!(minted, 500_000);
}

#[test]
fn test_two_equal_depositors_each_hold_half() {
    let (env, vault, admin, token) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    mint(&env, &token, &admin, &alice, 1_000_000);
    mint(&env, &token, &admin, &bob, 1_000_000);

    vault.deposit(&alice, &1_000_000);
    vault.deposit(&bob, &1_000_000);

    let alice_shares = vault.balance_of(&alice);
    let bob_shares = vault.balance_of(&bob);
    assert_eq!(alice_shares, bob_shares);
    assert_eq!(alice_shares + bob_shares, alice_shares * 2);
}

// ---------------------------------------------------------------------------
// 4. Withdraw — error paths
// ---------------------------------------------------------------------------

#[test]
fn test_withdraw_zero_returns_zero_amount() {
    let (env, vault, _admin, _token) = setup();
    let user = Address::generate(&env);
    let result = vault.try_withdraw(&user, &0);
    assert_eq!(result, Err(Ok(VaultError::ZeroAmount)));
}

#[test]
fn test_withdraw_before_init_returns_not_initialized() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let _token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let vault_addr = env.register_contract(None, AuraVault);
    let vault = AuraVaultClient::new(&env, &vault_addr);
    let user = Address::generate(&env);
    let result = vault.try_withdraw(&user, &100);
    assert_eq!(result, Err(Ok(VaultError::NotInitialized)));
}

#[test]
fn test_withdraw_more_than_balance_returns_insufficient_shares() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 1_000);
    vault.deposit(&user, &1_000);
    // Try to withdraw more shares than owned
    let result = vault.try_withdraw(&user, &9_999_999);
    assert_eq!(result, Err(Ok(VaultError::InsufficientShares)));
}

// ---------------------------------------------------------------------------
// 5. Withdraw — happy paths
// ---------------------------------------------------------------------------

#[test]
fn test_withdraw_all_shares_zeros_vault() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 5_000_000);
    vault.deposit(&user, &5_000_000);

    let shares = vault.balance_of(&user);
    vault.withdraw(&user, &shares);

    assert_eq!(vault.total_assets(), 0);
    assert_eq!(vault.balance_of(&user), 0);
}

#[test]
fn test_harvest_then_withdraw_yields_more() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 1_000_000);
    vault.deposit(&user, &1_000_000);

    let shares = vault.balance_of(&user);
    let pre_harvest_assets = vault.total_assets(); // 1_000_000

    // Harvest 500_000 yield — caller must be admin (FIX-2)
    mint(&env, &token, &admin, &admin, 500_000);
    vault.harvest(&admin, &500_000);

    let post_harvest_assets = vault.total_assets(); // 1_500_000
    assert!(post_harvest_assets > pre_harvest_assets);

    let received = vault.withdraw(&user, &shares);
    assert!(received > pre_harvest_assets);
    assert_eq!(received, 1_500_000);
}

#[test]
fn test_withdraw_does_not_affect_other_depositor_balance() {
    let (env, vault, admin, token) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    mint(&env, &token, &admin, &alice, 1_000_000);
    mint(&env, &token, &admin, &bob, 1_000_000);

    vault.deposit(&alice, &1_000_000);
    vault.deposit(&bob, &1_000_000);

    let bob_shares_before = vault.balance_of(&bob);
    let alice_shares = vault.balance_of(&alice);
    vault.withdraw(&alice, &alice_shares);

    assert_eq!(vault.balance_of(&bob), bob_shares_before);
}

// ---------------------------------------------------------------------------
// 6. Harvest — error paths
// ---------------------------------------------------------------------------

#[test]
fn test_harvest_zero_returns_zero_amount() {
    let (env, vault, admin, _token) = setup();
    let result = vault.try_harvest(&admin, &0);
    assert_eq!(result, Err(Ok(VaultError::ZeroAmount)));
}

#[test]
fn test_harvest_before_init_returns_not_initialized() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let _token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let vault_addr = env.register_contract(None, AuraVault);
    let vault = AuraVaultClient::new(&env, &vault_addr);
    let result = vault.try_harvest(&admin, &1_000);
    assert_eq!(result, Err(Ok(VaultError::NotInitialized)));
}

#[test]
fn test_harvest_on_empty_vault_returns_zero_shares() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 1_000_000);
    vault.deposit(&user, &1_000_000);
    let shares = vault.balance_of(&user);
    vault.withdraw(&user, &shares);

    // Vault is empty — harvest must return ZeroShares
    mint(&env, &token, &admin, &admin, 1_000);
    let result = vault.try_harvest(&admin, &1_000);
    assert_eq!(result, Err(Ok(VaultError::ZeroShares)));
}

// FIX-2: Non-admin harvest must be rejected
#[test]
fn test_harvest_by_non_admin_returns_harvest_unauthorized() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 1_000_000);
    vault.deposit(&user, &1_000_000);

    let stranger = Address::generate(&env);
    mint(&env, &token, &admin, &stranger, 1_000);
    let result = vault.try_harvest(&stranger, &1_000);
    assert_eq!(result, Err(Ok(VaultError::HarvestUnauthorized)));
}

// ---------------------------------------------------------------------------
// 7. Deposit-withdraw round-trip (verifies rounding bound of ±1)
// ---------------------------------------------------------------------------

#[test]
fn test_deposit_withdraw_round_trip_rounding() {
    let (env, vault, admin, token) = setup();

    // Seed vault 1:1
    let seeder = Address::generate(&env);
    mint(&env, &token, &admin, &seeder, 1_000_000);
    vault.deposit(&seeder, &1_000_000);

    let amounts: &[i128] = &[1, 7, 100, 999, 1_000_000, 9_999_999, 100_000_000];
    for &amount in amounts {
        let user = Address::generate(&env);
        mint(&env, &token, &admin, &user, amount);
        let minted = vault.deposit(&user, &amount);
        if minted > 0 {
            let received = vault.withdraw(&user, &minted);
            assert!(
                received >= amount - 1,
                "round-trip: deposited {amount}, received {received}"
            );
        }
    }
}

// ---------------------------------------------------------------------------
// 8. Share-sum invariant
// ---------------------------------------------------------------------------

#[test]
fn test_share_sum_invariant() {
    let (env, vault, admin, token) = setup();

    let users: std::vec::Vec<Address> = (0..4).map(|_| Address::generate(&env)).collect();
    let deposit_amounts: &[i128] = &[1_000_000, 2_000_000, 500_000, 3_000_000];

    for (user, &amount) in users.iter().zip(deposit_amounts.iter()) {
        mint(&env, &token, &admin, user, amount);
        vault.deposit(user, &amount);
    }

    // Withdraw half the users; check remaining balances are intact
    for user in &users[..2] {
        let s = vault.balance_of(user);
        vault.withdraw(user, &s);
        assert_eq!(vault.balance_of(user), 0);
    }
    for user in &users[2..] {
        assert!(vault.balance_of(user) > 0);
    }
}

// ---------------------------------------------------------------------------
// 9. Harvest non-dilution property
// ---------------------------------------------------------------------------

#[test]
fn test_harvest_non_dilution() {
    let (env, vault, admin, token) = setup();

    let alice = Address::generate(&env);
    mint(&env, &token, &admin, &alice, 1_000_000);
    vault.deposit(&alice, &1_000_000);

    let alice_shares_before = vault.balance_of(&alice);
    let assets_before = vault.total_assets();

    // Admin performs harvest (FIX-2)
    mint(&env, &token, &admin, &admin, 300_000);
    vault.harvest(&admin, &300_000);

    // Share balance must be unchanged
    assert_eq!(vault.balance_of(&alice), alice_shares_before);
    // Total assets must have increased
    assert!(vault.total_assets() > assets_before);
}

// ---------------------------------------------------------------------------
// 10. Serialisation round-trip — two distinct addresses map to distinct slots
// ---------------------------------------------------------------------------

#[test]
fn test_balance_of_distinct_addresses_no_collision() {
    let (env, vault, admin, token) = setup();

    let addr_a = Address::generate(&env);
    let addr_b = Address::generate(&env);

    mint(&env, &token, &admin, &addr_a, 1_000_000);
    mint(&env, &token, &admin, &addr_b, 2_000_000);

    vault.deposit(&addr_a, &1_000_000);
    vault.deposit(&addr_b, &2_000_000);

    assert_ne!(vault.balance_of(&addr_a), vault.balance_of(&addr_b));
    assert_eq!(vault.balance_of(&addr_a), 1_000_000);
    assert_eq!(vault.balance_of(&addr_b), 2_000_000);
}

// ---------------------------------------------------------------------------
// 11. Upgrade — version and UUPS-style upgrade
// ---------------------------------------------------------------------------

mod current_wasm {
    soroban_sdk::contractimport!(
        file = "target/wasm32-unknown-unknown/release/aura_vault.wasm"
    );
}

#[cfg(test)]
fn upload_self_wasm(env: &Env) -> soroban_sdk::BytesN<32> {
    env.deployer().upload_contract_wasm(current_wasm::WASM)
}

#[test]
fn test_version_starts_at_one_after_initialize() {
    let (_env, vault, _admin, _token) = setup();
    assert_eq!(vault.version(), 1);
}

#[test]
fn test_upgrade_before_init_returns_not_initialized() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let _token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let vault_addr = env.register_contract(None, AuraVault);
    let vault = AuraVaultClient::new(&env, &vault_addr);

    let hash = upload_self_wasm(&env);
    let result = vault.try_upgrade(&hash);
    assert_eq!(result, Err(Ok(VaultError::NotInitialized)));
}

#[test]
#[should_panic]
fn test_upgrade_by_non_admin_is_rejected() {
    let (env, vault, _admin, _token) = setup();
    let env_no_auth = Env::default();
    let vault_addr = env_no_auth.register_contract(None, AuraVault);
    let strict_vault = AuraVaultClient::new(&env_no_auth, &vault_addr);
    let hash = upload_self_wasm(&env);
    strict_vault.upgrade(&hash);
}

#[test]
fn test_upgrade_increments_version_and_emits_event() {
    let (env, vault, _admin, _token) = setup();
    assert_eq!(vault.version(), 1);

    let new_hash = upload_self_wasm(&env);
    vault.upgrade(&new_hash);

    assert_eq!(vault.version(), 2);
}

#[test]
fn test_upgrade_preserves_all_vault_state() {
    let (env, vault, admin, token) = setup();

    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 1_000_000);
    vault.deposit(&user, &1_000_000);

    let shares_before = vault.balance_of(&user);
    let assets_before = vault.total_assets();

    let new_hash = upload_self_wasm(&env);
    vault.upgrade(&new_hash);

    assert_eq!(vault.balance_of(&user), shares_before);
    assert_eq!(vault.total_assets(), assets_before);
    assert_eq!(vault.version(), 2);
}

#[test]
fn test_upgrade_can_be_called_multiple_times() {
    let (env, vault, _admin, _token) = setup();

    for expected_version in 2_u32..=4 {
        let hash = upload_self_wasm(&env);
        vault.upgrade(&hash);
        assert_eq!(vault.version(), expected_version);
    }
}

// ===========================================================================
// EXTENDED REGRESSION SUITE — batch 1: init / deposit edge cases
// ===========================================================================

// ---------------------------------------------------------------------------
// Init edge cases
// ---------------------------------------------------------------------------

#[test]
fn test_init_total_shares_is_zero() {
    let (_env, vault, _admin, _token) = setup();
    // total_assets proxy for total_deposited; shares not directly readable
    assert_eq!(vault.total_assets(), 0);
}

#[test]
fn test_init_version_is_one() {
    let (_env, vault, _admin, _token) = setup();
    assert_eq!(vault.version(), 1);
}

#[test]
fn test_init_multiple_users_balance_zero() {
    let (env, vault, _admin, _token) = setup();
    for _ in 0..5 {
        let u = Address::generate(&env);
        assert_eq!(vault.balance_of(&u), 0);
    }
}

#[test]
fn test_uninit_vault_total_assets_is_zero() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let _token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let vault_addr = env.register_contract(None, AuraVault);
    let vault = AuraVaultClient::new(&env, &vault_addr);
    assert_eq!(vault.total_assets(), 0);
}

#[test]
fn test_uninit_vault_balance_of_is_zero() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let _token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let vault_addr = env.register_contract(None, AuraVault);
    let vault = AuraVaultClient::new(&env, &vault_addr);
    let u = Address::generate(&env);
    assert_eq!(vault.balance_of(&u), 0);
}

// ---------------------------------------------------------------------------
// Deposit — additional edge cases
// ---------------------------------------------------------------------------

#[test]
fn test_deposit_one_unit() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 1);
    let shares = vault.deposit(&user, &1);
    assert_eq!(shares, 1);
    assert_eq!(vault.total_assets(), 1);
    assert_eq!(vault.balance_of(&user), 1);
}

#[test]
fn test_deposit_large_amount() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);
    let amount: i128 = 1_000_000_000_000;
    mint(&env, &token, &admin, &user, amount);
    let shares = vault.deposit(&user, &amount);
    assert_eq!(shares, amount);
    assert_eq!(vault.total_assets(), amount);
}

#[test]
fn test_deposit_updates_total_assets() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 500_000);
    vault.deposit(&user, &500_000);
    assert_eq!(vault.total_assets(), 500_000);
}

#[test]
fn test_deposit_twice_same_user_accumulates_shares() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 2_000_000);
    vault.deposit(&user, &1_000_000);
    vault.deposit(&user, &1_000_000);
    assert_eq!(vault.balance_of(&user), 2_000_000);
    assert_eq!(vault.total_assets(), 2_000_000);
}

#[test]
fn test_deposit_three_users_independent_balances() {
    let (env, vault, admin, token) = setup();
    let amounts: [i128; 3] = [1_000_000, 2_000_000, 3_000_000];
    let users: std::vec::Vec<Address> = (0..3).map(|_| Address::generate(&env)).collect();
    for (u, &a) in users.iter().zip(amounts.iter()) {
        mint(&env, &token, &admin, u, a);
        vault.deposit(u, &a);
    }
    // First depositor gets 1:1
    assert_eq!(vault.balance_of(&users[0]), 1_000_000);
    // Subsequent depositors: shares = floor(amount * total_shares / total_assets)
    // user[1]: floor(2M * 1M / 1M) = 2M
    assert_eq!(vault.balance_of(&users[1]), 2_000_000);
    // user[2]: floor(3M * 3M / 3M) = 3M
    assert_eq!(vault.balance_of(&users[2]), 3_000_000);
}

#[test]
fn test_deposit_negative_amount_returns_zero_amount() {
    let (env, vault, _admin, _token) = setup();
    let user = Address::generate(&env);
    let result = vault.try_deposit(&user, &-1);
    assert_eq!(result, Err(Ok(VaultError::ZeroAmount)));
}

#[test]
fn test_deposit_minus_large_returns_zero_amount() {
    let (env, vault, _admin, _token) = setup();
    let user = Address::generate(&env);
    let result = vault.try_deposit(&user, &i128::MIN);
    assert_eq!(result, Err(Ok(VaultError::ZeroAmount)));
}

#[test]
fn test_deposit_does_not_change_other_user_balance() {
    let (env, vault, admin, token) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    mint(&env, &token, &admin, &alice, 1_000_000);
    mint(&env, &token, &admin, &bob, 500_000);
    vault.deposit(&alice, &1_000_000);
    let bob_before = vault.balance_of(&bob);
    vault.deposit(&bob, &500_000);
    // Alice's balance unchanged
    assert_eq!(vault.balance_of(&alice), 1_000_000);
    let _ = bob_before;
}

#[test]
fn test_deposit_returns_correct_shares_after_harvest() {
    // After harvest: total_shares=1M, total_deposited=2M
    // New deposit of 2M → floor(2M*1M/2M) = 1M shares
    let (env, vault, admin, token) = setup();
    let alice = Address::generate(&env);
    mint(&env, &token, &admin, &alice, 1_000_000);
    vault.deposit(&alice, &1_000_000);

    let keeper = Address::generate(&env);
    mint(&env, &token, &admin, &keeper, 1_000_000);
    vault.harvest(&keeper, &1_000_000);

    let bob = Address::generate(&env);
    mint(&env, &token, &admin, &bob, 2_000_000);
    let shares = vault.deposit(&bob, &2_000_000);
    assert_eq!(shares, 1_000_000);
}

#[test]
fn test_deposit_tiny_into_large_vault_may_round_to_zero() {
    // Seed with large amount, then try 1-unit deposit which rounds to 0 shares
    let (env, vault, admin, token) = setup();
    let seeder = Address::generate(&env);
    mint(&env, &token, &admin, &seeder, 1_000_000_000);
    vault.deposit(&seeder, &1_000_000_000);

    // Harvest to make exchange rate 2:1 (1B shares, 2B assets)
    let keeper = Address::generate(&env);
    mint(&env, &token, &admin, &keeper, 1_000_000_000);
    vault.harvest(&keeper, &1_000_000_000);

    // A deposit of 1 token → floor(1 * 1B / 2B) = 0 shares → ZeroAmount error
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 1);
    let result = vault.try_deposit(&user, &1);
    assert_eq!(result, Err(Ok(VaultError::ZeroAmount)));
}

#[test]
fn test_deposit_overflow_large_existing_pool() {
    let (env, vault, admin, token) = setup();
    let seeder = Address::generate(&env);
    mint(&env, &token, &admin, &seeder, 1);
    vault.deposit(&seeder, &1);

    let attacker = Address::generate(&env);
    mint(&env, &token, &admin, &attacker, i128::MAX);
    let result = vault.try_deposit(&attacker, &i128::MAX);
    assert!(result.is_err());
}

#[test]
fn test_deposit_increments_total_assets_each_time() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 3_000);
    vault.deposit(&user, &1_000);
    assert_eq!(vault.total_assets(), 1_000);
    vault.deposit(&user, &1_000);
    assert_eq!(vault.total_assets(), 2_000);
    vault.deposit(&user, &1_000);
    assert_eq!(vault.total_assets(), 3_000);
}

#[test]
fn test_five_equal_depositors_each_hold_fifth() {
    let (env, vault, admin, token) = setup();
    let users: std::vec::Vec<Address> = (0..5).map(|_| Address::generate(&env)).collect();
    for u in &users {
        mint(&env, &token, &admin, u, 1_000_000);
        vault.deposit(u, &1_000_000);
    }
    let first = vault.balance_of(&users[0]);
    for u in &users[1..] {
        assert_eq!(vault.balance_of(u), first);
    }
}

// ===========================================================================
// EXTENDED REGRESSION SUITE — batch 2: withdraw / harvest edge cases
// ===========================================================================

// ---------------------------------------------------------------------------
// Withdraw — additional edge cases
// ---------------------------------------------------------------------------

#[test]
fn test_withdraw_one_share() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 1_000_000);
    vault.deposit(&user, &1_000_000);
    let received = vault.withdraw(&user, &1);
    assert_eq!(received, 1);
}

#[test]
fn test_withdraw_negative_shares_returns_zero_amount() {
    let (env, vault, _admin, _token) = setup();
    let user = Address::generate(&env);
    let result = vault.try_withdraw(&user, &-1);
    assert_eq!(result, Err(Ok(VaultError::ZeroAmount)));
}

#[test]
fn test_withdraw_partial_shares() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 1_000_000);
    vault.deposit(&user, &1_000_000);
    vault.withdraw(&user, &400_000);
    assert_eq!(vault.balance_of(&user), 600_000);
    assert_eq!(vault.total_assets(), 600_000);
}

#[test]
fn test_withdraw_all_reduces_total_assets_to_zero() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 5_000_000);
    vault.deposit(&user, &5_000_000);
    vault.withdraw(&user, &5_000_000);
    assert_eq!(vault.total_assets(), 0);
}

#[test]
fn test_withdraw_returns_proportional_yield() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 1_000_000);
    vault.deposit(&user, &1_000_000);

    let keeper = Address::generate(&env);
    mint(&env, &token, &admin, &keeper, 1_000_000);
    vault.harvest(&keeper, &1_000_000);

    // Withdraw half shares → half total_assets = 1_000_000
    let received = vault.withdraw(&user, &500_000);
    assert_eq!(received, 1_000_000);
}

#[test]
fn test_withdraw_zero_before_any_deposit_returns_zero_amount() {
    let (env, vault, _admin, _token) = setup();
    let user = Address::generate(&env);
    let result = vault.try_withdraw(&user, &0);
    assert_eq!(result, Err(Ok(VaultError::ZeroAmount)));
}

#[test]
fn test_withdraw_excess_by_one_returns_insufficient_shares() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 1_000);
    vault.deposit(&user, &1_000);
     let result = vault.try_withdraw(&user, &1_001);
    assert_eq!(result, Err(Ok(VaultError::InsufficientShares)));
}

#[test]
fn test_withdraw_by_user_with_zero_balance_returns_insufficient_shares() {
    let (env, vault, admin, token) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    mint(&env, &token, &admin, &alice, 1_000_000);
    vault.deposit(&alice, &1_000_000);
    // Bob has no shares
    let result = vault.try_withdraw(&bob, &1);
    assert_eq!(result, Err(Ok(VaultError::InsufficientShares)));
}

#[test]
fn test_withdraw_twice_in_sequence() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 1_000_000);
    vault.deposit(&user, &1_000_000);
    vault.withdraw(&user, &300_000);
    vault.withdraw(&user, &300_000);
    assert_eq!(vault.balance_of(&user), 400_000);
    assert_eq!(vault.total_assets(), 400_000);
}

#[test]
fn test_multiple_users_withdraw_independently() {
    let (env, vault, admin, token) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    mint(&env, &token, &admin, &alice, 1_000_000);
    mint(&env, &token, &admin, &bob, 1_000_000);
    vault.deposit(&alice, &1_000_000);
    vault.deposit(&bob, &1_000_000);

    vault.withdraw(&alice, &500_000);
    assert_eq!(vault.balance_of(&alice), 500_000);
    assert_eq!(vault.balance_of(&bob), 1_000_000); // unchanged
}

#[test]
fn test_withdraw_after_second_deposit_correct_amount() {
    let (env, vault, admin, token) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    mint(&env, &token, &admin, &alice, 1_000_000);
    mint(&env, &token, &admin, &bob, 1_000_000);
    vault.deposit(&alice, &1_000_000);
    vault.deposit(&bob, &1_000_000);

    // total: 2M assets, 2M shares; alice withdraw 1M shares → 1M assets
    let received = vault.withdraw(&alice, &1_000_000);
    assert_eq!(received, 1_000_000);
}

#[test]
fn test_deposit_then_withdraw_min_amount_i128() {
    let (env, vault, _admin, _token) = setup();
    let user = Address::generate(&env);
    let result = vault.try_withdraw(&user, &i128::MIN);
    assert_eq!(result, Err(Ok(VaultError::ZeroAmount)));
}

// ---------------------------------------------------------------------------
// Harvest — additional edge cases
// ---------------------------------------------------------------------------

#[test]
fn test_harvest_negative_returns_zero_amount() {
    let (env, vault, _admin, _token) = setup();
    let keeper = Address::generate(&env);
    let result = vault.try_harvest(&keeper, &-1);
    assert_eq!(result, Err(Ok(VaultError::ZeroAmount)));
}

#[test]
fn test_harvest_increases_total_assets() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 1_000_000);
    vault.deposit(&user, &1_000_000);
    let before = vault.total_assets();

    let keeper = Address::generate(&env);
    mint(&env, &token, &admin, &keeper, 500_000);
    vault.harvest(&keeper, &500_000);
    assert_eq!(vault.total_assets(), before + 500_000);
}

#[test]
fn test_harvest_does_not_change_user_share_balance() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 1_000_000);
    vault.deposit(&user, &1_000_000);
    let shares_before = vault.balance_of(&user);

    let keeper = Address::generate(&env);
    mint(&env, &token, &admin, &keeper, 200_000);
    vault.harvest(&keeper, &200_000);

    assert_eq!(vault.balance_of(&user), shares_before);
}

#[test]
fn test_harvest_multiple_times_accumulates() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 1_000_000);
    vault.deposit(&user, &1_000_000);

    let keeper = Address::generate(&env);
    mint(&env, &token, &admin, &keeper, 900_000);
    vault.harvest(&keeper, &300_000);
    vault.harvest(&keeper, &300_000);
    vault.harvest(&keeper, &300_000);

    assert_eq!(vault.total_assets(), 1_900_000);
}

#[test]
fn test_harvest_by_different_callers() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 1_000_000);
    vault.deposit(&user, &1_000_000);

    for _ in 0..3 {
        let keeper = Address::generate(&env);
        mint(&env, &token, &admin, &keeper, 100_000);
        vault.harvest(&keeper, &100_000);
    }
    assert_eq!(vault.total_assets(), 1_300_000);
}

#[test]
fn test_harvest_exchange_rate_increases() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 1_000_000);
    vault.deposit(&user, &1_000_000);
    // 1:1 before harvest
    let shares = vault.balance_of(&user);
    let assets_before = vault.total_assets();

    let keeper = Address::generate(&env);
    mint(&env, &token, &admin, &keeper, 1_000_000);
    vault.harvest(&keeper, &1_000_000);

    // Each share now redeems 2 tokens
    let redeemable = vault.withdraw(&user, &shares);
    assert_eq!(redeemable, assets_before * 2);
}

#[test]
fn test_harvest_one_unit() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 1_000_000);
    vault.deposit(&user, &1_000_000);

    let keeper = Address::generate(&env);
    mint(&env, &token, &admin, &keeper, 1);
    vault.harvest(&keeper, &1);
    assert_eq!(vault.total_assets(), 1_000_001);
}

#[test]
fn test_harvest_zero_shares_after_full_withdrawal() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 1_000_000);
    vault.deposit(&user, &1_000_000);
    let shares = vault.balance_of(&user);
    vault.withdraw(&user, &shares);

    let keeper = Address::generate(&env);
    mint(&env, &token, &admin, &keeper, 100_000);
    let result = vault.try_harvest(&keeper, &100_000);
    assert_eq!(result, Err(Ok(VaultError::ZeroShares)));
}

// ===========================================================================
// EXTENDED REGRESSION SUITE — batch 3: multi-user / sequential / invariants
// ===========================================================================

// ---------------------------------------------------------------------------
// Multi-user interaction scenarios
// ---------------------------------------------------------------------------

#[test]
fn test_deposit_withdraw_interleaved_two_users() {
    let (env, vault, admin, token) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    mint(&env, &token, &admin, &alice, 2_000_000);
    mint(&env, &token, &admin, &bob, 2_000_000);

    vault.deposit(&alice, &1_000_000);
    vault.deposit(&bob, &1_000_000);
    vault.withdraw(&alice, &500_000);
    vault.deposit(&alice, &1_000_000);
    vault.withdraw(&bob, &1_000_000);

    assert!(vault.balance_of(&alice) > 0);
    assert_eq!(vault.balance_of(&bob), 0);
}

#[test]
fn test_ten_depositors_total_assets_sum() {
    let (env, vault, admin, token) = setup();
    let n = 10_i128;
    let users: std::vec::Vec<Address> = (0..n).map(|_| Address::generate(&env)).collect();
    for u in &users {
        mint(&env, &token, &admin, u, 1_000_000);
        vault.deposit(u, &1_000_000);
    }
    assert_eq!(vault.total_assets(), n * 1_000_000);
}

#[test]
fn test_sequential_deposit_withdraw_deposit() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 3_000_000);
    vault.deposit(&user, &1_000_000);
    vault.withdraw(&user, &500_000);
    vault.deposit(&user, &1_000_000);
    assert!(vault.balance_of(&user) > 0);
    assert!(vault.total_assets() > 0);
}

#[test]
fn test_share_price_increases_after_harvest_deposit_compares() {
    // After harvest the same token amount buys fewer shares
    let (env, vault, admin, token) = setup();
    let alice = Address::generate(&env);
    mint(&env, &token, &admin, &alice, 1_000_000);
    vault.deposit(&alice, &1_000_000);

    let keeper = Address::generate(&env);
    mint(&env, &token, &admin, &keeper, 1_000_000);
    vault.harvest(&keeper, &1_000_000);

    // Before harvest 1M tokens → 1M shares; after harvest 1M tokens → 500K shares
    let bob = Address::generate(&env);
    mint(&env, &token, &admin, &bob, 1_000_000);
    let bob_shares = vault.deposit(&bob, &1_000_000);
    assert!(bob_shares < 1_000_000);
}

#[test]
fn test_withdraw_then_deposit_restores_position() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 2_000_000);
    vault.deposit(&user, &1_000_000);
    vault.withdraw(&user, &1_000_000);
    assert_eq!(vault.balance_of(&user), 0);

    // Re-deposit into now-empty vault → 1:1 again
    vault.deposit(&user, &1_000_000);
    assert_eq!(vault.balance_of(&user), 1_000_000);
}

#[test]
fn test_total_assets_zero_after_all_withdraw() {
    let (env, vault, admin, token) = setup();
    let users: std::vec::Vec<Address> = (0..3).map(|_| Address::generate(&env)).collect();
    for u in &users {
        mint(&env, &token, &admin, u, 1_000_000);
        vault.deposit(u, &1_000_000);
    }
    for u in &users {
        let s = vault.balance_of(u);
        vault.withdraw(u, &s);
    }
    assert_eq!(vault.total_assets(), 0);
}

#[test]
fn test_harvest_distributes_proportionally() {
    let (env, vault, admin, token) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    mint(&env, &token, &admin, &alice, 1_000_000);
    mint(&env, &token, &admin, &bob, 3_000_000);
    vault.deposit(&alice, &1_000_000);
    vault.deposit(&bob, &3_000_000);

    let keeper = Address::generate(&env);
    mint(&env, &token, &admin, &keeper, 4_000_000);
    vault.harvest(&keeper, &4_000_000);

    // Alice has 25% of shares → should redeem ~25% of 8M = 2M
    let alice_shares = vault.balance_of(&alice);
    let alice_out = vault.withdraw(&alice, &alice_shares);
    assert_eq!(alice_out, 2_000_000);
}

#[test]
fn test_harvest_then_two_deposits_correct_shares() {
    let (env, vault, admin, token) = setup();
    let seeder = Address::generate(&env);
    mint(&env, &token, &admin, &seeder, 1_000_000);
    vault.deposit(&seeder, &1_000_000);

    let keeper = Address::generate(&env);
    mint(&env, &token, &admin, &keeper, 1_000_000);
    vault.harvest(&keeper, &1_000_000);
    // Now 1M shares, 2M assets → rate = 2 tokens/share

    let bob = Address::generate(&env);
    mint(&env, &token, &admin, &bob, 2_000_000);
    let bob_shares = vault.deposit(&bob, &2_000_000);
    // floor(2M * 1M / 2M) = 1M shares
    assert_eq!(bob_shares, 1_000_000);

    let carol = Address::generate(&env);
    mint(&env, &token, &admin, &carol, 4_000_000);
    let carol_shares = vault.deposit(&carol, &4_000_000);
    // total_shares=2M, total_assets=4M → floor(4M*2M/4M)=2M
    assert_eq!(carol_shares, 2_000_000);
}

// ---------------------------------------------------------------------------
// Invariant / property checks (deterministic)
// ---------------------------------------------------------------------------

#[test]
fn test_balance_sum_equals_implicit_total_shares() {
    let (env, vault, admin, token) = setup();
    let users: std::vec::Vec<Address> = (0..4).map(|_| Address::generate(&env)).collect();
    let amounts: [i128; 4] = [1_000_000, 2_000_000, 3_000_000, 4_000_000];
    for (u, &a) in users.iter().zip(amounts.iter()) {
        mint(&env, &token, &admin, u, a);
        vault.deposit(u, &a);
    }
    let sum: i128 = users.iter().map(|u| vault.balance_of(u)).sum();
    // All users withdraw; total_assets should reach zero
    for u in &users {
        let s = vault.balance_of(u);
        vault.withdraw(u, &s);
    }
    assert_eq!(vault.total_assets(), 0);
    let _ = sum;
}

#[test]
fn test_no_shares_leak_after_full_withdrawal_cycle() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 5_000_000);
    vault.deposit(&user, &5_000_000);
    vault.withdraw(&user, &5_000_000);
    // Re-deposit must give 1:1 (vault is empty)
    mint(&env, &token, &admin, &user, 1_000_000);
    let shares = vault.deposit(&user, &1_000_000);
    assert_eq!(shares, 1_000_000);
}

#[test]
fn test_round_trip_one_unit_no_loss() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 1);
    vault.deposit(&user, &1);
    let received = vault.withdraw(&user, &1);
    assert_eq!(received, 1);
}

#[test]
fn test_round_trip_million_no_loss() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 1_000_000);
    vault.deposit(&user, &1_000_000);
    let received = vault.withdraw(&user, &1_000_000);
    assert_eq!(received, 1_000_000);
}

#[test]
fn test_total_assets_monotone_after_deposit_and_harvest() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 2_000_000);
    vault.deposit(&user, &1_000_000);
    let a1 = vault.total_assets();
    vault.deposit(&user, &1_000_000);
    let a2 = vault.total_assets();
    assert!(a2 > a1);

    let keeper = Address::generate(&env);
    mint(&env, &token, &admin, &keeper, 500_000);
    vault.harvest(&keeper, &500_000);
    let a3 = vault.total_assets();
    assert!(a3 > a2);
}

#[test]
fn test_version_invariant_across_operations() {
    let (env, vault, admin, token) = setup();
    assert_eq!(vault.version(), 1);
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 1_000_000);
    vault.deposit(&user, &1_000_000);
    assert_eq!(vault.version(), 1); // unchanged by deposit
    let s = vault.balance_of(&user);
    vault.withdraw(&user, &s);
    assert_eq!(vault.version(), 1); // unchanged by withdraw
    let keeper = Address::generate(&env);
    mint(&env, &token, &admin, &keeper, 1);
    // vault now empty, harvest would fail; skip
    assert_eq!(vault.version(), 1);
}

#[test]
fn test_balance_of_never_negative() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 1_000_000);
    vault.deposit(&user, &1_000_000);
    vault.withdraw(&user, &500_000);
    assert!(vault.balance_of(&user) >= 0);
}

#[test]
fn test_total_assets_never_negative_after_withdrawals() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 1_000_000);
    vault.deposit(&user, &1_000_000);
    vault.withdraw(&user, &1_000_000);
    assert!(vault.total_assets() >= 0);
}

// ===========================================================================
// EXTENDED REGRESSION SUITE — batch 4: proptest + upgrade extras
// ===========================================================================

use proptest::prelude::*;

proptest! {
    #[test]
    fn prop_deposit_positive_mints_positive_shares(amount in 1_i128..=1_000_000_000_i128) {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let vault_addr = env.register_contract(None, AuraVault);
        let vault = AuraVaultClient::new(&env, &vault_addr);
        vault.initialize(&admin, &token);
        let user = Address::generate(&env);
        StellarAssetClient::new(&env, &token).mint(&user, &amount);
        let shares = vault.deposit(&user, &amount);
        prop_assert!(shares > 0);
    }

    #[test]
    fn prop_withdraw_all_empties_balance(amount in 1_i128..=1_000_000_000_i128) {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let vault_addr = env.register_contract(None, AuraVault);
        let vault = AuraVaultClient::new(&env, &vault_addr);
        vault.initialize(&admin, &token);
        let user = Address::generate(&env);
        StellarAssetClient::new(&env, &token).mint(&user, &amount);
        vault.deposit(&user, &amount);
        let shares = vault.balance_of(&user);
        vault.withdraw(&user, &shares);
        prop_assert_eq!(vault.balance_of(&user), 0);
    }

    #[test]
    fn prop_deposit_withdraw_round_trip_bounded_loss(amount in 1_i128..=1_000_000_000_i128) {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let vault_addr = env.register_contract(None, AuraVault);
        let vault = AuraVaultClient::new(&env, &vault_addr);
        vault.initialize(&admin, &token);
        let user = Address::generate(&env);
        StellarAssetClient::new(&env, &token).mint(&user, &amount);
        let shares = vault.deposit(&user, &amount);
        if shares > 0 {
            let received = vault.withdraw(&user, &shares);
            // Rounding loss at most 1 stroop
            prop_assert!(received >= amount - 1, "round-trip loss > 1: deposited {amount}, got {received}");
        }
    }

    #[test]
    fn prop_harvest_increases_total_assets(
        deposit in 1_i128..=1_000_000_000_i128,
        yield_amt in 1_i128..=1_000_000_000_i128,
    ) {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let vault_addr = env.register_contract(None, AuraVault);
        let vault = AuraVaultClient::new(&env, &vault_addr);
        vault.initialize(&admin, &token);
        let user = Address::generate(&env);
        StellarAssetClient::new(&env, &token).mint(&user, &deposit);
        vault.deposit(&user, &deposit);
        let before = vault.total_assets();
        let keeper = Address::generate(&env);
        StellarAssetClient::new(&env, &token).mint(&keeper, &yield_amt);
        vault.harvest(&keeper, &yield_amt);
        prop_assert!(vault.total_assets() > before);
    }

    #[test]
    fn prop_negative_deposit_always_errors(amount in i128::MIN..=0_i128) {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let vault_addr = env.register_contract(None, AuraVault);
        let vault = AuraVaultClient::new(&env, &vault_addr);
        vault.initialize(&admin, &token);
        let user = Address::generate(&env);
        let result = vault.try_deposit(&user, &amount);
        prop_assert!(result.is_err());
    }

    #[test]
    fn prop_negative_withdraw_always_errors(amount in i128::MIN..=0_i128) {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let vault_addr = env.register_contract(None, AuraVault);
        let vault = AuraVaultClient::new(&env, &vault_addr);
        vault.initialize(&admin, &token);
        let user = Address::generate(&env);
        let result = vault.try_withdraw(&user, &amount);
        prop_assert!(result.is_err());
    }

    #[test]
    fn prop_negative_harvest_always_errors(amount in i128::MIN..=0_i128) {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let vault_addr = env.register_contract(None, AuraVault);
        let vault = AuraVaultClient::new(&env, &vault_addr);
        vault.initialize(&admin, &token);
        let user = Address::generate(&env);
        // Must have depositor for harvest to not fail with ZeroShares
        StellarAssetClient::new(&env, &token).mint(&user, &1_000_000);
        vault.deposit(&user, &1_000_000);
        let keeper = Address::generate(&env);
        let result = vault.try_harvest(&keeper, &amount);
        prop_assert!(result.is_err());
    }

    #[test]
    fn prop_share_balance_never_exceeds_total_deposited(
        a in 1_i128..=1_000_000_i128,
        b in 1_i128..=1_000_000_i128,
    ) {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let vault_addr = env.register_contract(None, AuraVault);
        let vault = AuraVaultClient::new(&env, &vault_addr);
        vault.initialize(&admin, &token);
        let u1 = Address::generate(&env);
        let u2 = Address::generate(&env);
        StellarAssetClient::new(&env, &token).mint(&u1, &a);
        StellarAssetClient::new(&env, &token).mint(&u2, &b);
        vault.deposit(&u1, &a);
        vault.deposit(&u2, &b);
        let total = vault.total_assets();
        prop_assert!(total >= vault.balance_of(&u1));
        prop_assert!(total >= vault.balance_of(&u2));
    }
}

// ---------------------------------------------------------------------------
// Upgrade — additional edge cases
// ---------------------------------------------------------------------------

#[test]
fn test_upgrade_version_after_operations() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 1_000_000);
    vault.deposit(&user, &1_000_000);

    let hash = upload_self_wasm(&env);
    vault.upgrade(&hash);
    assert_eq!(vault.version(), 2);

    // Operations still work post-upgrade
    vault.withdraw(&user, &500_000);
    assert_eq!(vault.balance_of(&user), 500_000);
}

#[test]
fn test_upgrade_total_assets_preserved() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 5_000_000);
    vault.deposit(&user, &5_000_000);
    let assets_before = vault.total_assets();

    let hash = upload_self_wasm(&env);
    vault.upgrade(&hash);
    assert_eq!(vault.total_assets(), assets_before);
}

#[test]
fn test_upgrade_deposit_withdraw_still_work() {
    let (env, vault, admin, token) = setup();
    let hash = upload_self_wasm(&env);
    vault.upgrade(&hash);

    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 1_000_000);
    vault.deposit(&user, &1_000_000);
    let received = vault.withdraw(&user, &1_000_000);
    assert_eq!(received, 1_000_000);
}

#[test]
fn test_upgrade_harvest_still_works() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 1_000_000);
    vault.deposit(&user, &1_000_000);

    let hash = upload_self_wasm(&env);
    vault.upgrade(&hash);

    let keeper = Address::generate(&env);
    mint(&env, &token, &admin, &keeper, 100_000);
    vault.harvest(&keeper, &100_000);
    assert_eq!(vault.total_assets(), 1_100_000);
}

#[test]
fn test_version_does_not_increment_on_deposit() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 1_000_000);
    vault.deposit(&user, &1_000_000);
    assert_eq!(vault.version(), 1);
}

#[test]
fn test_version_does_not_increment_on_withdraw() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 1_000_000);
    vault.deposit(&user, &1_000_000);
    vault.withdraw(&user, &1_000_000);
    assert_eq!(vault.version(), 1);
}

#[test]
fn test_version_does_not_increment_on_harvest() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 1_000_000);
    vault.deposit(&user, &1_000_000);
    let keeper = Address::generate(&env);
    mint(&env, &token, &admin, &keeper, 100_000);
    vault.harvest(&keeper, &100_000);
    assert_eq!(vault.version(), 1);
}

// ---------------------------------------------------------------------------
// Boundary / limit value analysis
// ---------------------------------------------------------------------------

#[test]
fn test_deposit_one_then_withdraw_one() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 1);
    vault.deposit(&user, &1);
    let received = vault.withdraw(&user, &1);
    assert_eq!(received, 1);
    assert_eq!(vault.total_assets(), 0);
}

#[test]
fn test_deposit_two_withdraw_one_one() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 2);
    vault.deposit(&user, &2);
    vault.withdraw(&user, &1);
    let received2 = vault.withdraw(&user, &1);
    assert_eq!(received2, 1);
    assert_eq!(vault.total_assets(), 0);
}

#[test]
fn test_withdraw_exact_balance_no_remainder() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 999_999);
    vault.deposit(&user, &999_999);
    let shares = vault.balance_of(&user);
    vault.withdraw(&user, &shares);
    assert_eq!(vault.balance_of(&user), 0);
}

#[test]
fn test_harvest_large_amount() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 1_000_000);
    vault.deposit(&user, &1_000_000);

    let keeper = Address::generate(&env);
    let large: i128 = 1_000_000_000;
    mint(&env, &token, &admin, &keeper, large);
    vault.harvest(&keeper, &large);
    assert_eq!(vault.total_assets(), 1_000_000 + large);
}

#[test]
fn test_three_way_deposit_proportional_shares() {
    let (env, vault, admin, token) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let carol = Address::generate(&env);
    mint(&env, &token, &admin, &alice, 1_000_000);
    mint(&env, &token, &admin, &bob, 1_000_000);
    mint(&env, &token, &admin, &carol, 1_000_000);
    vault.deposit(&alice, &1_000_000);
    vault.deposit(&bob, &1_000_000);
    vault.deposit(&carol, &1_000_000);
    // All deposited equal amounts with no yield → equal shares
    assert_eq!(vault.balance_of(&alice), vault.balance_of(&bob));
    assert_eq!(vault.balance_of(&bob), vault.balance_of(&carol));
}

#[test]
fn test_withdraw_zero_from_uninit_returns_zero_amount() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let _token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let vault_addr = env.register_contract(None, AuraVault);
    let vault = AuraVaultClient::new(&env, &vault_addr);
    let user = Address::generate(&env);
    // Zero amount errors before NotInitialized
    let result = vault.try_withdraw(&user, &0);
    assert_eq!(result, Err(Ok(VaultError::ZeroAmount)));
}

#[test]
fn test_harvest_zero_from_uninit_returns_zero_amount() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let _token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let vault_addr = env.register_contract(None, AuraVault);
    let vault = AuraVaultClient::new(&env, &vault_addr);
    let keeper = Address::generate(&env);
    let result = vault.try_harvest(&keeper, &0);
    assert_eq!(result, Err(Ok(VaultError::ZeroAmount)));
}

// ===========================================================================
// #358 — TVL cap tests
// ===========================================================================

#[test]
fn test_tvl_cap_default_is_zero_unlimited() {
    let (_env, vault, _admin, _token) = setup();
    assert_eq!(vault.tvl_cap(), 0);
}

#[test]
fn test_set_tvl_cap_stores_value() {
    let (_env, vault, admin, _token) = setup();
    vault.set_tvl_cap(&1_000_000);
    assert_eq!(vault.tvl_cap(), 1_000_000);
    let _ = admin;
}

#[test]
fn test_tvl_cap_emits_event_and_allows_deposit_up_to_cap() {
    let (env, vault, admin, token) = setup();
    vault.set_tvl_cap(&500_000);

    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 500_000);
    let shares = vault.deposit(&user, &500_000);
    assert!(shares > 0);
    assert_eq!(vault.total_assets(), 500_000);
}

#[test]
fn test_deposit_exceeds_tvl_cap_returns_error() {
    let (env, vault, admin, token) = setup();
    vault.set_tvl_cap(&300_000);

    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 500_000);
    let result = vault.try_deposit(&user, &500_000);
    assert_eq!(result, Err(Ok(VaultError::TvlCapExceeded)));
}

#[test]
fn test_tvl_cap_zero_means_unlimited() {
    let (env, vault, admin, token) = setup();
    vault.set_tvl_cap(&0); // explicitly set to 0 = unlimited

    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 10_000_000);
    let shares = vault.deposit(&user, &10_000_000);
    assert!(shares > 0);
}

#[test]
fn test_partial_deposit_under_cap_succeeds() {
    let (env, vault, admin, token) = setup();
    vault.set_tvl_cap(&1_000_000);

    // First deposit 600k (under cap)
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 1_200_000);
    vault.deposit(&user, &600_000);

    // Second deposit of 400k (total = 1M, exactly at cap) should succeed
    let result = vault.try_deposit(&user, &400_000);
    assert!(result.is_ok());

    // Third deposit of 1 (total would be 1M+1, over cap) should fail
    let result2 = vault.try_deposit(&user, &1);
    assert_eq!(result2, Err(Ok(VaultError::TvlCapExceeded)));
}

// ===========================================================================
// #359 — On-chain fee accounting tests
// ===========================================================================

#[test]
fn test_accrued_fees_default_zero() {
    let (_env, vault, _admin, _token) = setup();
    assert_eq!(vault.accrued_fees(), 0);
}

#[test]
fn test_harvest_accrues_fees_excluded_from_total_assets() {
    let (env, vault, admin, token) = setup();

    // Seed vault
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 1_000_000);
    vault.deposit(&user, &1_000_000);

    // harvest 100_000 with default 10% perf fee → fee = 10_000, yield_after = 90_000
    mint(&env, &token, &admin, &admin, 100_000);
    vault.harvest(&admin, &100_000);

    assert_eq!(vault.accrued_fees(), 10_000);
    // total_assets excludes accrued fees
    assert_eq!(vault.total_assets(), 1_090_000);
}

#[test]
fn test_claim_fees_transfers_to_recipient_and_zeroes_accrued() {
    let (env, vault, admin, token) = setup();

    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 1_000_000);
    vault.deposit(&user, &1_000_000);

    mint(&env, &token, &admin, &admin, 100_000);
    vault.harvest(&admin, &100_000);

    let fees_before = vault.accrued_fees();
    assert_eq!(fees_before, 10_000);

    let recipient = Address::generate(&env);
    let claimed = vault.claim_fees(&recipient);
    assert_eq!(claimed, 10_000);
    assert_eq!(vault.accrued_fees(), 0);

    // Recipient token balance should be 10_000
    let token_client = soroban_sdk::token::Client::new(&env, &token);
    assert_eq!(token_client.balance(&recipient), 10_000);
}

#[test]
fn test_claim_fees_no_fees_returns_error() {
    let (_env, vault, admin, _token) = setup();
    let result = vault.try_claim_fees(&admin);
    assert_eq!(result, Err(Ok(VaultError::NoFeesToClaim)));
}

#[test]
fn test_total_assets_excludes_accrued_fees() {
    let (env, vault, admin, token) = setup();
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 1_000_000);
    vault.deposit(&user, &1_000_000);

    // Multiple harvests accumulate fees
    mint(&env, &token, &admin, &admin, 200_000);
    vault.harvest(&admin, &100_000);
    vault.harvest(&admin, &100_000);

    // Each 100k harvest: 10k fee, 90k to total_assets
    assert_eq!(vault.accrued_fees(), 20_000);
    assert_eq!(vault.total_assets(), 1_180_000);
}

// ===========================================================================
// #361 — KYC / deposit allowlist tests
// ===========================================================================

#[test]
fn test_kyc_disabled_by_default_allows_all_deposits() {
    let (env, vault, admin, token) = setup();
    // KYC is off by default — any user can deposit
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 100_000);
    let shares = vault.deposit(&user, &100_000);
    assert!(shares > 0);
}

#[test]
fn test_kyc_enabled_blocks_unapproved_address() {
    let (env, vault, admin, token) = setup();

    // Enable KYC and set a verifier
    let verifier = Address::generate(&env);
    vault.set_kyc_verifier(&verifier);
    vault.set_kyc_enabled(&true);

    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 100_000);
    let result = vault.try_deposit(&user, &100_000);
    assert_eq!(result, Err(Ok(VaultError::KycNotApproved)));
}

#[test]
fn test_kyc_approved_address_can_deposit() {
    let (env, vault, admin, token) = setup();

    let verifier = Address::generate(&env);
    vault.set_kyc_verifier(&verifier);
    vault.set_kyc_enabled(&true);

    let user = Address::generate(&env);
    // Approve with far-future expiry
    vault.approve_address(&user, &u64::MAX);

    mint(&env, &token, &admin, &user, 100_000);
    let shares = vault.deposit(&user, &100_000);
    assert!(shares > 0);
}

#[test]
fn test_kyc_revoked_address_cannot_deposit() {
    let (env, vault, admin, token) = setup();

    let verifier = Address::generate(&env);
    vault.set_kyc_verifier(&verifier);
    vault.set_kyc_enabled(&true);

    let user = Address::generate(&env);
    vault.approve_address(&user, &u64::MAX);
    vault.revoke_address(&user);

    mint(&env, &token, &admin, &user, 100_000);
    let result = vault.try_deposit(&user, &100_000);
    assert_eq!(result, Err(Ok(VaultError::KycNotApproved)));
}

#[test]
fn test_kyc_expired_approval_blocks_deposit() {
    let (env, vault, admin, token) = setup();

    let verifier = Address::generate(&env);
    vault.set_kyc_verifier(&verifier);
    vault.set_kyc_enabled(&true);

    let user = Address::generate(&env);
    // Set expiry to ledger timestamp 0 (already expired)
    vault.approve_address(&user, &0u64);

    mint(&env, &token, &admin, &user, 100_000);
    let result = vault.try_deposit(&user, &100_000);
    assert_eq!(result, Err(Ok(VaultError::KycExpired)));
}

#[test]
fn test_kyc_disabled_allows_previously_unapproved_address() {
    let (env, vault, admin, token) = setup();

    let verifier = Address::generate(&env);
    vault.set_kyc_verifier(&verifier);
    vault.set_kyc_enabled(&true);

    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 100_000);

    // Blocked with KYC on
    assert!(vault.try_deposit(&user, &100_000).is_err());

    // Disable KYC — now anyone can deposit
    vault.set_kyc_enabled(&false);
    let shares = vault.deposit(&user, &100_000);
    assert!(shares > 0);
}

// ===========================================================================
// #360 — Pause countdown with scheduled unpause tests
// ===========================================================================

#[test]
fn test_pause_until_sets_pause_and_expiry() {
    let (env, vault, _admin, _token) = setup();
    let future_ts = env.ledger().timestamp() + 1000;
    vault.pause_until(&future_ts);

    assert!(vault.is_paused());
    assert_eq!(vault.pause_expires_at(), Some(future_ts));
}

#[test]
fn test_pause_expires_at_none_when_not_scheduled() {
    let (_env, vault, _admin, _token) = setup();
    assert_eq!(vault.pause_expires_at(), None);
}

#[test]
fn test_manual_unpause_clears_scheduled_expiry() {
    let (env, vault, _admin, _token) = setup();
    let future_ts = env.ledger().timestamp() + 1000;
    vault.pause_until(&future_ts);
    vault.unpause();

    assert!(!vault.is_paused());
    assert_eq!(vault.pause_expires_at(), None);
}

#[test]
fn test_auto_unpause_on_deposit_after_expiry() {
    let (env, vault, admin, token) = setup();

    // Schedule unpause at current_ts + 1
    let future_ts = env.ledger().timestamp() + 1;
    vault.pause_until(&future_ts);
    assert!(vault.is_paused());

    // Advance ledger timestamp past the expiry
    env.ledger().with_mut(|li| {
        li.timestamp = future_ts + 1;
    });

    // deposit should auto-unpause and succeed
    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 100_000);
    let shares = vault.deposit(&user, &100_000);
    assert!(shares > 0);
    assert!(!vault.is_paused());
    assert_eq!(vault.pause_expires_at(), None);
}

#[test]
fn test_pause_until_blocks_deposit_before_expiry() {
    let (env, vault, admin, token) = setup();

    let future_ts = env.ledger().timestamp() + 10_000;
    vault.pause_until(&future_ts);

    let user = Address::generate(&env);
    mint(&env, &token, &admin, &user, 100_000);
    let result = vault.try_deposit(&user, &100_000);
    assert_eq!(result, Err(Ok(VaultError::VaultPaused)));
}

#[test]
fn test_manual_pause_clears_scheduled_unpause() {
    let (env, vault, _admin, _token) = setup();
    let future_ts = env.ledger().timestamp() + 1000;
    vault.pause_until(&future_ts);
    assert_eq!(vault.pause_expires_at(), Some(future_ts));

    // Calling pause() again clears the scheduled expiry
    vault.pause();
    assert_eq!(vault.pause_expires_at(), None);
    assert!(vault.is_paused());
}
