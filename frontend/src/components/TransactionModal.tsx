"use client";

import { useState, useEffect, useRef } from "react";
import { AlertCircle, Check, CheckCircle, XCircle } from "lucide-react";
import TransactionConfirmation from "@/components/TransactionConfirmation";
import { useHapticsStandalone } from "@/components/HapticFeedback";

type TxType = "deposit" | "withdraw" | "harvest";
/** 1 = Amount, 2 = Review/Sign, 3 = Submit, 4 = Confirmed */
type Step = 1 | 2 | 3 | 4;
type TxStatus = "idle" | "pending" | "success" | "error";

interface Props {
  type: TxType;
  balance: string;
  /** Current share price used to estimate shares / tokens in the review step. Defaults to "1.0". */
  sharePrice?: string;
  onClose: () => void;
}

interface GasEstimate {
  baseFee: string;
  priorityFee: string;
  totalGas: string;
}

// ─── Timeline step definitions ────────────────────────────────────────────────

interface StepDef {
  id: Step;
  label: string;
  descriptions: Record<TxType, string>;
}

const STEP_DEFS: StepDef[] = [
  {
    id: 1,
    label: "Confirm",
    descriptions: {
      deposit: "Enter the amount you want to deposit into the vault.",
      withdraw: "Enter the number of shares you want to redeem.",
      harvest: "Enter the yield amount you want to inject into the vault.",
    },
  },
  {
    id: 2,
    label: "Sign",
    descriptions: {
      deposit: "Review gas estimates and confirm the deposit details.",
      withdraw: "Review the redemption details and estimated output.",
      harvest: "Review the yield injection details before confirming.",
    },
  },
  {
    id: 3,
    label: "Submit",
    descriptions: {
      deposit: "Submitting your deposit to the Stellar network…",
      withdraw: "Broadcasting your withdrawal transaction…",
      harvest: "Broadcasting your harvest transaction…",
    },
  },
  {
    id: 4,
    label: "Confirmed",
    descriptions: {
      deposit: "Your deposit was successful. Shares have been minted.",
      withdraw: "Withdrawal complete. Underlying tokens have been sent.",
      harvest: "Harvest complete. Yield has been injected into the vault.",
    },
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <svg
      className="animate-spin h-5 w-5 text-current"
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

// ─── StepTimeline component ───────────────────────────────────────────────────

interface StepTimelineProps {
  currentStep: Step;
  txType: TxType;
  txStatus: TxStatus;
}

function StepTimeline({ currentStep, txType, txStatus }: StepTimelineProps) {
  // Derive the "effective" step for display:
  // After success we show step 4 as complete; error keeps us on step 3.
  const displayStep: Step =
    txStatus === "success" ? 4 : currentStep;

  const currentDef =
    STEP_DEFS.find((s) => s.id === displayStep) ?? STEP_DEFS[0];
  const description = currentDef.descriptions[txType];

  return (
    <div className="mb-6">
      {/* Accessible live region — announces step changes to screen readers */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {`Step ${displayStep} of 4: ${currentDef.label}. ${description}`}
      </div>

      {/* Visual timeline */}
      <ol
        aria-label="Transaction steps"
        className="flex items-center w-full mb-3"
      >
        {STEP_DEFS.map((stepDef, index) => {
          const isCompleted = stepDef.id < displayStep;
          const isCurrent = stepDef.id === displayStep;
          const isFuture = stepDef.id > displayStep;
          const isLast = index === STEP_DEFS.length - 1;

          return (
            <li
              key={stepDef.id}
              className="flex items-center flex-1 last:flex-none"
              aria-current={isCurrent ? "step" : undefined}
            >
              {/* Circle */}
              <div className="flex flex-col items-center gap-1 relative">
                <div
                  className={[
                    "relative flex h-8 w-8 items-center justify-center rounded-full border-2 transition-all duration-300",
                    isCompleted
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : isCurrent
                      ? "border-indigo-600 bg-indigo-600 text-white ring-4 ring-indigo-600/20"
                      : "border-zinc-300 bg-white text-zinc-400 dark:border-zinc-600 dark:bg-zinc-900",
                  ].join(" ")}
                  aria-hidden="true"
                >
                  {isCompleted ? (
                    <Check size={14} strokeWidth={3} />
                  ) : isCurrent && (txStatus === "pending" || stepDef.id === 3) ? (
                    <span className="h-2.5 w-2.5 rounded-full bg-white animate-pulse" />
                  ) : (
                    <span className="text-xs font-bold">{stepDef.id}</span>
                  )}
                </div>

                {/* Label below circle */}
                <span
                  className={[
                    "absolute top-9 text-[10px] font-medium whitespace-nowrap transition-colors duration-300",
                    isCompleted
                      ? "text-emerald-600 dark:text-emerald-400"
                      : isCurrent
                      ? "text-indigo-600 dark:text-indigo-400"
                      : "text-zinc-400 dark:text-zinc-500",
                  ].join(" ")}
                >
                  {stepDef.label}
                </span>
              </div>

              {/* Connector line between steps */}
              {!isLast && (
                <div
                  aria-hidden="true"
                  className="flex-1 mx-1 relative h-0.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700"
                >
                  {/* Animated fill for completed connectors */}
                  <div
                    className={[
                      "absolute inset-0 h-full rounded-full transition-all duration-500 ease-in-out",
                      isCompleted
                        ? "bg-emerald-500 w-full"
                        : isCurrent
                        ? "bg-indigo-600 w-1/2"
                        : "w-0",
                    ].join(" ")}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {/* Step description — context-specific copy */}
      <div className="mt-7 pt-2 border-t border-zinc-100 dark:border-zinc-800">
        <p
          className={[
            "text-sm transition-colors duration-200",
            isFutureStep(displayStep)
              ? "text-zinc-400"
              : "text-zinc-600 dark:text-zinc-300",
          ].join(" ")}
        >
          {description}
        </p>
      </div>
    </div>
  );
}

function isFutureStep(_step: Step) {
  // helper kept for potential future use — currently description is always contextual
  return false;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function TransactionModal({ type, balance, sharePrice = "1.0", onClose }: Props) {
  const [step, setStep] = useState<Step>(1);
  const [amount, setAmount] = useState("");
  const [amountError, setAmountError] = useState("");
  const [status, setStatus] = useState<TxStatus>("idle");
  const [txHash, setTxHash] = useState("");
  const [txError, setTxError] = useState("");
  const [gasEstimate, setGasEstimate] = useState<GasEstimate | null>(null);
  const [gasLoading, setGasLoading] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const { vibrate } = useHapticsStandalone();

  useEffect(() => {
    if (step === 1) inputRef.current?.focus();
  }, [step]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  async function estimateGas(txAmount: string): Promise<void> {
    setGasLoading(true);
    try {
      const res = await fetch("/api/vault/estimate-gas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, amount: txAmount }),
      });
      if (res.ok) {
        const data = await res.json();
        setGasEstimate({
          baseFee: data.baseFee ?? "0.001",
          priorityFee: data.priorityFee ?? "0.0005",
          totalGas: data.totalGas ?? "0.0015",
        });
      } else {
        setGasEstimate({ baseFee: "0.001", priorityFee: "0.0005", totalGas: "0.0015" });
      }
    } catch {
      setGasEstimate({ baseFee: "0.001", priorityFee: "0.0005", totalGas: "0.0015" });
    } finally {
      setGasLoading(false);
    }
  }

  function validateAmount(): boolean {
    const n = parseFloat(amount);
    if (!amount || isNaN(n) || n <= 0) {
      setAmountError("Enter an amount greater than 0");
      return false;
    }
    if (n > parseFloat(balance)) {
      setAmountError("Amount exceeds your balance");
      return false;
    }
    setAmountError("");
    return true;
  }

  async function handleNext() {
    if (step === 1 && validateAmount()) {
      await estimateGas(amount);
      setStep(2);
    } else if (step === 2) {
      vibrate("confirmationOpen"); // 1 short vibration when confirm dialog advances
      setStep(3);
      await handleSubmit();
    }
  }

  async function handleSubmit(retrying = false) {
    if (!retrying) {
      setStatus("pending");
      setTxError("");
    }
    try {
      const res = await fetch("/api/vault/transactions/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, amount }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Transaction failed");
      setTxHash(data.hash ?? `tx-${Date.now()}`);
      setStatus("success");
      vibrate("transactionSuccess"); // 2 short vibrations
      setRetryCount(0);
    } catch (err: unknown) {
      const errorMsg =
        (err instanceof Error ? err.message : "Transaction failed") ??
        "Transaction failed";
      setTxError(errorMsg);
      setStatus("error");
      vibrate("transactionFailure"); // 3 long vibrations

      if (retrying) {
        setRetryCount((prev) => prev + 1);
      }
    }
  }

  function handleRetry() {
    setStatus("idle");
    setRetryCount((prev) => prev + 1);
    void handleSubmit(true);
  }

  const labelMap: Record<TxType, string> = { deposit: "Deposit", withdraw: "Withdraw", harvest: "Harvest" };
  const label = labelMap[type];
  const balanceNum = parseFloat(balance);
  const amountNum = parseFloat(amount) || 0;
  const sharePriceNum = parseFloat(sharePrice) || 1;
  const totalWithGas = amountNum + parseFloat(gasEstimate?.totalGas ?? "0");

  // Estimated shares for deposit: amount / sharePrice
  const estimatedShares =
    sharePriceNum > 0
      ? Math.floor(amountNum / sharePriceNum).toString()
      : "0";
  // Estimated tokens for withdraw: shares * sharePrice (treat amount as shares for withdraw)
  const estimatedTokens =
    type === "withdraw"
      ? (amountNum * sharePriceNum).toFixed(4)
      : "0";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`${label} modal`}
      data-cy="tx-modal"
    >
      <div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-zinc-900 animate-modal-content">
        <button
          data-cy="modal-close"
          onClick={onClose}
          className="absolute right-4 top-4 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
          aria-label="Close"
        >
          ✕
        </button>

        <h2 className="mb-5 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          {label}
        </h2>

        {/* ── Visual step timeline ─────────────────────────────────────── */}
        <StepTimeline
          currentStep={step}
          txType={type}
          txStatus={status}
        />

        {/* ── Step 1: Amount Input ─────────────────────────────────────── */}
        {step === 1 && (
          <div data-cy="modal-step-1" className="flex flex-col gap-4">
            <p className="text-sm text-zinc-500">
              Available:{" "}
              <span className="font-mono font-semibold text-zinc-800 dark:text-zinc-200">
                {balance}
              </span>
            </p>
            <input
              ref={inputRef}
              data-cy="modal-amount-input"
              type="number"
              min="0"
              step="any"
              placeholder="0.00"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setAmountError("");
              }}
              className="rounded-lg border border-zinc-300 px-4 py-2.5 font-mono text-lg focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
            />

            {/* Quick amount buttons */}
            <div className="flex gap-2">
              {[25, 50, 75, 100].map((pct) => (
                <button
                  key={pct}
                  onClick={() => {
                    const amt = (balanceNum * pct) / 100;
                    setAmount(amt.toFixed(2));
                    setAmountError("");
                  }}
                  className="flex-1 rounded-md bg-zinc-100 px-2 py-1.5 text-xs font-medium hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700"
                >
                  {pct}%
                </button>
              ))}
            </div>

            {amountError && (
              <p
                data-cy="modal-amount-error"
                className="text-sm text-red-600 dark:text-red-400 flex items-center gap-2"
                role="alert"
              >
                <AlertCircle size={16} />
                {amountError}
              </p>
            )}

            <button
              data-cy="modal-next-btn"
              onClick={() => void handleNext()}
              className="rounded-lg bg-zinc-900 px-4 py-2.5 font-semibold text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-black dark:hover:bg-zinc-300"
            >
              Next
            </button>
          </div>
        )}

        {/* ── Step 2: Review / Sign ────────────────────────────────────── */}
        {step === 2 && (
          <div data-cy="modal-step-2" className="flex flex-col gap-4">
            <TransactionConfirmation
              type={type}
              amount={amount}
              estimatedShares={estimatedShares}
              estimatedTokens={estimatedTokens}
              sharePrice={sharePrice}
              onConfirm={() => void handleNext()}
              onBack={() => setStep(1)}
            />

            {totalWithGas > balanceNum && (
              <p className="text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
                <AlertCircle size={16} />
                Insufficient balance for gas fees
              </p>
            )}
          </div>
        )}

        {/* ── Step 3: Submit / Result ──────────────────────────────────── */}
        {step === 3 && (
          <div
            data-cy="modal-step-3"
            className="flex flex-col items-center gap-4 py-4 text-center"
          >
            {status === "pending" && (
              <>
                <Spinner />
                <p className="text-sm text-zinc-500">
                  Broadcasting transaction to Stellar…
                </p>
                <button
                  data-cy="modal-confirm-btn"
                  disabled
                  className="rounded-lg bg-zinc-200 px-4 py-2.5 font-semibold text-zinc-400 dark:bg-zinc-700 dark:text-zinc-500"
                >
                  Waiting…
                </button>
              </>
            )}

            {status === "success" && (
              <div
                data-cy="modal-success"
                className="flex flex-col items-center gap-3 w-full"
              >
                <CheckCircle
                  size={48}
                  className="text-green-600 dark:text-green-400"
                />
                <p className="font-semibold text-zinc-900 dark:text-zinc-50">
                  {label} successful!
                </p>
                <p className="text-xs text-zinc-500">
                  Tx:{" "}
                  <span data-cy="modal-tx-hash" className="font-mono">
                    {txHash.slice(0, 16)}…
                  </span>
                </p>
                <button
                  onClick={onClose}
                  className="mt-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-black"
                >
                  Done
                </button>
              </div>
            )}

            {status === "error" && (
              <div
                data-cy="modal-error"
                className="flex flex-col items-center gap-3"
              >
                <XCircle
                  size={48}
                  className="text-red-600 dark:text-red-400"
                />
                <p className="text-sm text-red-600 dark:text-red-400">
                  {txError || "Transaction failed"}
                </p>
                {retryCount < 3 && (
                  <button
                    data-cy="modal-retry-btn"
                    onClick={handleRetry}
                    className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-black"
                  >
                    Retry {retryCount > 0 && `(${retryCount}/3)`}
                  </button>
                )}
                <button
                  onClick={() => setStep(1)}
                  className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-800"
                >
                  Start Over
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ErrorRecoveryPanel — renders contextual recovery guidance
// ---------------------------------------------------------------------------

interface ErrorRecoveryPanelProps {
  txError: string;
  balance: string;
  amount: string;
  retryCount: number;
  handleRetry: () => void;
  setStep: (step: Step) => void;
  setAmount: (amount: string) => void;
}

const ICON_MAP: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  Wallet,
  PauseCircle,
  Globe,
  WifiOff,
  XCircle,
  AlertCircle,
  CheckCircle,
  ExternalLink,
};

const SEVERITY_STYLES: Record<VaultErrorContext["severity"], {
  border: string;
  iconClass: string;
  titleClass: string;
}> = {
  error: {
    border: "border-l-4 border-red-500",
    iconClass: "text-red-600 dark:text-red-400",
    titleClass: "text-red-700 dark:text-red-300",
  },
  warning: {
    border: "border-l-4 border-yellow-500",
    iconClass: "text-yellow-600 dark:text-yellow-400",
    titleClass: "text-yellow-700 dark:text-yellow-300",
  },
  info: {
    border: "border-l-4 border-blue-500",
    iconClass: "text-blue-600 dark:text-blue-400",
    titleClass: "text-blue-700 dark:text-blue-300",
  },
};

function ErrorRecoveryPanel({
  txError,
  balance,
  amount,
  retryCount,
  handleRetry,
  setStep,
  setAmount,
}: ErrorRecoveryPanelProps) {
  const recovery = getErrorRecovery(txError || "Transaction failed", {
    walletBalance: balance,
    enteredAmount: amount,
    tokenSymbol: "USDC",
  });

  const styles = SEVERITY_STYLES[recovery.severity];
  const IconComponent = ICON_MAP[recovery.icon] ?? XCircle;

  return (
    <div
      data-cy="modal-error"
      className={`w-full rounded-xl bg-zinc-50 dark:bg-zinc-800 p-4 text-left ${styles.border}`}
    >
      {/* Header: icon + title */}
      <div className="flex items-start gap-3 mb-2">
        <IconComponent size={24} className={`mt-0.5 shrink-0 ${styles.iconClass}`} />
        <p className={`font-bold text-sm ${styles.titleClass}`}>{recovery.title}</p>
      </div>

      {/* Descriptive message */}
      <p className="text-sm text-zinc-600 dark:text-zinc-300 mb-4 pl-9">
        {recovery.message}
      </p>

      {/* Action buttons */}
      <div className="flex flex-col gap-2 pl-9">
        {recovery.actions.map((recoveryAction) => {
          if (recoveryAction.action === "external") {
            return (
              <a
                key={recoveryAction.label}
                href={recoveryAction.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-black dark:hover:bg-zinc-300"
              >
                {recoveryAction.label}
                <ExternalLink size={13} />
              </a>
            );
          }

          if (recoveryAction.action === "retry") {
            if (retryCount >= 3) return null;
            return (
              <button
                key={recoveryAction.label}
                data-cy="modal-retry-btn"
                onClick={handleRetry}
                className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-black"
              >
                {recoveryAction.label}
                {retryCount > 0 && ` (${retryCount}/3)`}
              </button>
            );
          }

          if (recoveryAction.action === "reduce_amount") {
            return (
              <button
                key={recoveryAction.label}
                onClick={() => setStep(1)}
                className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-black"
              >
                {recoveryAction.label}
              </button>
            );
          }

          if (recoveryAction.action === "start_over") {
            return (
              <button
                key={recoveryAction.label}
                onClick={() => {
                  setAmount("");
                  setStep(1);
                }}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-800"
              >
                {recoveryAction.label}
              </button>
            );
          }

          return null;
        })}
      </div>
    </div>
  );
}
