/**
 * Leaderboard Route — Issue #322
 *
 * GET /api/vault/leaderboard?limit=100
 *   Returns the top vault depositors by share balance.
 *
 *   Response shape:
 *     { leaderboard: LeaderboardEntry[], total_eligible: number, cached: boolean,
 *       cache_age_secs: number | null, generated_at: string }
 *
 *   Privacy:
 *     - Full wallet addresses are NEVER returned; only truncated forms are exposed:
 *       first 6 chars + "…" + last 4 chars  (e.g. "GBKZM…3XYZ")
 *     - Addresses opted out via POST /api/vault/leaderboard/optout are excluded
 *
 *   Caching: Results are cached in Redis for 5 minutes.
 *
 *   Opt-out:
 *     POST /api/vault/leaderboard/optout  { "address": "<wallet>" }
 *     DELETE /api/vault/leaderboard/optout  { "address": "<wallet>" }
 */

import { Router, Request, Response } from "express";
import { cacheGet, cacheSet } from "../cache.js";
import { getReadPool, getWritePool } from "../db.js";
import { instrumentedQuery } from "../services/dbMonitor.js";

export const leaderboardRouter = Router();

// ── Constants ─────────────────────────────────────────────────────────────────

const CACHE_NS = "vault:leaderboard";
const CACHE_KEY = "current";
const CACHE_TTL_SECS = 300; // 5 minutes

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 100;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LeaderboardEntry {
  rank: number;
  address: string;       // truncated: first6 + "…" + last4
  share_balance: string; // NUMERIC as string to preserve precision
  estimated_value: string;
}

