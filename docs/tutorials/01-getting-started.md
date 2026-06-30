# Getting Started with Aura Vault

**Estimated time:** 5 minutes  
**What you'll learn:** How to open the app for the first time, complete the onboarding flow, and orient yourself before making your first transaction.

---

## Prerequisites

Before you begin you need:

- A Stellar-compatible wallet (e.g. Freighter, Lobstr, or any SEP-41-capable wallet)
- Some XLM for transaction fees (a few lumens is enough)
- The SEP-41 underlying token that the vault accepts (check the vault's token address in the README)
- A modern browser (Chrome, Firefox, Edge, or Safari — latest version recommended)

---

## Step 1 — Open the App

Navigate to the Aura Vault URL in your browser. The page loads a single-page application with a header that reads **"Aura Vault"** and three tab buttons: **Deposit**, **Withdraw**, and **Harvest**.

> **Tip:** Bookmark the exact URL right now. Phishing sites often mimic DeFi apps with nearly identical URLs. Always verify you are on the correct domain before connecting your wallet or signing any transaction.

---

## Step 2 — Complete the Onboarding Flow

If this is your first visit (or you have never completed onboarding before), a modal dialog appears automatically over the page. It walks you through five informational steps:

| Step | Title | What it covers |
|------|-------|----------------|
| 1 of 5 | Welcome to Aura Vault | Protocol overview — deposit, earn, harvest on-chain |
| 2 of 5 | Deposit & Earn | How the Deposit tab works and when yield starts accruing |
| 3 of 5 | Withdraw Anytime | How to reclaim tokens, no lock-up periods |
| 4 of 5 | Harvest Rewards | How the Harvest tab compounds gains |
| 5 of 5 | Stay Secure | Key security reminders before you transact |

**Navigation controls inside the modal:**

- **Next** — advance to the next step
- **Back** — return to the previous step (appears from step 2 onward)
- **Get Started** — appears on the last step; closes the modal and saves your progress
- **Skip** — dismisses the modal immediately without going through all steps

A progress bar at the top of the modal shows how far through the five steps you are. The dots below it are clickable — you can jump to any step directly.

Once you click **Get Started** (or **Skip**), the modal closes and the main UI is accessible. The app remembers your choice in browser `localStorage`, so the modal will not reappear on future visits in the same browser.

> **Note:** If you want to see the onboarding flow again later — for example after clearing your browser data — simply clear `localStorage` for the site and refresh.

---

## Step 3 — Understand What You're Looking At

After onboarding the main screen has three sections:

1. **Header** — displays the "Aura Vault" title.
2. **Tab navigation** — three buttons (`Deposit`, `Withdraw`, `Harvest`) that switch the active panel.
3. **Active panel** — the form or panel for whichever tab is selected. Deposit is the default.

Each panel loads on demand (lazy-loaded), so you may briefly see a loading skeleton on a slow connection before the form appears.

---

## Step 4 — Connect Your Wallet (Application-Level)

Aura Vault interacts with the Stellar network through your wallet extension. Depending on your wallet:

1. Click the wallet extension icon in your browser toolbar.
2. Ensure you are on the **Testnet** network if you are experimenting, or **Mainnet** for real funds.
3. Confirm the wallet is unlocked and shows your public key (starts with `G…`).

Your wallet does not need to be "connected" to the page the same way EVM wallets work — on Stellar/Soroban the wallet signs individual transactions when prompted.

---

## Next Steps

You are ready to use the vault. Continue with:

- [02 — How to Deposit](./02-deposit.md)
- [03 — How to Withdraw](./03-withdraw.md)
- [04 — Dashboard Overview](./04-dashboard.md)
- [05 — Troubleshooting & Security](./05-troubleshooting-and-security.md)
