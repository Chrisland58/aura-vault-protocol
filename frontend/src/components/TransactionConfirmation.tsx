"use client";

/**
 * TransactionConfirmation
 *
 * Renders a plain-language confirmation screen for deposit, withdraw, and
 * harvest transactions. Designed to give users a clear, human-readable
 * summary before they finalise a vault interaction.
 *
 * Props:
 *   type            – Transaction type: 'deposit' | 'withdraw' | 'harvest'
 *   amount          – Raw amount string (underlying token units)
 *   estimatedShares – Shares minted (deposit) or being redeemed (withdraw)
 *   estimatedTokens – Underlying tokens returned on withdraw
 *   sharePrice      – Current share price (for display purposes)
 *   fee             – Optional protocol fee amount string; shown only when > 0
 *   onConfirm       – Called when the user confirms the transaction
 *   onBack          – Called when the user wants to go back and edit
 */

import Link from "next/link";
import { ArrowLeft, Info } from "lucide-react";

export type TxConfirmationType = "deposit" | "withdraw" | "harvest";

export interface TransactionConfirmationProps {
  type: TxConfirmationType;
  amount: string;
  estimatedShares: string;
  estimatedTokens: string;
  sharePrice: string;
  /** Protocol fee in USDC. When omitted or "0", the fee section is hidden. */
  fee?: string;
  onConfirm: () => void;
  onBack: () => void;
}

// ─── Plain-language copy ──────────────────────────────────────────────────────

function DepositCopy({
  amount,
  estimatedShares,
}: {
  amount: string;
  estimatedShares: string;
}) {
  return (
    <p className="text-base text-zinc-700 dark:text-zinc-200 leading-relaxed">
      You are depositing{" "}
      <span className="font-semibold font-mono text-zinc-900 dark:text-zinc-50">
        {amount} USDC
      </span>{" "}
      and will receive approximately{" "}
      <span className="font-semibold font-mono text-zinc-900 dark:text-zinc-50">
        {estimatedShares} vault shares
      </span>
      .
    </p>
  );
}

function WithdrawCopy({
  estimatedShares,
  estimatedTokens,
}: {
  estimatedShares: string;
  estimatedTokens: string;
}) {
  return (
    <p className="text-base text-zinc-700 dark:text-zinc-200 leading-relaxed">
      You are redeeming{" "}
      <span className="font-semibold font-mono text-zinc-900 dark:text-zinc-50">
        {estimatedShares} vault shares
      </span>{" "}
      for approximately{" "}
      <span className="font-semibold font-mono text-zinc-900 dark:text-zinc-50">
        {estimatedTokens} USDC
      </span>
      .
    </p>
  );
}

function HarvestCopy({ amount }: { amount: string }) {
  return (
    <p className="text-base text-zinc-700 dark:text-zinc-200 leading-relaxed">
      You are injecting{" "}
      <span className="font-semibold font-mono text-zinc-900 dark:text-zinc-50">
        {amount} USDC
      </span>{" "}
      of yield, increasing the share price for all holders.
    </p>
  );
}

// ─── Fee breakdown ────────────────────────────────────────────────────────────

function FeeBreakdown({ fee }: { fee: string }) {
  const feeNum = parseFloat(fee);
  if (isNaN(feeNum) || feeNum <= 0) return null;

  return (
    <div
      role="region"
      aria-label="Fee breakdown"
      className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-700 dark:bg-zinc-800/60"
    >
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500 mb-2">
        Fees
      </p>
      <div className="flex items-center justify-between text-sm">
        <span className="text-zinc-600 dark:text-zinc-300">Protocol fee</span>
        <span
          data-cy="tx-confirmation-fee"
          className="font-mono font-semibold text-zinc-800 dark:text-zinc-100"
        >
          {fee} USDC
        </span>
      </div>
    </div>
  );
}

// ─── Share price detail row ───────────────────────────────────────────────────

