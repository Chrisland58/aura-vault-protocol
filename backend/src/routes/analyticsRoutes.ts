/**
 * Analytics routes — all SELECT queries go through the read replica pool.
 *
 * Endpoints:
 *   GET /api/v1/analytics/vault-stats      – aggregate vault metrics
 *   GET /api/v1/analytics/replication-lag  – current replica lag in seconds
 */

import { Router, type Request, type Response } from "express";
import { authenticate } from "../middleware/authMiddleware.js";
import { getReadPool } from "../db.js";

export const analyticsRouter = Router();

/**
 * GET /api/v1/analytics/vault-stats
 * Returns aggregate vault statistics from the read replica.
 */
analyticsRouter.get(
  "/vault-stats",
  authenticate,
  async (_req: Request, res: Response): Promise<void> => {
    const pool = getReadPool();
    try {
      // Parameterised query — no injection risk
      const { rows } = await pool.query<{
        total_positions: string;
        total_deposited: string;
        total_yield_earned: string;
        active_users: string;
      }>(
        `SELECT
           COUNT(*)                          AS total_positions,
           COALESCE(SUM(amount), 0)          AS total_deposited,
           COALESCE(SUM(yield_earned), 0)    AS total_yield_earned,
           COUNT(DISTINCT user_id)           AS active_users
         FROM vault_positions
         WHERE deleted_at IS NULL`
      );

      const stats = rows[0];
      res.json({
        totalPositions: Number(stats.total_positions),
        totalDeposited: stats.total_deposited,
        totalYieldEarned: stats.total_yield_earned,
        activeUsers: Number(stats.active_users),
        dataSource: "read-replica",
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("[analytics/vault-stats]", err);
      res.status(500).json({ error: "Failed to retrieve vault statistics" });
    }
  }
);

/**
 * GET /api/v1/analytics/replication-lag
 * Returns the current replication lag in seconds (0 if this is the primary).
 */
analyticsRouter.get(
  "/replication-lag",
  authenticate,
  async (_req: Request, res: Response): Promise<void> => {
    const pool = getReadPool();
    try {
      const { rows } = await pool.query<{ lag_seconds: number | null }>(
        `SELECT EXTRACT(EPOCH FROM (NOW() - pg_last_xact_replay_timestamp()))::FLOAT AS lag_seconds`
      );

      const lagSeconds = rows[0]?.lag_seconds ?? 0;
      const isReplica = lagSeconds !== null && lagSeconds > 0;

      res.json({
        lagSeconds: lagSeconds ?? 0,
        isReplica,
        healthy: lagSeconds === null || lagSeconds <= 30,
        threshold: 30,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("[analytics/replication-lag]", err);
      res.status(500).json({ error: "Failed to retrieve replication lag" });
    }
  }
);
