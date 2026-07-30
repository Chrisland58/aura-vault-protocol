/**
 * Database Query Performance Monitoring — Issue #324
 *
 * Wraps pg.Pool.query to:
 *   1. Log queries exceeding SLOW_QUERY_THRESHOLD_MS at WARN level with full SQL + params
 *   2. Capture EXPLAIN ANALYZE for the slowest queries (above EXPLAIN_THRESHOLD_MS)
 *   3. Record a Prometheus-compatible histogram in Redis: db_query_duration_seconds
 *   4. Expose metrics via /api/metrics/db for Grafana dashboard consumption
 *
 * Usage:
 *   import { instrumentedQuery } from './dbMonitor.js';
 *   const rows = await instrumentedQuery(pool, 'SELECT ...', [params], 'list_positions');
 *
 * Or wrap an entire pool:
 *   const pool = wrapPool(getWritePool(), 'write');
 */

import pg from "pg";
import { logger } from "../logger.js";
import { cacheGet, cacheSet } from "../cache.js";

// ── Thresholds ────────────────────────────────────────────────────────────────

/** Queries slower than this are logged at WARN level. */
export const SLOW_QUERY_THRESHOLD_MS =
  parseInt(process.env.SLOW_QUERY_THRESHOLD_MS ?? "100", 10);

/** Queries slower than this also get EXPLAIN ANALYZE captured. */
export const EXPLAIN_THRESHOLD_MS =
  parseInt(process.env.EXPLAIN_THRESHOLD_MS ?? "500", 10);

/** Max number of slow query log entries kept in Redis. */
const SLOW_LOG_MAX_ENTRIES = 200;

/** TTL for slow query log in Redis (seconds). */
const SLOW_LOG_TTL = 7 * 24 * 3600; // 7 days

// ── Histogram configuration ───────────────────────────────────────────────────

/** Bucket upper bounds in seconds for the Prometheus histogram. */
const HISTOGRAM_BUCKETS = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

const METRICS_NS = "metrics:db";
const HISTOGRAM_KEY = "query_duration_histogram";
const SLOW_LOG_KEY = "slow_query_log";
const METRICS_TTL = 86400; // 1 day

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SlowQueryRecord {
  timestamp: string;        // ISO-8601
  queryType: string;        // label supplied by caller
  sql: string;              // full query text
  params: unknown[];        // bound parameters
  durationMs: number;
  explainAnalyze?: string;  // EXPLAIN ANALYZE output for very slow queries
}

export interface DbHistogramBucket {
  le: number;    // upper bound in seconds
  count: number; // cumulative count of observations ≤ le
}

export interface DbQueryMetrics {
  queryType: string;
  count: number;
  sum_seconds: number;
  buckets: DbHistogramBucket[];
  p99_estimate_seconds: number | null;
}

// ── Histogram helpers ─────────────────────────────────────────────────────────

type HistogramData = Record<
  string, // queryType
  {
    count: number;
    sum: number;  // seconds
    buckets: Record<string, number>; // "0.1" → cumulative count
  }
>;

async function recordObservation(
  queryType: string,
  durationMs: number
): Promise<void> {
  const durationSec = durationMs / 1000;

  let data: HistogramData = {};
  try {
    const cached = await cacheGet<HistogramData>(METRICS_NS, HISTOGRAM_KEY);
    if (cached) data = cached;
  } catch {
    // ignore Redis error
  }

  if (!data[queryType]) {
    data[queryType] = {
      count: 0,
      sum: 0,
      buckets: Object.fromEntries(HISTOGRAM_BUCKETS.map((b) => [String(b), 0])),
    };
  }

  data[queryType].count += 1;
  data[queryType].sum += durationSec;

  // Increment all buckets whose upper bound ≥ durationSec (cumulative)
  for (const bucket of HISTOGRAM_BUCKETS) {
    if (durationSec <= bucket) {
      data[queryType].buckets[String(bucket)] += 1;
    }
  }

  try {
    await cacheSet(METRICS_NS, HISTOGRAM_KEY, data, METRICS_TTL);
  } catch {
    // best-effort
  }
}

// ── Slow query log helpers ────────────────────────────────────────────────────

async function appendSlowQuery(record: SlowQueryRecord): Promise<void> {
  let log: SlowQueryRecord[] = [];
  try {
    const cached = await cacheGet<SlowQueryRecord[]>(METRICS_NS, SLOW_LOG_KEY);
    if (cached) log = cached;
  } catch {
    // ignore Redis error
  }

  log.push(record);

  // Keep only the most recent SLOW_LOG_MAX_ENTRIES entries
  if (log.length > SLOW_LOG_MAX_ENTRIES) {
    log = log.slice(log.length - SLOW_LOG_MAX_ENTRIES);
  }

  try {
    await cacheSet(METRICS_NS, SLOW_LOG_KEY, log, SLOW_LOG_TTL);
  } catch {
    // best-effort
  }
}

// ── EXPLAIN ANALYZE capture ───────────────────────────────────────────────────

