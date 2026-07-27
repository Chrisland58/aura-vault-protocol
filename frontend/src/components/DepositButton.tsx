"use client";

/**
 * DepositButton (#478)
 *
 * A deposit/action button that displays contextual icons and animations for
 * each transaction state:
 *   - idle    → plain label
 *   - pending → spinning loader
 *   - success → animated checkmark
 *   - error   → animated × icon
 *
 * All animations are CSS-transform-based and respect prefers-reduced-motion.
 */

import { type ButtonHTMLAttributes, type ReactNode, useId } from "react";

export type ButtonTxState = "idle" | "pending" | "success" | "error";

interface DepositButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Current transaction state driving the icon/animation */
  txState?: ButtonTxState;
  children: ReactNode;
  /** Accessible label override (defaults to children text + state) */
  "aria-label"?: string;
}

// ── Inline SVG icons (no external dependency) ─────────────────────────────

function SpinnerIcon() {
  return (
    <svg
      className="animate-spin h-4 w-4 shrink-0 animate-btn-spinner-in"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v8H4z"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      className="h-4 w-4 shrink-0 animate-btn-icon-in"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg
      className="h-4 w-4 shrink-0 animate-btn-icon-in"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

// ── State-driven label + icon map ──────────────────────────────────────────

const STATE_CONFIG: Record<
  ButtonTxState,
  { icon: ReactNode | null; label: string; colorClass: string }
> = {
  idle: {
    icon: null,
    label: "",
    colorClass: "",
  },
  pending: {
    icon: <SpinnerIcon />,
    label: "Processing…",
    colorClass: "bg-zinc-500 dark:bg-zinc-600 cursor-wait",
  },
  success: {
    icon: <CheckIcon />,
    label: "Success",
    colorClass:
      "bg-[#16a34a] hover:bg-[#15803d] dark:bg-[#16a34a] dark:hover:bg-[#15803d]",
  },
  error: {
    icon: <XIcon />,
    label: "Failed",
    colorClass:
      "bg-[#dc2626] hover:bg-[#b91c1c] dark:bg-[#dc2626] dark:hover:bg-[#b91c1c]",
  },
};

// ── Component ──────────────────────────────────────────────────────────────

export function DepositButton({
  txState = "idle",
  children,
  disabled,
  className = "",
  "aria-label": ariaLabel,
  ...props
}: DepositButtonProps) {
  const id = useId();
  const cfg = STATE_CONFIG[txState];
  const isActive = txState !== "idle";

  const statusLabel =
    txState !== "idle" ? cfg.label : typeof children === "string" ? children : "";

  return (
    <button
      {...props}
      id={id}
      disabled={disabled ?? txState === "pending"}
      aria-label={ariaLabel ?? (isActive ? cfg.label : undefined)}
      aria-busy={txState === "pending" ? "true" : undefined}
      aria-live="polite"
      className={[
        // Base layout & typography
        "relative inline-flex items-center justify-center gap-2",
        "rounded-lg px-4 py-2.5 text-sm font-semibold text-white",
        "transition-all duration-200 ease-out",
        // Press interaction via CSS transforms only
        "active:scale-95",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100",
        "disabled:opacity-50 disabled:cursor-not-allowed disabled:scale-100",
        // Idle default colour (overridden by state)
        txState === "idle"
          ? "bg-zinc-900 hover:bg-zinc-700 dark:bg-zinc-100 dark:text-black dark:hover:bg-zinc-300"
          : cfg.colorClass,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {/* Icon slot — only rendered when state is active */}
      {isActive && (
        <span className="flex items-center" aria-hidden="true">
          {cfg.icon}
        </span>
      )}

      {/* Label — shows state copy when active, children when idle */}
      <span
        key={txState} /* key swap triggers CSS animation reset */
        className={isActive ? "animate-btn-icon-in" : undefined}
      >
        {isActive ? cfg.label : children}
      </span>
    </button>
  );
}

export default DepositButton;
