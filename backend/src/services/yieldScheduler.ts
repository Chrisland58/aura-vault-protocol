/**
 * Yield Calculation Scheduler
 *
 * Runs yield calculations on an hourly cadence (aligned to the clock hour).
 * Follows the same setInterval/start/stop pattern used by queue.ts.
 *
 * Usage:
 *   import { startYieldScheduler, stopYieldScheduler } from "./yieldScheduler.js";
 *
 *   // In server startup:
 *   startYieldScheduler(getPositions, getSources);
 *
 *   // In server shutdown:
 *   stopYieldScheduler();
 */

import { createYieldService, type BatchResult, type VaultPosition, type YieldSource } from "./yieldService.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Async function that returns the current set of positions to be calculated. */
export type PositionLoader = () => Promise<VaultPosition[]>;

/** Async function that returns the active yield sources. */
export type SourceLoader = () => Promise<YieldSource[]>;

/** Optional hook called after every successful batch run. */
export type OnBatchComplete = (result: BatchResult, calcDate: Date) => Promise<void> | void;

/** Optional hook called when a scheduled run fails entirely. */
export type OnRunError = (err: unknown) => void;

export interface YieldSchedulerOptions {
  /** How often to run in ms (default: 3_600_000 — 1 hour). */
  intervalMs?: number;
  /** Whether to run immediately on start (default: false). */
  runImmediately?: boolean;
  /** Called after each completed batch run. */
  onBatchComplete?: OnBatchComplete;
  /** Called if the scheduled run throws an unhandled error. */
  onRunError?: OnRunError;
  /** Forwarded to the underlying YieldService instance. */
  batchSize?: number;
  /** Forwarded alert handler to the underlying YieldService instance. */
  onAlert?: (msg: string, meta?: unknown) => void;
}

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;

// Shared service instance used by the scheduler
let _service = createYieldService();

// ---------------------------------------------------------------------------
// Scheduler helpers
// ---------------------------------------------------------------------------

/**
 * Compute the milliseconds until the next top-of-the-hour.
 * e.g. at 14:23:45, returns ms until 15:00:00.
 * Returns `intervalMs` if intervalMs < 3_600_000 (useful for tests).
 */
export function msUntilNextHour(now: Date = new Date(), intervalMs = 3_600_000): number {
  if (intervalMs < 3_600_000) return intervalMs;
  const ms = now.getTime();
  const nextHour = Math.ceil(ms / 3_600_000) * 3_600_000;
  const wait = nextHour - ms;
  // Minimum 1 second to avoid scheduling in the past
  return Math.max(wait, 1_000);
}

// ---------------------------------------------------------------------------
// Core tick
// ---------------------------------------------------------------------------

async function runTick(
  loadPositions: PositionLoader,
  loadSources: SourceLoader,
  onBatchComplete: OnBatchComplete | undefined,
  onRunError: OnRunError | undefined,
  service: ReturnType<typeof createYieldService>
): Promise<void> {
  const calcDate = new Date();
  try {
    const [positions, sources] = await Promise.all([loadPositions(), loadSources()]);
    const result = await service.processBatch(positions, sources, calcDate);
    if (onBatchComplete) {
      await onBatchComplete(result, calcDate);
    }
  } catch (err) {
    const handler = onRunError ?? ((e) => console.error("[YieldScheduler] Unhandled run error:", e));
    handler(err);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start the hourly yield calculation scheduler.
 * Calling start while already running is a no-op (safe to call multiple times).
 */
export function startYieldScheduler(
  loadPositions: PositionLoader,
  loadSources: SourceLoader,
  opts: YieldSchedulerOptions = {}
): void {
  if (running) return;
  running = true;

  const {
    intervalMs = 3_600_000,
    runImmediately = false,
    onBatchComplete,
    onRunError,
    batchSize,
    onAlert,
  } = opts;

  // Build a fresh service with the provided options
  _service = createYieldService({ batchSize, onAlert });

  const tick = () =>
    runTick(loadPositions, loadSources, onBatchComplete, onRunError, _service);

  function scheduleNext(): void {
    const delay = msUntilNextHour(new Date(), intervalMs);
    timer = setTimeout(() => {
      void tick().finally(scheduleNext);
    }, delay);
  }

  if (runImmediately) {
    void tick().finally(scheduleNext);
  } else {
    scheduleNext();
  }
}

/**
 * Stop the hourly scheduler.
 * Safe to call if the scheduler is not running.
 */
export function stopYieldScheduler(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  running = false;
}

/** Returns true if the scheduler is currently active. */
export function isYieldSchedulerRunning(): boolean {
  return running;
}

/**
 * Returns the metrics from the underlying yield service instance
 * used by the scheduler. Useful for health-check and Prometheus endpoints.
 */
export function getSchedulerMetrics() {
  return _service.getMetrics();
}
