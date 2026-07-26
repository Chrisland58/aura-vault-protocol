/**
 * Portfolio Analytics Routes — Issue #320
 *
 * GET /api/portfolio/:address/analytics
 *   Returns pre-computed analytics for a Stellar wallet address.
 *   Computes on first request, caches in Redis for 5 minutes.
 *   Invalidated on harvest events.
 */

import express, { Request, Response } from "express";
import { getPortfolioAnalytics, type TxEvent } from "../services/analyticsService.js";

const router = express.Router();

// ---------------------------------------------------------------------------
// Stub event loader — replace with real DB / Horizon query in production
// ---------------------------------------------------------------------------

async function loadEventsForAddress(address: string): Promise<TxEvent[]> {
  // In production: query postgres for all deposit/withdrawal/harvest events
  // tied to this address, ordered by timestamp ascending.
  //
  // Example SQL:
  //   SELECT type, amount, timestamp, price_per_unit
  //   FROM vault_transactions
  //   WHERE wallet_address = $1
  //   ORDER BY timestamp ASC
  //
  // For now we return an empty set so the route is exercisable without a DB.
  void address;
  return [];
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /api/portfolio/:address/analytics
 *
 * Response:
 *   200 { address, totalDeposited, totalWithdrawn, netPnL, averageEntryPrice,
 *          computedAt, transactionCount }
 *   400 { error: "Invalid address" }
 *   500 { error: "Internal server error" }
 */
router.get("/:address/analytics", async (req: Request, res: Response) => {
  const { address } = req.params;

  // Basic Stellar address validation (G… public keys are 56 chars)
  if (!address || !/^[A-Z2-7]{56}$/.test(address)) {
    res.status(400).json({ error: "Invalid Stellar address format" });
    return;
  }

  try {
    const analytics = await getPortfolioAnalytics(address, loadEventsForAddress);
    res.json(analytics);
  } catch (err) {
    console.error("[analyticsRoute] error computing analytics:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export { router as analyticsRouter };
