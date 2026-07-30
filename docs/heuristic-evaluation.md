# Heuristic Evaluation Report — Aura Vault Protocol UI

**Evaluator:** Internal UX Review  
**Date:** 2026-07-29  
**Method:** Solo expert walkthrough against Nielsen's 10 Usability Heuristics  
**Scope:** All production UI screens accessible via the Next.js frontend

---

## Evaluation Method

Each screen was inspected against Nielsen's 10 Usability Heuristics. Violations are rated on a 4-point severity scale:

| Severity | Label | Description |
|---|---|---|
| 1 | Cosmetic | Minor polish issue; fix only if time permits |
| 2 | Minor | Causes friction but has a workaround; fix in next sprint |
| 3 | Major | Significantly impairs task completion; fix before next release |
| 4 | Catastrophic | Blocks task completion or causes data loss; fix immediately |

---

## Screens Evaluated

| # | Screen | Route | Description |
|---|---|---|---|
| S1 | Home | `/` | Landing page with navigation links and deploy CTA |
| S2 | Dashboard | `/dashboard` | Vault stats grid (TVL, APY, depositor count, user position) |
| S3 | FAQ | `/faq` | Accordion-style frequently asked questions |
| S4 | Settings | `/settings` | Notifications, slippage, security, APY alerts, haptics |

---

## Findings by Screen

### S1 — Home (`/`)

| ID | Heuristic | Description | Severity |
|---|---|---|---|
| H1-01 | H1: Visibility of System Status | The home page contains a "Deploy Now" link pointing to `vercel.com/new`. This is scaffolding boilerplate and not a valid app action, giving users no feedback about what the system does or its current state (e.g., vault is live / paused). | **3 — Major** |
| H1-02 | H4: Consistency & Standards | Nav links ("Dashboard", "FAQ") are styled as `<a>` tags with a border style identical to the "Deploy Now" and "Documentation" external CTAs. Internal and external links should be visually distinct to avoid confusion. | **2 — Minor** |
| H1-03 | H6: Recognition over Recall | The page shows no vault-specific information (TVL, APY, last harvest). New users cannot form a mental model of the product without clicking into the dashboard. | **3 — Major** |
| H1-04 | H8: Aesthetic & Minimalist Design | The page body is largely a Next.js starter template. The product name "Aura Vault Protocol" appears only in the `<title>` tag; it is not rendered on the page itself. | **2 — Minor** |
| H1-05 | H10: Help & Documentation | There is no "Get started" or onboarding guidance visible above the fold. The only documentation link routes to `nextjs.org/docs`, which is irrelevant for DeFi users. | **2 — Minor** |

---

### S2 — Dashboard (`/dashboard`)

| ID | Heuristic | Description | Severity |
|---|---|---|---|
| H2-01 | H1: Visibility of System Status | When the vault is paused, there is no prominent banner or system-wide indicator on the dashboard. Users can still attempt to deposit or withdraw, learning of the pause state only after a failed transaction. | **4 — Catastrophic** |
| H2-02 | H1: Visibility of System Status | The loading state for stat cards uses animated skeletons, which is good. However there is no maximum timeout or fallback; if the API is degraded, cards spin indefinitely with no error message. | **3 — Major** |
| H2-03 | H3: User Control & Freedom | There is no "Cancel" affordance visible during a multi-step transaction (deposit/withdraw) once the signing step is initiated. Users who trigger it accidentally have no clear exit path. | **3 — Major** |
| H2-04 | H4: Consistency & Standards | Financial values are formatted inconsistently: TVL shows a locale-formatted number while APY sometimes shows raw decimals (e.g., "8.73426%"). All financial figures should use a consistent number of significant digits. | **2 — Minor** |
| H2-05 | H5: Error Prevention | The deposit form accepts any number input. There is no maximum validation against the user's wallet balance before submitting, which can surface a confusing on-chain error. | **3 — Major** |
| H2-06 | H6: Recognition over Recall | The "Share Price" card provides an absolute numeric value but no change indicator (e.g., +0.3% since last harvest). Users must recall the previous value to interpret whether the vault is performing. | **2 — Minor** |
| H2-07 | H7: Flexibility & Efficiency | Power users have no keyboard shortcut to open the deposit or withdraw modal. The keyboard shortcuts help panel exists but deposit/withdraw actions are not listed in it. | **1 — Cosmetic** |
| H2-08 | H9: Help Users Recognise Errors | When a wallet is not connected, the user-position card is hidden rather than showing an empty state with a "Connect Wallet" prompt. Users may mistake a hidden card for a loading failure. | **2 — Minor** |

---

### S3 — FAQ (`/faq`)

| ID | Heuristic | Description | Severity |
|---|---|---|---|
| H3-01 | H4: Consistency & Standards | FAQ accordion items lack visible focus indicators when navigated with a keyboard (Tab key). Focus ring styles are present in the design system but are not applied to the `<summary>` or toggle elements in `FAQPage.tsx`. | **3 — Major** |
| H3-02 | H6: Recognition over Recall | There is no search or filter control on the FAQ page. With a large number of questions, users must scroll through all entries to find a relevant answer. | **2 — Minor** |
| H3-03 | H8: Aesthetic & Minimalist Design | Each FAQ item renders the full answer text on expand, including lengthy technical contract addresses and code snippets, without a "read more" collapse or copy-to-clipboard affordance for addresses. | **1 — Cosmetic** |

---

### S4 — Settings (`/settings`)

