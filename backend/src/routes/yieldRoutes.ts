import { Router, Request, Response } from "express";
import { createYieldService, YieldSource, VaultPosition } from "../services/yieldService.js";
import { getLastRunStats, getRunHistory, isYieldWorkerRunning } from "../services/yieldWorker.js";

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
 * GET /api/v1/yield/stats
 * Returns last hourly worker run stats and optional history for monitoring.
 * Query params: ?history=N (default 0 — omit history)
 */
yieldRouter.get("/stats", async (req: Request, res: Response): Promise<void> => {
  const historyLimit = Math.min(200, Math.max(0, parseInt((req.query.history as string) ?? "0", 10)));

  try {
    const [lastRun, history] = await Promise.all([
      getLastRunStats(),
      historyLimit > 0 ? getRunHistory(historyLimit) : Promise.resolve([] as Awaited<ReturnType<typeof getRunHistory>>),
    ]);

    res.json({
      workerRunning: isYieldWorkerRunning(),
      lastRun,
      history: historyLimit > 0 ? history : undefined,
    });
  } catch (err) {
    console.error("[yield/stats]", err);
    res.status(500).json({ error: "Failed to retrieve yield stats" });
  }
});
