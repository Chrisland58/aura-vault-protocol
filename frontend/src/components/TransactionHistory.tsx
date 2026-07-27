"use client";

import React, { useState, useMemo, useCallback } from "react";
import { ArrowDownCircle, ArrowUpCircle, Zap, CheckCircle2, Clock, XCircle } from "lucide-react";
import { FinancialBadge, type FinancialSentiment } from "./FinancialValue";

// ── Types ────────────────────────────────────────────────────────────────────

export type TxType = "deposit" | "withdraw" | "harvest" | "all";
export type TxStatus = "confirmed" | "pending" | "failed" | "all";

export interface Transaction {
  hash: string;
  date: string; // ISO-8601
  type: Exclude<TxType, "all">;
  amount: string; // decimal string
  status: Exclude<TxStatus, "all">;
}

export interface TransactionHistoryProps {
  transactions: Transaction[];
  explorerBase?: string; // e.g. "https://stellar.expert/explorer/testnet/tx"
  tokenSymbol?: string;
}

// ── Constants (updated to use financial colour system tokens #479) ─────────

const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
type PageSizeOption = (typeof PAGE_SIZE_OPTIONS)[number];

type SortField = "date" | "amount" | "status";
type SortDir = "asc" | "desc";

/** Map tx status → FinancialSentiment for FinancialBadge */
const STATUS_SENTIMENT: Record<Exclude<TxStatus, "all">, FinancialSentiment> = {
  confirmed: "positive",
  pending:   "warning",
  failed:    "negative",
};

/** Status badge label — shown alongside the icon so colour is not the sole indicator */
const STATUS_LABEL: Record<Exclude<TxStatus, "all">, string> = {
  confirmed: "Confirmed",
  pending:   "Pending",
  failed:    "Failed",
};

/** Status icon for the badge */
const STATUS_ICON: Record<Exclude<TxStatus, "all">, React.ReactNode> = {
  confirmed: <CheckCircle2 className="h-3 w-3" aria-hidden="true" />,
  pending:   <Clock        className="h-3 w-3" aria-hidden="true" />,
  failed:    <XCircle      className="h-3 w-3" aria-hidden="true" />,
};

/** Tx type → financial colour var (used via inline style for 4.5:1 compliance) */
const TYPE_COLOR_VAR: Record<Exclude<TxType, "all">, string> = {
  deposit:  "var(--fin-positive)",
  withdraw: "var(--fin-negative)",
  harvest:  "var(--fin-warning)",
};

