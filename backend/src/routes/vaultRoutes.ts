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
import { getDbMetrics, getSlowQueryLog, dbMetricsPrometheusText } from "../services/dbMonitor.js";
import { successResponse, errorResponse } from "../dto/index.js";

export const VAULT_STATS_CACHE_NS = "vault:stats";
export const VAULT_STATS_CACHE_KEY = "current";
export const VAULT_STATS_TTL_SECS = 60;

export interface VaultStatsCacheEntry {
  data: VaultStatsData;
  cached_at: number;
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
    const payload: VaultStatsResponse = {
      ...cacheEntry.data,
      cached: true,
      cache_age_secs: Math.floor(ageMs / 1000),
      fetched_at: fetchedAt,
    };
    res.json(successResponse(payload));
    return;
  }

  try {
    const liveData = await getVaultStats();
    const entry: VaultStatsCacheEntry = { data: liveData, cached_at: Date.now() };

    try {
      await cacheSet(VAULT_STATS_CACHE_NS, VAULT_STATS_CACHE_KEY, entry, VAULT_STATS_TTL_SECS);
    } catch {
      // Redis unavailable — serve without caching
    }

    const payload: VaultStatsResponse = {
      ...liveData,
      cached: false,
      cache_age_secs: null,
      fetched_at: fetchedAt,
    };
    res.json(successResponse(payload));
  } catch (err) {
    console.error("[vault/stats]", err);
    res.status(500).json(errorResponse("INTERNAL_ERROR", "Failed to retrieve vault stats"));
  }
});

/**
 * POST /api/v1/vault/stats/invalidate
 * Purges the vault-stats cache.
 */
vaultRouter.post("/stats/invalidate", async (_req: Request, res: Response): Promise<void> => {
  try {
    await cacheDel(VAULT_STATS_CACHE_NS, VAULT_STATS_CACHE_KEY);
    res.json(successResponse({ invalidated: true }));
  } catch (err) {
    console.error("[vault/stats/invalidate]", err);
    res.status(500).json(errorResponse("INTERNAL_ERROR", "Cache invalidation failed"));
  }
});

/** Programmatic cache invalidation — used by harvest event handlers. */
export async function invalidateVaultStatsCache(): Promise<void> {
  await cacheDel(VAULT_STATS_CACHE_NS, VAULT_STATS_CACHE_KEY);
}

// Issue #324 — DB Query Performance Monitoring

vaultRouter.get("/metrics/db", async (_req: Request, res: Response): Promise<void> => {
  try {
    const metrics = await getDbMetrics();
    res.json(successResponse({ metrics, generated_at: new Date().toISOString() }));
  } catch (err) {
    console.error("[vault/metrics/db]", err);
    res.status(500).json(errorResponse("INTERNAL_ERROR", "Failed to retrieve DB metrics"));
  }
});

vaultRouter.get("/metrics/db/slow-log", async (_req: Request, res: Response): Promise<void> => {
  try {
    const log = await getSlowQueryLog();
    res.json(successResponse({ slow_queries: log, count: log.length, generated_at: new Date().toISOString() }));
  } catch (err) {
    console.error("[vault/metrics/db/slow-log]", err);
    res.status(500).json(errorResponse("INTERNAL_ERROR", "Failed to retrieve slow query log"));
  }
});

vaultRouter.get("/metrics/db/prometheus", async (_req: Request, res: Response): Promise<void> => {
  try {
    const text = await dbMetricsPrometheusText();
    res.set("Content-Type", "text/plain; version=0.0.4").send(text);
  } catch (err) {
    console.error("[vault/metrics/db/prometheus]", err);
    res.status(500).send("# error generating metrics\n");
  }
});

/**
 * GET /api/vault/total_assets
 * Temporary dashboard endpoint from Issue #6.
 */
vaultRouter.get(
  "/total_assets",
  (_req: Request, res: Response): void => {
    res.json({
      total: "1050",
      userBalance: "1050",
      userShares: "1000",
      pricePerShare: "1.0500",
    });
  },
);

/**
 * GET /api/vault/apy
 * Temporary dashboard APY endpoint from Issue #6.
 */
vaultRouter.get(
  "/apy",
  (_req: Request, res: Response): void => {
    res.json({
      apy: "8.5",
    });
  },
);

/**
 * GET /api/vault/balance_of
 * Temporary dashboard balance endpoint from Issue #6.
 */
vaultRouter.get(
  "/balance_of",
  (req: Request, res: Response): void => {
    const address = String(req.query.address ?? "");

    res.json({
      address,
      balance: "1050",
    });
  },
);
