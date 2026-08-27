BEGIN;

-- User preferences table — stores per-user display and notification settings.
-- Used by GET /api/users/preferences and PATCH /api/users/preferences (Issue #318).
--
-- Schema columns:
--   wallet_address    — Stellar or EVM wallet address (primary identifier)
--   currency          — display currency code, e.g. "USD", "EUR"
--   language          — BCP-47 language tag, e.g. "en", "fr"
--   email_notifications — master toggle for all email notifications
--   harvest_alerts    — specifically opt in/out of harvest event email alerts

CREATE TABLE IF NOT EXISTS user_preferences (
  id                   BIGSERIAL    PRIMARY KEY,
  wallet_address       TEXT         NOT NULL,
  currency             TEXT         NOT NULL DEFAULT 'USD'
                         CHECK (char_length(currency) BETWEEN 2 AND 10),
  language             TEXT         NOT NULL DEFAULT 'en'
                         CHECK (char_length(language) BETWEEN 2 AND 10),
  email_notifications  BOOLEAN      NOT NULL DEFAULT TRUE,
  harvest_alerts       BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT user_preferences_wallet_address_unique UNIQUE (wallet_address)
);

-- Fast lookup by wallet address (covered by the unique constraint, but explicit
-- for clarity and to support partial-index queries in future).
CREATE INDEX IF NOT EXISTS idx_user_preferences_wallet_address
  ON user_preferences (wallet_address);

-- Auto-bump updated_at on every row update.
CREATE OR REPLACE FUNCTION touch_user_preferences_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_user_preferences_updated_at ON user_preferences;
CREATE TRIGGER trg_user_preferences_updated_at
BEFORE UPDATE ON user_preferences
FOR EACH ROW
EXECUTE FUNCTION touch_user_preferences_updated_at();

COMMIT;
