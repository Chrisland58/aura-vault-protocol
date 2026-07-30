"use client";

import Image from "next/image";
import type { ReactNode } from "react";

// ── Types ──────────────────────────────────────────────────────────────────

export type EmptyVariant =
  | "no-transactions"
  | "no-wallet"
  | "vault-paused"
  | "error"
  | "custom";

interface VariantConfig {
  src: string;
  alt: string;
  title: string;
  description: string;
}

// ── Preset copy per variant ────────────────────────────────────────────────

const VARIANTS: Record<Exclude<EmptyVariant, "custom">, VariantConfig> = {
  "no-transactions": {
    src: "/empty-no-transactions.svg",
    alt: "",
    title: "No transactions yet",
    description:
      "Your transaction history will appear here once you make a deposit or withdrawal.",
  },
  "no-wallet": {
    src: "/empty-no-wallet.svg",
    alt: "",
    title: "No wallet connected",
    description:
      "Connect your Stellar wallet to view your vault positions and interact with the protocol.",
  },
  "vault-paused": {
    src: "/empty-vault-paused.svg",
    alt: "",
    title: "Vault is paused",
    description:
      "The vault has been temporarily paused by the admin. Deposits, withdrawals, and harvests are disabled until operations resume.",
  },
  error: {
    src: "/empty-error.svg",
    alt: "",
    title: "Something went wrong",
    description:
      "We couldn't load this data. Check your connection and try again, or contact support if the problem persists.",
  },
};

// ── Props ──────────────────────────────────────────────────────────────────

export interface EmptyStateProps {
  /** Preset variant — picks illustration, headline, and description automatically. */
  variant?: Exclude<EmptyVariant, "custom">;

  /**
   * Override or provide custom copy.
   * When `variant` is omitted, all three fields are required.
   */
  title?: string;
  description?: string;
  /** Custom illustration src (absolute path or URL). */
  illustrationSrc?: string;
  /** Alt text for a custom illustration. Use empty string `""` for decorative images. */
  illustrationAlt?: string;

  /** Optional CTA — e.g. a <button> or <a> element. */
  action?: ReactNode;

  /** Additional class names applied to the root element. */
  className?: string;
}

// ── Component ──────────────────────────────────────────────────────────────

/**
 * EmptyState
 *
 * Renders a centred illustration, headline, description, and optional CTA.
 * Supports four preset variants (no-transactions, no-wallet, vault-paused, error)
 * as well as fully custom content.
 *
 * Accessibility:
 * - The illustration is purely decorative (alt="") so screen readers focus on
 *   the text copy rather than repeating the aria-label baked into the SVG.
 * - The section receives role="status" so AT is notified when it appears.
 *
 * @example
 * // Preset
 * <EmptyState variant="no-transactions" action={<button>Deposit</button>} />
 *
 * @example
 * // Custom
 * <EmptyState
 *   illustrationSrc="/custom.svg"
 *   illustrationAlt=""
 *   title="Nothing here"
 *   description="Add something to get started."
 * />
 */
export function EmptyState({
  variant,
  title,
  description,
  illustrationSrc,
  illustrationAlt = "",
  action,
  className = "",
}: EmptyStateProps) {
  // Resolve config from preset or custom props
  const preset = variant ? VARIANTS[variant] : null;

  const resolvedTitle = title ?? preset?.title ?? "Nothing here";
  const resolvedDescription = description ?? preset?.description;
  const resolvedSrc = illustrationSrc ?? preset?.src;
  const resolvedAlt = illustrationAlt !== undefined ? illustrationAlt : (preset?.alt ?? "");

  return (
    <section
      role="status"
      aria-label={resolvedTitle}
      className={[
        "flex flex-col items-center justify-center gap-5 px-6 py-12 text-center",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {resolvedSrc && (
        <div
          className="flex items-center justify-center"
          aria-hidden="true"
        >
          <Image
            src={resolvedSrc}
            alt={resolvedAlt}
            width={160}
            height={128}
            priority={false}
            className="select-none"
            draggable={false}
          />
        </div>
      )}

      <div className="flex flex-col items-center gap-2 max-w-xs">
        <h3 className="text-base font-semibold text-foreground leading-tight">
          {resolvedTitle}
        </h3>

        {resolvedDescription && (
          <p className="text-sm text-muted leading-relaxed">
            {resolvedDescription}
          </p>
        )}
      </div>

      {action && (
        <div className="mt-1">
          {action}
        </div>
      )}
    </section>
  );
}

export default EmptyState;
