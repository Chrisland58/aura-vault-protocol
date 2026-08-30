BEGIN;

CREATE TABLE IF NOT EXISTS contract_events (
  id                BIGSERIAL    PRIMARY KEY,
  ledger_sequence   INTEGER      NOT NULL,
  transaction_hash  TEXT         NOT NULL,
  event_index       TEXT         NOT NULL,
  contract_id       TEXT         NOT NULL,
  event_type        TEXT         NOT NULL,
  topic             JSONB        NOT NULL DEFAULT '[]',
  value             JSONB,
  created_at        TIMESTAMPTZ  NOT NULL,
  backfilled_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  -- Prevent duplicate events across re-runs
  CONSTRAINT contract_events_tx_idx_unique UNIQUE (transaction_hash, event_index)
);

CREATE INDEX IF NOT EXISTS idx_contract_events_ledger
  ON contract_events (ledger_sequence);

CREATE INDEX IF NOT EXISTS idx_contract_events_contract_id
  ON contract_events (contract_id, ledger_sequence DESC);

CREATE INDEX IF NOT EXISTS idx_contract_events_type
  ON contract_events (event_type, ledger_sequence DESC);

CREATE INDEX IF NOT EXISTS idx_contract_events_created_at
  ON contract_events (created_at DESC);

COMMIT;
