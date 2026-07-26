# Local Development Setup Guide

This guide enables new developers to set up and run Aura Vault Protocol locally within 30 minutes.

## System Requirements

- **OS**: macOS, Linux, or Windows (WSL2)
- **Rust**: 1.70+ ([install](https://rustup.rs/))
- **Node.js**: 18+ ([install](https://nodejs.org/))
- **Docker**: 20.10+ ([install](https://docs.docker.com/get-docker/)) - optional for local Stellar network
- **Stellar CLI**: Latest ([install](https://github.com/stellar/stellar-cli))

## Step 1: Clone & Install Dependencies (5 min)

```bash
git clone https://github.com/soterika/aura-vault-protocol.git
cd aura-vault-protocol

# Install Rust target for WASM
rustup target add wasm32-unknown-unknown

# Install Node dependencies
npm install
cd ui && npm install && cd ..
```

## Step 2: Environment Configuration (5 min)

### Copy environment templates

```bash
# Backend
cp backend/.env.example backend/.env.local

# Frontend
cp .env.staging.example .env.local
```

### Edit `.env.local`

```bash
# Stellar testnet (default)
STELLAR_NETWORK=testnet
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
ADMIN_KEYPAIR=S...  # Your testnet keypair
```

Get a testnet keypair:

```bash
stellar keys generate test-key --network testnet
stellar account fund GABC...  # Fund with XLM from faucet
```

## Step 3: Build Contract (5 min)

```bash
cd aura-vault
cargo build --target wasm32-unknown-unknown --release
cargo test  # Verify all 22 tests pass
```

Expected output:
```
test result: ok. 22 passed; 0 failed; 0 ignored; 0 measured
```

## Step 4: Deploy to Testnet (10 min)

```bash
# Set network
export STELLAR_NETWORK=testnet

# Upload WASM
WASM_HASH=$(stellar contract upload \
  --wasm target/wasm32-unknown-unknown/release/aura_vault.wasm \
  --source test-key \
  --network $STELLAR_NETWORK \
  --output json | jq -r '.wasm_id')

echo "WASM Hash: $WASM_HASH"

# Deploy instance
CONTRACT_ID=$(stellar contract deploy \
  --wasm-hash "$WASM_HASH" \
  --source test-key \
  --network $STELLAR_NETWORK \
  --output json | jq -r '.contract_id')

echo "Contract: $CONTRACT_ID"

# Initialize (use your account public key)
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source test-key \
  --network $STELLAR_NETWORK \
  -- initialize \
  --admin "GABC..." \
  --underlying_token "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4"
```

## Step 5: Start Frontend (5 min)

```bash
cd ui
npm run dev
```

Open http://localhost:5173 in your browser.

## Development Workflow

### Running Tests

```bash
# Contract tests
cd aura-vault && cargo test

# Frontend unit tests
cd ui && npm test

# Accessibility tests
cd ui && npm run test:a11y

# Load tests (requires k6)
cd ui && npm run test:load
```

### Storybook (Component Development)

```bash
cd ui
npm run storybook
# Opens http://localhost:6006
```

### Type Checking

```bash
cd ui && npm run build  # Includes TypeScript check
```

### Linting

```bash
cd ui && npm run lint  # ESLint
cd aura-vault && cargo clippy  # Rust linting
```

## Common Tasks

### Resetting Local State

```bash
# Clear contract storage on testnet
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source test-key \
  --network testnet \
  -- reset  # If contract has reset function

# Or redeploy to new contract ID
```

### Viewing Contract State

```bash
# Check total assets
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --network testnet \
  -- total_assets

# Check user balance
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --network testnet \
  -- balance_of \
  --address "GABC..."
```

### Checking Events

```bash
# Use Stellar Expert or Dashboard
# https://testnet.steexp.com/contract/$CONTRACT_ID
```

## Troubleshooting

### WASM Build Fails
```bash
# Clean build
cd aura-vault
cargo clean
cargo build --target wasm32-unknown-unknown --release
```

### Tests Fail
```bash
# Check for dependency issues
cargo update
cargo test --verbose
```

### Contract Won't Initialize
- Verify token contract ID is valid on testnet
- Check admin keypair is funded with XLM
- Confirm network is set to testnet

### Frontend Won't Connect
- Verify `VITE_STELLAR_NETWORK=testnet` in `.env.local`
- Check contract ID is correct
- Clear browser cache (Ctrl+Shift+Delete)

## IDE Setup

### VS Code

1. Install extensions:
   - Rust Analyzer
   - Soroban (Stellar)
   - ESLint
   - Prettier

2. Create `.vscode/settings.json`:
```json
{
  "rust-analyzer.checkOnSave.command": "clippy",
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode"
}
```

### Neovim/Vim

```bash
# Install rust-analyzer
rustup component add rust-analyzer

# LSP config for Rust
# See nvim-lspconfig documentation
```

## Next Steps

1. Read INTEGRATION_GUIDE.md for API details
2. Check ui/stories/ for component examples
3. Join [Stellar Dev Discord](https://discord.gg/stellardev)
4. Review GOVERNANCE_IMPLEMENTATION.md for multi-sig

## Getting Help

- **Errors**: Check logs in `.env.local` for network/contract issues
- **Contract**: Read aura-vault/README.md
- **UI**: See ui/README.md and Storybook components
- **Community**: Post in [Stellar Developers forum](https://developers.stellar.org/community)