function DetailRow({
  label,
  value,
  dataCy,
}: {
  label: string;
  value: string;
  dataCy?: string;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-zinc-500 dark:text-zinc-400">{label}</span>
      <span
        data-cy={dataCy}
        className="font-mono font-medium text-zinc-800 dark:text-zinc-100"
      >
        {value}
      </span>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function TransactionConfirmation({
  type,
  amount,
  estimatedShares,
  estimatedTokens,
  sharePrice,
  fee,
  onConfirm,
  onBack,
}: TransactionConfirmationProps) {
  const headingId = `tx-confirmation-heading-${type}`;

  const typeLabel: Record<TxConfirmationType, string> = {
    deposit: "Deposit",
    withdraw: "Withdraw",
    harvest: "Harvest",
  };

  return (
    <section
      role="region"
      aria-label={`${typeLabel[type]} confirmation`}
      aria-labelledby={headingId}
      data-cy="tx-confirmation"
      className="flex flex-col gap-5"
    >
      {/* ── Heading ─────────────────────────────────────────────────────── */}
      <h3
        id={headingId}
        className="text-lg font-semibold text-zinc-900 dark:text-zinc-50"
      >
        Confirm {typeLabel[type]}
      </h3>

      {/* ── Plain-language summary ───────────────────────────────────────── */}
      <div
        role="region"
        aria-label="Transaction summary"
        className="rounded-xl bg-zinc-100 px-5 py-4 dark:bg-zinc-800"
        data-cy="tx-confirmation-summary"
      >
        {type === "deposit" && (
          <DepositCopy amount={amount} estimatedShares={estimatedShares} />
        )}
        {type === "withdraw" && (
          <WithdrawCopy
            estimatedShares={estimatedShares}
            estimatedTokens={estimatedTokens}
          />
        )}
        {type === "harvest" && <HarvestCopy amount={amount} />}
      </div>

      {/* ── Detail rows ─────────────────────────────────────────────────── */}
      <div
        role="region"
        aria-label="Transaction details"
        className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-700 dark:bg-zinc-900"
      >
        <DetailRow
          label="Current share price"
          value={`${sharePrice} USDC`}
          dataCy="tx-confirmation-share-price"
        />
        {type === "deposit" && (
          <DetailRow
            label="Estimated shares"
            value={estimatedShares}
            dataCy="tx-confirmation-estimated-shares"
          />
        )}
        {type === "withdraw" && (
          <DetailRow
            label="Shares redeemed"
            value={estimatedShares}
            dataCy="tx-confirmation-estimated-shares"
          />
        )}
        {type === "withdraw" && (
          <DetailRow
            label="Estimated return"
            value={`${estimatedTokens} USDC`}
            dataCy="tx-confirmation-estimated-tokens"
          />
        )}
        {type === "harvest" && (
          <DetailRow
            label="Yield injected"
            value={`${amount} USDC`}
            dataCy="tx-confirmation-harvest-amount"
          />
        )}
      </div>

      {/* ── Fee breakdown (shown only when fee > 0) ──────────────────────── */}
      {fee !== undefined && <FeeBreakdown fee={fee} />}

      {/* ── Learn more link ──────────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400">
        <Info size={14} aria-hidden="true" />
        <Link
          href="/faq"
          aria-label="Learn more about vault transactions (opens FAQ)"
          className="underline underline-offset-2 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
          data-cy="tx-confirmation-learn-more"
        >
          Learn more
        </Link>{" "}
        about vault transactions
      </div>

      {/* ── Action buttons ───────────────────────────────────────────────── */}
      <div className="flex gap-3 pt-1">
        <button
          type="button"
          aria-label="Go back and edit transaction"
          onClick={onBack}
          data-cy="tx-confirmation-back-btn"
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors"
        >
          <ArrowLeft size={15} aria-hidden="true" />
          Back
        </button>
        <button
          type="button"
          aria-label={`Confirm ${typeLabel[type].toLowerCase()} transaction`}
          onClick={onConfirm}
          data-cy="tx-confirmation-confirm-btn"
          className="flex-1 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-black dark:hover:bg-zinc-300 transition-colors"
        >
          Confirm &amp; Sign
        </button>
      </div>
    </section>
  );
}