| ID | Heuristic | Description | Severity |
|---|---|---|---|
| H4-01 | H1: Visibility of System Status | The "Saved" confirmation toast disappears after 2 seconds. For users with slow cognitive processing or assistive technologies, this may not be long enough to register. The `role="status"` announcement is correct, but the visual indicator should remain visible for at least 4 seconds per WCAG 2.2 guidance. | **2 — Minor** |
| H4-02 | H2: Match Between System & Real World | The slippage tolerance section uses the term "slippage tolerance" without a tooltip or explanation. DeFi-naive users will not understand what this setting controls or the risk of high slippage. | **3 — Major** |
| H4-03 | H3: User Control & Freedom | The "Deactivate Account" confirmation dialog contains a "Confirm" button that is not connected to any action (no handler function, no API call). Users who click "Confirm" receive no feedback and the account is not actually deactivated, but they do not know that. | **4 — Catastrophic** |
| H4-04 | H5: Error Prevention | The email input in the Notifications section accepts any text; there is no client-side email format validation before saving. An invalid email is silently stored and causes silent delivery failures. | **2 — Minor** |
| H4-05 | H5: Error Prevention | The APY alert threshold input validates only on blur. If the user types an invalid value and navigates away using Tab (rather than clicking away), the invalid value is not corrected. | **1 — Cosmetic** |
| H4-06 | H6: Recognition over Recall | The "Active alerts" summary at the bottom of the APY Alert section conditionally renders, requiring users to scroll down and expand the section to review their alert status. A persistent summary badge on the Settings page title would reduce recall burden. | **1 — Cosmetic** |
| H4-07 | H9: Help Users Recognise Errors | When browser push notifications are denied and the user re-clicks "Enable," the error message ("Browser notifications were denied. Enable them in your browser settings.") is technically accurate but does not provide a direct link or step-by-step instructions for re-enabling permissions in major browsers. | **2 — Minor** |

---

## Summary Matrix

| ID | Screen | Heuristic | Severity | GitHub Issue |
|---|---|---|---|---|
| H1-01 | Home | H1 Visibility | 3 — Major | ✅ Create issue |
| H1-02 | Home | H4 Consistency | 2 — Minor | — |
| H1-03 | Home | H6 Recognition | 3 — Major | ✅ Create issue |
| H1-04 | Home | H8 Aesthetics | 2 — Minor | — |
| H1-05 | Home | H10 Help | 2 — Minor | — |
| H2-01 | Dashboard | H1 Visibility | **4 — Catastrophic** | ✅ Create issue |
| H2-02 | Dashboard | H1 Visibility | 3 — Major | ✅ Create issue |
| H2-03 | Dashboard | H3 Control | 3 — Major | ✅ Create issue |
| H2-04 | Dashboard | H4 Consistency | 2 — Minor | — |
| H2-05 | Dashboard | H5 Error Prev | 3 — Major | ✅ Create issue |
| H2-06 | Dashboard | H6 Recognition | 2 — Minor | — |
| H2-07 | Dashboard | H7 Flexibility | 1 — Cosmetic | — |
| H2-08 | Dashboard | H9 Error Recog | 2 — Minor | — |
| H3-01 | FAQ | H4 Consistency | 3 — Major | ✅ Create issue |
| H3-02 | FAQ | H6 Recognition | 2 — Minor | — |
| H3-03 | FAQ | H8 Aesthetics | 1 — Cosmetic | — |
| H4-01 | Settings | H1 Visibility | 2 — Minor | — |
| H4-02 | Settings | H2 Real World | 3 — Major | ✅ Create issue |
| H4-03 | Settings | H3 Control | **4 — Catastrophic** | ✅ Create issue |
| H4-04 | Settings | H5 Error Prev | 2 — Minor | — |
| H4-05 | Settings | H5 Error Prev | 1 — Cosmetic | — |
| H4-06 | Settings | H6 Recognition | 1 — Cosmetic | — |
| H4-07 | Settings | H9 Error Recog | 2 — Minor | — |

**Totals:** 2 Catastrophic · 7 Major · 9 Minor · 4 Cosmetic

---

## Issues Requiring GitHub Tracking

The following Major (3) and Catastrophic (4) violations must be filed as GitHub issues before next release:

| Finding | Title | Priority |
|---|---|---|
| H2-01 | Vault pause state not surfaced on dashboard | P0 |
| H4-03 | Deactivate account confirm button has no action | P0 |
| H1-01 | Home page shows Vercel boilerplate instead of vault status | P1 |
| H1-03 | Home page missing vault metrics for new user orientation | P1 |
| H2-02 | Stat card loading state has no timeout or fallback error | P1 |
| H2-03 | No "Cancel" affordance during multi-step transaction signing | P1 |
| H2-05 | Deposit form missing wallet balance upper bound validation | P1 |
| H3-01 | FAQ items missing keyboard focus ring (accessibility) | P1 |
| H4-02 | Slippage tolerance setting lacks explanation tooltip | P1 |

---

## Nielsen's 10 Heuristics Reference

| # | Heuristic |
|---|---|
| H1 | Visibility of System Status |
| H2 | Match Between System and the Real World |
| H3 | User Control and Freedom |
| H4 | Consistency and Standards |
| H5 | Error Prevention |
| H6 | Recognition Rather Than Recall |
| H7 | Flexibility and Efficiency of Use |
| H8 | Aesthetic and Minimalist Design |
| H9 | Help Users Recognise, Diagnose, and Recover from Errors |
| H10 | Help and Documentation |

---

*Report generated as part of issue #535. All Catastrophic and Major violations have been listed in the GitHub Issues Requiring Tracking table above.*
