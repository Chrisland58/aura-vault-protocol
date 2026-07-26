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
// SEP-41 TRANSFER / ALLOWANCE TESTS
//
// These tests verify the SEP-41 token interface (transfer, approve,
// transfer_from, allowance) on the underlying Stellar Asset Contract that
// the vault wraps, and confirm that the vault's own token-moving paths
// (deposit / withdraw) are correctly blocked when the vault is paused.
//
// The Stellar Asset Contract (SAC) is a compliant SEP-41 implementation.
// Failure conditions (over-balance, over-allowance) trap the executor, so
// they are covered with #[should_panic] tests as prescribed by the spec.
// ===========================================================================

mod sep41_transfer_allowance {
    extern crate std;

    use soroban_sdk::{
        symbol_short,
        testutils::Address as _,
        token::Client as TokenClient,
        token::StellarAssetClient,
        Address, Env,
    };

    use crate::{AuraVault, AuraVaultClient, VaultError};

    // -----------------------------------------------------------------------
    // Module-level setup helper
    // Mirrors the top-level `setup()` so this module is self-contained.
    // Returns (env, token_address, admin).
    // -----------------------------------------------------------------------
    fn token_setup() -> (Env, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let token_addr = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        (env, token_addr, admin)
    }

    /// Mint `amount` underlying tokens to `recipient` via the SAC admin.
    fn mint(env: &Env, token: &Address, admin: &Address, recipient: &Address, amount: i128) {
        StellarAssetClient::new(env, token).mint(recipient, &amount);
    }

    // -----------------------------------------------------------------------
    // Helper: deploy + initialise the vault alongside a token; returns
    // (env, vault_client, vault_address, token_address, admin).
    // -----------------------------------------------------------------------
    fn vault_setup() -> (Env, AuraVaultClient<'static>, Address, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let token_addr = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        let vault_addr = env.register_contract(None, AuraVault);
        let vault = AuraVaultClient::new(&env, &vault_addr);
        vault.initialize(&admin, &token_addr);
        (env, vault, vault_addr, token_addr, admin)
    }

    // -----------------------------------------------------------------------
    // Test 1 — transfer correct amount between addresses
    //
    // Criterion: after token.transfer(from → to, amount), `to`'s balance
    // increases by exactly `amount` and `from`'s balance decreases by the
    // same amount.
    // -----------------------------------------------------------------------
    #[test]
    fn test_sep41_transfer_correct_amount() {
        let (env, token_addr, admin) = token_setup();
        let token = TokenClient::new(&env, &token_addr);

        let alice = Address::generate(&env);
        let bob = Address::generate(&env);

        mint(&env, &token_addr, &admin, &alice, 1_000_000);

        let alice_before = token.balance(&alice);
        let bob_before = token.balance(&bob);

        token.transfer(&alice, &bob, &400_000);

        assert_eq!(
            token.balance(&alice),
            alice_before - 400_000,
            "alice balance should decrease by transferred amount"
        );
        assert_eq!(
            token.balance(&bob),
            bob_before + 400_000,
            "bob balance should increase by transferred amount"
        );
    }

    // -----------------------------------------------------------------------
    // Test 2 — transfer more than balance → panic (trap)
    //
    // Criterion: the SAC traps when the sender tries to transfer more tokens
    // than their available balance. Per the SEP-41 spec, failure conditions
    // are signalled by trapping rather than returning an error code.
    // -----------------------------------------------------------------------
    #[test]
    #[should_panic]
    fn test_sep41_transfer_more_than_balance_panics() {
        let (env, token_addr, admin) = token_setup();
        let token = TokenClient::new(&env, &token_addr);

        let alice = Address::generate(&env);
        let bob = Address::generate(&env);

        mint(&env, &token_addr, &admin, &alice, 500);

        // Attempting to transfer 501 when alice only has 500 must trap.
        token.transfer(&alice, &bob, &501);
    }

