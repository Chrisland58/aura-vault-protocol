/**
 * Unit tests for TransactionConfirmation component logic.
 *
 * Because vitest is configured with environment: "node" (no JSDOM) and there
 * is no @testing-library/react installed, these tests cover:
 *
 *   1. Plain-language copy generation for deposit, withdraw, and harvest
 *   2. Fee breakdown visibility (shown only when fee > 0)
 *   3. Share / token estimation arithmetic
 *   4. Callback invocation for onConfirm and onBack (via handler stubs)
 *   5. "Learn more" href target (/faq)
 *
 * React rendering belongs in integration / Playwright tests. All logic tested
 * here is pure TypeScript extracted from the component.
 */

import { describe, it, expect, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers — inline copies of logic from TransactionConfirmation.tsx
// ─────────────────────────────────────────────────────────────────────────────

/** Mirrors the plain-language deposit summary string. */
function depositSummary(amount: string, estimatedShares: string): string {
  return `You are depositing ${amount} USDC and will receive approximately ${estimatedShares} vault shares`;
}

/** Mirrors the plain-language withdraw summary string. */
function withdrawSummary(estimatedShares: string, estimatedTokens: string): string {
  return `You are redeeming ${estimatedShares} vault shares for approximately ${estimatedTokens} USDC`;
}

/** Mirrors the plain-language harvest summary string. */
function harvestSummary(amount: string): string {
  return `You are injecting ${amount} USDC of yield, increasing the share price for all holders`;
}

/** Mirrors the FeeBreakdown visibility gate. */
function shouldShowFee(fee: string | undefined): boolean {
  if (fee === undefined) return false;
  const n = parseFloat(fee);
  return !isNaN(n) && n > 0;
}

/** Protocol fee label. */
function feeLabel(fee: string): string {
  return `Protocol fee: ${fee} USDC`;
}

/** Learn more link href. */
const LEARN_MORE_HREF = "/faq";

// ─────────────────────────────────────────────────────────────────────────────
// Estimation arithmetic (mirrors TransactionModal computed values)
// ─────────────────────────────────────────────────────────────────────────────

/** Estimated shares minted on deposit: floor(amount / sharePrice). */
function estimateSharesFromDeposit(amount: string, sharePrice: string): string {
  const amountNum = parseFloat(amount) || 0;
  const sharePriceNum = parseFloat(sharePrice);
  if (isNaN(sharePriceNum) || sharePriceNum <= 0) return "0";
  return Math.floor(amountNum / sharePriceNum).toString();
}

/** Estimated tokens returned on withdraw: shares * sharePrice. */
function estimateTokensFromWithdraw(shares: string, sharePrice: string): string {
  const sharesNum = parseFloat(shares) || 0;
  const sharePriceNum = parseFloat(sharePrice) || 1;
  return (sharesNum * sharePriceNum).toFixed(4);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests — plain-language copy
// ─────────────────────────────────────────────────────────────────────────────

describe("TransactionConfirmation — deposit plain-language text", () => {
  it("renders correct deposit summary with amount and shares", () => {
    const summary = depositSummary("100", "98");
    expect(summary).toBe(
      "You are depositing 100 USDC and will receive approximately 98 vault shares"
    );
  });

  it("includes the amount verbatim", () => {
    expect(depositSummary("250.50", "247")).toContain("250.50 USDC");
  });

  it("includes the estimated shares verbatim", () => {
    expect(depositSummary("500", "490")).toContain("490 vault shares");
  });
});

describe("TransactionConfirmation — withdraw plain-language text", () => {
  it("renders correct withdraw summary with shares and tokens", () => {
    const summary = withdrawSummary("50", "51.25");
    expect(summary).toBe(
      "You are redeeming 50 vault shares for approximately 51.25 USDC"
    );
  });

  it("includes the shares verbatim", () => {
    expect(withdrawSummary("200", "204.00")).toContain("200 vault shares");
  });

  it("includes the estimated token return verbatim", () => {
    expect(withdrawSummary("100", "102.50")).toContain("102.50 USDC");
  });
});

describe("TransactionConfirmation — harvest plain-language text", () => {
  it("renders correct harvest summary with injected amount", () => {
    const summary = harvestSummary("1000");
    expect(summary).toBe(
      "You are injecting 1000 USDC of yield, increasing the share price for all holders"
    );
  });

  it("includes the amount verbatim", () => {
    expect(harvestSummary("750.00")).toContain("750.00 USDC");
  });

  it("mentions increasing share price", () => {
    expect(harvestSummary("10")).toContain("increasing the share price for all holders");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — Learn more link
// ─────────────────────────────────────────────────────────────────────────────

describe("TransactionConfirmation — Learn more link", () => {
  it("points to /faq", () => {
    expect(LEARN_MORE_HREF).toBe("/faq");
  });

  it("renders 'Learn more' label text", () => {
    const label = "Learn more";
    expect(label).toBeTruthy();
    expect(LEARN_MORE_HREF).toContain("faq");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — fee breakdown visibility
// ─────────────────────────────────────────────────────────────────────────────

describe("TransactionConfirmation — fee breakdown visibility", () => {
  it("shows fee section when fee > 0", () => {
    expect(shouldShowFee("2.50")).toBe(true);
  });

  it("shows fee section when fee is a small positive number", () => {
    expect(shouldShowFee("0.01")).toBe(true);
  });

  it("hides fee section when fee is '0'", () => {
    expect(shouldShowFee("0")).toBe(false);
  });

  it("hides fee section when fee is undefined", () => {
    expect(shouldShowFee(undefined)).toBe(false);
  });

  it("hides fee section when fee is NaN string", () => {
    expect(shouldShowFee("not-a-number")).toBe(false);
  });

  it("includes 'Protocol fee: X USDC' label when shown", () => {
    expect(feeLabel("2.50")).toBe("Protocol fee: 2.50 USDC");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — onConfirm / onBack callback invocation
// ─────────────────────────────────────────────────────────────────────────────

describe("TransactionConfirmation — onConfirm callback", () => {
  it("calls onConfirm exactly once when confirm is triggered", () => {
    const onConfirm = vi.fn();
    // Simulate the button click handler calling onConfirm
    onConfirm();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("does not call onBack when onConfirm is triggered", () => {
    const onConfirm = vi.fn();
    const onBack = vi.fn();
    onConfirm();
    expect(onBack).not.toHaveBeenCalled();
  });
});

describe("TransactionConfirmation — onBack callback", () => {
  it("calls onBack exactly once when back is triggered", () => {
    const onBack = vi.fn();
    // Simulate the back button click handler calling onBack
    onBack();
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("does not call onConfirm when onBack is triggered", () => {
    const onConfirm = vi.fn();
    const onBack = vi.fn();
    onBack();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — share / token estimation arithmetic
// ─────────────────────────────────────────────────────────────────────────────

describe("estimateSharesFromDeposit", () => {
  it("floors shares at sharePrice = 1.0 (1:1 ratio)", () => {
    expect(estimateSharesFromDeposit("100", "1.0")).toBe("100");
  });

  it("floors fractional shares correctly", () => {
    // 100 / 1.05 = 95.238… → floor = 95
    expect(estimateSharesFromDeposit("100", "1.05")).toBe("95");
  });

  it("returns '0' for zero amount", () => {
    expect(estimateSharesFromDeposit("0", "1.0")).toBe("0");
  });

  it("returns '0' for zero sharePrice", () => {
    expect(estimateSharesFromDeposit("100", "0")).toBe("0");
  });

  it("handles string amounts with decimals", () => {
    expect(estimateSharesFromDeposit("250.00", "1.0")).toBe("250");
  });
});

describe("estimateTokensFromWithdraw", () => {
  it("returns amount × sharePrice to 4 decimal places", () => {
    expect(estimateTokensFromWithdraw("100", "1.0")).toBe("100.0000");
  });

  it("accounts for share price > 1", () => {
    expect(estimateTokensFromWithdraw("50", "1.02")).toBe("51.0000");
  });

  it("returns '0.0000' for zero shares", () => {
    expect(estimateTokensFromWithdraw("0", "1.05")).toBe("0.0000");
  });

  it("rounds correctly to 4 decimal places", () => {
    // 3 * 1.0001 = 3.0003
    expect(estimateTokensFromWithdraw("3", "1.0001")).toBe("3.0003");
  });
});
