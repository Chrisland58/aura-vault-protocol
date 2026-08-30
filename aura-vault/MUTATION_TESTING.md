# Mutation Testing — AuraVault

## Overview

Mutation testing systematically injects small source-level faults ("mutants") into the
contract and verifies that the existing test suite detects (kills) each one. A mutant that
is **not** killed by any test is called a *surviving* mutant and represents a gap in test
coverage.

AuraVault uses [cargo-mutants](https://mutants.rs/) because it works directly on Rust
source, requires no instrumented build, and integrates cleanly with `cargo test`.

### Score targets

| Scope | Target |
|---|---|
| Overall mutation score | **≥ 80 %** |
| Share-math logic (`deposit` / `withdraw` / `harvest` formulas) | **100 %** |
| Authorization checks (`require_auth`, admin guards, pause guard) | **100 %** |
| Flash-loan guard (`BalanceMismatch` path) | **100 %** |

---

## Running

### Install cargo-mutants

```bash
cargo install cargo-mutants --locked
```

### Run against the vault crate

```bash
cd aura-vault
cargo mutants
```

cargo-mutants picks up `mutation-testing.toml` automatically and writes results to
`mutants.out/`.

### Useful flags

```bash
# Run only mutations in a single file
cargo mutants --file src/lib.rs

# Increase the per-mutant timeout (seconds) if tests are slow
cargo mutants --timeout 180

# Run with multiple jobs in parallel (speeds up large runs significantly)
cargo mutants --jobs 4

# Show only surviving mutants (quiet output)
cargo mutants 2>&1 | grep -E '^(MISSED|caught|timeout)'
```

---

## Interpreting Results

cargo-mutants classifies each mutant as one of:

| Status | Meaning |
|---|---|
| **caught** | At least one test failed on the mutant — good, the test suite detects this fault |
| **missed** | All tests passed on the mutant — gap in test coverage; needs investigation |
| **timeout** | No tests completed within the timeout — treated as missed by default |
| **unviable** | The mutated code failed to compile — not counted in the score |

The mutation score is `caught / (caught + missed) × 100`.

A result in `mutants.out/mutants.out` (one line per mutant) can be post-processed:

```bash
# Count by status
grep -c CAUGHT  mutants.out/mutants.out
grep -c MISSED  mutants.out/mutants.out

# Show all surviving mutants
grep '^MISSED' mutants.out/mutants.out
```

---

## Known Surviving Mutants

The following categories of mutations are expected to *survive* (not be caught by the
current test suite) because the tests do not exercise the specific behaviour that each
mutation alters. These are documented here so that CI failures for these specific mutants
can be triaged quickly and are not mistakenly treated as regressions.

### 1. TTL / archival constants (`storage.rs`)

**Example mutations:**
- `INSTANCE_TTL_THRESHOLD: u32 = 7 * 24 * 60 * 60` → `6 * 24 * 60 * 60`
- `INSTANCE_LIFETIME_TTL: u32 = 30 * 24 * 60 * 60` → `29 * 24 * 60 * 60`

**Why they survive:** Unit tests run against the Soroban test harness, which does not
advance ledger sequences far enough to trigger archival. No test asserts that a specific
TTL value was passed to `extend_ttl`; the tests only check that state reads/writes succeed.
Changing a 30-day lifetime to a 29-day lifetime has no observable effect within a test run.

**Risk level:** Low — off-by-one TTL values would only matter in production once entries
approach the archival threshold.

---

### 2. Event field ordering / symbol names (`lib.rs`)

**Example mutations:**
- `Symbol::new(&env, "deposit")` → `Symbol::new(&env, "withdraw")`
- Swapping the order of fields published in an event `Vec`

**Why they survive:** The test suite verifies that mutating functions complete
successfully and that token balances change as expected. Event emission is currently
verified via `env.events().all()` only in a subset of tests, and those assertions check
for the presence of an event but not for the exact symbol string or field ordering within
the event payload.

**Risk level:** Medium — off-chain indexers rely on event schemas. Adding event-schema
assertions to the test suite would eliminate this gap.

---

### 3. Error discriminant numeric values (`errors.rs`)

**Example mutations:**
- `NotInitialized = 1` → `NotInitialized = 2`
- `VaultPaused = 11` → `VaultPaused = 10`

**Why they survive:** Tests assert on the *variant name* (e.g., `Err(VaultError::VaultPaused)`)
rather than on the raw `u32` discriminant. Because `contracterror` encodes variants by
name in Soroban's XDR, renumbering a variant does not change which error is returned from
the test harness's perspective — the variant comparison still passes.

**Risk level:** Low for in-process tests, but a discriminant change is a **breaking ABI
change** for clients using the raw XDR code. This is noted in the `errors.rs` doc comment.

---

### 4. Harvest cooldown off-by-one comparisons (`lib.rs`)

**Example mutations:**
- `current_time < last_harvest + cooldown` → `current_time <= last_harvest + cooldown`
- Boundary condition: `>=` → `>`

**Why they survive:** The harvest cooldown tests typically set up time with a margin
(e.g., advance ledger by `cooldown + 10`) and do not test the exact boundary where
`current_time == last_harvest + cooldown`. A strict-vs-inclusive comparison mutation
at the boundary therefore passes all existing tests.

**Risk level:** Low — the off-by-one only matters at exactly the boundary second, which
is unlikely in production. A dedicated boundary test would close this gap.

---

### 5. TVL cap comparison direction (`lib.rs`)

**Example mutations:**
- `new_total > tvl_cap` → `new_total >= tvl_cap`

**Why they survive:** TVL cap tests deposit amounts that are either clearly below or
clearly above the cap, leaving the equality boundary untested. A mutation that changes
strict-greater to greater-or-equal would not be caught unless a test deposits exactly the
cap amount and expects success.

**Risk level:** Low — the practical difference is whether a deposit of exactly the cap
value is accepted or rejected. This is a product decision worth documenting.

---

### 6. Governance timelock arithmetic (`governance.rs` / `lib.rs`)

**Example mutations:**
- `proposal_time + timelock_secs` → `proposal_time + timelock_secs - 1`
- Addition replaced by subtraction in timestamp calculation

**Why they survive:** Governance tests exercise the happy path (wait long enough) and the
sad path (don't wait at all), but rarely test the exact moment the timelock expires.
Off-by-one mutations in the timestamp sum survive for the same reason as the harvest
cooldown boundary case above.

**Risk level:** Medium — a timelock that expires one second early could allow a governance
action to execute fractionally sooner than intended.

---

## Critical Logic Coverage

The following paths **must** have 100 % mutation kill rate. If any mutant in these
categories survives, it must be resolved before merging to `main`.

### Share minting formula (`deposit`)

```
shares_to_mint = floor(amount × total_shares / total_assets)
```

Mutations cargo-mutants will try:
- Replace `*` with `+`, `-`, `/`
- Replace `checked_mul` / `checked_div` with unchecked variants
- Swap `total_shares` and `total_assets` operands
- Replace `floor` (integer truncation) with rounding up

All of these must be caught. If any survive, add a test that deposits a non-round amount
and asserts the exact share count.

### Share redemption formula (`withdraw`)

```
underlying_out = floor(shares × total_assets / total_shares)
```

Same operators and operand-swap mutations apply. The test must assert the exact token
amount returned.

### Authorization guards

Every `require_auth()` call must be covered. cargo-mutants will try deleting the call
entirely. If the delete survives, the test suite has no test that calls the function
without authorization and expects a failure.

### Pause guard

The `VaultPaused` check at the top of `deposit`, `withdraw`, and `harvest` must be
covered. Tests should:
1. Pause the vault.
2. Call each mutating function and assert `Err(VaultError::VaultPaused)`.

### Flash-loan guard

The balance equality check (`actual_balance == total_deposited`) must be covered. A test
should inject a balance discrepancy and assert `Err(VaultError::BalanceMismatch)`.

---

## CI Integration

The GitHub Actions workflow (`.github/workflows/mutation-testing.yml`) runs cargo-mutants:

- **On push** to any of the core source files (`lib.rs`, `storage.rs`, `fee.rs`, `errors.rs`)
- **On schedule** — quarterly (first day of January, April, July, October at 02:00 UTC)
- **On demand** — via `workflow_dispatch`

The workflow fails if the overall mutation score drops below **80 %**. Surviving mutants
in the known-surviving list above should be suppressed by adding their exact source
location to the `exclude_globs` in `mutation-testing.toml` once they have been
triaged and accepted.
