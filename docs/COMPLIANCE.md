# Aura Vault Protocol — Institutional Compliance Guide

**Document version:** 1.0.0  
**Last updated:** 2026-07-25  
**Applies to:** AuraVault Soroban smart contract and associated protocol infrastructure  

> **Disclaimer:** This document is provided for informational purposes only and does not constitute legal, financial, regulatory, or investment advice. Institutions should obtain independent legal and compliance counsel before interacting with the protocol.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Smart Contract Audit Reports](#2-smart-contract-audit-reports)
3. [Open-Source Code Verification](#3-open-source-code-verification)
4. [Token Classification](#4-token-classification)
5. [AML/KYC Capabilities](#5-amlkyc-capabilities)
6. [Data Residency and Privacy Practices](#6-data-residency-and-privacy-practices)
7. [Legal Disclaimer and Terms of Service](#7-legal-disclaimer-and-terms-of-service)
8. [Contact and Governance](#8-contact-and-governance)

---

## 1. Executive Summary

AuraVault is an open-source, non-custodial, permissionless yield vault smart contract deployed on the Stellar blockchain using the Soroban smart contract platform. It aggregates deposits of a single SEP-41-compatible token, issues proportional vault shares to depositors, and auto-compounds yield through permissionless keeper harvests.

Key compliance characteristics:

| Property | Value |
|---|---|
| Contract type | Non-custodial yield vault |
| Blockchain | Stellar (Soroban / WebAssembly) |
| License | MIT (fully open source) |
| Admin controls | Emergency pause, fee management, governance |
| Custody of user funds | None — funds remain in smart contract, user retains key control |
| Personal data collected | None on-chain |
| External audit | Internal security audit completed (see Section 2) |
| Upgrade mechanism | Admin-controlled WASM upgrade with governance proposal system |

---

## 2. Smart Contract Audit Reports

### 2.1 Audit Summary

An internal security audit of the AuraVault smart contract has been completed. The audit covered all Soroban contract source files and found **no high-risk vulnerabilities**.

| Report | Location |
|---|---|
| Security Audit Report | [`SECURITY_AUDIT_REPORT.md`](../SECURITY_AUDIT_REPORT.md) |
| Full Audit Document | [`AUDIT.md`](../AUDIT.md) |
| Security Policy | [`SECURITY.md`](../SECURITY.md) |

**Audit scope:**  
`aura-vault/src/lib.rs`, `errors.rs`, `storage.rs`, `fee.rs`, `governance.rs`, `interface.rs`

**Attack vectors assessed:**

| Category | Result |
|---|---|
| Reentrancy | ✅ Mitigated (CEI ordering + Soroban execution model) |
| Integer Overflow/Underflow | ✅ Mitigated (`checked_*` arithmetic + `overflow-checks = true`) |
| Access Control | ✅ Mitigated (admin + signer whitelist enforced) |
| Flash Loan Attacks | ✅ Mitigated (balance-equality guard on every mutating call) |
| Share Inflation (ERC-4626 style) | ✅ Mitigated (zero-share mint rejection fence) |
| Emergency Pause | ✅ Implemented (admin-only halt mechanism) |

**Continuous automated scanning (CI/CD):**

- `cargo audit` — scans Rust dependencies against the RustSec Advisory Database on every push
- `cargo clippy` — enforces security-relevant lint denials (`unwrap_used`, `integer_arithmetic`, `cast_sign_loss`, etc.)
- `trivy` — container image CVE scanning
- CodeQL — static analysis on JavaScript/TypeScript code

### 2.2 Third-Party Audit Status

A third-party audit by an independent security firm is **recommended before mainnet deployment with significant TVL**. The protocol maintains a responsible disclosure process described in [`SECURITY.md`](../SECURITY.md).

To request or reference audit reports, contact the maintainers via the governance process described in [`GOVERNANCE.md`](../GOVERNANCE.md).

---

## 3. Open-Source Code Verification

### 3.1 Source Code Location

The complete source code is publicly available under the MIT license:

- **Repository:** `https://github.com/soterika/aura-vault-protocol`
- **Contract source:** `aura-vault/src/`
- **License:** [`MIT`](../LICENSE) (see repository root)

### 3.2 Build Reproducibility

The AuraVault contract compiles to a deterministic WebAssembly binary. Institutions can independently reproduce and verify the deployed contract Wasm.

**Prerequisites:**

```bash
# Install Rust stable toolchain
rustup default stable
rustup target add wasm32-unknown-unknown
```

**Build from source:**

```bash
git clone https://github.com/soterika/aura-vault-protocol.git
cd aura-vault-protocol

# Pin to a specific audited commit or tag
git checkout <audited-commit-sha>

# Build the deployable Wasm
cargo build \
  --manifest-path aura-vault/Cargo.toml \
  --target wasm32-unknown-unknown \
  --release

# Compute SHA-256 of the compiled binary
sha256sum aura-vault/target/wasm32-unknown-unknown/release/aura_vault.wasm
```

### 3.3 On-Chain Wasm Hash Verification

Once the Wasm is uploaded to Stellar, the network stores the SHA-256 hash of the binary. You can verify that the on-chain contract matches the source you compiled:

```bash
# Retrieve the Wasm hash from the deployed contract instance
stellar contract info \
  --id <contract-id> \
  --network mainnet

# Compare against locally compiled hash
sha256sum aura-vault/target/wasm32-unknown-unknown/release/aura_vault.wasm
```

If the hashes match, the deployed contract is byte-for-byte identical to the audited source code.

### 3.4 Dependency Verification

All Rust dependencies are pinned in `aura-vault/Cargo.lock`. Verify the dependency tree:

```bash
# Audit for known CVEs
cargo install cargo-audit
cargo audit --manifest-path aura-vault/Cargo.toml

# Inspect full dependency tree
cargo tree --manifest-path aura-vault/Cargo.toml
```

---

## 4. Token Classification

### 4.1 Nature of Vault Shares

When a user deposits underlying tokens into AuraVault, the contract mints proportional **vault shares**. These shares:

- Represent a **pro-rata claim** on the vault's underlying token pool, including accrued yield
- Are implemented as an internal `i128` balance stored per address in Soroban persistent storage
- Can be redeemed at any time for the proportional share of underlying tokens via the `withdraw` function
- Are **not** transferable between addresses within the current contract (no ERC-20-style `transfer` function)

### 4.2 Utility Token Characteristics

AuraVault vault shares exhibit characteristics of **utility tokens** rather than securities:

| Characteristic | AuraVault Shares |
|---|---|
| Represent equity ownership in an entity | ❌ No |
| Carry voting rights in a company | ❌ No |
| Entitle holder to profit distributions from a business | ❌ No |
| Represent a claim on protocol-managed yield | ✅ Yes |
| Redeemable for underlying asset on demand | ✅ Yes |
| Utility: track proportional position in a yield vault | ✅ Yes |
| Issued by a centralised issuer | ❌ No — contract logic is autonomous |

Vault shares function as **accounting units** within the protocol — they track a user's proportional ownership of a pool of tokens managed by immutable on-chain logic.

### 4.3 Regulatory Considerations

> **Important:** Token classification under securities law varies significantly by jurisdiction. The characterisation above is a technical description, not legal advice.

Institutions should consult qualified legal counsel to determine:

- Whether vault shares constitute securities under applicable local law (e.g. Howey test in the US, MiCA classification in the EU)
- Whether operating or recommending access to the protocol triggers licensing requirements
- Tax treatment of yield accrual and share redemption

**Key factors that may influence classification:**

- The protocol is **permissionless** — any address may interact directly with the on-chain contract
- The protocol **does not** manage funds on behalf of users; it executes deterministic on-chain logic
- Yield originates from external keepers injecting tokens, not from investment activities of a promoter
- The underlying token type will affect classification (a stablecoin vault differs from a volatile asset vault)

---

## 5. AML/KYC Capabilities

### 5.1 Default Protocol Behaviour

AuraVault is a **permissionless protocol** by design. In its default configuration:

- Any Stellar account address can call `deposit`, `withdraw`, and `harvest`
- No identity verification is performed at the contract level
- No address screening against sanctions lists occurs on-chain

This is consistent with the technical nature of public blockchain infrastructure, where the smart contract layer enforces financial logic rather than identity rules.

### 5.2 Admin Controls Available

While the protocol is permissionless by default, the contract includes **admin-controlled levers** that can be used to restrict access:

#### Emergency Pause

The admin can immediately halt **all deposits, withdrawals, and harvests** via:

```
pause(admin: Address) → Result<(), VaultError>
unpause(admin: Address) → Result<(), VaultError>
is_paused() → bool
```

This is a global pause — it applies to all users. It is designed for emergency response (e.g. detection of an exploit), not routine KYC enforcement.

#### Governance System

The contract includes a multi-signer governance system (`governance.rs`) supporting:

- **Proposal creation** — authorised signers propose parameter changes, admin updates, or token updates
- **Voting** — signers vote to approve or reject proposals
- **Execution** — approved proposals execute after a timelock period
- **Signer whitelist** — only addresses in the `signers` list passed to `initialize()` can create and vote on governance proposals

#### Fee Administration

The admin controls performance fees, management fees, and treasury address. These can be used to redirect fee flows to compliant entities.

### 5.3 Off-Chain KYC Integration Pattern

For institutions deploying a **whitelisted or permissioned frontend**, the recommended integration pattern is:

```
[User] → [Institution KYC Gate] → [Compliant Frontend] → [AuraVault Contract]
```

1. **Off-chain identity verification:** The institution's web application collects and verifies user identity before generating a transaction.
2. **Address allowlist:** The institution maintains an off-chain registry of KYC'd Stellar addresses.
3. **Frontend enforcement:** The institution's frontend only submits transactions to the contract from KYC'd addresses.
4. **Smart contract layer:** The AuraVault contract executes the transaction permissionlessly once submitted to the network.

> **Note:** The smart contract itself does not enforce the KYC gate — that is a frontend and product-layer concern. On-chain, any address with sufficient token balance can interact with the contract directly (bypassing the institution's frontend). Institutions must account for this when designing their compliance posture.

#### Future Whitelist Mechanism

A **per-address whitelist** at the contract level (e.g. a `DataKey::Whitelist(Address)` flag gating `deposit`) could be added via a governance proposal and contract upgrade. This would enforce access control on-chain. Contact the governance signers to propose this enhancement if required.

### 5.4 Sanctions Screening

The protocol does not perform real-time OFAC/sanctions screening. Institutions operating regulated services that offer access to AuraVault should implement:

- Address screening against OFAC SDN list and equivalent sanctions lists at the frontend/API layer
- Transaction monitoring for suspicious patterns
- Reporting obligations per applicable jurisdiction (e.g. FINCEN SARs in the US)

Tools like [Chainalysis](https://www.chainalysis.com/), [Elliptic](https://www.elliptic.co/), or [TRM Labs](https://www.trmlabs.com/) can be integrated at the API layer for real-time address screening.

---

## 6. Data Residency and Privacy Practices

### 6.1 On-Chain Data (Stellar Ledger)

All data stored by the AuraVault smart contract is **public on the Stellar ledger**:

| Data | Storage Type | Public? |
|---|---|---|
| Admin address | Instance storage | ✅ Yes |
| Underlying token address | Instance storage | ✅ Yes |
| Total shares | Instance storage | ✅ Yes |
| Total deposited | Instance storage | ✅ Yes |
| Per-address share balance | Persistent storage | ✅ Yes |
| Pause state | Instance storage | ✅ Yes |
| Fee configuration | Instance storage | ✅ Yes |
| Governance proposals | Instance storage | ✅ Yes |

**No personal data is stored on-chain.** The contract stores Stellar account addresses (public keys), which are pseudonymous identifiers — not names, email addresses, or other personal information.

Stellar account addresses may be linkable to real-world identities through chain analysis or exchange KYC records. Institutions should treat on-chain addresses as pseudonymous, not anonymous.

### 6.2 Data Residency

Stellar is a **globally distributed** public blockchain. The ledger state (including AuraVault contract data) is:

- Replicated across validator nodes worldwide
- Not confined to any single jurisdiction or data centre
- Publicly accessible to anyone

There is no mechanism within the protocol to restrict ledger data to a specific geographic region. This is an inherent property of public blockchain infrastructure.

**Implication for GDPR/CCPA:** Stellar account addresses may constitute personal data under some regulatory frameworks if they can be linked to identified individuals. Institutions operating in the EU should assess their obligations under GDPR Article 17 ("right to erasure") in the context of immutable blockchain data — a known tension that has been addressed in guidance from several EU data protection authorities (see [EDPB guidance on blockchain](https://edpb.europa.eu/)).

### 6.3 Off-Chain Backend Data

The AuraVault protocol includes an optional **backend API** (`backend/`) for portfolio tracking and notifications. If deployed by an institution:

- The backend collects Stellar addresses and transaction metadata for portfolio display
- Email addresses are collected if users opt into notifications (see `backend/src/services/emailService.ts`)
- Data is stored in PostgreSQL (see `backend/migrations/`)
- Data is processed in the infrastructure region where the backend is deployed

Institutions operating the backend should:

- Publish a privacy policy describing data collection and retention
- Implement data subject request handling (access, deletion) as required
- Ensure database backups comply with local data residency requirements
- Review `docs/secrets-management.md` for secrets handling practices

### 6.4 Telemetry and Analytics

The frontend includes optional analytics (`docs/analytics.md`). No analytics are collected by the smart contract itself. Frontend analytics are subject to the institution's own privacy practices.

---

## 7. Legal Disclaimer and Terms of Service

### 7.1 No Warranties

THE AURAVAULT PROTOCOL, INCLUDING ALL SMART CONTRACTS, FRONTEND INTERFACES, BACKEND SERVICES, AND DOCUMENTATION, IS PROVIDED **"AS IS"** WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED.

THE PROTOCOL CONTRIBUTORS AND MAINTAINERS MAKE NO WARRANTIES, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO WARRANTIES OF:
- Merchantability or fitness for a particular purpose
- Accuracy, completeness, or timeliness of information
- Uninterrupted or error-free operation
- Security against all possible exploits or vulnerabilities
- Compliance with applicable laws in any jurisdiction

### 7.2 Limitation of Liability

TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, THE PROTOCOL CONTRIBUTORS SHALL NOT BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES ARISING FROM:

- Use of or inability to use the protocol
- Loss of funds due to smart contract vulnerabilities, network failures, or user error
- Regulatory actions taken against users of the protocol
- Any third-party actions affecting the underlying Stellar network

### 7.3 No Financial or Legal Advice

Nothing in this documentation or in the protocol itself constitutes:

- Financial advice or investment recommendations
- Legal advice or regulatory guidance
- Tax advice
- An offer to sell or a solicitation to buy any financial instrument

Users interact with the protocol **at their own risk** and are solely responsible for compliance with applicable laws in their jurisdiction.

### 7.4 Regulatory Compliance Responsibility

It is the **sole responsibility** of each user and institution to:

- Determine whether use of the protocol is lawful in their jurisdiction
- Obtain all necessary licences, registrations, and approvals
- Comply with applicable AML, KYC, sanctions, securities, and tax laws
- Ensure their use of the protocol does not facilitate illegal activity

The protocol is neutral infrastructure. Its deployment and use by regulated entities does not imply any regulatory endorsement or exemption.

### 7.5 Protocol Upgradability

AuraVault supports **admin-controlled Wasm upgrades** via the `upgrade()` function. This means:

- The contract logic can be changed by the admin after a governance vote
- Future versions may behave differently from the version described in this document
- Institutions should monitor governance proposals and upgrade events

Upgrade events are emitted on-chain and are auditable. The governance system requires multi-signer approval before upgrades can be executed.

### 7.6 Open Source License

The AuraVault codebase is released under the **MIT License**. This permits free use, modification, and distribution, subject to the license terms. The MIT License does not impose regulatory compliance obligations — those remain the responsibility of each operator.

### 7.7 Acknowledgement

By deploying, integrating, or otherwise using the AuraVault protocol, users and institutions acknowledge that they have read and understood this compliance guide, accept the disclaimers and limitations stated herein, and agree to comply with all applicable laws and regulations.

---

## 8. Contact and Governance

### 8.1 Governance

Protocol governance is managed through the on-chain proposal system and documented in:

- [`GOVERNANCE.md`](../GOVERNANCE.md) — governance process overview
- [`GOVERNANCE_USAGE.md`](../GOVERNANCE_USAGE.md) — usage guide for governance participants

To propose protocol changes (including compliance enhancements such as on-chain whitelisting), authorised signers may submit a governance proposal via the `propose_parameter_update` or `propose_update_admin` contract functions.

### 8.2 Security Disclosures

To report a security vulnerability, follow the responsible disclosure process in [`SECURITY.md`](../SECURITY.md). Do **not** disclose security vulnerabilities publicly before contacting the maintainers.

### 8.3 Document Updates

This compliance guide will be updated when:

- A new external audit is completed
- Significant protocol changes are made via governance
- Regulatory guidance materially affecting the protocol is published

Institutions relying on this document for compliance purposes should monitor the repository for updates to this file.

---

*This document was prepared by the AuraVault protocol maintainers. It is not a substitute for independent legal and compliance advice.*
