/**
 * Horizon Submission Retry Service — Issue #321
 *
 * Wraps Horizon transaction submission with exponential backoff retry:
 *   - Retry on: network timeout, 503 Service Unavailable, tx_too_late
 *   - Do NOT retry on: tx_bad_auth, tx_insufficient_balance (terminal errors)
 *   - Backoff schedule: 1 s → 2 s → 4 s  (max 3 retries)
 *   - After max retries the error is returned with full details
 *   - Caller is notified via optional webhook/email on terminal failure
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Horizon result codes for a failed transaction */
export interface HorizonTransactionResult {
  /** HTTP status from Horizon */
  httpStatus?: number;
  /** Horizon result code string, e.g. "tx_bad_auth" */
  resultCode?: string;
  /** Network-level error (e.g. fetch timeout) */
  networkError?: boolean;
  /** Human-readable detail */
  detail?: string;
  /** Successful transaction hash (when submission succeeds) */
  hash?: string;
}

export interface SubmissionError {
  code: string;
  message: string;
  attempts: number;
  lastAttemptAt: string;
  retryable: boolean;
}

export interface SubmissionResult {
  success: true;
  hash: string;
  attempts: number;
}

export type HorizonSubmissionOutcome = SubmissionResult | { success: false; error: SubmissionError };

/** Callable that submits a signed XDR blob to Horizon */
export type HorizonSubmitter = (xdr: string) => Promise<HorizonTransactionResult>;

/** Optional notification callback invoked on terminal failure */
export type FailureNotifier = (error: SubmissionError) => Promise<void>;

// ---------------------------------------------------------------------------
// Retry policy
// ---------------------------------------------------------------------------

/**
 * Result codes that should never be retried — the transaction is definitively
 * rejected by the network and a retry would produce the same failure.
 */
export const TERMINAL_ERROR_CODES = new Set([
  "tx_bad_auth",
  "tx_insufficient_balance",
  "tx_bad_seq",
  "tx_no_account",
  "tx_insufficient_fee",
  "tx_bad_minSeqAge",
  "tx_bad_minSeqLedgerGap",
]);

/**
 * Result codes / conditions that are safe to retry.
 * Anything not in TERMINAL_ERROR_CODES and matching this set is retryable.
 */
export const RETRYABLE_ERROR_CODES = new Set([
  "tx_too_late",
  "timeout",
]);

export const MAX_RETRIES = 3;
export const BASE_DELAY_MS = 1_000;

/** Exponential backoff: 1s, 2s, 4s for attempts 1, 2, 3 */
export function backoffDelayMs(attempt: number): number {
  return BASE_DELAY_MS * Math.pow(2, attempt - 1);
}

/**
 * Determine whether a Horizon result is retryable.
 *
 * Retryable conditions:
 *   1. Network error (timeout / fetch failure)
 *   2. HTTP 503 Service Unavailable
 *   3. Result code is in RETRYABLE_ERROR_CODES
 *   4. Unknown error codes (we fail open toward retrying, except terminal codes)
 */
export function isRetryable(result: HorizonTransactionResult): boolean {
  if (result.networkError) return true;
  if (result.httpStatus === 503) return true;

  const code = result.resultCode;
  if (!code) return true; // unknown error — retry

  if (TERMINAL_ERROR_CODES.has(code)) return false;
  return true; // includes tx_too_late and other transient failures
}

// ---------------------------------------------------------------------------
// Core retry loop
// ---------------------------------------------------------------------------

/** Inject a sleep function for testability */
type Sleeper = (ms: number) => Promise<void>;
const defaultSleep: Sleeper = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Submit a signed transaction XDR to Horizon with exponential backoff retry.
 *
 * @param xdr        Signed transaction XDR string
 * @param submit     Horizon submitter (real or mock)
 * @param notify     Optional failure notifier (webhook/email)
 * @param sleep      Injectable sleep for testing (default: real setTimeout)
 */
export async function submitWithRetry(
  xdr: string,
  submit: HorizonSubmitter,
  notify?: FailureNotifier,
  sleep: Sleeper = defaultSleep
): Promise<HorizonSubmissionOutcome> {
  let lastResult: HorizonTransactionResult = {};

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await submit(xdr);

      if (result.hash) {
        // Success
        return { success: true, hash: result.hash, attempts: attempt };
      }

      lastResult = result;

      // Check if this failure is retryable
      if (!isRetryable(result)) {
        const error: SubmissionError = {
          code: result.resultCode ?? "unknown",
          message: result.detail ?? `Terminal error: ${result.resultCode}`,
          attempts: attempt,
          lastAttemptAt: new Date().toISOString(),
          retryable: false,
        };
        if (notify) await notify(error).catch(console.error);
        return { success: false, error };
      }

      // Retryable — back off before the next attempt (unless it's the last)
      if (attempt < MAX_RETRIES) {
        await sleep(backoffDelayMs(attempt));
      }
    } catch (err) {
      // Network-level exception (fetch failed, timeout, etc.)
      lastResult = {
        networkError: true,
        detail: err instanceof Error ? err.message : String(err),
      };

      if (attempt < MAX_RETRIES) {
        await sleep(backoffDelayMs(attempt));
      }
    }
  }

  // Exhausted all retries
  const error: SubmissionError = {
    code: lastResult.resultCode ?? "max_retries_exceeded",
    message:
      lastResult.detail ??
      `Transaction submission failed after ${MAX_RETRIES} attempts`,
    attempts: MAX_RETRIES,
    lastAttemptAt: new Date().toISOString(),
    retryable: true,
  };

  if (notify) await notify(error).catch(console.error);
  return { success: false, error };
}
