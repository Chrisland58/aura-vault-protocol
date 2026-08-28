"use client";

/**
 * FinancialValue (#479)
 *
 * Displays a financial value (gain, loss, or warning) with:
 *   - Semantic colour from the financial colour system tokens
 *   - An icon alongside the value  (colour is NEVER the only indicator)
 *   - An optional text label / sign prefix
 *   - Accessible aria-label describing the semantic meaning
 *
 * Token values (defined in globals.css and ui/src/styles/tokens.css):
 *   --fin-positive  #16a34a  green-700 (light) / #4ade80 (dark)  4.5:1+ contrast
 *   --fin-negative  #dc2626  red-600   (light) / #f87171 (dark)  4.5:1+ contrast
 *   --fin-warning   #d97706  amber-600 (light) / #fbbf24 (dark)  4.5:1+ contrast
 */

import type { ReactNode } from "react";

export type FinancialSentiment = "positive" | "negative" | "warning" | "neutral";

export interface FinancialValueProps {
  /** The numeric or formatted string to display */
  value: string;
  /** Semantic meaning drives colour, icon, and aria description */
  sentiment: FinancialSentiment;
  /** Show a + / - / ~ prefix before the value */
  showSign?: boolean;
  /** Extra CSS classes forwarded to the wrapper span */
  className?: string;
  /** Override the icon with a custom node */
  icon?: ReactNode;
  /** Accessible label describing the full meaning, e.g. "gain of 5.2%" */
  "aria-label"?: string;
}

// ── Inline SVG icons (avoids external icon dependency) ───────────────────────

function TrendUpIcon({ className }: { className?: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
      <polyline points="16 7 22 7 22 13" />
    </svg>
  );
}

function TrendDownIcon({ className }: { className?: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <polyline points="22 17 13.5 8.5 8.5 13.5 2 7" />
      <polyline points="16 17 22 17 22 11" />
    </svg>
  );
}

function WarningIcon({ className }: { className?: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

// ── Config per sentiment ──────────────────────────────────────────────────────

const SENTIMENT_CONFIG: Record<
  FinancialSentiment,
  {
    colorVar: string;          // CSS variable name
    textClass: string;         // Tailwind-compatible inline style key
    defaultIcon: ReactNode;
    sign: string;
    ariaPrefix: string;
  }
> = {
  positive: {
    colorVar: "var(--fin-positive)",
    textClass: "",
    defaultIcon: <TrendUpIcon />,
    sign: "+",
    ariaPrefix: "gain",
  },
  negative: {
    colorVar: "var(--fin-negative)",
    textClass: "",
    defaultIcon: <TrendDownIcon />,
    sign: "-",
    ariaPrefix: "loss",
  },
  warning: {
    colorVar: "var(--fin-warning)",
    textClass: "",
    defaultIcon: <WarningIcon />,
    sign: "~",
    ariaPrefix: "warning",
  },
  neutral: {
    colorVar: "inherit",
    textClass: "",
    defaultIcon: null,
    sign: "",
    ariaPrefix: "",
  },
};

// ── Component ─────────────────────────────────────────────────────────────────

export function FinancialValue({
  value,
  sentiment,
  showSign = false,
  className = "",
  icon,
  "aria-label": ariaLabel,
}: FinancialValueProps) {
  const cfg = SENTIMENT_CONFIG[sentiment];
  const displayIcon = icon !== undefined ? icon : cfg.defaultIcon;
  const prefix = showSign && sentiment !== "neutral" ? cfg.sign : "";
  const label =
    ariaLabel ?? (cfg.ariaPrefix ? `${cfg.ariaPrefix} ${value}` : value);

  return (
    <span
      className={[
        "inline-flex items-center gap-1 font-mono font-semibold",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ color: cfg.colorVar }}
      aria-label={label}
      role="text"
    >
      {/* Icon — ensures colour is not the only differentiator (WCAG 1.4.1) */}
      {displayIcon && (
        <span className="shrink-0" aria-hidden="true">
          {displayIcon}
        </span>
      )}
      {/* Value with optional sign */}
      <span>
        {prefix}
        {value}
      </span>
    </span>
  );
}

/**
 * FinancialBadge
 *
 * Pill-shaped badge version of FinancialValue — useful for status tags
 * like "confirmed", "pending", "failed" in transaction history.
 */
export interface FinancialBadgeProps {
  label: string;
  sentiment: FinancialSentiment;
  icon?: ReactNode;
  className?: string;
}

export function FinancialBadge({
  label,
  sentiment,
  icon,
  className = "",
}: FinancialBadgeProps) {
  const bgVar =
    sentiment === "positive"
      ? "var(--fin-positive-subtle)"
      : sentiment === "negative"
      ? "var(--fin-negative-subtle)"
      : sentiment === "warning"
      ? "var(--fin-warning-subtle)"
      : "transparent";

  const textVar =
    sentiment === "positive"
      ? "var(--fin-positive-text)"
      : sentiment === "negative"
      ? "var(--fin-negative-text)"
      : sentiment === "warning"
      ? "var(--fin-warning-text)"
      : "inherit";

  const defaultIcons: Record<FinancialSentiment, ReactNode> = {
    positive: <TrendUpIcon />,
    negative: <TrendDownIcon />,
    warning: <WarningIcon />,
    neutral: null,
  };

  const displayIcon = icon !== undefined ? icon : defaultIcons[sentiment];

  return (
    <span
      className={[
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ backgroundColor: bgVar, color: textVar }}
      role="status"
    >
      {displayIcon && (
        <span aria-hidden="true" className="shrink-0">
          {displayIcon}
        </span>
      )}
      <span>{label}</span>
    </span>
  );
}

export default FinancialValue;
