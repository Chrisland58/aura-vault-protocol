/**
 * APY History Routes  (Issue #529)
 *
 * GET /api/vault/apy/history?period=7d[&vaultId=...]
 *
 * Returns APY data points over time for chart display on the frontend.
 * Response is cached in Redis with a 5-minute TTL.
 */

import { Router, Request, Response } from "express";
import { getApyHistory, isValidPeriod } from "../services/apyHistoryService.js";

export const apyRouter = Router();

// Default vault ID — in a multi-vault deployment this comes from the request
const DEFAULT_VAULT_ID =
  process.env.DEFAULT_VAULT_ID ?? "00000000-0000-0000-0000-000000000001";

/**
 * GET /api/vault/apy/history
 *
 * Query params:
 *   period   — "7d" | "30d" | "90d" | "1y"  (default "30d")
 *   vaultId  — vault UUID (optional, defaults to env DEFAULT_VAULT_ID)
 *
 * Response schema:
 *   {
 *     vaultId:    string,
 *     period:     "7d" | "30d" | "90d" | "1y",
 *     resolution: "hourly" | "daily",
 *     dataPoints: [{ timestamp: string, apy7d: number, apy30d: number }]
 *   }
 *
 * Empty `dataPoints` array (not an error) is returned for periods with no data.
 */
apyRouter.get("/history", async (req: Request, res: Response): Promise<void> => {
  const rawPeriod = req.query.period ?? "30d";
  const vaultId = String(req.query.vaultId ?? DEFAULT_VAULT_ID).trim();

  if (!isValidPeriod(rawPeriod)) {
    res.status(400).json({
      error: `Invalid period. Allowed values: 7d, 30d, 90d, 1y`,
    });
    return;
  }

  if (!vaultId) {
    res.status(400).json({ error: "vaultId is required." });
    return;
  }

  try {
    const history = await getApyHistory(vaultId, rawPeriod);

    // Inform clients of the cache lifetime
    res.set("Cache-Control", "public, max-age=300"); // 5 minutes
    res.json(history);
  } catch (err) {
    console.error("[APY] GET /history error:", err);
    res.status(500).json({ error: "Failed to retrieve APY history." });
  }
});
