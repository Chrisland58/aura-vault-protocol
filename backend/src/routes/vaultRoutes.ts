/**
 * Vault Stats Route — Issue #466
 *
 * GET /api/v1/vault/stats
 *
 * Returns vault statistics with Redis caching. Cache misses fetch live data,
 * cache hits serve instantly (< 50 ms). Harvest events invalidate the cache.
 * Redis unavailability falls back gracefully to a direct contract call.
 *
 * ---
 *
 * Deposit Simulation Route — Issue #317
 *
 * POST /api/v1/vault/simulate/deposit
 *
 * Read-only endpoint that computes expected shares, share price, and price
 * impact for a prospective deposit without executing any on-chain transaction.
 * Response is cached per (totalAssets, totalShares) vault state so that
 * repeated previews with the same state are served instantly.
 */

import { Router, Request, Response } from "express";
import { cacheGet, cacheSet, cacheDel } from "../cache.js";
import { getVaultStats, VaultStatsData, simulateDeposit } from "../services/vaultStatsService.js";
import { validate, depositSimulateSchema } from "../validation.js";

export const VAULT_STATS_CACHE_NS = "vault:stats";
export const VAULT_STATS_CACHE_KEY = "current";
export const VAULT_STATS_TTL_SECS = 60; // 1-minute TTL

// Deposit simulation cache constants
export const VAULT_SIMULATE_CACHE_NS = "vault:simulate";
export const VAULT_SIMULATE_TTL_SECS = 60; // 1-minute TTL

export interface VaultStatsCacheEntry {
  data: VaultStatsData;
  cached_at: number; // Unix epoch ms
}

export interface VaultStatsResponse extends VaultStatsData {
  cached: boolean;
  cache_age_secs: number | null;
  fetched_at: string;
}

export const vaultRouter = Router();

/**
 * GET /api/v1/vault/stats
 * Serves vault stats from cache when available, otherwise fetches live data.
 */
vaultRouter.get("/stats", async (_req: Request, res: Response): Promise<void> => {
  const fetchedAt = new Date().toISOString();

  // --- Try cache first ---
  let cacheEntry: VaultStatsCacheEntry | null = null;
  try {
    cacheEntry = await cacheGet<VaultStatsCacheEntry>(
      VAULT_STATS_CACHE_NS,
      VAULT_STATS_CACHE_KEY,
    );
  } catch {
    // Redis unavailable — fall through to live fetch
  }

  if (cacheEntry !== null) {
    const ageMs = Date.now() - cacheEntry.cached_at;
    const response: VaultStatsResponse = {
      ...cacheEntry.data,
      cached: true,
      cache_age_secs: Math.floor(ageMs / 1000),
      fetched_at: fetchedAt,
    };
    res.json(response);
    return;
  }

  // --- Cache miss: fetch live data ---
  try {
    const liveData = await getVaultStats();
    const entry: VaultStatsCacheEntry = { data: liveData, cached_at: Date.now() };

    // Populate cache (best-effort — ignore Redis errors)
    try {
      await cacheSet(VAULT_STATS_CACHE_NS, VAULT_STATS_CACHE_KEY, entry, VAULT_STATS_TTL_SECS);
    } catch {
      // Redis unavailable — serve without caching
    }

    const response: VaultStatsResponse = {
      ...liveData,
      cached: false,
      cache_age_secs: null,
      fetched_at: fetchedAt,
    };
    res.json(response);
  } catch (err) {
    console.error("[vault/stats]", err);
    res.status(500).json({ error: "Failed to retrieve vault stats" });
  }
});

/**
 * POST /api/v1/vault/stats/invalidate
 * Purges the vault-stats cache. Called when a harvest event is received.
 */
vaultRouter.post("/stats/invalidate", async (_req: Request, res: Response): Promise<void> => {
  try {
    await cacheDel(VAULT_STATS_CACHE_NS, VAULT_STATS_CACHE_KEY);
    res.json({ invalidated: true });
  } catch (err) {
    console.error("[vault/stats/invalidate]", err);
    res.status(500).json({ error: "Cache invalidation failed" });
  }
});

/** Programmatic cache invalidation — used by harvest event handlers. */
export async function invalidateVaultStatsCache(): Promise<void> {
  await cacheDel(VAULT_STATS_CACHE_NS, VAULT_STATS_CACHE_KEY);
}

/**
 * POST /api/v1/vault/simulate/deposit
 *
 * Returns the expected shares, share price, and price impact for a deposit
 * of `amount` underlying tokens without executing any on-chain transaction.
 *
 * The response is cached per (totalAssets, totalShares) vault state so that
 * multiple previews at the same state cost only one vault-stats lookup.
 *
 * Request body:  { amount: number }    — positive integer
 * Response:      { expectedShares, sharePrice, priceImpact }
 */
vaultRouter.post(
  "/simulate/deposit",
  validate(depositSimulateSchema),
  async (req: Request, res: Response): Promise<void> => {
    const { amount } = req.body as { amount: number };

    // 1. Resolve current vault state (cached via vault:stats if available)
    let totalAssets: number;
    let totalShares: number;

    try {
      // Re-use the existing stats cache to avoid a redundant on-chain read
      let statsEntry = await cacheGet<VaultStatsCacheEntry>(
        VAULT_STATS_CACHE_NS,
        VAULT_STATS_CACHE_KEY,
      ).catch(() => null);

      if (statsEntry === null) {
        const liveData = await getVaultStats();
        statsEntry = { data: liveData, cached_at: Date.now() };
        // Populate stats cache best-effort
        cacheSet(VAULT_STATS_CACHE_NS, VAULT_STATS_CACHE_KEY, statsEntry, VAULT_STATS_TTL_SECS).catch(
          () => undefined,
        );
      }

      totalAssets = statsEntry.data.total_assets;
      totalShares = statsEntry.data.total_shares;
    } catch (err) {
      console.error("[vault/simulate/deposit] failed to fetch vault state:", err);
      res.status(500).json({ error: "Failed to retrieve vault state for simulation" });
      return;
    }

    // 2. Build a cache key that encodes the vault state + requested amount
    //    so different amounts and different vault states each get their own entry.
    const simulateCacheKey = `${totalAssets}:${totalShares}:${amount}`;

    // 3. Check simulation cache
    try {
      const cached = await cacheGet<SimulateDepositCacheEntry>(
        VAULT_SIMULATE_CACHE_NS,
        simulateCacheKey,
      );
      if (cached !== null) {
        res.json(cached.result);
        return;
      }
    } catch {
      // Redis unavailable — fall through to compute
    }

    // 4. Compute the simulation
    const result = simulateDeposit(amount, totalAssets, totalShares);

    // 5. Populate simulation cache best-effort
    const entry: SimulateDepositCacheEntry = { result, cached_at: Date.now() };
    cacheSet(VAULT_SIMULATE_CACHE_NS, simulateCacheKey, entry, VAULT_SIMULATE_TTL_SECS).catch(
      () => undefined,
    );

    res.json(result);
  },
);

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface SimulateDepositCacheEntry {
  result: {
    expectedShares: number;
    sharePrice: number;
    priceImpact: number;
  };
  cached_at: number; // Unix epoch ms
}
