import { Router, Request, Response } from "express";
import { 
  getJob, 
  listJobs, 
  getDeadLetterJobs as getMemoryDlq,
  queueMetrics as getMemoryMetrics,
  enqueue,
  type TxJobData,
} from "../queue.js";
import { 
  getQueueMetrics, 
  getDeadLetterJobs, 
  getJobsByStatus, 
  loadJob 
} from "../services/queueDb.js";

export const queueRouter = Router();

/**
 * GET /api/v1/queue/health
 * Returns queue health status and key metrics
 */
queueRouter.get("/health", async (_req: Request, res: Response): Promise<void> => {
  try {
    const memoryMetrics = getMemoryMetrics();
    const dbMetrics = await getQueueMetrics().catch(() => null);

    const health = {
      status: memoryMetrics.waiting + memoryMetrics.active > 0 ? "processing" : "idle",
      timestamp: new Date().toISOString(),
      memory: memoryMetrics,
      database: dbMetrics,
      healthy: memoryMetrics.dead < 100 && (dbMetrics ? dbMetrics.dead < 100 : true),
    };

    res.json(health);
  } catch (err) {
    console.error("[queue-health]", err);
    res.status(500).json({ error: "Failed to retrieve queue health" });
  }
});

/**
 * GET /api/v1/queue/metrics
 * Returns detailed queue metrics for monitoring dashboard
 */
queueRouter.get("/metrics", async (_req: Request, res: Response): Promise<void> => {
  try {
    const metrics = await getQueueMetrics();
    
    const healthScore = metrics.total > 0
      ? ((metrics.completed / metrics.total) * 100).toFixed(2)
      : "100.00";

    const response = {
      ...metrics,
      healthScore: `${healthScore}%`,
      meetsThresholdRequirement: metrics.throughputPerHour >= 1000,
      timestamp: new Date().toISOString(),
    };

    res.json(response);
  } catch (err) {
    console.error("[queue-metrics]", err);
    res.status(500).json({ error: "Failed to retrieve queue metrics" });
  }
});

/**
 * GET /api/v1/queue/jobs/:id
 * Get details for a specific job
 */
queueRouter.get("/jobs/:id", async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    
    // Try memory first, then database
    let job = getJob(id);
    if (!job) {
      job = await loadJob(id);
    }

    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    res.json(job);
  } catch (err) {
    console.error("[queue-get-job]", err);
    res.status(500).json({ error: "Failed to retrieve job" });
  }
});

/**
 * GET /api/v1/queue/jobs
 * List jobs by status with pagination
 */
queueRouter.get("/jobs", async (req: Request, res: Response): Promise<void> => {
  try {
    const status = req.query.status as string | undefined;
    const limitRaw = Number.parseInt(String(req.query.limit ?? "50"), 10);
    const offsetRaw = Number.parseInt(String(req.query.offset ?? "0"), 10);
    
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(100, limitRaw) : 50;
    const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;

    let jobs;
    if (status) {
      jobs = await getJobsByStatus(status, limit, offset);
    } else {
      // Return from memory if no status filter
      jobs = listJobs();
    }

    res.json({
      jobs,
      pagination: {
        limit,
        offset,
        count: jobs.length,
      },
    });
  } catch (err) {
    console.error("[queue-list-jobs]", err);
    res.status(500).json({ error: "Failed to list jobs" });
  }
});

/**
 * GET /api/v1/queue/dlq
 * Get dead letter queue entries
 */
queueRouter.get("/dlq", async (req: Request, res: Response): Promise<void> => {
  try {
    const limitRaw = Number.parseInt(String(req.query.limit ?? "50"), 10);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(100, limitRaw) : 50;

    const dlqJobs = await getDeadLetterJobs(limit);

    res.json({
      jobs: dlqJobs,
      count: dlqJobs.length,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[queue-dlq]", err);
    res.status(500).json({ error: "Failed to retrieve dead letter queue" });
  }
});

/**
 * POST /api/v1/queue/jobs
 * Enqueue a new transaction job
 */
queueRouter.post("/jobs", async (req: Request, res: Response): Promise<void> => {
  try {
    const { type, walletAddress, amount, webhookUrl, meta } = req.body;

    if (!type || !walletAddress || !amount) {
      res.status(400).json({ 
        error: "Missing required fields: type, walletAddress, amount" 
      });
      return;
    }

    if (!["deposit", "withdrawal", "claim"].includes(type)) {
      res.status(400).json({ 
        error: "Invalid type. Must be one of: deposit, withdrawal, claim" 
      });
      return;
    }

    const jobData: TxJobData = {
      type,
      walletAddress,
      amount,
      webhookUrl,
      meta,
    };

    const job = enqueue(jobData);
    res.status(201).json(job);
  } catch (err) {
    console.error("[queue-enqueue]", err);
    res.status(500).json({ error: "Failed to enqueue job" });
  }
});

/**
 * GET /api/v1/queue/stats
 * Get aggregated statistics for monitoring
 */
queueRouter.get("/stats", async (_req: Request, res: Response): Promise<void> => {
  try {
    const metrics = await getQueueMetrics();
    
    const stats = {
      processing: {
        waiting: metrics.waiting,
        active: metrics.active,
        total: metrics.waiting + metrics.active,
      },
      completed: {
        successful: metrics.completed,
        failed: metrics.failed,
        dead: metrics.dead,
        total: metrics.completed + metrics.failed + metrics.dead,
      },
      performance: {
        avgProcessingTimeSeconds: metrics.avgProcessingTimeSeconds ?? 0,
        avgAttemptsToSuccess: metrics.avgAttemptsToSuccess ?? 0,
        throughputPerHour: metrics.throughputPerHour,
        meetsRequirement: metrics.throughputPerHour >= 1000,
      },
      hourly: {
        jobsStarted: metrics.jobsLastHour,
        jobsCompleted: metrics.completedLastHour,
      },
      timestamp: new Date().toISOString(),
    };

    res.json(stats);
  } catch (err) {
    console.error("[queue-stats]", err);
    res.status(500).json({ error: "Failed to retrieve queue statistics" });
  }
});
