/// Gas (CPU instruction) measurement tests for AuraVault contract functions.
///
/// Each test measures the CPU instructions consumed by one contract function
/// call using `env.budget().cpu_instruction_count()`. Results are printed to
/// stdout so the CI script can parse them and compare against the baselines in
/// `gas-baselines.json`.
///
/// Output format (one line per function):
///   GAS_MEASUREMENT: <function_name> <cpu_instructions>
///
/// Run with:
///   cargo test gas_ -- --nocapture 2>&1 | grep GAS_MEASUREMENT
#![cfg(test)]

extern crate std;

use soroban_sdk::{testutils::Address as _, Address, Env, Vec};
use soroban_sdk::token::StellarAssetClient;

use crate::{AuraVault, AuraVaultClient};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn setup_vault() -> (Env, AuraVaultClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.budget().reset_unlimited();

    let admin = Address::generate(&env);
    let token_address = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();

    let vault_address = env.register_contract(None, AuraVault);
    let vault = AuraVaultClient::new(&env, &vault_address);

    let signers: Vec<Address> = Vec::new(&env);
    vault.initialize(&admin, &token_address, &signers);
    vault.set_fees(&admin, &0_u32, &0_u32);

    (env, vault, admin, token_address)
}

fn mint_tokens(env: &Env, token: &Address, admin: &Address, to: &Address, amount: i128) {
    StellarAssetClient::new(env, token).mint(to, &amount);
}

/// Measure the CPU instructions used by `f`, resetting the budget before and
/// after so consecutive measurements are independent.
fn measure<F: FnOnce()>(env: &Env, f: F) -> u64 {
    env.budget().reset_unlimited();
    f();
    let instructions = env.budget().cpu_instruction_count();
    env.budget().reset_unlimited();
    instructions
}

// ---------------------------------------------------------------------------
// Individual function measurements
// ---------------------------------------------------------------------------

#[test]
fn gas_initialize() {
    let env = Env::default();
    env.mock_all_auths();
    env.budget().reset_unlimited();

    let admin = Address::generate(&env);
    let token_address = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let vault_address = env.register_contract(None, AuraVault);
    let vault = AuraVaultClient::new(&env, &vault_address);
    let signers: Vec<Address> = Vec::new(&env);

    let instructions = measure(&env, || {
        vault.initialize(&admin, &token_address, &signers);
    });

    std::println!("GAS_MEASUREMENT: initialize {}", instructions);
}

#[test]
fn gas_deposit() {
    let (env, vault, admin, token) = setup_vault();
    let user = Address::generate(&env);
    mint_tokens(&env, &token, &admin, &user, 10_000_000);

    let instructions = measure(&env, || {
        vault.deposit(&user, &1_000_000_i128);
    });

    std::println!("GAS_MEASUREMENT: deposit {}", instructions);
}

#[test]
fn gas_withdraw() {
    let (env, vault, admin, token) = setup_vault();
    let user = Address::generate(&env);
    mint_tokens(&env, &token, &admin, &user, 10_000_000);
    vault.deposit(&user, &1_000_000_i128);

    let instructions = measure(&env, || {
        vault.withdraw(&user, &500_000_i128);
    });

    std::println!("GAS_MEASUREMENT: withdraw {}", instructions);
}

#[test]
fn gas_harvest() {
    let (env, vault, admin, token) = setup_vault();
    // Seed vault so harvest is valid (non-zero shares)
    let user = Address::generate(&env);
    mint_tokens(&env, &token, &admin, &user, 10_000_000);
    vault.deposit(&user, &1_000_000_i128);

    // Keeper needs yield tokens
    let keeper = Address::generate(&env);
    mint_tokens(&env, &token, &admin, &keeper, 5_000_000);

    let instructions = measure(&env, || {
        vault.harvest(&keeper, &100_000_i128);
    });

    std::println!("GAS_MEASUREMENT: harvest {}", instructions);
}

#[test]
fn gas_pause() {
    let (env, vault, admin, _token) = setup_vault();

    let instructions = measure(&env, || {
        vault.pause(&admin);
    });

    std::println!("GAS_MEASUREMENT: pause {}", instructions);
}

#[test]
fn gas_unpause() {
    let (env, vault, admin, _token) = setup_vault();
    vault.pause(&admin);

    let instructions = measure(&env, || {
        vault.unpause(&admin);
    });

    std::println!("GAS_MEASUREMENT: unpause {}", instructions);
}

#[test]
fn gas_is_paused() {
    let (env, vault, _admin, _token) = setup_vault();

    let instructions = measure(&env, || {
        vault.is_paused();
    });

    std::println!("GAS_MEASUREMENT: is_paused {}", instructions);
}

#[test]
fn gas_total_assets() {
    let (env, vault, _admin, _token) = setup_vault();

    let instructions = measure(&env, || {
        vault.total_assets();
    });

    std::println!("GAS_MEASUREMENT: total_assets {}", instructions);
}

#[test]
fn gas_balance_of() {
    let (env, vault, _admin, _token) = setup_vault();
    let user = Address::generate(&env);

    let instructions = measure(&env, || {
        vault.balance_of(&user);
    });

    std::println!("GAS_MEASUREMENT: balance_of {}", instructions);
}

#[test]
fn gas_set_fees() {
    let (env, vault, admin, _token) = setup_vault();

    let instructions = measure(&env, || {
        vault.set_fees(&admin, &100_u32, &50_u32);
    });

    std::println!("GAS_MEASUREMENT: set_fees {}", instructions);
}

// upgrade requires a real wasm hash — skip in unit test mode (it's a Wasm-only op).
// The CI wasm build test covers compile correctness; upgrade gas is noted as N/A.
#[test]
fn gas_upgrade_skipped() {
    // Upgrade consumes a Wasm blob at runtime. We record a sentinel so the
    // baseline file has an entry, but the comparison script ignores sentinels
    // with value 0.
    std::println!("GAS_MEASUREMENT: upgrade 0");
}
