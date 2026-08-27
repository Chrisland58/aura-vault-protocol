BEGIN;

-- Leaderboard opt-out table — Issue #322
--
-- Addresses in this table are excluded from GET /api/vault/leaderboard responses.
-- Soft-delete via opted_out_at allows reinstatement without data loss.

CREATE TABLE IF NOT EXISTS leaderboard_optouts (
  id               BIGSERIAL    PRIMARY KEY,
  wallet_address   TEXT         NOT NULL,
  opted_out_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  opted_in_at      TIMESTAMPTZ  NULL,       -- set when user removes opt-out
  is_active        BOOLEAN      NOT NULL DEFAULT TRUE,  -- TRUE = currently opted out
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT leaderboard_optouts_wallet_unique UNIQUE (wallet_address)
);

-- Fast lookup by wallet address for the exclusion join in the leaderboard query.
CREATE INDEX IF NOT EXISTS idx_leaderboard_optouts_wallet_address
  ON leaderboard_optouts (wallet_address)
  WHERE is_active = TRUE;

-- Auto-bump updated_at.
CREATE OR REPLACE FUNCTION touch_leaderboard_optouts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_leaderboard_optouts_updated_at ON leaderboard_optouts;
CREATE TRIGGER trg_leaderboard_optouts_updated_at
BEFORE UPDATE ON leaderboard_optouts
FOR EACH ROW
EXECUTE FUNCTION touch_leaderboard_optouts_updated_at();

COMMIT;
