/**
 * Database persistence layer for transaction queue
 * Provides PostgreSQL integration for job status tracking
 */

import type { TxJob } from "../queue.js";

export interface DbConfig {
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
}

// Mock database client interface for demonstration
// In production, use pg, Prisma, or another PostgreSQL client
interface DbClient {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

let dbClient: DbClient | null = null;

/**
 * Initialize database connection
 */
export function initDb(client: DbClient): void {
  dbClient = client;
}

/**
 * Get database client
 */
function getDb(): DbClient {
  if (!dbClient) {
    throw new Error("Database not initialized. Call initDb() first.");
  }
  return dbClient;
}

/**
 * Persist job to database
 */
export async function saveJob(job: TxJob): Promise<void> {
  const db = getDb();
  
  await db.query(
    `INSERT INTO transaction_jobs (
      id, type, wallet_address, amount, status, attempts,
      webhook_url, meta, result, error, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    ON CONFLICT (id) DO UPDATE SET
      status = EXCLUDED.status,
      attempts = EXCLUDED.attempts,
      result = EXCLUDED.result,
      error = EXCLUDED.error,
      updated_at = EXCLUDED.updated_at`,
    [
      job.id,
      job.data.type,
      job.data.walletAddress,
      job.data.amount,
      job.status,
      job.attempts,
      job.data.webhookUrl ?? null,
      job.data.meta ? JSON.stringify(job.data.meta) : null,
      job.result ?? null,
      job.error ?? null,
      new Date(job.createdAt),
      new Date(job.updatedAt),
    ]
  );
}

/**
 * Load job from database
 */
export async function loadJob(id: string): Promise<TxJob | null> {
  const db = getDb();
  
  const result = await db.query<{
    id: string;
    type: string;
    wallet_address: string;
    amount: string;
    status: string;
    attempts: number;
    webhook_url: string | null;
    meta: string | null;
    result: string | null;
    error: string | null;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT * FROM transaction_jobs WHERE id = $1`,
    [id]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    id: row.id,
    data: {
      type: row.type as any,
      walletAddress: row.wallet_address,
      amount: row.amount,
      webhookUrl: row.webhook_url ?? undefined,
      meta: row.meta ? JSON.parse(row.meta) : undefined,
    },
    status: row.status as any,
    attempts: row.attempts,
    createdAt: row.created_at.getTime(),
    updatedAt: row.updated_at.getTime(),
    result: row.result ?? undefined,
    error: row.error ?? undefined,
  };
}

/**
 * Get queue metrics from database
 */
export async function getQueueMetrics(): Promise<{
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  dead: number;
  total: number;
  avgProcessingTimeSeconds: number | null;
  avgAttemptsToSuccess: number | null;
  jobsLastHour: number;
  completedLastHour: number;
  throughputPerHour: number;
}> {
  const db = getDb();
  
  const result = await db.query<{
    waiting_count: string;
    active_count: string;
    completed_count: string;
    failed_count: string;
    dead_count: string;
    total_count: string;
    avg_processing_time_seconds: string | null;
    avg_attempts_to_success: string | null;
    jobs_last_hour: string;
    completed_last_hour: string;
  }>(
    `SELECT * FROM transaction_queue_metrics`
  );

  const row = result.rows[0] ?? {
    waiting_count: "0",
    active_count: "0",
    completed_count: "0",
    failed_count: "0",
    dead_count: "0",
    total_count: "0",
    avg_processing_time_seconds: null,
    avg_attempts_to_success: null,
    jobs_last_hour: "0",
    completed_last_hour: "0",
  };

  const completedLastHour = Number.parseInt(row.completed_last_hour, 10);
  
  return {
    waiting: Number.parseInt(row.waiting_count, 10),
    active: Number.parseInt(row.active_count, 10),
    completed: Number.parseInt(row.completed_count, 10),
    failed: Number.parseInt(row.failed_count, 10),
    dead: Number.parseInt(row.dead_count, 10),
    total: Number.parseInt(row.total_count, 10),
    avgProcessingTimeSeconds: row.avg_processing_time_seconds ? Number.parseFloat(row.avg_processing_time_seconds) : null,
    avgAttemptsToSuccess: row.avg_attempts_to_success ? Number.parseFloat(row.avg_attempts_to_success) : null,
    jobsLastHour: Number.parseInt(row.jobs_last_hour, 10),
    completedLastHour,
    throughputPerHour: completedLastHour, // Completed in last hour is throughput
  };
}

/**
 * Get dead letter queue jobs
 */
export async function getDeadLetterJobs(limit = 50): Promise<{
  id: string;
  type: string;
  walletAddress: string;
  amount: string;
  attempts: number;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}[]> {
  const db = getDb();
  
  const result = await db.query<{
    id: string;
    type: string;
    wallet_address: string;
    amount: string;
    attempts: number;
    error: string | null;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT * FROM dead_letter_queue LIMIT $1`,
    [limit]
  );

  return result.rows.map((row) => ({
    id: row.id,
    type: row.type,
    walletAddress: row.wallet_address,
    amount: row.amount,
    attempts: row.attempts,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

/**
 * Get jobs by status
 */
export async function getJobsByStatus(
  status: string,
  limit = 100,
  offset = 0
): Promise<TxJob[]> {
  const db = getDb();
  
  const result = await db.query<{
    id: string;
    type: string;
    wallet_address: string;
    amount: string;
    status: string;
    attempts: number;
    webhook_url: string | null;
    meta: string | null;
    result: string | null;
    error: string | null;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT * FROM transaction_jobs 
     WHERE status = $1 
     ORDER BY created_at DESC 
     LIMIT $2 OFFSET $3`,
    [status, limit, offset]
  );

  return result.rows.map((row) => ({
    id: row.id,
    data: {
      type: row.type as any,
      walletAddress: row.wallet_address,
      amount: row.amount,
      webhookUrl: row.webhook_url ?? undefined,
      meta: row.meta ? JSON.parse(row.meta) : undefined,
    },
    status: row.status as any,
    attempts: row.attempts,
    createdAt: row.created_at.getTime(),
    updatedAt: row.updated_at.getTime(),
    result: row.result ?? undefined,
    error: row.error ?? undefined,
  }));
}
