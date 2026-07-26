/**
 * Tests for horizonRetryService — Issue #321
 */

import { describe, it, expect, vi } from "vitest";
import {
  submitWithRetry,
  isRetryable,
  backoffDelayMs,
  TERMINAL_ERROR_CODES,
  RETRYABLE_ERROR_CODES,
  MAX_RETRIES,
  BASE_DELAY_MS,
  type HorizonTransactionResult,
  type HorizonSubmitter,
} from "./horizonRetryService.js";

const NO_SLEEP = async (_ms: number) => {};  // skip real waits in tests

const FAKE_XDR = "AAAA...base64xdr";

// ---------------------------------------------------------------------------
// backoffDelayMs
// ---------------------------------------------------------------------------

describe("backoffDelayMs", () => {
  it("returns 1s for attempt 1", () => expect(backoffDelayMs(1)).toBe(1_000));
  it("returns 2s for attempt 2", () => expect(backoffDelayMs(2)).toBe(2_000));
  it("returns 4s for attempt 3", () => expect(backoffDelayMs(3)).toBe(4_000));
});

// ---------------------------------------------------------------------------
// isRetryable
// ---------------------------------------------------------------------------

describe("isRetryable", () => {
  it("returns true for network errors", () => {
    expect(isRetryable({ networkError: true })).toBe(true);
  });

  it("returns true for HTTP 503", () => {
    expect(isRetryable({ httpStatus: 503 })).toBe(true);
  });

  it("returns true for tx_too_late", () => {
    expect(isRetryable({ resultCode: "tx_too_late" })).toBe(true);
  });

  it("returns false for tx_bad_auth (terminal)", () => {
    expect(isRetryable({ resultCode: "tx_bad_auth" })).toBe(false);
  });

  it("returns false for tx_insufficient_balance (terminal)", () => {
    expect(isRetryable({ resultCode: "tx_insufficient_balance" })).toBe(false);
  });

  it("returns false for tx_bad_seq (terminal)", () => {
    expect(isRetryable({ resultCode: "tx_bad_seq" })).toBe(false);
  });

  it("returns true for unknown result code (fail open)", () => {
    expect(isRetryable({ resultCode: "tx_unknown_future_code" })).toBe(true);
  });

  it("returns true when no result code present", () => {
    expect(isRetryable({})).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// submitWithRetry — happy path
// ---------------------------------------------------------------------------

describe("submitWithRetry — success", () => {
  it("returns success on first attempt when hash is returned", async () => {
    const submit: HorizonSubmitter = vi.fn().mockResolvedValue({ hash: "txhash123" });
    const result = await submitWithRetry(FAKE_XDR, submit, undefined, NO_SLEEP);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.hash).toBe("txhash123");
      expect(result.attempts).toBe(1);
    }
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("succeeds on second attempt after a retryable failure", async () => {
    const submit: HorizonSubmitter = vi
      .fn()
      .mockResolvedValueOnce({ resultCode: "tx_too_late" })
      .mockResolvedValueOnce({ hash: "txhash-retry" });

    const result = await submitWithRetry(FAKE_XDR, submit, undefined, NO_SLEEP);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.attempts).toBe(2);
    }
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it("succeeds on third attempt after two retryable failures", async () => {
    const submit: HorizonSubmitter = vi
      .fn()
      .mockResolvedValueOnce({ httpStatus: 503, detail: "unavailable" })
      .mockResolvedValueOnce({ networkError: true })
      .mockResolvedValueOnce({ hash: "final-hash" });

    const result = await submitWithRetry(FAKE_XDR, submit, undefined, NO_SLEEP);
    expect(result.success).toBe(true);
    if (result.success) expect(result.attempts).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// submitWithRetry — terminal errors
// ---------------------------------------------------------------------------

describe("submitWithRetry — terminal errors (no retry)", () => {
  for (const code of TERMINAL_ERROR_CODES) {
    it(`does not retry on ${code}`, async () => {
      const submit: HorizonSubmitter = vi.fn().mockResolvedValue({ resultCode: code });
      const result = await submitWithRetry(FAKE_XDR, submit, undefined, NO_SLEEP);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(code);
        expect(result.error.retryable).toBe(false);
        expect(result.error.attempts).toBe(1);
      }
      // Should only call submit once — no retries
      expect(submit).toHaveBeenCalledTimes(1);
    });
  }
});

// ---------------------------------------------------------------------------
// submitWithRetry — exhausted retries
// ---------------------------------------------------------------------------

describe("submitWithRetry — exhausted retries", () => {
  it("fails after MAX_RETRIES with retryable errors", async () => {
    const submit: HorizonSubmitter = vi
      .fn()
      .mockResolvedValue({ resultCode: "tx_too_late" });

    const result = await submitWithRetry(FAKE_XDR, submit, undefined, NO_SLEEP);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.attempts).toBe(MAX_RETRIES);
    }
    expect(submit).toHaveBeenCalledTimes(MAX_RETRIES);
  });

  it("fails after MAX_RETRIES on repeated network errors", async () => {
    const submit: HorizonSubmitter = vi
      .fn()
      .mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await submitWithRetry(FAKE_XDR, submit, undefined, NO_SLEEP);

    expect(result.success).toBe(false);
    expect(submit).toHaveBeenCalledTimes(MAX_RETRIES);
  });

  it("calls notifier on terminal failure", async () => {
    const submit: HorizonSubmitter = vi
      .fn()
      .mockResolvedValue({ resultCode: "tx_bad_auth" });

    const notify = vi.fn().mockResolvedValue(undefined);
    await submitWithRetry(FAKE_XDR, submit, notify, NO_SLEEP);

    expect(notify).toHaveBeenCalledOnce();
    expect(notify.mock.calls[0][0]).toMatchObject({ code: "tx_bad_auth" });
  });

  it("calls notifier after exhausted retries", async () => {
    const submit: HorizonSubmitter = vi
      .fn()
      .mockResolvedValue({ resultCode: "tx_too_late" });

    const notify = vi.fn().mockResolvedValue(undefined);
    await submitWithRetry(FAKE_XDR, submit, notify, NO_SLEEP);

    expect(notify).toHaveBeenCalledOnce();
  });

  it("does not call notifier on success", async () => {
    const submit: HorizonSubmitter = vi.fn().mockResolvedValue({ hash: "ok" });
    const notify = vi.fn().mockResolvedValue(undefined);
    await submitWithRetry(FAKE_XDR, submit, notify, NO_SLEEP);
    expect(notify).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Backoff timing
// ---------------------------------------------------------------------------

describe("submitWithRetry — backoff timing", () => {
  it("sleeps with correct backoff delays between retries", async () => {
    const submit: HorizonSubmitter = vi
      .fn()
      .mockResolvedValueOnce({ resultCode: "tx_too_late" })
      .mockResolvedValueOnce({ resultCode: "tx_too_late" })
      .mockResolvedValueOnce({ resultCode: "tx_too_late" });

    const sleepDelays: number[] = [];
    const sleep = async (ms: number) => { sleepDelays.push(ms); };

    await submitWithRetry(FAKE_XDR, submit, undefined, sleep);

    // Should sleep after attempt 1 (1s) and attempt 2 (2s), not after attempt 3
    expect(sleepDelays).toEqual([BASE_DELAY_MS, BASE_DELAY_MS * 2]);
  });

  it("does not sleep on terminal error", async () => {
    const submit: HorizonSubmitter = vi
      .fn()
      .mockResolvedValue({ resultCode: "tx_bad_auth" });

    const sleepDelays: number[] = [];
    const sleep = async (ms: number) => { sleepDelays.push(ms); };

    await submitWithRetry(FAKE_XDR, submit, undefined, sleep);

    expect(sleepDelays).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// SubmissionError shape
// ---------------------------------------------------------------------------

describe("SubmissionError fields", () => {
  it("includes lastAttemptAt as ISO timestamp", async () => {
    const submit: HorizonSubmitter = vi
      .fn()
      .mockResolvedValue({ resultCode: "tx_bad_auth" });

    const result = await submitWithRetry(FAKE_XDR, submit, undefined, NO_SLEEP);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(new Date(result.error.lastAttemptAt).toISOString()).toBe(
        result.error.lastAttemptAt
      );
    }
  });
});
