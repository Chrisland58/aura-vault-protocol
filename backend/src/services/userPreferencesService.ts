/**
 * User Preferences Service — Issue #318
 *
 * Persists display and notification preferences per wallet address.
 * Uses the read pool for fetches and write pool for upserts.
 *
 * Defaults are applied automatically when a wallet has no row yet (first GET).
 */

import { getReadPool, getWritePool } from "../db.js";

// ── Types ────────────────────────────────────────────────────────────────────

/** All fields that can be stored / returned for a user's preferences. */
export interface UserPreferences {
  /** Wallet address that identifies this preference record. */
  address: string;
  /** ISO 4217 currency code, e.g. "USD". */
  currency: string;
  /** BCP-47 language tag, e.g. "en". */
  language: string;
  /** Master toggle — enable all email notifications. */
  emailNotifications: boolean;
  /** Toggle for harvest-event email alerts. */
  harvestAlerts: boolean;
}

/** Subset of UserPreferences that callers may supply on a PATCH. */
export type UserPreferencesUpdate = Partial<
  Omit<UserPreferences, "address">
>;

// ── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_PREFERENCES: Omit<UserPreferences, "address"> = {
  currency: "USD",
  language: "en",
  emailNotifications: true,
  harvestAlerts: true,
};

// ── DB row type (snake_case from Postgres) ────────────────────────────────────

interface PreferencesRow {
  wallet_address: string;
  currency: string;
  language: string;
  email_notifications: boolean;
  harvest_alerts: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function rowToPreferences(row: PreferencesRow): UserPreferences {
  return {
    address: row.wallet_address,
    currency: row.currency,
    language: row.language,
    emailNotifications: row.email_notifications,
    harvestAlerts: row.harvest_alerts,
  };
}

// ── Service functions ─────────────────────────────────────────────────────────

/**
 * Retrieve preferences for a wallet address.
 * If no row exists, defaults are upserted and returned (first-GET creates defaults).
 */
export async function getUserPreferences(
  walletAddress: string
): Promise<UserPreferences> {
  const readPool = getReadPool();

  const result = await readPool.query<PreferencesRow>(
    `SELECT wallet_address, currency, language, email_notifications, harvest_alerts
       FROM user_preferences
      WHERE wallet_address = $1
      LIMIT 1`,
    [walletAddress]
  );

  if (result.rows.length > 0) {
    return rowToPreferences(result.rows[0]);
  }

  // No row yet — create defaults for this wallet address.
  return upsertUserPreferences(walletAddress, DEFAULT_PREFERENCES);
}

/**
 * Update preferences for a wallet address.
 * Only the fields supplied in `updates` are changed; others retain their current
 * value (or defaults if this is the first write for the address).
 */
export async function updateUserPreferences(
  walletAddress: string,
  updates: UserPreferencesUpdate
): Promise<UserPreferences> {
  // Fetch existing preferences first so we can merge with defaults.
  const existing = await getUserPreferences(walletAddress);

  const merged: Omit<UserPreferences, "address"> = {
    currency:
      updates.currency !== undefined ? updates.currency : existing.currency,
    language:
      updates.language !== undefined ? updates.language : existing.language,
    emailNotifications:
      updates.emailNotifications !== undefined
        ? updates.emailNotifications
        : existing.emailNotifications,
    harvestAlerts:
      updates.harvestAlerts !== undefined
        ? updates.harvestAlerts
        : existing.harvestAlerts,
  };

  return upsertUserPreferences(walletAddress, merged);
}

/**
 * Upsert a complete preferences record for a wallet address.
 * Uses INSERT … ON CONFLICT … DO UPDATE so it is idempotent.
 */
async function upsertUserPreferences(
  walletAddress: string,
  prefs: Omit<UserPreferences, "address">
): Promise<UserPreferences> {
  const writePool = getWritePool();

  const result = await writePool.query<PreferencesRow>(
    `INSERT INTO user_preferences
       (wallet_address, currency, language, email_notifications, harvest_alerts)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (wallet_address) DO UPDATE SET
       currency            = EXCLUDED.currency,
       language            = EXCLUDED.language,
       email_notifications = EXCLUDED.email_notifications,
       harvest_alerts      = EXCLUDED.harvest_alerts
     RETURNING wallet_address, currency, language, email_notifications, harvest_alerts`,
    [
      walletAddress,
      prefs.currency,
      prefs.language,
      prefs.emailNotifications,
      prefs.harvestAlerts,
    ]
  );

  return rowToPreferences(result.rows[0]);
}