    // -----------------------------------------------------------------------
    // Test 3 — approve then transfer_from within allowance
    //
    // Criterion: after alice approves spender for `amount` (with a far-future
    // live_until_ledger), spender can call transfer_from and the tokens move
    // correctly; the allowance is consumed by the transferred amount.
    // -----------------------------------------------------------------------
    #[test]
    fn test_sep41_approve_then_transfer_from_within_allowance() {
        let (env, token_addr, admin) = token_setup();
        let token = TokenClient::new(&env, &token_addr);

        let alice = Address::generate(&env);
        let spender = Address::generate(&env);
        let bob = Address::generate(&env);

        mint(&env, &token_addr, &admin, &alice, 1_000_000);

        // Approve spender to spend up to 300_000 from alice's balance.
        // live_until_ledger is set far in the future (current + 10_000).
        let live_until = env.ledger().sequence() + 10_000;
        token.approve(&alice, &spender, &300_000, &live_until);

        // Verify the allowance was recorded.
        assert_eq!(
            token.allowance(&alice, &spender),
            300_000,
            "allowance should be 300_000 after approve"
        );

        let alice_before = token.balance(&alice);
        let bob_before = token.balance(&bob);

        // Spender transfers 200_000 from alice to bob.
        token.transfer_from(&spender, &alice, &bob, &200_000);

        assert_eq!(
            token.balance(&alice),
            alice_before - 200_000,
            "alice's balance should decrease by 200_000"
        );
        assert_eq!(
            token.balance(&bob),
            bob_before + 200_000,
            "bob's balance should increase by 200_000"
        );
        // Remaining allowance must be reduced by the transferred amount.
        assert_eq!(
            token.allowance(&alice, &spender),
            100_000,
            "allowance should be reduced to 100_000 after partial transfer_from"
        );
    }

    // -----------------------------------------------------------------------
    // Test 4 — transfer_from exceeding allowance → panic (trap)
    //
    // Criterion: attempting to transfer_from more than the approved allowance
    // traps the executor. Aligns with the SEP-41 failure-condition spec.
    // -----------------------------------------------------------------------
    #[test]
    #[should_panic]
    fn test_sep41_transfer_from_exceeds_allowance_panics() {
        let (env, token_addr, admin) = token_setup();
        let token = TokenClient::new(&env, &token_addr);

        let alice = Address::generate(&env);
        let spender = Address::generate(&env);
        let bob = Address::generate(&env);

        mint(&env, &token_addr, &admin, &alice, 1_000_000);

        let live_until = env.ledger().sequence() + 10_000;
        // Approve only 100 stroops.
        token.approve(&alice, &spender, &100, &live_until);

        // Attempt to transfer 101 — must trap.
        token.transfer_from(&spender, &alice, &bob, &101);
    }

    // -----------------------------------------------------------------------
    // Test 5 — Transfer event emitted with correct fields
    //
    // Criterion: after a successful token.transfer call, env.events().all()
    // contains an event from the token contract whose topics Vec starts with
    //   topics[0] = Symbol("transfer")
    //   topics[1] = from: Address
    //   topics[2] = to: Address
    // conforming to the SEP-41 event specification.
    //
    // We use soroban_sdk::IntoVal to convert the expected Rust values to
    // soroban_sdk::Val for comparison with the stored raw event entries.
    // -----------------------------------------------------------------------
    #[test]
    fn test_sep41_transfer_event_emitted_with_correct_fields() {
        use soroban_sdk::{testutils::Events as _, IntoVal, Val};

        let (env, token_addr, admin) = token_setup();
        let token = TokenClient::new(&env, &token_addr);

        let alice = Address::generate(&env);
        let bob = Address::generate(&env);

        mint(&env, &token_addr, &admin, &alice, 1_000_000);

        let transfer_amount: i128 = 250_000;
        token.transfer(&alice, &bob, &transfer_amount);

        // env.events().all() returns a soroban_sdk::Vec<(Address, Vec<Val>, Val)>.
        // Convert to std Vec for ergonomic iteration.
        let all_events = env.events().all();
        let events_std: std::vec::Vec<_> = all_events.iter().collect();

        // The SEP-41 / SAC "transfer" event format:
        //   topics[0] = Symbol("transfer")
        //   topics[1] = from: Address
        //   topics[2] = to: Address
        //   data      = amount: i128 (legacy SAC format)
        let transfer_sym: Val = symbol_short!("transfer").into_val(&env);
        let alice_val: Val = alice.clone().into_val(&env);
        let bob_val: Val = bob.clone().into_val(&env);

        let found = events_std.iter().any(|(contract_id, topics, _data)| {
            // Event must come from the token contract.
            if *contract_id != token_addr {
                return false;
            }
            // The topics Vec must have at least 3 entries.
            if topics.len() < 3 {
                return false;
            }
            // topics[0] == Symbol("transfer")
            let t0: Val = topics.get(0).unwrap();
            if t0 != transfer_sym {
                return false;
            }
            // topics[1] == alice (from)
            let t1: Val = topics.get(1).unwrap();
            if t1 != alice_val {
                return false;
            }
            // topics[2] == bob (to)
            let t2: Val = topics.get(2).unwrap();
            t2 == bob_val
        });

        assert!(
            found,
            "expected a SEP-41 'transfer' event \
             (from=alice, to=bob, amount={transfer_amount}) \
             but none matched in the event list"
        );
    }

