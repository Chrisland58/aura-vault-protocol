BEGIN;

-- GDPR right-to-erasure requests table
-- Tracks deletion requests, their status, and completion timestamp.
-- On-chain data (tx hashes) is never erased; only off-chain user data
-- (email, preferences, notification subscriptions) is removed.

CREATE TABLE IF NOT EXISTS gdpr_erasure_requests (
  id              BIGSERIAL    PRIMARY KEY,
  wallet_address  TEXT         NOT NULL,
  requested_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  -- deadline = requested_at + 30 days (GDPR Art. 12 §3)
  deadline_at     TIMESTAMPTZ  NOT NULL GENERATED ALWAYS AS (requested_at + INTERVAL '30 days') STORED,
  status          TEXT         NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  completed_at    TIMESTAMPTZ  NULL,
  deleted_fields  JSONB        NOT NULL DEFAULT '[]',
  request_ip      TEXT         NULL,
  confirmation_email_sent BOOLEAN NOT NULL DEFAULT FALSE,
  notes           TEXT         NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Only one active (pending/processing) erasure request per wallet at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_gdpr_erasure_requests_active_wallet
  ON gdpr_erasure_requests (wallet_address)
  WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS idx_gdpr_erasure_requests_wallet_address
  ON gdpr_erasure_requests (wallet_address, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_gdpr_erasure_requests_status
  ON gdpr_erasure_requests (status, deadline_at ASC);

-- auto-bump updated_at
CREATE OR REPLACE FUNCTION touch_gdpr_erasure_requests_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_gdpr_erasure_updated_at ON gdpr_erasure_requests;
CREATE TRIGGER trg_gdpr_erasure_updated_at
BEFORE UPDATE ON gdpr_erasure_requests
FOR EACH ROW
EXECUTE FUNCTION touch_gdpr_erasure_requests_updated_at();

-- Compliance audit log — immutable append-only log of every erasure action
CREATE TABLE IF NOT EXISTS gdpr_audit_log (
  id              BIGSERIAL    PRIMARY KEY,
  erasure_id      BIGINT       NOT NULL REFERENCES gdpr_erasure_requests(id),
  action          TEXT         NOT NULL,
  actor           TEXT         NOT NULL DEFAULT 'system',
  detail          JSONB        NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gdpr_audit_log_erasure_id
  ON gdpr_audit_log (erasure_id, created_at DESC);

COMMIT;
