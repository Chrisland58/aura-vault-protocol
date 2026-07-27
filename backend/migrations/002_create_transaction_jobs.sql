BEGIN;

-- ---------------------------------------------------------------------------
-- transaction_jobs
-- Persists async blockchain transaction queue state so job status survives
-- restarts and can be queried independently of the in-memory queue.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS transaction_jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tx_type       TEXT NOT NULL CHECK (tx_type IN ('deposit', 'withdrawal', 'claim')),
  wallet_address TEXT NOT NULL,
  amount        NUMERIC(38, 18) NOT NULL CHECK (amount > 0),
  status        TEXT NOT NULL DEFAULT 'waiting'
                  CHECK (status IN ('waiting', 'active', 'completed', 'failed', 'dead')),
  attempts      INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts  INTEGER NOT NULL DEFAULT 3  CHECK (max_attempts >= 1),
  webhook_url   TEXT NULL,
  result        TEXT NULL,
  error_message TEXT NULL,
  meta          JSONB NULL,
  scheduled_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at    TIMESTAMPTZ NULL,
  completed_at  TIMESTAMPTZ NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lookup by status for worker polling and dashboard
CREATE INDEX IF NOT EXISTS idx_transaction_jobs_status
  ON transaction_jobs (status, scheduled_at ASC);

-- Lookup by wallet for user-facing status queries
CREATE INDEX IF NOT EXISTS idx_transaction_jobs_wallet
  ON transaction_jobs (wallet_address, created_at DESC);

-- Dead-letter queue: find all exhausted jobs
CREATE INDEX IF NOT EXISTS idx_transaction_jobs_dead
  ON transaction_jobs (status, completed_at DESC)
  WHERE status = 'dead';

-- ---------------------------------------------------------------------------
-- dead_letter_jobs  — immutable archive copy of exhausted transactions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS dead_letter_jobs (
  id             BIGSERIAL PRIMARY KEY,
  original_job_id UUID NOT NULL,
  tx_type        TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  amount         NUMERIC(38, 18) NOT NULL,
  attempts       INTEGER NOT NULL,
  last_error     TEXT NULL,
  job_snapshot   JSONB NOT NULL,   -- full copy of transaction_jobs row at death
  archived_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dead_letter_jobs_original_id
  ON dead_letter_jobs (original_job_id);

CREATE INDEX IF NOT EXISTS idx_dead_letter_jobs_archived_at
  ON dead_letter_jobs (archived_at DESC);

-- ---------------------------------------------------------------------------
-- Auto-update updated_at on transaction_jobs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION touch_transaction_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_transaction_jobs_updated_at ON transaction_jobs;
CREATE TRIGGER trg_transaction_jobs_updated_at
BEFORE UPDATE ON transaction_jobs
FOR EACH ROW
EXECUTE FUNCTION touch_transaction_jobs_updated_at();

-- ---------------------------------------------------------------------------
-- Trigger: automatically archive to dead_letter_jobs when status -> 'dead'
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION archive_dead_transaction_job()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'dead' AND OLD.status <> 'dead' THEN
    INSERT INTO dead_letter_jobs (
      original_job_id,
      tx_type,
      wallet_address,
      amount,
      attempts,
      last_error,
      job_snapshot
    ) VALUES (
      NEW.id,
      NEW.tx_type,
      NEW.wallet_address,
      NEW.amount,
      NEW.attempts,
      NEW.error_message,
      to_jsonb(NEW)
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_archive_dead_job ON transaction_jobs;
CREATE TRIGGER trg_archive_dead_job
AFTER UPDATE ON transaction_jobs
FOR EACH ROW
EXECUTE FUNCTION archive_dead_transaction_job();

COMMIT;
