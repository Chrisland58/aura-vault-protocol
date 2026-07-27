BEGIN;

-- APY snapshot table — stores periodic APY readings for vault(s).
-- Used by the GET /api/vault/apy/history endpoint to build chart data.
-- Hourly rows support the 7d period; daily rows support 30d / 90d / 1y.

CREATE TABLE IF NOT EXISTS apy_snapshots (
  id           BIGSERIAL    PRIMARY KEY,
  vault_id     UUID         NOT NULL,
  -- resolution: 'hourly' or 'daily'
  resolution   TEXT         NOT NULL CHECK (resolution IN ('hourly', 'daily')),
  snapshot_at  TIMESTAMPTZ  NOT NULL,
  apy_7d       NUMERIC(10, 6) NOT NULL CHECK (apy_7d >= 0),
  apy_30d      NUMERIC(10, 6) NOT NULL CHECK (apy_30d >= 0),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- One snapshot per vault / resolution / hour (or day)
CREATE UNIQUE INDEX IF NOT EXISTS idx_apy_snapshots_unique
  ON apy_snapshots (vault_id, resolution, snapshot_at);

CREATE INDEX IF NOT EXISTS idx_apy_snapshots_vault_time
  ON apy_snapshots (vault_id, snapshot_at DESC);

CREATE INDEX IF NOT EXISTS idx_apy_snapshots_resolution_time
  ON apy_snapshots (resolution, snapshot_at DESC);

COMMIT;