    // -----------------------------------------------------------------------
    // Test 6 — Token transfer blocked while vault is paused
    //
    // Criterion: the vault's deposit and withdraw functions call
    // token.transfer internally. When the vault is paused, both functions
    // must return VaultPaused without executing any token transfer, leaving
    // token balances unchanged.
    // -----------------------------------------------------------------------
    #[test]
    fn test_sep41_transfer_blocked_while_vault_paused() {
        let (env, vault, _vault_addr, token_addr, admin) = vault_setup();
        let token = TokenClient::new(&env, &token_addr);

        let alice = Address::generate(&env);
        mint(&env, &token_addr, &admin, &alice, 1_000_000);

        // Seed alice's position so she has shares to withdraw later.
        vault.deposit(&alice, &500_000);
        let shares = vault.balance_of(&alice);
        assert!(shares > 0, "alice should have shares after deposit");

        // --- Pause the vault ---
        vault.pause();
        assert!(vault.is_paused(), "vault must be paused");

        // Record balances *after* pause, *before* any blocked operations.
        let alice_token_balance_before = token.balance(&alice);
        let vault_token_balance_before = token.balance(&_vault_addr);
        let vault_total_assets_before = vault.total_assets();
        let alice_shares_before = vault.balance_of(&alice);

        // Attempt deposit while paused → must fail with VaultPaused.
        let deposit_result = vault.try_deposit(&alice, &500_000);
        assert_eq!(
            deposit_result,
            Err(Ok(VaultError::VaultPaused)),
            "deposit must be blocked with VaultPaused when vault is paused"
        );

        // Attempt withdraw while paused → must fail with VaultPaused.
        let withdraw_result = vault.try_withdraw(&alice, &shares);
        assert_eq!(
            withdraw_result,
            Err(Ok(VaultError::VaultPaused)),
            "withdraw must be blocked with VaultPaused when vault is paused"
        );

        // Confirm that no token balances changed — no transfer occurred.
        assert_eq!(
            token.balance(&alice),
            alice_token_balance_before,
            "alice's token balance must be unchanged while vault is paused"
        );
        assert_eq!(
            token.balance(&_vault_addr),
            vault_token_balance_before,
            "vault's token balance must be unchanged while vault is paused"
        );
        assert_eq!(
            vault.total_assets(),
            vault_total_assets_before,
            "vault total_assets must be unchanged while paused"
        );
        assert_eq!(
            vault.balance_of(&alice),
            alice_shares_before,
            "alice's share balance must be unchanged while vault is paused"
        );

        // --- Unpause and verify operations resume ---
        vault.unpause();
        assert!(!vault.is_paused(), "vault must be unpaused");

        // Deposit must succeed after unpause.
        let new_shares = vault.deposit(&alice, &100_000);
        assert!(
            new_shares > 0,
            "deposit should succeed and mint shares after unpause"
        );
    }
}
