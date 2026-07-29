BEGIN;

-- Transaction queue table for job status tracking
CREATE TABLE IF NOT EXISTS transaction_jobs (
  id UUID PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('deposit', 'withdrawal', 'claim')),
  wallet_address TEXT NOT NULL,
  amount NUMERIC(38, 18) NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('waiting', 'active', 'completed', 'failed', 'dead')),
  attempts INT NOT NULL DEFAULT 0,
  webhook_url TEXT NULL,
  meta JSONB NULL,
  result TEXT NULL,
  error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ NULL
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_transaction_jobs_status
  ON transaction_jobs (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_transaction_jobs_wallet_address
  ON transaction_jobs (wallet_address, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_transaction_jobs_type_status
  ON transaction_jobs (type, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_transaction_jobs_created_at
  ON transaction_jobs (created_at DESC);

-- Dead letter queue view for easy access
CREATE OR REPLACE VIEW dead_letter_queue AS
SELECT 
  id,
  type,
  wallet_address,
  amount,
  attempts,
  error,
  created_at,
  updated_at
FROM transaction_jobs
WHERE status = 'dead'
ORDER BY updated_at DESC;

-- Metrics view for monitoring dashboard
CREATE OR REPLACE VIEW transaction_queue_metrics AS
SELECT
  COUNT(*) FILTER (WHERE status = 'waiting') AS waiting_count,
  COUNT(*) FILTER (WHERE status = 'active') AS active_count,
  COUNT(*) FILTER (WHERE status = 'completed') AS completed_count,
  COUNT(*) FILTER (WHERE status = 'failed') AS failed_count,
  COUNT(*) FILTER (WHERE status = 'dead') AS dead_count,
  COUNT(*) AS total_count,
  AVG(CASE 
    WHEN status = 'completed' AND completed_at IS NOT NULL 
    THEN EXTRACT(EPOCH FROM (completed_at - created_at))
    ELSE NULL
  END) AS avg_processing_time_seconds,
  AVG(attempts) FILTER (WHERE status = 'completed') AS avg_attempts_to_success,
  COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 hour') AS jobs_last_hour,
  COUNT(*) FILTER (
    WHERE status = 'completed' AND created_at > NOW() - INTERVAL '1 hour'
  ) AS completed_last_hour
FROM transaction_jobs;

-- Function to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION touch_transaction_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    NEW.completed_at = NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for updated_at
DROP TRIGGER IF EXISTS trg_transaction_jobs_updated_at ON transaction_jobs;
CREATE TRIGGER trg_transaction_jobs_updated_at
BEFORE UPDATE ON transaction_jobs
FOR EACH ROW
EXECUTE FUNCTION touch_transaction_jobs_updated_at();

COMMIT;