interface CachePayload {
  leaderboard: LeaderboardEntry[];
  total_eligible: number;
  cached_at: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Truncate a wallet address: first 6 + "…" + last 4 characters.
 * Example: "GBKZMTESTADDRESS123XYZ" → "GBKZMT…3XYZ"
 */
function truncateAddress(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * Validate that an address looks like a Stellar public key (56 uppercase alphanums starting with G)
 * or a generic hex address (40 hex chars starting with 0x).
 */
function isValidAddress(address: string): boolean {
  // Stellar G-address: 56 chars, base32 alphanumeric
  if (/^G[A-Z2-7]{55}$/.test(address)) return true;
  // EVM hex address (also accepted): 0x followed by 40 hex chars
  if (/^0x[0-9a-fA-F]{40}$/.test(address)) return true;
  return false;
}

// ── Route handlers ────────────────────────────────────────────────────────────

/**
 * GET /api/vault/leaderboard?limit=100
 *
 * Returns the top depositors sorted by share balance (descending).
 * Excludes addresses in leaderboard_optouts. Caches result for 5 minutes.
 */
leaderboardRouter.get("/", async (req: Request, res: Response): Promise<void> => {
  const rawLimit = parseInt(String(req.query.limit ?? DEFAULT_LIMIT), 10);
  const limit = Math.min(isNaN(rawLimit) || rawLimit < 1 ? DEFAULT_LIMIT : rawLimit, MAX_LIMIT);

  const generatedAt = new Date().toISOString();

  // ── Cache check ──────────────────────────────────────────────────────────
  let cachePayload: CachePayload | null = null;
  try {
    cachePayload = await cacheGet<CachePayload>(CACHE_NS, CACHE_KEY);
  } catch {
    // Redis unavailable — fall through to DB
  }

  if (cachePayload !== null) {
    const ageMs = Date.now() - cachePayload.cached_at;
    res.json({
      leaderboard: cachePayload.leaderboard.slice(0, limit),
      total_eligible: cachePayload.total_eligible,
      cached: true,
      cache_age_secs: Math.floor(ageMs / 1000),
      generated_at: generatedAt,
    });
    return;
  }

  // ── DB fetch ─────────────────────────────────────────────────────────────
  try {
    const pool = getReadPool();

    // Count total eligible depositors (for UI pagination / display)
    const countResult = await instrumentedQuery<{ eligible: string }>(
      pool,
      `
      SELECT COUNT(DISTINCT vp.user_id)::text AS eligible
      FROM vault_positions vp
      WHERE vp.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM leaderboard_optouts lo
          WHERE lo.wallet_address = vp.user_id::text
            AND lo.is_active = TRUE
        )
      `,
      [],
      "leaderboard_count"
    );

    const totalEligible = parseInt(countResult.rows[0]?.eligible ?? "0", 10);

    // Fetch top depositors ordered by share balance
    const rowResult = await instrumentedQuery<{
      user_id: string;
      share_balance: string;
      estimated_value: string;
    }>(
      pool,
      `
      SELECT
        vp.user_id::text                         AS user_id,
        SUM(vp.amount)::text                     AS share_balance,
        SUM(vp.amount + vp.yield_earned)::text   AS estimated_value
      FROM vault_positions vp
      WHERE vp.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM leaderboard_optouts lo
          WHERE lo.wallet_address = vp.user_id::text
            AND lo.is_active = TRUE
        )
      GROUP BY vp.user_id
      ORDER BY SUM(vp.amount) DESC
      LIMIT $1
      `,
      [MAX_LIMIT], // always fetch max for cache; trim on response
      "leaderboard_top"
    );

    const leaderboard: LeaderboardEntry[] = rowResult.rows.map((row: {
      user_id: string;
      share_balance: string;
      estimated_value: string;
    }, idx: number) => ({
      rank: idx + 1,
      address: truncateAddress(row.user_id),
      share_balance: row.share_balance,
      estimated_value: row.estimated_value,
    }));

    // Cache the full MAX_LIMIT result
    const payload: CachePayload = {
      leaderboard,
      total_eligible: totalEligible,
      cached_at: Date.now(),
    };

    try {
      await cacheSet(CACHE_NS, CACHE_KEY, payload, CACHE_TTL_SECS);
    } catch {
      // Redis unavailable — serve without caching
    }

    res.json({
      leaderboard: leaderboard.slice(0, limit),
      total_eligible: totalEligible,
      cached: false,
      cache_age_secs: null,
      generated_at: generatedAt,
    });
  } catch (err) {
    console.error("[leaderboard/GET]", err);
    res.status(500).json({ error: "Failed to retrieve leaderboard" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Opt-out endpoints
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/vault/leaderboard/optout
 * Body: { "address": "<wallet_address>" }
 *
 * Adds the address to the opt-out list. Subsequent leaderboard queries will
 * exclude this address. Idempotent — re-opting out is a no-op.
 */
leaderboardRouter.post("/optout", async (req: Request, res: Response): Promise<void> => {
  const { address } = req.body as { address?: string };

  if (!address || typeof address !== "string" || !isValidAddress(address)) {
    res.status(400).json({ error: "Invalid or missing wallet address" });
    return;
  }

  try {
    const pool = getWritePool();

    await instrumentedQuery(
      pool,
      `
      INSERT INTO leaderboard_optouts (wallet_address, opted_out_at, is_active)
      VALUES ($1, NOW(), TRUE)
      ON CONFLICT (wallet_address)
      DO UPDATE SET
        is_active    = TRUE,
        opted_out_at = NOW(),
        opted_in_at  = NULL
      `,
      [address],
      "leaderboard_optout_upsert"
    );

    // Invalidate leaderboard cache
    try {
      await cacheSet(CACHE_NS, CACHE_KEY, null, 1);
    } catch {
      // best-effort
    }

    res.json({ opted_out: true, address: truncateAddress(address) });
  } catch (err) {
    console.error("[leaderboard/optout POST]", err);
    res.status(500).json({ error: "Failed to record opt-out" });
  }
});

/**
 * DELETE /api/vault/leaderboard/optout
 * Body: { "address": "<wallet_address>" }
 *
 * Removes the address from the opt-out list so it can appear on the leaderboard again.
 */
leaderboardRouter.delete("/optout", async (req: Request, res: Response): Promise<void> => {
  const { address } = req.body as { address?: string };

  if (!address || typeof address !== "string" || !isValidAddress(address)) {
    res.status(400).json({ error: "Invalid or missing wallet address" });
    return;
  }

  try {
    const pool = getWritePool();

    await instrumentedQuery(
      pool,
      `
      UPDATE leaderboard_optouts
      SET is_active   = FALSE,
          opted_in_at = NOW()
      WHERE wallet_address = $1
        AND is_active = TRUE
      `,
      [address],
      "leaderboard_optin_update"
    );

    // Invalidate leaderboard cache
    try {
      await cacheSet(CACHE_NS, CACHE_KEY, null, 1);
    } catch {
      // best-effort
    }

    res.json({ opted_out: false, address: truncateAddress(address) });
  } catch (err) {
    console.error("[leaderboard/optout DELETE]", err);
    res.status(500).json({ error: "Failed to remove opt-out" });
  }
});
