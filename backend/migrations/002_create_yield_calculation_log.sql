BEGIN;

-- Stores a log entry for every hourly yield calculation batch run.
-- Enables historical auditing and replay, and feeds monitoring dashboards.
CREATE TABLE IF NOT EXISTS yield_calculation_log (
  id               BIGSERIAL PRIMARY KEY,
  -- ISO timestamp at which the calculation was performed
  calc_date        TIMESTAMPTZ NOT NULL,
  -- Total positions submitted to the batch
  positions_total  INTEGER     NOT NULL CHECK (positions_total >= 0),
  -- Successfully calculated
  positions_ok     INTEGER     NOT NULL CHECK (positions_ok >= 0),
  -- Failed (exception thrown during calculation)
  positions_failed INTEGER     NOT NULL CHECK (positions_failed >= 0),
  -- Wall-clock duration of the batch run
  duration_ms      INTEGER     NOT NULL CHECK (duration_ms >= 0),
  -- JSON array of { positionId, error } objects for failed positions
  errors           JSONB       NOT NULL DEFAULT '[]',
  -- Whether this was a scheduled run or a manual backfill
  run_type         TEXT        NOT NULL DEFAULT 'scheduled'
    CHECK (run_type IN ('scheduled', 'backfill', 'manual')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast lookup by run time (descending — most recent first)
CREATE INDEX IF NOT EXISTS idx_yield_calc_log_calc_date
  ON yield_calculation_log (calc_date DESC);

-- Index for querying only failed runs
CREATE INDEX IF NOT EXISTS idx_yield_calc_log_failed
  ON yield_calculation_log (positions_failed)
  WHERE positions_failed > 0;

-- Index for filtering by run_type
CREATE INDEX IF NOT EXISTS idx_yield_calc_log_run_type
  ON yield_calculation_log (run_type, calc_date DESC);

COMMIT;
