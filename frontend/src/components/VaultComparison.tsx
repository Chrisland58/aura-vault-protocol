"use client";

import { useState, useCallback, useMemo } from "react";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface VaultInfo {
  id: string;
  name: string;
  underlyingToken: string; // e.g. 'USDC'
  apy: number;             // percentage, e.g. 12.5
  tvl: number;             // in USD
  fee: number;             // percentage, e.g. 0.1
  minDeposit: number;      // in token units
}

export interface VaultComparisonProps {
  vaults: VaultInfo[];
  onDeposit: (vaultId: string) => void;
}

// ─── Column definitions ───────────────────────────────────────────────────────

type SortKey = keyof VaultInfo;
type SortDir = "asc" | "desc";

interface Column {
  key: SortKey;
  label: string;
  /** For numeric columns: which direction is "best"? */
  bestDir?: "max" | "min";
  format: (vault: VaultInfo) => string;
  align: "left" | "right";
}

const COLUMNS: Column[] = [
  {
    key: "name",
    label: "Vault Name",
    format: (v) => v.name,
    align: "left",
  },
  {
    key: "underlyingToken",
    label: "Underlying Token",
    format: (v) => v.underlyingToken,
    align: "left",
  },
  {
    key: "apy",
    label: "APY",
    bestDir: "max",
    format: (v) => `${v.apy.toFixed(2)}%`,
    align: "right",
  },
  {
    key: "tvl",
    label: "TVL",
    bestDir: "max",
    format: (v) =>
      `$${v.tvl.toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
    align: "right",
  },
  {
    key: "fee",
    label: "Fee",
    bestDir: "min",
    format: (v) => `${v.fee.toFixed(2)}%`,
    align: "right",
  },
  {
    key: "minDeposit",
    label: "Min Deposit",
    bestDir: "min",
    format: (v) => `${v.minDeposit.toLocaleString("en-US")} ${v.underlyingToken}`,
    align: "right",
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns the vault id that has the "best" value for a given numeric column. */
function getBestId(vaults: VaultInfo[], col: Column): string | null {
  if (!col.bestDir || vaults.length === 0) return null;
  return vaults.reduce((best, vault) => {
    const bVal = best[col.key as keyof VaultInfo] as number;
    const vVal = vault[col.key as keyof VaultInfo] as number;
    return col.bestDir === "max" ? (vVal > bVal ? vault : best) : (vVal < bVal ? vault : best);
  }, vaults[0]).id;
}

/** aria-sort value for a column header. */
function ariaSort(
  colKey: SortKey,
  sortKey: SortKey,
  sortDir: SortDir
): React.AriaAttributes["aria-sort"] {
  if (colKey !== sortKey) return "none";
  return sortDir === "asc" ? "ascending" : "descending";
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Best-value badge wrapper. */
function BestBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md px-2 py-0.5 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 font-semibold">
      {children}
    </span>
  );
}

/** Deposit button for table rows and cards. */
function DepositButton({
  vaultId,
  onDeposit,
}: {
  vaultId: string;
  onDeposit: (id: string) => void;
}) {
  const handleClick = useCallback(() => onDeposit(vaultId), [vaultId, onDeposit]);
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onDeposit(vaultId);
      }
    },
    [vaultId, onDeposit]
  );

  return (
    <button
      type="button"
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      aria-label={`Deposit into vault ${vaultId}`}
      className="bg-zinc-900 text-white dark:bg-zinc-100 dark:text-black rounded-lg px-3 py-1.5 text-sm font-medium transition-opacity hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:focus-visible:outline-zinc-100"
    >
      Deposit
    </button>
  );
}

// ─── Stacked card (xs screens) ────────────────────────────────────────────────

function VaultCard({
  vault,
  bestIds,
  onDeposit,
}: {
  vault: VaultInfo;
  bestIds: Record<string, string | null>;
  onDeposit: (id: string) => void;
}) {
  return (
    <div
      role="article"
      aria-label={`Vault: ${vault.name}`}
      className="rounded-2xl border border-zinc-200 bg-white p-4 flex flex-col gap-3 dark:border-zinc-700 dark:bg-zinc-900"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-zinc-900 dark:text-zinc-50">{vault.name}</p>
          <p className="text-xs text-zinc-500 mt-0.5">{vault.underlyingToken}</p>
        </div>
        <DepositButton vaultId={vault.id} onDeposit={onDeposit} />
      </div>

      {/* Numeric metrics */}
      <dl className="grid grid-cols-2 gap-2">
        {COLUMNS.filter((c) => c.bestDir).map((col) => {
          const isBest = bestIds[col.key] === vault.id;
          return (
            <div key={col.key} className="flex flex-col gap-0.5">
              <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                {col.label}
              </dt>
              <dd>
                {isBest ? (
                  <BestBadge>{col.format(vault)}</BestBadge>
                ) : (
                  <span className="text-sm text-zinc-800 dark:text-zinc-200 font-mono">
                    {col.format(vault)}
                  </span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function VaultComparison({ vaults, onDeposit }: VaultComparisonProps) {
  const [sortKey, setSortKey] = useState<SortKey>("apy");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Compute best vault id per numeric column
  const bestIds = useMemo<Record<string, string | null>>(
    () =>
      Object.fromEntries(
        COLUMNS.filter((c) => c.bestDir).map((c) => [c.key, getBestId(vaults, c)])
      ),
    [vaults]
  );

  // Sort vaults
  const sortedVaults = useMemo(() => {
    return [...vaults].sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      let cmp = 0;
      if (typeof aVal === "number" && typeof bVal === "number") {
        cmp = aVal - bVal;
      } else {
        cmp = String(aVal).localeCompare(String(bVal));
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [vaults, sortKey, sortDir]);

  const handleSort = useCallback(
    (key: SortKey) => {
      setSortKey((prev) => {
        if (prev === key) {
          setSortDir((d) => (d === "asc" ? "desc" : "asc"));
          return key;
        }
        setSortDir("desc");
        return key;
      });
    },
    []
  );

  if (vaults.length === 0) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900">
        No vaults available.
      </div>
    );
  }

  return (
    <section aria-label="Vault comparison" className="flex flex-col gap-4">
      {/* ── Desktop / tablet table (sm+) ──────────────────────────────────── */}
      <div className="hidden sm:block overflow-x-auto rounded-2xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
        <table
          className="min-w-full text-sm"
          aria-label="Side-by-side vault comparison"
        >
          <thead>
            <tr className="border-b border-zinc-100 dark:border-zinc-800">
              {COLUMNS.map((col) => {
                const isActive = sortKey === col.key;
                const arrow =
                  isActive ? (sortDir === "asc" ? " ↑" : " ↓") : " ↕";
                return (
                  <th
                    key={col.key}
                    scope="col"
                    aria-sort={ariaSort(col.key, sortKey, sortDir)}
                    className={[
                      "px-4 py-3 font-semibold uppercase tracking-wide text-xs text-zinc-500 whitespace-nowrap select-none",
                      col.align === "right" ? "text-right" : "text-left",
                      "cursor-pointer hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors",
                      isActive ? "text-zinc-800 dark:text-zinc-200" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => handleSort(col.key)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleSort(col.key);
                      }
                    }}
                    tabIndex={0}
                    role="columnheader"
                  >
                    {col.label}
                    <span aria-hidden="true" className="ml-1 font-normal opacity-60">
                      {arrow}
                    </span>
                  </th>
                );
              })}
              {/* Actions column */}
              <th
                scope="col"
                className="px-4 py-3 text-right font-semibold uppercase tracking-wide text-xs text-zinc-500"
              >
                Action
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedVaults.map((vault, rowIdx) => (
              <tr
                key={vault.id}
                className={[
                  "border-b border-zinc-100 dark:border-zinc-800 last:border-0",
                  "hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors",
                  rowIdx % 2 === 1 ? "bg-zinc-50/40 dark:bg-zinc-800/20" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {COLUMNS.map((col) => {
                  const isBest = col.bestDir && bestIds[col.key] === vault.id;
                  const cellText = col.format(vault);
                  return (
                    <td
                      key={col.key}
                      className={[
                        "px-4 py-3 whitespace-nowrap",
                        col.align === "right" ? "text-right" : "text-left",
                        col.key === "name"
                          ? "font-medium text-zinc-900 dark:text-zinc-50"
                          : "font-mono text-zinc-700 dark:text-zinc-300",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      {isBest ? (
                        <BestBadge>{cellText}</BestBadge>
                      ) : (
                        cellText
                      )}
                    </td>
                  );
                })}
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <DepositButton vaultId={vault.id} onDeposit={onDeposit} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Mobile stacked cards (xs only) ───────────────────────────────── */}
      <div className="sm:hidden flex flex-col gap-3" aria-label="Vault comparison cards">
        {/* Sort control for mobile */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-zinc-500 uppercase tracking-wide">Sort by:</span>
          {COLUMNS.map((col) => {
            const isActive = sortKey === col.key;
            return (
              <button
                key={col.key}
                type="button"
                onClick={() => handleSort(col.key)}
                aria-pressed={isActive}
                className={[
                  "rounded-full px-2.5 py-1 text-xs font-medium border transition-colors",
                  isActive
                    ? "bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-100 dark:text-black dark:border-zinc-100"
                    : "bg-white text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700 hover:border-zinc-400",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {col.label}
                {isActive && (
                  <span aria-hidden="true" className="ml-1">
                    {sortDir === "asc" ? "↑" : "↓"}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Cards */}
        {sortedVaults.map((vault) => (
          <VaultCard
            key={vault.id}
            vault={vault}
            bestIds={bestIds}
            onDeposit={onDeposit}
          />
        ))}
      </div>
    </section>
  );
}

export default VaultComparison;
