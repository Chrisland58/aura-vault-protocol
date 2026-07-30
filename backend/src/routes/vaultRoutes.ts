/**
 * Vault Stats Route — Issue #466
 *
 * GET /api/v1/vault/stats
 *
 * Returns vault statistics with Redis caching. Cache misses fetch live data,
 * cache hits serve instantly (< 50 ms). Harvest events invalidate the cache.
 * Redis unavailability falls back gracefully to a direct contract call.
 */

import { Router, Request, Response } from "express";
import { cacheGet, cacheSet, cacheDel } from "../cache.js";
import { getVaultStats, VaultStatsData } from "../services/vaultStatsService.js";

export const VAULT_STATS_CACHE_NS = "vault:stats";
export const VAULT_STATS_CACHE_KEY = "current";
export const VAULT_STATS_TTL_SECS = 60; // 1-minute TTL

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
