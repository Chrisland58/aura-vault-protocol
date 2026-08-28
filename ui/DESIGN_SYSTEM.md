# Aura Vault — Design System

> **Issue**: #410  
> **Version**: 0.2.0  
> **Last Updated**: 2026-08-28  
> **Storybook**: `cd ui && npm run storybook` (planned for v0.3.0)

---

## Table of Contents

1. [Overview](#overview)
2. [Colour Tokens](#colour-tokens)
3. [Typography](#typography)
4. [Spacing](#spacing)
5. [Layout & Grid](#layout--grid)
6. [Borders & Radius](#borders--radius)
7. [Motion & Transitions](#motion--transitions)
8. [Component Reference](#component-reference)
   - [DepositForm](#depositform)
   - [WithdrawForm](#withdrawform)
   - [HarvestPanel](#harvestpanel)
   - [Skeleton / Loading States](#skeleton--loading-states)
   - [Toast](#toast)
   - [Modal](#modal)
   - [ErrorMessage](#errormessage)
   - [ErrorBoundary](#errorboundary)
   - [OnboardingFlow](#onboardingflow)
9. [Accessibility](#accessibility)
10. [Do / Don't Patterns](#do--dont-patterns)

---

## Overview

The Aura Vault UI is a dark-first, accessibility-first React application built with CSS custom properties (design tokens). All visual attributes are expressed as tokens defined in `src/styles/global.css`. Components reference tokens only — no hard-coded colour or spacing values appear in component files.

**Tech stack**: React 18, TypeScript, Vite, CSS Modules via global.css tokens.

---

## Colour Tokens

All colours are defined as CSS custom properties on `:root` in `src/styles/global.css`.

### Palette

| Token | Value | Usage |
|---|---|---|
| `--color-bg` | `#0f1117` | Page background |
| `--color-surface` | `#1a1d27` | Cards, forms, headers |
| `--color-surface-raised` | `#22263a` | Elevated surfaces, skeleton shimmer |

### Text

| Token | Value | Contrast on `--color-surface` | Usage |
|---|---|---|---|
| `--color-text` | `#e8eaf6` | 13.5:1 ✅ | Primary body copy, headings |
| `--color-text-muted` | `#9fa8c7` | 4.6:1 ✅ | Secondary labels, descriptions, placeholders |

Both text tokens meet WCAG AA (4.5:1) and `--color-text` exceeds WCAG AAA (7:1).

### Brand / Interactive

| Token | Value | Contrast on `--color-surface` | Usage |
|---|---|---|---|
| `--color-primary` | `#7c83fd` | 4.6:1 ✅ | Buttons, active tabs, links, focus rings |
| `--color-primary-hover` | `#9da3fe` | — | Button hover state |
| `--color-primary-active` | `#6269e0` | — | Button press state |

### Semantic

| Token | Value | Contrast on `--color-surface` | Usage |
|---|---|---|---|
| `--color-success` | `#4caf84` | 4.5:1 ✅ | Success toasts, done states, harvest confirmations |
| `--color-error` | `#f28b82` | 4.6:1 ✅ | Error toasts, invalid fields, error messages |
| `--color-info` | `#81d4fa` | 5.1:1 ✅ | Info toasts, informational callouts |

### Focus Ring

| Token | Value | Usage |
|---|---|---|
| `--focus-ring` | `0 0 0 3px #7c83fd80` | Applied to `:focus-visible` on all interactive elements |

### Do / Don't — Colour

✅ **Do**: Use `--color-text-muted` for secondary descriptions and helper text.  
✅ **Do**: Use `--color-error` for field validation errors and destructive actions.  
✅ **Do**: Reference tokens in CSS: `color: var(--color-text)`.  

❌ **Don't**: Hard-code hex values in component CSS. Always use tokens.  
❌ **Don't**: Use `--color-text-muted` for interactive labels that must meet 4.5:1 contrast in their context.  
❌ **Don't**: Add a light-mode palette without updating all contrast ratios.  

---

## Typography

### Font Families

| Token | Stack | Usage |
|---|---|---|
| `--font-sans` | `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` | All UI text |
| `--font-mono` | `"Fira Code", "Cascadia Code", ui-monospace, monospace` | Contract addresses, amounts, code blocks |

The system font stack ensures fast rendering with no external font loading. Monospace is used for any data that benefits from fixed-width alignment (addresses, balances, transaction hashes).

### Type Scale

Sizes are expressed in `rem` (base: 16px) to respect user browser font preferences.

| Role | Size | Weight | Element | Usage |
|---|---|---|---|---|
| App title | `1.5rem` / 24px | 700 | `h1` | Top-level app header |
| Section heading | `1.25rem` / 20px | 600 | `h2` | Page section headers |
| Form title | `1.1rem` / 17.6px | 600 | `h2.form-title` | Form panel headings |
| Body | `1rem` / 16px | 400 | `p`, `span` | All body copy |
| Label | `0.875rem` / 14px | 500 | `label` | Form field labels |
| Small / helper | `0.875rem` / 14px | 400 | `p.form-desc` | Descriptions, helper text |
| Micro | `0.8rem` / 12.8px | 400 | `p.field-error` | Inline validation errors |
| Toast | `0.9rem` / 14.4px | 500 | `.toast` | Notification messages |

### Line Height

| Context | Value |
|---|---|
| Body text | `1.6` |
| Headings | `1.2` (tight) |

### Letter Spacing

App-level `h1` uses `letter-spacing: -0.02em` to tighten large display headings. All other text uses default browser spacing.

### Do / Don't — Typography

✅ **Do**: Use `--font-mono` for contract addresses and numeric balances.  
✅ **Do**: Apply `font-size: 0.875rem` to labels for visual hierarchy below body copy.  

❌ **Don't**: Set `font-size` below `0.8rem` (12.8px); this approaches the WCAG minimum for body text.  
❌ **Don't**: Use `px` units for font sizes; use `rem` to honour user zoom preferences.  

---

## Spacing

All spacing uses an 8-point scale expressed via tokens. The base unit is `0.25rem` (4px).

| Token | Value | px equiv | Usage |
|---|---|---|---|
| `--sp-1` | `0.25rem` | 4px | Tight gaps (icon-to-label, dot spacing) |
| `--sp-2` | `0.5rem` | 8px | Button padding (vertical), small gaps |
| `--sp-3` | `0.75rem` | 12px | Form field gaps, toast padding |
| `--sp-4` | `1rem` | 16px | Component padding, section gaps |
| `--sp-6` | `1.5rem` | 24px | Card internal padding, major gaps |
| `--sp-8` | `2rem` | 32px | Page-level margins, section separation |

### Usage Rules

- Use `--sp-1` and `--sp-2` only for micro-spacing within a single element (icon + text, dot indicators).
- Use `--sp-4` as the default inner padding for cards and forms.
- Use `--sp-6` for comfortable inner padding when screen space is available.
- Use `--sp-8` for page-level outer margins (`.app-main` top margin, header padding).

### Do / Don't — Spacing

✅ **Do**: Stack spacing tokens (`gap: var(--sp-4)`) to compose layouts.  
✅ **Do**: Use `--sp-6` for `.vault-form` internal padding.  

❌ **Don't**: Mix arbitrary px values with token values in the same component.  
❌ **Don't**: Use more than `--sp-8` without a design review; larger values create excessive white space on mobile.  

---

## Layout & Grid

### App Shell

```
┌─────────────────────────────────┐
│ .app-header  (sticky, full-width)│
├─────────────────────────────────┤
│                                 │
│     .app-main                   │
│     max-width: 520px            │
│     margin: auto                │
│                                 │
└─────────────────────────────────┘
```

The main content column is constrained to **520px** to keep forms readable on widescreen without horizontal eye travel. On mobile, `padding: 0 var(--sp-4)` provides 16px side gutters.

### Tab Layout

Three tabs (Deposit, Withdraw, Harvest) use a pill-style tab list that fills the column width:

```css
.tab-list {
  display: flex;           /* horizontal row */
  gap: var(--sp-1);        /* 4px between buttons */
  background: --color-surface;
  border-radius: var(--radius-lg);
  padding: var(--sp-1);    /* inset pill effect */
}
.tab-btn { flex: 1; }      /* equal widths */
```

### Card Grid (Skeleton)

Portfolio or position cards use a responsive auto-fill grid:

```css
.skeleton-card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: var(--sp-4);
}
```

Minimum card width is 220px; cards fill available space and wrap to new rows automatically.

---

## Borders & Radius

| Token | Value | Usage |
|---|---|---|
| `--radius` | `0.5rem` / 8px | Inputs, buttons, toasts, error messages |
| `--radius-lg` | `1rem` / 16px | Cards, modals, tab list, onboarding card |

### Border Colours

| Context | Value | Token |
|---|---|---|
| Dividers / edges | `#ffffff12` | (inline — 7% white) |
| Input default | `#ffffff20` | (inline — 12% white) |
| Input hover | `#ffffff40` | (inline — 25% white) |
| Input focused | `var(--color-primary)` | |
| Input invalid | `var(--color-error)` | |

All borders are subtle in the dark theme. The focus ring on inputs is expressed via `box-shadow: var(--focus-ring)` rather than `outline` to allow border-radius to be respected.

---

## Motion & Transitions

Motion is designed to communicate state change, not decorate. All transitions respect `prefers-reduced-motion`.

### Transition Tokens

| Token | Value | Usage |
|---|---|---|
| `--transition-fast` | `150ms ease` | Hover states, focus rings, colour changes |
| `--transition-base` | `300ms ease` | Panel enter/exit, modal appear, tab switch |
| `--transition-slow` | `500ms ease` | Reserved for complex multi-element sequences |

### Reduced Motion

Under `@media (prefers-reduced-motion: reduce)`, all three tokens are set to `0ms` and `animation-duration` is forced to `0.01ms`. This means **all animations are disabled** when the user has requested reduced motion — including skeleton shimmer, tab panel fade, and modal scale.

### Named Animations

| Name | CSS | Applied To |
|---|---|---|
| `panelEnter` | `opacity 0→1, translateY 8→0` | Tab panels, error messages, onboarding content |
| `toastIn` | `opacity 0→1, translateX 100%→0` | Toast notification |
| `modalIn` | `opacity 0→1, scale 0.95→1, translateY -8→0` | Modal dialog |
| `fadeIn` | `opacity 0→1` | Modal backdrop |
| `fadeSlideIn` | `opacity 0→1, translateY 8→0` | Onboarding step content |
| `shimmer` | `background-position sweep` | Skeleton loading rows and bars |

### Do / Don't — Motion

✅ **Do**: Use `--transition-fast` for colour/opacity changes triggered by hover.  
✅ **Do**: Use `panelEnter` for any panel that mounts/unmounts conditionally.  

❌ **Don't**: Add new animations without testing under `prefers-reduced-motion`.  
❌ **Don't**: Use `--transition-slow` for interactions that require fast feedback (button clicks, input validation).  

---

## Component Reference

### DepositForm

**File**: `src/components/DepositForm.tsx`  
**Class**: `.vault-form`

A form that accepts a token amount and calls the vault's `deposit()` function. Switches to a `<Skeleton>` while the transaction is in-flight.

**Props**:
| Prop | Type | Description |
|---|---|---|
| `onToast` | `(msg: ToastMessage) => void` | Callback to show a success/error toast |

**States**:
| State | UI |
|---|---|
| Idle | Amount input + Deposit button |
| Loading | `<Skeleton rows={3} />` replaces the form |
| Field error | Inline `p.field-error` with `aria-invalid="true"` on input |
| TX error | `<ErrorMessage>` with Retry and Dismiss |
| Success | Form resets; toast fires via `onToast` |

**When to use**: On the Deposit tab. One instance per page.

**Do / Don't**:
- ✅ Do: Call `onToast` with `type: "success"` on transaction success.
- ❌ Don't: Show a success toast while `loading === true`; reset state first.
- ❌ Don't: Duplicate this component for harvest — use `HarvestPanel` instead.

---

### WithdrawForm

**File**: `src/components/WithdrawForm.tsx`  
**Class**: `.vault-form`

Identical structure to `DepositForm` but accepts a **share amount** rather than a token amount. Uses the same loading/error/success pattern.

**Props**: Same as `DepositForm`.

**When to use**: On the Withdraw tab. One instance per page.

**Do / Don't**:
- ✅ Do: Use the `shares` label on the input (not "amount") to distinguish from deposits.
- ❌ Don't: Validate shares as a percentage — validate as a raw number greater than zero and let the contract return `InsufficientShares` if the user exceeds their balance.

---

### HarvestPanel

**File**: `src/components/HarvestPanel.tsx`  
**Class**: `.vault-form`

A form for keeper-role users to inject yield into the vault via `harvest()`. Includes a subtitle (`form-desc`) explaining the action.

**Props**: Same as `DepositForm`.

**When to use**: On the Harvest tab. Typically visible only to keepers, but the contract allows any address to call `harvest()`.

**Do / Don't**:
- ✅ Do: Show the `.form-desc` subtitle — harvesting is less intuitive than deposit/withdraw.
- ❌ Don't: Hide this tab from regular users; anyone can trigger a harvest.

---

### Skeleton / Loading States

**File**: `src/components/Skeleton.tsx`

Five exported components for different loading contexts:

| Export | Class | Use When |
|---|---|---|
| `<Skeleton rows={n}>` | `.skeleton-wrapper` | Loading any content with unknown structure |
| `<CardSkeleton cards={n}>` | `.skeleton-card-grid` | Loading a grid of vault/position cards |
| `<TableSkeleton rows cols>` | `.skeleton-table` | Loading tabular data (tx history, leaderboard) |
| `<GraphSkeleton bars={n}>` | `.skeleton-graph` | Loading yield charts, APY graphs |
| `<FormSkeleton fields={n}>` | `.skeleton-form` | Loading a form whose fields are not yet known |
| `<LoadingIndicator label progress>` | `.loading-indicator` | Inline progress (determinate or indeterminate) |

All skeleton components set `role="status"` + `aria-busy="true"` + a visually-hidden `.sr-only` message for screen readers.

The shimmer animation (`@keyframes shimmer`) sweeps a lighter gradient from right to left over `1.4s infinite`. Under reduced motion, the animation is disabled; the skeleton renders as a static grey placeholder.

**Do / Don't**:
- ✅ Do: Swap the real content in for the skeleton on the same conditional — `loading ? <Skeleton /> : <RealContent />`.
- ✅ Do: Use `<FormSkeleton>` inside `DepositForm`, `WithdrawForm`, and `HarvestPanel` when `loading === true`.
- ❌ Don't: Show a skeleton for longer than the expected load time; if a call might never resolve, show an error state instead.
- ❌ Don't: Nest skeletons. Use a single appropriate variant for the context.

---

### Toast

**File**: `src/components/Toast.tsx`  
**Class**: `.toast`

A temporary status notification that auto-dismisses after a configurable duration (default 4000ms).

**Props**:
| Prop | Type | Default | Description |
|---|---|---|---|
| `message` | `ToastMessage` | required | `{ type: "success" | "error" | "info", text: string }` |
| `onDismiss` | `() => void` | required | Called when auto-dismissed or close button clicked |
| `duration` | `number` | `4000` | Time in ms before auto-dismiss |

**Variants**:
| Class | Background | Border | When |
|---|---|---|---|
| `.toast--success` | `#1b3a2d` | `--color-success` | Transaction confirmed |
| `.toast--error` | `#3a1b1b` | `--color-error` | Transaction failed |
| `.toast--info` | `#1b2e3a` | `--color-info` | Informational status |

The toast appears bottom-right (`position: fixed; bottom: var(--sp-6); right: var(--sp-6)`) with a slide-in animation. It sets `aria-live="polite"` so screen readers announce it without interrupting.

**Do / Don't**:
- ✅ Do: Use `type: "success"` on confirmed transactions, `type: "error"` on failures.
- ✅ Do: Keep toast text brief — one sentence maximum.
- ❌ Don't: Use a toast for errors that require user action (e.g., insufficient balance). Use `<ErrorMessage>` inline instead.
- ❌ Don't: Stack multiple toasts simultaneously. Queue them or replace.

---

### Modal

**File**: `src/components/Modal.tsx`  
**Class**: `.modal`

A portal-rendered dialog with backdrop, focus trap, and Escape-to-close.

**Props**:
| Prop | Type | Description |
|---|---|---|
| `isOpen` | `boolean` | Controls visibility |
| `title` | `string` | Dialog title (renders in `.modal-header`) |
| `onClose` | `() => void` | Called on backdrop click or Escape key |
| `children` | `ReactNode` | Dialog body content |

**Accessibility**: Sets `role="dialog"`, `aria-modal="true"`, `aria-labelledby` pointing to the title `h2`. Pressing Escape fires `onClose`. The dialog `div` receives `tabIndex={-1}` and is focused on open via `useEffect`.

**Do / Don't**:
- ✅ Do: Use Modal for confirmation dialogs (e.g., "Confirm withdrawal of 500 shares?").
- ✅ Do: Pass a descriptive `title` — it is read by screen readers on dialog open.
- ❌ Don't: Use Modal for non-blocking notifications; use Toast instead.
- ❌ Don't: Render a Modal without an `onClose` handler — users must always be able to dismiss it.

---

### ErrorMessage

**File**: `src/components/ErrorMessage.tsx`  
**Class**: `.error-msg`

An inline error display shown within a form after a failed transaction or API call. Includes optional Retry and Dismiss actions.

**Props**:
| Prop | Type | Description |
|---|---|---|
| `error` | `UserError` | `{ message, action?, retryable, severity }` |
| `onRetry` | `() => void` | Optional. Shown only when `error.retryable === true` |
| `onDismiss` | `() => void` | Optional. Shows a Dismiss link |

**Variants**:
| Class | Border | When |
|---|---|---|
| `.error-msg--error` | `--color-error` | Hard failures (contract error, network error) |
| `.error-msg--warning` | `#ffb74d` | Soft warnings (non-critical issues) |

Sets `role="alert"` + `aria-live="assertive"` so the error is immediately announced to screen readers without user navigation.

**Do / Don't**:
- ✅ Do: Show `<ErrorMessage>` inside the form, directly above the submit button.
- ✅ Do: Set `error.retryable = true` for network timeouts; set it `false` for invalid input errors.
- ❌ Don't: Show both a Toast error and an ErrorMessage for the same failure. Use Toast for transient notifications; ErrorMessage for persistent, actionable errors.

---

### ErrorBoundary

**File**: `src/components/ErrorBoundary.tsx`  
**Class**: `.error-boundary`

A React class component that catches unhandled render errors and shows a full-panel fallback UI instead of a blank screen.

**Props**: `children: ReactNode`

**When to use**: Wrap the top-level app content and any independently rendered panel. A caught error renders a centred message with an icon, title, and body text.

**Do / Don't**:
- ✅ Do: Wrap the root `<App>` in an ErrorBoundary.
- ✅ Do: Wrap individual sections (e.g., the Harvest panel) in their own ErrorBoundary so one panel's failure doesn't crash the whole app.
- ❌ Don't: Use ErrorBoundary to handle expected async errors (network calls, contract errors). Those should use the `error` state pattern with `<ErrorMessage>`.

---

### OnboardingFlow

**File**: `src/components/OnboardingFlow.tsx`  
**Class**: `.onboarding-overlay`

A 5-step modal overlay shown to first-time users. Reads from and writes to `localStorage` to track completion. Can be skipped.

**Steps** (built-in, not configurable via props):
1. Welcome to Aura Vault
2. Deposit & Earn
3. Withdraw Anytime
4. Harvest Rewards
5. Stay Secure

**Props**:
| Prop | Type | Description |
|---|---|---|
| `onComplete` | `() => void` | Called when user completes or skips onboarding |

**Exports**:
| Export | Description |
|---|---|
| `OnboardingFlow` | The main component |
| `hasCompletedOnboarding()` | Returns `true` if the user has seen onboarding before |
| `resetOnboarding()` | Clears the localStorage flag (useful in settings or tests) |

**Accessibility**: `role="dialog"`, `aria-modal="true"`, progress bar with `role="progressbar"` + `aria-valuenow/min/max`. Step content refreshes on each step change via `key={step}` to trigger the `fadeSlideIn` animation.

**Do / Don't**:
- ✅ Do: Gate the component with `hasCompletedOnboarding()` in `App.tsx` — don't render it on every load.
- ✅ Do: Call `resetOnboarding()` in a Settings page so users can replay the walkthrough.
- ❌ Don't: Block all UI interaction while onboarding is shown. The overlay uses `backdrop-filter: blur` but the underlying content remains in the DOM.
- ❌ Don't: Add more than 6–7 steps; the dot indicator and attention span both degrade.

---

## Accessibility

The design system is built to meet **WCAG 2.1 AA** minimum standards.

### Contrast

All text colour / background combinations meet 4.5:1 minimum contrast (see [Colour Tokens](#colour-tokens)). Primary text (`--color-text`) exceeds AAA (7:1).

### Focus Management

- `:focus-visible` receives `outline: 3px solid var(--color-primary)` + `box-shadow: var(--focus-ring)`.
- Mouse users see no outline (`:focus:not(:focus-visible) { outline: none }`).
- Modal dialogs and OnboardingFlow trap focus and restore it on close.
- A `.skip-link` at the top of the page allows keyboard users to jump past navigation.

### ARIA Patterns

| Element | ARIA |
|---|---|
| Forms | `aria-labelledby` on `<section>` pointing to `<h2>` |
| Invalid inputs | `aria-invalid="true"` + `aria-describedby` pointing to error paragraph |
| Error paragraph | `role="alert"` (announced immediately) |
| Toast | `role="status"` + `aria-live="polite"` + `aria-atomic="true"` |
| ErrorMessage | `role="alert"` + `aria-live="assertive"` |
| Skeleton | `role="status"` + `aria-busy="true"` + `.sr-only` text |
| Modal | `role="dialog"` + `aria-modal="true"` + `aria-labelledby` |
| Progress bars | `role="progressbar"` + `aria-valuenow/min/max` |

### Reduced Motion

All animations and transitions are disabled when the user enables "Reduce Motion" in their OS. The system CSS ensures no animation plays — components do not need to check this themselves.

---

## Do / Don't Patterns

### Forms

✅ **Do**: Always pair a `<label>` with its input via `htmlFor` / `id`.  
✅ **Do**: Show validation errors inline below the field, not in a modal or toast.  
✅ **Do**: Use `aria-invalid="true"` and `aria-describedby` when a field has an error.  
✅ **Do**: Disable the submit button with `disabled` while a transaction is in-flight.  

❌ **Don't**: Validate only on submit — validate on `blur` too (after the user leaves the field).  
❌ **Don't**: Use `placeholder` as a label replacement.  
❌ **Don't**: Use red text alone to indicate an error — pair it with an icon or text prefix (`⚠`).  

### Feedback

✅ **Do**: Show a `<Skeleton>` immediately when a loading state begins.  
✅ **Do**: Use `type: "success"` toasts to confirm transactions.  
✅ **Do**: Show `<ErrorMessage>` for errors that require the user to take action.  

❌ **Don't**: Leave the UI in a loading state indefinitely — set a timeout and show an error.  
❌ **Don't**: Show both a toast and an inline error message for the same failure.  

### Tokens

✅ **Do**: Use `var(--color-*)` for all colours.  
✅ **Do**: Use `var(--sp-*)` for all spacing.  
✅ **Do**: Use `var(--transition-fast)` for hover colour changes.  

❌ **Don't**: Hard-code any colour value in component CSS.  
❌ **Don't**: Add new tokens without updating this document.  
❌ **Don't**: Use `margin-top` and `margin-bottom` together — pick one direction and use `gap` in flex/grid containers.  

---

*Storybook integration is planned for v0.3.0. Until then, component demos can be run via `cd ui && npm run dev`.*
