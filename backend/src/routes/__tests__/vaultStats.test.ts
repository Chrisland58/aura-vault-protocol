/**
 * Vault Stats API — Cache behaviour tests — Issue #466
 *
 * Tests the GET /api/v1/vault/stats endpoint for:
 *   ✓ cold start  → cache miss  → fetches live data
 *   ✓ second request within TTL → cache hit
 *   ✓ harvest event  → cache invalidated → fresh data on next request
 *   ✓ Redis unavailable → falls back to direct contract call
 *   ✓ response time < 50 ms on cache hit
 *   ✓ data freshness field (cache_age_secs / cached) reflects cache work
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import express from "express";
import request from "supertest";

// ---------------------------------------------------------------------------
// Module mocks — must be hoisted before any import that touches the modules
// ---------------------------------------------------------------------------

// In-memory store that mimics the Redis-backed cache module
const _cacheStore = new Map<string, unknown>();

vi.mock("../../cache.js", () => ({
  cacheGet: vi.fn(async (ns: string, key: string) => {
    return _cacheStore.get(`${ns}:${key}`) ?? null;
  }),
  cacheSet: vi.fn(async (ns: string, key: string, value: unknown) => {
    _cacheStore.set(`${ns}:${key}`, value);
  }),
  cacheDel: vi.fn(async (ns: string, key: string) => {
    _cacheStore.delete(`${ns}:${key}`);
  }),
  NS: {},
}));

// Mock vault stats service — returns controlled data
const mockLiveStats = {
  total_assets: 5_000_000,
  total_shares: 4_800_000,
  apy: 0.082,
  last_harvest: "2026-07-26T10:00:00.000Z",
};

vi.mock("../../services/vaultStatsService.js", () => ({
  getVaultStats: vi.fn(async () => ({ ...mockLiveStats })),
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------
import {
  vaultRouter,
  VAULT_STATS_CACHE_NS,
  VAULT_STATS_CACHE_KEY,
  type VaultStatsCacheEntry,
} from "../vaultRoutes.js";
import { cacheGet, cacheSet, cacheDel } from "../../cache.js";
import { getVaultStats } from "../../services/vaultStatsService.js";

// ---------------------------------------------------------------------------
// Test app
// ---------------------------------------------------------------------------

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/vault", vaultRouter);
  return app;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function writeCacheEntry(data: typeof mockLiveStats, cachedAtMs = Date.now()) {
  const entry: VaultStatsCacheEntry = { data, cached_at: cachedAtMs };
  _cacheStore.set(`${VAULT_STATS_CACHE_NS}:${VAULT_STATS_CACHE_KEY}`, entry);
}

function clearCache() {
  _cacheStore.clear();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/v1/vault/stats — cache behaviour", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    app = buildApp();
    clearCache();
    vi.clearAllMocks();
    // Re-apply mock implementations after clearAllMocks
    vi.mocked(cacheGet).mockImplementation(async (ns: string, key: string) =>
      _cacheStore.get(`${ns}:${key}`) ?? null,
    );
    vi.mocked(cacheSet).mockImplementation(async (ns: string, key: string, value: unknown) => {
      _cacheStore.set(`${ns}:${key}`, value);
    });
    vi.mocked(cacheDel).mockImplementation(async (ns: string, key: string) => {
      _cacheStore.delete(`${ns}:${key}`);
    });
    vi.mocked(getVaultStats).mockResolvedValue({ ...mockLiveStats });
  });

  afterEach(() => {
    clearCache();
  });

  // -------------------------------------------------------------------------
  // cold start → cache miss → fetches live data
  // -------------------------------------------------------------------------

  it("cold start: cache miss → fetches live data and returns cached=false", async () => {
    const res = await request(app).get("/api/v1/vault/stats");

    expect(res.status).toBe(200);
    expect(res.body.cached).toBe(false);
    expect(res.body.cache_age_secs).toBeNull();
    expect(res.body.total_assets).toBe(mockLiveStats.total_assets);
    expect(res.body.total_shares).toBe(mockLiveStats.total_shares);
    expect(res.body.apy).toBe(mockLiveStats.apy);
    expect(res.body.last_harvest).toBe(mockLiveStats.last_harvest);
    expect(res.body.fetched_at).toBeTruthy();

    // Live service was called exactly once
    expect(getVaultStats).toHaveBeenCalledTimes(1);

    // Cache was populated
    expect(cacheSet).toHaveBeenCalledTimes(1);
    const cacheKey = `${VAULT_STATS_CACHE_NS}:${VAULT_STATS_CACHE_KEY}`;
    expect(_cacheStore.has(cacheKey)).toBe(true);
  });

  it("cold start: response contains fetched_at ISO-8601 timestamp", async () => {
    const res = await request(app).get("/api/v1/vault/stats");
    expect(res.status).toBe(200);
    const ts = new Date(res.body.fetched_at);
    expect(ts.getTime()).not.toBeNaN();
  });

  // -------------------------------------------------------------------------
  // second request within TTL → cache hit
  // -------------------------------------------------------------------------

  it("second request within TTL: serves cache hit and cached=true", async () => {
    // First request — cold
    await request(app).get("/api/v1/vault/stats");
    vi.clearAllMocks();
    // Re-wire mocks after clear
    vi.mocked(cacheGet).mockImplementation(async (ns: string, key: string) =>
      _cacheStore.get(`${ns}:${key}`) ?? null,
    );
    vi.mocked(getVaultStats).mockResolvedValue({ ...mockLiveStats });

    // Second request — should hit cache
    const res = await request(app).get("/api/v1/vault/stats");

    expect(res.status).toBe(200);
    expect(res.body.cached).toBe(true);
    expect(typeof res.body.cache_age_secs).toBe("number");
    expect(res.body.cache_age_secs).toBeGreaterThanOrEqual(0);

    // Live service NOT called on cache hit
    expect(getVaultStats).not.toHaveBeenCalled();
  });

  it("cache hit: data fields match the original live response", async () => {
    await request(app).get("/api/v1/vault/stats"); // seed cache
    const res = await request(app).get("/api/v1/vault/stats"); // cache hit

    expect(res.body.total_assets).toBe(mockLiveStats.total_assets);
    expect(res.body.total_shares).toBe(mockLiveStats.total_shares);
    expect(res.body.apy).toBe(mockLiveStats.apy);
    expect(res.body.last_harvest).toBe(mockLiveStats.last_harvest);
  });

  // -------------------------------------------------------------------------
  // cache_age_secs increases over time
  // -------------------------------------------------------------------------

  it("cache_age_secs reflects how old the cache entry is", async () => {
    // Pre-populate cache with a 30-second-old entry
    const thirtySecsAgo = Date.now() - 30_000;
    writeCacheEntry(mockLiveStats, thirtySecsAgo);

    const res = await request(app).get("/api/v1/vault/stats");

    expect(res.status).toBe(200);
    expect(res.body.cached).toBe(true);
    // Allow ±2 seconds of tolerance for test execution time
    expect(res.body.cache_age_secs).toBeGreaterThanOrEqual(28);
    expect(res.body.cache_age_secs).toBeLessThanOrEqual(32);
  });

  // -------------------------------------------------------------------------
  // harvest event → cache invalidated → fresh data on next request
  // -------------------------------------------------------------------------

  it("harvest event: POST /stats/invalidate purges the cache", async () => {
    // Seed cache
    await request(app).get("/api/v1/vault/stats");
    expect(_cacheStore.size).toBeGreaterThan(0);

    // Simulate harvest event by calling the invalidate endpoint
    const invalidateRes = await request(app).post("/api/v1/vault/stats/invalidate");
    expect(invalidateRes.status).toBe(200);
    expect(invalidateRes.body.invalidated).toBe(true);
    expect(cacheDel).toHaveBeenCalledWith(VAULT_STATS_CACHE_NS, VAULT_STATS_CACHE_KEY);

    // Cache should be empty
    expect(_cacheStore.size).toBe(0);
  });

  it("harvest event: next request after invalidation fetches fresh live data", async () => {
    // Populate cache with stale data
    writeCacheEntry({ ...mockLiveStats, total_assets: 1_000_000 });

    // Invalidate simulating a harvest
    await request(app).post("/api/v1/vault/stats/invalidate");

    // Updated live data (post-harvest)
    const updatedStats = { ...mockLiveStats, total_assets: 6_000_000 };
    vi.mocked(getVaultStats).mockResolvedValue(updatedStats);

    const res = await request(app).get("/api/v1/vault/stats");

    expect(res.status).toBe(200);
    expect(res.body.cached).toBe(false);
    expect(res.body.total_assets).toBe(6_000_000); // fresh data
    expect(getVaultStats).toHaveBeenCalledTimes(1);
  });

  it("harvest event: back-to-back invalidations are idempotent", async () => {
    await request(app).get("/api/v1/vault/stats"); // seed cache

    const r1 = await request(app).post("/api/v1/vault/stats/invalidate");
    const r2 = await request(app).post("/api/v1/vault/stats/invalidate");

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r1.body.invalidated).toBe(true);
    expect(r2.body.invalidated).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Redis unavailable → falls back to direct contract call
  // -------------------------------------------------------------------------

  it("Redis unavailable on read: falls back to live data (cached=false)", async () => {
    // cacheGet throws (Redis down)
    vi.mocked(cacheGet).mockRejectedValueOnce(new Error("ECONNREFUSED"));
    // cacheSet also throws
    vi.mocked(cacheSet).mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const res = await request(app).get("/api/v1/vault/stats");

    expect(res.status).toBe(200);
    expect(res.body.cached).toBe(false);
    expect(res.body.total_assets).toBe(mockLiveStats.total_assets);
    expect(getVaultStats).toHaveBeenCalledTimes(1);
  });

  it("Redis unavailable on write: still returns live data successfully", async () => {
    // cacheGet returns null (miss) — Redis answers for get but not set
    vi.mocked(cacheGet).mockResolvedValueOnce(null);
    vi.mocked(cacheSet).mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const res = await request(app).get("/api/v1/vault/stats");

    expect(res.status).toBe(200);
    expect(res.body.total_assets).toBe(mockLiveStats.total_assets);
    expect(res.body.cached).toBe(false);
  });

  it("Redis unavailable on invalidate: returns 500", async () => {
    vi.mocked(cacheDel).mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const res = await request(app).post("/api/v1/vault/stats/invalidate");

    expect(res.status).toBe(500);
    expect(res.body.error).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // response time < 50 ms on cache hit
  // -------------------------------------------------------------------------

  it("cache hit: response time is under 50 ms", async () => {
    // Seed the cache
    writeCacheEntry(mockLiveStats);

    const start = Date.now();
    const res = await request(app).get("/api/v1/vault/stats");
    const elapsed = Date.now() - start;

    expect(res.status).toBe(200);
    expect(res.body.cached).toBe(true);
    expect(elapsed).toBeLessThan(50);
  });

  // -------------------------------------------------------------------------
  // data freshness field shows cache age
  // -------------------------------------------------------------------------

  it("freshness: cache_age_secs is 0 (or near 0) for a brand-new cache entry", async () => {
    // Seed cache as if written right now
    writeCacheEntry(mockLiveStats, Date.now());

    const res = await request(app).get("/api/v1/vault/stats");

    expect(res.status).toBe(200);
    expect(res.body.cached).toBe(true);
    // Should be 0 since the entry was just created
    expect(res.body.cache_age_secs).toBeLessThanOrEqual(1);
  });

  it("freshness: cache_age_secs is null on a cache miss", async () => {
    const res = await request(app).get("/api/v1/vault/stats");

    expect(res.status).toBe(200);
    expect(res.body.cached).toBe(false);
    expect(res.body.cache_age_secs).toBeNull();
  });

  it("freshness: fetched_at is always present regardless of cache status", async () => {
    // Cache miss
    const res1 = await request(app).get("/api/v1/vault/stats");
    expect(res1.body.fetched_at).toBeTruthy();

    // Cache hit
    const res2 = await request(app).get("/api/v1/vault/stats");
    expect(res2.body.fetched_at).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // upstream service failure
  // -------------------------------------------------------------------------

  it("live service failure: returns 500 on cache miss + upstream error", async () => {
    vi.mocked(getVaultStats).mockRejectedValueOnce(new Error("RPC timeout"));

    const res = await request(app).get("/api/v1/vault/stats");

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/vault stats/i);
  });
});
