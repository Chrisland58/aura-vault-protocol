import { Router, Request, Response } from "express";
import { createYieldService, type YieldSource, type VaultPosition } from "../services/yieldService.js";
import { getSchedulerMetrics } from "../services/yieldScheduler.js";

const yieldService = createYieldService();

export const yieldRouter = Router();

/**
 * POST /api/v1/yield/calculate
 * Body: { positions: VaultPosition[], sources: YieldSource[], calcDate?: string }
 */
yieldRouter.post("/calculate", async (req: Request, res: Response): Promise<void> => {
  const { positions, sources, calcDate } = req.body as {
    positions: VaultPosition[];
    sources: YieldSource[];
    calcDate?: string;
  };

  if (!Array.isArray(positions) || !Array.isArray(sources)) {
    res.status(400).json({ error: "positions and sources arrays are required" });
    return;
  }

  try {
    const date = calcDate ? new Date(calcDate) : new Date();
    const result = await yieldService.processBatch(positions, sources, date);
    res.json(result);
  } catch (err) {
    console.error("[yield/calculate]", err);
    res.status(500).json({ error: "Yield calculation failed" });
  }
});

/**
 * POST /api/v1/yield/backfill
 * Body: { positions: VaultPosition[], sources: YieldSource[], startDate: string, endDate: string }
 */
yieldRouter.post("/backfill", async (req: Request, res: Response): Promise<void> => {
  const { positions, sources, startDate, endDate } = req.body as {
    positions: VaultPosition[];
    sources: YieldSource[];
    startDate: string;
    endDate: string;
  };

  if (!Array.isArray(positions) || !Array.isArray(sources) || !startDate || !endDate) {
    res.status(400).json({ error: "positions, sources, startDate, and endDate are required" });
    return;
  }

  const start = new Date(startDate);
  const end = new Date(endDate);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
    res.status(400).json({ error: "Invalid date range" });
    return;
  }

  try {
    const results = await yieldService.backfill(positions, sources, start, end);
    res.json({ slots: results.length, results });
  } catch (err) {
    console.error("[yield/backfill]", err);
    res.status(500).json({ error: "Backfill failed" });
  }
});

/**
 * GET /api/v1/yield/metrics
 * Returns monitoring counters for the yield calculation scheduler.
 * Suitable for scraping by Prometheus (convert to gauge metrics downstream)
 * or querying from a health-check dashboard.
 */
yieldRouter.get("/metrics", (_req: Request, res: Response): void => {
  res.json(getSchedulerMetrics());
});
