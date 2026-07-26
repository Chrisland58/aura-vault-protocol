/**
 * Tests for analyticsService — Issue #320
 */

import { describe, it, expect } from "vitest";
import { computeAnalytics } from "./analyticsService.js";
import type { TxEvent } from "./analyticsService.js";

const ADDR = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

describe("computeAnalytics — basic", () => {
  it("returns zeros for empty event list", () => {
    const result = computeAnalytics(ADDR, []);
    expect(result.totalDeposited).toBe("0");
    expect(result.totalWithdrawn).toBe("0");
    expect(result.netPnL).toBe("0");
    expect(result.averageEntryPrice).toBe("0.000000");
    expect(result.transactionCount).toBe(0);
  });

  it("sums totalDeposited across multiple deposits", () => {
    const events: TxEvent[] = [
      { type: "deposit", amount: "1000", timestamp: 1 },
      { type: "deposit", amount: "2000", timestamp: 2 },
    ];
    const result = computeAnalytics(ADDR, events);
    expect(result.totalDeposited).toBe("3000");
    expect(result.totalWithdrawn).toBe("0");
  });

  it("sums totalWithdrawn across multiple withdrawals", () => {
    const events: TxEvent[] = [
      { type: "deposit", amount: "5000", timestamp: 1 },
      { type: "withdrawal", amount: "1000", timestamp: 2 },
      { type: "withdrawal", amount: "500", timestamp: 3 },
    ];
    const result = computeAnalytics(ADDR, events);
    expect(result.totalWithdrawn).toBe("1500");
  });

  it("counts all events including harvest", () => {
    const events: TxEvent[] = [
      { type: "deposit", amount: "1000", timestamp: 1 },
      { type: "harvest", amount: "50", timestamp: 2 },
      { type: "withdrawal", amount: "200", timestamp: 3 },
    ];
    const result = computeAnalytics(ADDR, events);
    expect(result.transactionCount).toBe(3);
  });

  it("sets address field", () => {
    const result = computeAnalytics(ADDR, []);
    expect(result.address).toBe(ADDR);
  });

  it("sets computedAt as ISO timestamp", () => {
    const result = computeAnalytics(ADDR, []);
    expect(new Date(result.computedAt).toISOString()).toBe(result.computedAt);
  });
});

describe("computeAnalytics — FIFO P&L", () => {
  it("zero P&L when deposit and withdrawal at same price", () => {
    const events: TxEvent[] = [
      { type: "deposit", amount: "1000", timestamp: 1, pricePerUnit: "1.0" },
      { type: "withdrawal", amount: "1000", timestamp: 2, pricePerUnit: "1.0" },
    ];
    const result = computeAnalytics(ADDR, events);
    expect(result.netPnL).toBe("0");
  });

  it("positive P&L when withdrawal price > deposit price", () => {
    const events: TxEvent[] = [
      { type: "deposit", amount: "1000", timestamp: 1, pricePerUnit: "1.0" },
      { type: "withdrawal", amount: "1000", timestamp: 2, pricePerUnit: "1.5" },
    ];
    const result = computeAnalytics(ADDR, events);
    // sale value = 1000 * 1.5 = 1500, cost = 1000 * 1.0 = 1000, pnl = 500
    expect(BigInt(result.netPnL)).toBeGreaterThan(0n);
  });

  it("negative P&L when withdrawal price < deposit price", () => {
    const events: TxEvent[] = [
      { type: "deposit", amount: "1000", timestamp: 1, pricePerUnit: "2.0" },
      { type: "withdrawal", amount: "1000", timestamp: 2, pricePerUnit: "1.0" },
    ];
    const result = computeAnalytics(ADDR, events);
    expect(BigInt(result.netPnL)).toBeLessThan(0n);
  });

  it("FIFO: first lot consumed before second lot", () => {
    const events: TxEvent[] = [
      { type: "deposit", amount: "500", timestamp: 1, pricePerUnit: "1.0" }, // lot A
      { type: "deposit", amount: "500", timestamp: 2, pricePerUnit: "2.0" }, // lot B
      { type: "withdrawal", amount: "500", timestamp: 3, pricePerUnit: "3.0" }, // should consume lot A
    ];
    const result = computeAnalytics(ADDR, events);
    // Lot A consumed: proceeds=1500, cost=500 => pnl=1000
    expect(BigInt(result.netPnL)).toBe(1000n);
  });

  it("partial lot consumption", () => {
    const events: TxEvent[] = [
      { type: "deposit", amount: "1000", timestamp: 1, pricePerUnit: "1.0" },
      { type: "withdrawal", amount: "400", timestamp: 2, pricePerUnit: "2.0" },
    ];
    const result = computeAnalytics(ADDR, events);
    // 400 units withdrawn at 2.0, cost was 400 * 1.0 = 400, sale = 800, pnl = 400
    expect(BigInt(result.netPnL)).toBe(400n);
  });

  it("average entry price for remaining lots", () => {
    const events: TxEvent[] = [
      { type: "deposit", amount: "1000", timestamp: 1, pricePerUnit: "2.0" },
    ];
    const result = computeAnalytics(ADDR, events);
    // All units remain, avg entry = 2.0
    expect(result.averageEntryPrice).toBe("2.000000");
  });

  it("average entry price is zero when all shares withdrawn", () => {
    const events: TxEvent[] = [
      { type: "deposit", amount: "1000", timestamp: 1, pricePerUnit: "1.0" },
      { type: "withdrawal", amount: "1000", timestamp: 2, pricePerUnit: "1.0" },
    ];
    const result = computeAnalytics(ADDR, events);
    expect(result.averageEntryPrice).toBe("0.000000");
  });

  it("sorts events by timestamp before processing", () => {
    // Provide events out of order
    const events: TxEvent[] = [
      { type: "withdrawal", amount: "500", timestamp: 3, pricePerUnit: "1.0" },
      { type: "deposit", amount: "500", timestamp: 1, pricePerUnit: "1.0" },
      { type: "deposit", amount: "500", timestamp: 2, pricePerUnit: "1.0" },
    ];
    // Should not throw (withdrawal should see deposit lots)
    expect(() => computeAnalytics(ADDR, events)).not.toThrow();
  });

  it("handles large number of transactions efficiently", () => {
    const events: TxEvent[] = [];
    for (let i = 0; i < 5000; i++) {
      events.push({ type: "deposit", amount: "100", timestamp: i });
    }
    for (let i = 5000; i < 8000; i++) {
      events.push({ type: "withdrawal", amount: "100", timestamp: i });
    }
    const start = Date.now();
    const result = computeAnalytics(ADDR, events);
    const elapsed = Date.now() - start;
    expect(result.transactionCount).toBe(8000);
    expect(elapsed).toBeLessThan(1000); // should complete in under 1 second
  });
});
