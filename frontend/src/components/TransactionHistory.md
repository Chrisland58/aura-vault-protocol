# TransactionHistory — Filterable Data Grid (#5)

## Overview

`TransactionHistory.tsx` implements a high-performance transaction history table for the Aura Vault Protocol frontend, capable of handling 10,000+ transactions with sub-500ms filter response.

## Features

- **Columns** — Date (relative + absolute tooltip), Type (icon + colour-coded), Amount (signed, monospace), Status (badge with icon), Hash (truncated, links to block explorer)
- **Filtering**
  - Search by transaction hash
  - Filter by Type: Deposit / Withdraw / Harvest / All
  - Filter by Status: Confirmed / Pending / Failed / All
  - Date range (from / to)
  - Clear all filters button
- **Sorting** — Click any column header (Date, Amount, Status) to sort ascending/descending; aria-sort attributes for accessibility
- **Pagination** — 25 / 50 / 100 items per page selector; first/prev/next/last navigation; results count display
- **Export** — "Export CSV" downloads filtered+sorted transactions as `transactions.csv`
- **Compact mode** — Toggle to reduce row height and hide the hash column
- **Keyboard navigation** — All controls (table headers, pagination, filters) are keyboard-accessible; tabIndex + Enter key support on sort headers
- **Accessibility** — WCAG-compliant colour system via `FinancialBadge` (icon + label, not colour alone); `aria-sort`, `aria-label`, `role="grid"`, `role="alert"` on error
- **Financial colour tokens** — Status and type colours use CSS variables (`--fin-positive`, `--fin-negative`, `--fin-warning`) for light/dark mode compatibility

## Acceptance Criteria (Issue #5)

| Criterion | Status |
|-----------|--------|
| Display: Date, Type, Amount, Status, Hash | ✅ |
| Filter by: Type, Date Range, Status | ✅ |
| Sort by: Date, Amount, Status | ✅ |
| Pagination (25/50/100 items per page) | ✅ |
| Click to view transaction on block explorer | ✅ — configurable `explorerBase` prop |
| Handles 10,000+ transactions | ✅ — pure `useMemo` filtering/sorting; no virtualisation needed at 100 rows/page |
| Search/filter response < 500ms | ✅ — synchronous memo, no async overhead |
| Keyboard navigation support | ✅ — tabIndex, Enter key, aria-sort |
| Export functionality | ✅ — CSV export of filtered/sorted data |

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `transactions` | `Transaction[]` | required | Full transaction list |
| `explorerBase` | `string` | Stellar testnet explorer | Base URL for hash links |
| `tokenSymbol` | `string` | `"USDC"` | Token symbol shown in amount column |
| `shareSymbol` | `string` | `"aUSDC"` | Share token symbol |

## File

`frontend/src/components/TransactionHistory.tsx`
