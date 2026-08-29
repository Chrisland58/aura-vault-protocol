# WalletConnect — Web3 Wallet Integration (#4)

## Overview

`WalletConnect.tsx` implements multi-wallet Web3 connection for the Aura Vault Protocol frontend.

## Features

- **Auto-detection** — Scans `window.freighterApi`, `window.ethereum`, and `window.coinbaseWalletSDK` at mount time; only shows detected wallets in the dropdown.
- **Supported wallets**
  - 🌟 **Freighter** — Stellar native wallet extension
  - 🦊 **MetaMask** — EVM browser extension
  - 💎 **Coinbase Wallet** — via `@coinbase/wallet-sdk` (dynamic import)
  - 📱 **WalletConnect** — stub ready, marked "Coming Soon"
- **Network display** — Shows network badge (ETHEREUM / TESTNET / etc.) alongside wallet type badge.
- **Session persistence** — Wallet state serialised to `localStorage` under key `aura_wallet_state`; restored on page reload.
- **Remember last wallet** — Last connected wallet type stored under `aura_last_wallet_type`.
- **Disconnect** — Clears both localStorage keys and resets all state.
- **Error handling** — Inline error message displayed on connection failure (extension missing, user rejected, etc.).
- **Portfolio section** — When connected, fetches `total_assets` and `balance_of` from the backend API and shows share balance + price per share.

## Acceptance Criteria (Issue #4)

| Criterion | Status |
|-----------|--------|
| Connection established within 3s | ✅ — async connect + loading state |
| Supports mainnet and testnet | ✅ — chainId → network name mapping |
| Error handling for network mismatches | ✅ — error state shown inline |
| Session persistence | ✅ — localStorage restore on mount |
| Auto-detect installed wallets | ✅ — `getInstalledWallets()` |
| Multiple wallet types | ✅ — Freighter, MetaMask, Coinbase, WalletConnect |
| Disconnect functionality | ✅ — `disconnect()` callback |

## File

`frontend/src/components/WalletConnect.tsx`
