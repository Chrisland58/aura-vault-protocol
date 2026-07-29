/**
 * Tests for feeBumpService — Issue #323
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createFeeBump,
  getSponsorshipStats,
  getAdminSponsorshipReport,
  DEFAULT_FEE_CONFIG,
  FEE_CAP_BY_TYPE,
  type FeeBumpConfig,
  type FeeBumpBuilder,
} from "./feeBumpService.js";

// ---------------------------------------------------------------------------
// Mock Redis
// ---------------------------------------------------------------------------

const store = new Map<string, string>();

vi.mock("../redis.js", () => ({
  getRedis: () => ({
    get: async (key: string) => store.get(key) ?? null,
    incr: async (key: string) => {
      const v = parseInt(store.get(key) ?? "0", 10) + 1;
      store.set(key, String(v));
      return v;
    },
    expire: async () => 1,
    set: async (key: string, value: string) => { store.set(key, value); return "OK"; },
    del: async (key: string) => { store.delete(key); return 1; },
  }),
}));

const ADDR = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const INNER_XDR = "AAAA...signed_inner_xdr";

const mockBuilder: FeeBumpBuilder = vi.fn().mockResolvedValue("BBBB...fee_bump_xdr");

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  // Provide a public key for the fee account
  process.env.FEE_ACCOUNT_PUBLIC_KEY = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
});

// ---------------------------------------------------------------------------
// getSponsorshipStats
// ---------------------------------------------------------------------------

describe("getSponsorshipStats", () => {
  it("returns 0 count for a new address", async () => {
    const stats = await getSponsorshipStats(ADDR);
    expect(stats.sponsoredCount).toBe(0);
    expect(stats.remainingSponsored).toBe(DEFAULT_FEE_CONFIG.maxSponsoredPerAddress);
    expect(stats.eligible).toBe(true);
  });

  it("reflects incremented count", async () => {
    // Simulate 2 previous sponsored txs
    store.set(`feebump:count:${ADDR}`, "2");
    const stats = await getSponsorshipStats(ADDR);
    expect(stats.sponsoredCount).toBe(2);
    expect(stats.remainingSponsored).toBe(1);
    expect(stats.eligible).toBe(true);
  });

  it("marks address ineligible at limit", async () => {
    store.set(`feebump:count:${ADDR}`, String(DEFAULT_FEE_CONFIG.maxSponsoredPerAddress));
    const stats = await getSponsorshipStats(ADDR);
    expect(stats.eligible).toBe(false);
    expect(stats.remainingSponsored).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// createFeeBump — happy path
// ---------------------------------------------------------------------------

describe("createFeeBump — success", () => {
  it("returns fee-bump XDR and increments count", async () => {
    const result = await createFeeBump(
      { innerXdr: INNER_XDR, userAddress: ADDR, txType: "deposit" },
      mockBuilder
    );
    expect(result.feeBumpXdr).toBe("BBBB...fee_bump_xdr");
    expect(result.feeSource).toBe(process.env.FEE_ACCOUNT_PUBLIC_KEY);
    expect(result.feeStroops).toBe(FEE_CAP_BY_TYPE.deposit);
    expect(result.sponsoredCount).toBe(1);
  });

  it("calls builder with correct params", async () => {
    await createFeeBump(
      { innerXdr: INNER_XDR, userAddress: ADDR, txType: "deposit" },
      mockBuilder
    );
    expect(mockBuilder).toHaveBeenCalledWith({
      feeSource: process.env.FEE_ACCOUNT_PUBLIC_KEY,
      innerXdr: INNER_XDR,
      maxFeeStroops: FEE_CAP_BY_TYPE.deposit,
    });
  });

  it("allows up to maxSponsoredPerAddress transactions", async () => {
    const max = DEFAULT_FEE_CONFIG.maxSponsoredPerAddress;
    for (let i = 0; i < max; i++) {
      await createFeeBump(
        { innerXdr: INNER_XDR, userAddress: ADDR, txType: "deposit" },
        mockBuilder
      );
    }
    const stats = await getSponsorshipStats(ADDR);
    expect(stats.eligible).toBe(false);
  });

  it("uses per-type fee cap", async () => {
    const result = await createFeeBump(
      { innerXdr: INNER_XDR, userAddress: ADDR, txType: "claim" },
      mockBuilder
    );
    expect(result.feeStroops).toBe(FEE_CAP_BY_TYPE.claim);
  });
});

// ---------------------------------------------------------------------------
// createFeeBump — error cases
// ---------------------------------------------------------------------------

describe("createFeeBump — errors", () => {
  it("throws when address exceeds sponsorship limit", async () => {
    store.set(`feebump:count:${ADDR}`, String(DEFAULT_FEE_CONFIG.maxSponsoredPerAddress));
    await expect(
      createFeeBump({ innerXdr: INNER_XDR, userAddress: ADDR, txType: "deposit" }, mockBuilder)
    ).rejects.toThrow(/exceeded the fee sponsorship limit/);
  });

  it("throws when txType is not eligible", async () => {
    const restrictedConfig: FeeBumpConfig = {
      ...DEFAULT_FEE_CONFIG,
      eligibleTypes: new Set(["deposit"]),
    };
    await expect(
      createFeeBump(
        { innerXdr: INNER_XDR, userAddress: ADDR, txType: "withdrawal" },
        mockBuilder,
        restrictedConfig
      )
    ).rejects.toThrow(/not eligible for fee sponsorship/);
  });

  it("throws when FEE_ACCOUNT_PUBLIC_KEY is not set", async () => {
    delete process.env.FEE_ACCOUNT_PUBLIC_KEY;
    await expect(
      createFeeBump({ innerXdr: INNER_XDR, userAddress: ADDR, txType: "deposit" }, mockBuilder)
    ).rejects.toThrow(/FEE_ACCOUNT_PUBLIC_KEY/);
  });

  it("respects custom maxSponsoredPerAddress", async () => {
    const customConfig: FeeBumpConfig = {
      ...DEFAULT_FEE_CONFIG,
      maxSponsoredPerAddress: 1,
    };
    // First tx succeeds
    await createFeeBump(
      { innerXdr: INNER_XDR, userAddress: ADDR, txType: "deposit" },
      mockBuilder,
      customConfig
    );
    // Second tx fails
    await expect(
      createFeeBump(
        { innerXdr: INNER_XDR, userAddress: ADDR, txType: "deposit" },
        mockBuilder,
        customConfig
      )
    ).rejects.toThrow(/exceeded/);
  });
});

// ---------------------------------------------------------------------------
// getAdminSponsorshipReport
// ---------------------------------------------------------------------------

describe("getAdminSponsorshipReport", () => {
  it("returns zero counts for addresses with no history", async () => {
    const report = await getAdminSponsorshipReport([ADDR]);
    expect(report.totalSponsored).toBe(0);
    expect(report.byAddress[ADDR]).toBe(0);
  });

  it("aggregates counts across multiple addresses", async () => {
    const addr2 = "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";
    store.set(`feebump:count:${ADDR}`, "2");
    store.set(`feebump:count:${addr2}`, "1");
    const report = await getAdminSponsorshipReport([ADDR, addr2]);
    expect(report.totalSponsored).toBe(3);
    expect(report.byAddress[ADDR]).toBe(2);
    expect(report.byAddress[addr2]).toBe(1);
  });

  it("returns empty report for empty address list", async () => {
    const report = await getAdminSponsorshipReport([]);
    expect(report.totalSponsored).toBe(0);
    expect(report.byAddress).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Fee cap constraints
// ---------------------------------------------------------------------------

describe("fee cap", () => {
  it("clamps fee to config.maxFeeStroops even if per-type cap is higher", async () => {
    const tightConfig: FeeBumpConfig = {
      ...DEFAULT_FEE_CONFIG,
      maxFeeStroops: 10_000, // tighter than per-type defaults
    };
    const result = await createFeeBump(
      { innerXdr: INNER_XDR, userAddress: ADDR, txType: "deposit" },
      mockBuilder,
      tightConfig
    );
    expect(result.feeStroops).toBe(10_000);
  });
});