/** Amount colour sentiment per type */
const AMOUNT_SENTIMENT: Record<Exclude<TxType, "all">, FinancialSentiment> = {
  deposit:  "positive",
  withdraw: "negative",
  harvest:  "warning",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function shortHash(hash: string) {
  return hash.length > 12 ? `${hash.slice(0, 6)}…${hash.slice(-6)}` : hash;
}

function parseAmount(s: string): number {
  return parseFloat(s) || 0;
}

/** Returns a human-readable relative time string for a given ISO-8601 date string. */
function getRelativeTime(dateString: string): string {
  const now = Date.now();
  const then = new Date(dateString).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 30) return "just now";
  if (diffSec < 60) return `${diffSec} seconds ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return diffMin === 1 ? "1 minute ago" : `${diffMin} minutes ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return diffHr === 1 ? "1 hour ago" : `${diffHr} hours ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return diffDay === 1 ? "1 day ago" : `${diffDay} days ago`;
  const diffMonth = Math.floor(diffDay / 30);
  if (diffMonth < 12) return diffMonth === 1 ? "1 month ago" : `${diffMonth} months ago`;
  const diffYear = Math.floor(diffMonth / 12);
  return diffYear === 1 ? "1 year ago" : `${diffYear} years ago`;
}

/** Icon component for transaction type — coloured via financial system tokens. */
function TypeIcon({ type }: { type: Exclude<TxType, "all"> }) {
  const style = { color: TYPE_COLOR_VAR[type] };
  const cls = "h-4 w-4 shrink-0";
  if (type === "deposit")  return <ArrowDownCircle className={cls} style={style} aria-hidden="true" />;
  if (type === "withdraw") return <ArrowUpCircle   className={cls} style={style} aria-hidden="true" />;
  return <Zap className={cls} style={style} aria-hidden="true" />;
}

/** Format amount with sign prefix and token symbol. */
function formatAmount(type: Exclude<TxType, "all">, amount: string, symbol: string): string {
  const num = parseFloat(amount);
  const sign = type === "withdraw" ? "- " : "+ ";
  return `${sign}${Math.abs(num).toFixed(2)} ${symbol}`;
}

/** Amount colour uses financial system variable so it adapts to light/dark. */
function amountColorStyle(type: Exclude<TxType, "all">): React.CSSProperties {
  return { color: TYPE_COLOR_VAR[type] };
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function TransactionHistory({
  transactions,
  explorerBase = "https://stellar.expert/explorer/testnet/tx",
  tokenSymbol = "USDC",
}: TransactionHistoryProps) {
  // Filters
  const [typeFilter, setTypeFilter] = useState<TxType>("all");
  const [statusFilter, setStatusFilter] = useState<TxStatus>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");

  // Sorting
  const [sortField, setSortField] = useState<SortField>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Pagination
  const [pageSize, setPageSize] = useState<PageSizeOption>(25);
  const [page, setPage] = useState(1);

  // Compact mode
  const [compact, setCompact] = useState(false);

  // ── Filtering ───────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return transactions.filter((tx) => {
      if (typeFilter !== "all" && tx.type !== typeFilter) return false;
      if (statusFilter !== "all" && tx.status !== statusFilter) return false;
      if (dateFrom && tx.date < dateFrom) return false;
      if (dateTo && tx.date > dateTo + "T23:59:59Z") return false;
      if (query && !tx.hash.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [transactions, typeFilter, statusFilter, dateFrom, dateTo, search]);

  // ── Sorting ─────────────────────────────────────────────────────────────
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortField === "date")   cmp = a.date.localeCompare(b.date);
      if (sortField === "amount") cmp = parseAmount(a.amount) - parseAmount(b.amount);
      if (sortField === "status") cmp = a.status.localeCompare(b.status);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortField, sortDir]);

  // ── Pagination ──────────────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);

  const resetPage = useCallback(() => setPage(1), []);

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
    resetPage();
  }

  // ── Export ──────────────────────────────────────────────────────────────
  function exportCsv() {
    const header = "date,type,amount,status,hash";
    const rows = sorted.map(
      (tx) => `${tx.date},${tx.type},${tx.amount},${tx.status},${tx.hash}`
    );
    const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "transactions.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Row padding class (compact vs normal) ────────────────────────────────
  const cellPy = compact ? "py-1.5" : "py-3";

  // ── Column header helper ─────────────────────────────────────────────────
  function ColHeader({ field, label }: { field: SortField; label: string }) {
    const active = sortField === field;
    const arrow = active ? (sortDir === "asc" ? " ↑" : " ↓") : "";
    return (
      <th
        scope="col"
        className="cursor-pointer select-none whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
        onClick={() => toggleSort(field)}
        onKeyDown={(e) => e.key === "Enter" && toggleSort(field)}
        tabIndex={0}
        aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
      >
        {label}
        {arrow}
      </th>
    );
  }

  return (
    <section
      aria-label="Transaction History"
      className="flex flex-col gap-4 rounded-2xl bg-white p-4 shadow-sm dark:bg-zinc-900"
    >
      {/* ── Filters ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-3">
        {/* Search */}
        <div className="flex flex-col gap-1">
          <label htmlFor="tx-search" className="text-xs text-zinc-500 dark:text-zinc-400">
            Search hash
          </label>
          <input
            id="tx-search"
            type="search"
            placeholder="0xabc…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); resetPage(); }}
            className="h-9 w-52 rounded-lg border border-zinc-200 px-3 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-400"
          />
        </div>

        {/* Type filter */}
        <div className="flex flex-col gap-1">
          <label htmlFor="tx-type" className="text-xs text-zinc-500 dark:text-zinc-400">
            Type
          </label>
          <select
            id="tx-type"
            value={typeFilter}
            onChange={(e) => { setTypeFilter(e.target.value as TxType); resetPage(); }}
            className="h-9 rounded-lg border border-zinc-200 px-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          >
            <option value="all">All</option>
            <option value="deposit">Deposit</option>
            <option value="withdraw">Withdraw</option>
            <option value="harvest">Harvest</option>
          </select>
        </div>

        {/* Status filter */}
        <div className="flex flex-col gap-1">
          <label htmlFor="tx-status" className="text-xs text-zinc-500 dark:text-zinc-400">
            Status
          </label>
          <select
            id="tx-status"
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value as TxStatus); resetPage(); }}
            className="h-9 rounded-lg border border-zinc-200 px-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          >
            <option value="all">All</option>
            <option value="confirmed">Confirmed</option>
            <option value="pending">Pending</option>
            <option value="failed">Failed</option>
          </select>
        </div>

        {/* Date range */}
        <div className="flex flex-col gap-1">
          <label htmlFor="tx-date-from" className="text-xs text-zinc-500 dark:text-zinc-400">
            From
          </label>
          <input
            id="tx-date-from"
            type="date"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); resetPage(); }}
            className="h-9 rounded-lg border border-zinc-200 px-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="tx-date-to" className="text-xs text-zinc-500 dark:text-zinc-400">
            To
          </label>
          <input
            id="tx-date-to"
            type="date"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); resetPage(); }}
            className="h-9 rounded-lg border border-zinc-200 px-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />
        </div>

        {/* Clear */}
        {(search || typeFilter !== "all" || statusFilter !== "all" || dateFrom || dateTo) && (
          <button
            onClick={() => {
              setSearch(""); setTypeFilter("all"); setStatusFilter("all");
              setDateFrom(""); setDateTo(""); resetPage();
            }}
            className="h-9 rounded-lg border border-zinc-200 px-3 text-sm text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Clear
          </button>
        )}

        {/* Right-side controls: Compact toggle + Export CSV */}
        <div className="ml-auto flex items-center gap-2">
          {/* Compact toggle */}
          <button
            onClick={() => setCompact((c) => !c)}
            aria-pressed={compact}
            className={`h-9 rounded-lg border px-3 text-sm font-medium transition-colors ${
              compact
                ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-black"
                : "border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
            }`}
          >
            Compact
          </button>

          {/* Export CSV */}
          <button
            onClick={exportCsv}
            className="h-9 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-black dark:hover:bg-zinc-300"
          >
            Export CSV
          </button>
        </div>
      </div>

      {/* ── Table ──────────────────────────────────────────────────────────── */}
      <div className="overflow-x-auto rounded-xl border border-zinc-100 dark:border-zinc-800">
        <table className="min-w-full divide-y divide-zinc-100 dark:divide-zinc-800" role="grid">
          <thead className="bg-zinc-50 dark:bg-zinc-800/50">
            <tr>
              <ColHeader field="date" label="Date" />
              <th
                scope="col"
                className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
                style={{ minWidth: "120px" }}
              >
                Type
              </th>
              <ColHeader field="amount" label="Amount" />
              <ColHeader field="status" label="Status" />
              {/* Hash column — hidden in compact mode */}
              {!compact && (
                <th
                  scope="col"
                  className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
                >
                  Hash
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={compact ? 4 : 5}>
                  <EmptyState variant="no-transactions" className="py-4" />
                </td>
              </tr>
            ) : (
              pageRows.map((tx) => (
                <tr
                  key={tx.hash}
                  className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40 focus-within:bg-zinc-50 dark:focus-within:bg-zinc-800/40"
                >
                  {/* Date — relative time with absolute tooltip */}
                  <td
                    className={`whitespace-nowrap px-4 ${cellPy} text-sm text-zinc-700 dark:text-zinc-300`}
                    title={new Date(tx.date).toLocaleString()}
                  >
                    {getRelativeTime(tx.date)}
                  </td>

                  {/* Type — icon + colour-coded text, no badge pill */}
                  <td className={`px-4 ${cellPy}`} style={{ minWidth: "120px" }}>
                    <span className="inline-flex items-center gap-1.5 text-sm font-medium capitalize"
                          style={{ color: TYPE_COLOR_VAR[tx.type] }}>
                      <TypeIcon type={tx.type} />
                      {tx.type}
                    </span>
                  </td>

                  {/* Amount — signed, with token symbol, right-aligned, monospace */}
                  <td className={`whitespace-nowrap px-4 ${cellPy} text-right font-mono text-sm font-medium`}
                      style={amountColorStyle(tx.type)}>
                    {formatAmount(tx.type, tx.amount, tokenSymbol)}
                  </td>

                  {/* Status — FinancialBadge satisfies WCAG 1.4.1 (icon+label, not just colour) */}
                  <td className={`px-4 ${cellPy}`}>
                    <FinancialBadge
                      label={STATUS_LABEL[tx.status]}
                      sentiment={STATUS_SENTIMENT[tx.status]}
                      icon={STATUS_ICON[tx.status]}
                    />
                  </td>

                  {/* Hash — hidden in compact mode */}
                  {!compact && (
                    <td className={`whitespace-nowrap px-4 ${cellPy}`}>
                      <a
                        href={`${explorerBase}/${tx.hash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-sm text-blue-600 hover:underline dark:text-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
                        aria-label={`View transaction ${tx.hash} on block explorer`}
                      >
                        {shortHash(tx.hash)}
                      </a>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-zinc-500 dark:text-zinc-400">
        {/* Result count */}
        <span>
          {sorted.length === 0
            ? "No results"
            : `${(safePage - 1) * pageSize + 1}–${Math.min(safePage * pageSize, sorted.length)} of ${sorted.length}`}
        </span>

        {/* Page size picker */}
        <div className="flex items-center gap-2">
          <label htmlFor="tx-page-size" className="text-xs">Rows</label>
          <select
            id="tx-page-size"
            value={pageSize}
            onChange={(e) => { setPageSize(Number(e.target.value) as PageSizeOption); resetPage(); }}
            className="h-8 rounded border border-zinc-200 px-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>

        {/* Page navigation */}
        <nav aria-label="Pagination" className="flex items-center gap-1">
          <button
            onClick={() => setPage(1)}
            disabled={safePage === 1}
            className="rounded px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40"
            aria-label="First page"
          >
            «
          </button>
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={safePage === 1}
            className="rounded px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40"
            aria-label="Previous page"
          >
            ‹
          </button>
          <span className="px-2">
            {safePage} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={safePage === totalPages}
            className="rounded px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40"
            aria-label="Next page"
          >
            ›
          </button>
          <button
            onClick={() => setPage(totalPages)}
            disabled={safePage === totalPages}
            className="rounded px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40"
            aria-label="Last page"
          >
            »
          </button>
        </nav>
      </div>
    </section>
  );
}