async function captureExplainAnalyze(
  pool: pg.Pool,
  sql: string,
  params: unknown[]
): Promise<string> {
  try {
    // Only safe for SELECT statements to avoid side-effects
    const normalized = sql.trim().toUpperCase();
    if (!normalized.startsWith("SELECT")) {
      return "(EXPLAIN skipped — not a SELECT)";
    }

    const result = await pool.query(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${sql}`,
      params
    );

    return (result.rows as Array<{ "QUERY PLAN": string }>)
      .map((r) => r["QUERY PLAN"])
      .join("\n");
  } catch (err) {
    return `(EXPLAIN failed: ${String(err)})`;
  }
}

// ── Core instrumentation ──────────────────────────────────────────────────────

/**
 * Execute a query with monitoring.
 *
 * @param pool      - pg.Pool to run the query on
 * @param sql       - SQL text (parameterised with $1, $2, …)
 * @param params    - Bound parameters array
 * @param queryType - Human-readable label for metrics (e.g. "list_positions")
 */
export async function instrumentedQuery<T extends pg.QueryResultRow = pg.QueryResultRow>(
  pool: pg.Pool,
  sql: string,
  params: unknown[] = [],
  queryType = "unknown"
): Promise<pg.QueryResult<T>> {
  const start = Date.now();

  let result: pg.QueryResult<T>;
  let queryError: unknown = null;

  try {
    result = await pool.query<T>(sql, params);
  } catch (err) {
    queryError = err;
    // Still record timing even on error
    const durationMs = Date.now() - start;
    logger.error("[db-monitor] query error", {
      queryType,
      durationMs,
      sql: sql.slice(0, 500), // truncate very long SQL
      error: String(err),
    });
    await recordObservation(queryType, durationMs).catch(() => undefined);
    throw err;
  }

  const durationMs = Date.now() - start;

  // Record histogram observation (best-effort)
  void recordObservation(queryType, durationMs);

  if (durationMs >= SLOW_QUERY_THRESHOLD_MS) {
    const record: SlowQueryRecord = {
      timestamp: new Date().toISOString(),
      queryType,
      sql,
      params,
      durationMs,
    };

    // For very slow queries also capture EXPLAIN ANALYZE
    if (durationMs >= EXPLAIN_THRESHOLD_MS) {
      record.explainAnalyze = await captureExplainAnalyze(pool, sql, params);

      logger.warn("[db-monitor] SLOW QUERY (with EXPLAIN ANALYZE)", {
        queryType,
        durationMs,
        sql,
        params,
        explainAnalyze: record.explainAnalyze,
      });
    } else {
      logger.warn("[db-monitor] slow query", {
        queryType,
        durationMs,
        sql,
        params,
      });
    }

    void appendSlowQuery(record);
  }

  return result;
}

// ── Pool wrapper ──────────────────────────────────────────────────────────────

/**
 * Returns an object that delegates .query() to instrumentedQuery.
 * Useful for swapping in a monitored pool without changing call sites.
 */
export function wrapPool(
  pool: pg.Pool,
  poolLabel = "default"
): {
  query: <T extends pg.QueryResultRow = pg.QueryResultRow>(
    sql: string,
    params?: unknown[],
    queryType?: string
  ) => Promise<pg.QueryResult<T>>;
} {
  return {
    query: <T extends pg.QueryResultRow>(
      sql: string,
      params: unknown[] = [],
      queryType = poolLabel
    ) => instrumentedQuery<T>(pool, sql, params, queryType),
  };
}

// ── Metrics read API ──────────────────────────────────────────────────────────

/**
 * Returns aggregated histogram metrics for all query types.
 * Consumed by the /api/v1/vault/metrics/db endpoint.
 */
export async function getDbMetrics(): Promise<DbQueryMetrics[]> {
  let data: HistogramData = {};
  try {
    const cached = await cacheGet<HistogramData>(METRICS_NS, HISTOGRAM_KEY);
    if (cached) data = cached;
  } catch {
    return [];
  }

  return Object.entries(data).map(([queryType, d]) => {
    // Estimate p99 from buckets using linear interpolation
    const target = d.count * 0.99;
    let p99: number | null = null;
    for (const bucket of HISTOGRAM_BUCKETS) {
      if ((d.buckets[String(bucket)] ?? 0) >= target) {
        p99 = bucket;
        break;
      }
    }
    if (p99 === null && d.count > 0) {
      p99 = HISTOGRAM_BUCKETS[HISTOGRAM_BUCKETS.length - 1] ?? null;
    }

    return {
      queryType,
      count: d.count,
      sum_seconds: d.sum,
      buckets: HISTOGRAM_BUCKETS.map((le) => ({
        le,
        count: d.buckets[String(le)] ?? 0,
      })),
      p99_estimate_seconds: p99,
    };
  });
}

/**
 * Returns the slow query log (most recent first).
 */
export async function getSlowQueryLog(): Promise<SlowQueryRecord[]> {
  try {
    const log = await cacheGet<SlowQueryRecord[]>(METRICS_NS, SLOW_LOG_KEY);
    return log ? [...log].reverse() : [];
  } catch {
    return [];
  }
}

/**
 * Returns Prometheus text format exposition for db_query_duration_seconds.
 * Suitable for inclusion in the /metrics scrape endpoint.
 */
export async function dbMetricsPrometheusText(): Promise<string> {
  const metrics = await getDbMetrics();
  const lines: string[] = [
    "# HELP db_query_duration_seconds Duration of database queries in seconds",
    "# TYPE db_query_duration_seconds histogram",
  ];

  for (const m of metrics) {
    const label = `query_type="${m.queryType}"`;
    for (const b of m.buckets) {
      lines.push(
        `db_query_duration_seconds_bucket{${label},le="${b.le}"} ${b.count}`
      );
    }
    lines.push(`db_query_duration_seconds_bucket{${label},le="+Inf"} ${m.count}`);
    lines.push(`db_query_duration_seconds_sum{${label}} ${m.sum_seconds}`);
    lines.push(`db_query_duration_seconds_count{${label}} ${m.count}`);
  }

  return lines.join("\n");
}
