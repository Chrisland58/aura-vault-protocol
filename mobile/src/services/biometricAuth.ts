/**
 * Biometric Authentication Service  (Issue #528)
 *
 * Provides Face ID / Touch ID / fingerprint authentication for the
 * Aura Vault mobile app.
 *
 * Key design decisions:
 *  - Session tokens (not private keys) are stored in SecureStore
 *  - Private keys are NEVER persisted on-device
 *  - Biometric gate is re-prompted after 5 minutes of background
 *  - Fallback to PIN when biometrics unavailable or locked out
 *  - Enrollment prompt on first login
 *
 * Tested on:
 *  - iOS 17+  (Face ID via LocalAuthentication)
 *  - Android 12+ (Fingerprint / Face via LocalAuthentication)
 */

import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";

// ─── Storage keys ─────────────────────────────────────────────────────────────

const KEY_BIOMETRIC_ENROLLED = "aura_biometric_enrolled"; // "true" | "false"
const KEY_PIN_HASH           = "aura_pin_hash";           // bcrypt hash of user's PIN
const KEY_LAST_AUTH_TS       = "aura_last_auth_ts";       // unix ms timestamp (string)
const KEY_LOCKOUT_COUNT      = "aura_lockout_count";      // failed PIN attempts

/** Require re-auth after 5 minutes in the background (ms). */
export const BACKGROUND_TIMEOUT_MS = 5 * 60 * 1000;

/** Lock out PIN entry after this many consecutive failures. */
const MAX_PIN_ATTEMPTS = 5;

// ─── Types ────────────────────────────────────────────────────────────────────

export type AuthMethod = "biometric" | "pin" | "none";

export interface BiometricCapability {
  hasHardware: boolean;
  isEnrolled: boolean;
  supportedTypes: LocalAuthentication.AuthenticationType[];
}

export interface AuthResult {
  success: boolean;
  method: AuthMethod;
  error?: string;
}

// ─── Capability detection ─────────────────────────────────────────────────────

/**
 * Query the device's biometric capabilities.
 * Returns hardware presence, enrollment status, and supported auth types.
 */
export async function getBiometricCapability(): Promise<BiometricCapability> {
  const [hasHardware, isEnrolled, supportedTypes] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
    LocalAuthentication.supportedAuthenticationTypesAsync(),
  ]);
  return { hasHardware, isEnrolled, supportedTypes };
}

/**
 * True when the device supports biometrics AND has enrolled credentials.
 */
export async function isBiometricAvailable(): Promise<boolean> {
  const { hasHardware, isEnrolled } = await getBiometricCapability();
  return hasHardware && isEnrolled;
}

// ─── Enrollment state ─────────────────────────────────────────────────────────

/**
 * Has the user previously opted-in to biometric auth in this app?
 */
export async function isBiometricEnrolled(): Promise<boolean> {
  const val = await SecureStore.getItemAsync(KEY_BIOMETRIC_ENROLLED);
  return val === "true";
}

/**
 * Persist the user's opt-in decision.
 */
export async function setBiometricEnrolled(enrolled: boolean): Promise<void> {
  await SecureStore.setItemAsync(KEY_BIOMETRIC_ENROLLED, enrolled ? "true" : "false");
}

// ─── PIN management ───────────────────────────────────────────────────────────

/**
 * Store a hashed PIN for fallback authentication.
 * Only a salted SHA-256 digest is stored (no bcrypt dep required at runtime).
 */
export async function savePin(pin: string): Promise<void> {
  // Simple salted digest — replace with bcrypt in production for stronger security
  const salt = "aura_pin_salt_v1";
  const encoder = new TextEncoder();
  const data = encoder.encode(salt + pin);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  await SecureStore.setItemAsync(KEY_PIN_HASH, hashHex);
  // Reset lockout on new PIN set
  await SecureStore.setItemAsync(KEY_LOCKOUT_COUNT, "0");
}

/**
 * Verify PIN against stored hash.
 * Returns false and increments lockout counter on failure.
 */
export async function verifyPin(pin: string): Promise<{ success: boolean; locked: boolean }> {
  const storedHash = await SecureStore.getItemAsync(KEY_PIN_HASH);
  if (!storedHash) {
    return { success: false, locked: false };
  }

  const rawCount = await SecureStore.getItemAsync(KEY_LOCKOUT_COUNT);
  const count = parseInt(rawCount ?? "0", 10);
  if (count >= MAX_PIN_ATTEMPTS) {
    return { success: false, locked: true };
  }

  const salt = "aura_pin_salt_v1";
  const encoder = new TextEncoder();
  const data = encoder.encode(salt + pin);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

  if (hashHex === storedHash) {
    await SecureStore.setItemAsync(KEY_LOCKOUT_COUNT, "0");
    return { success: true, locked: false };
  }

  await SecureStore.setItemAsync(KEY_LOCKOUT_COUNT, String(count + 1));
  return { success: false, locked: count + 1 >= MAX_PIN_ATTEMPTS };
}

export async function hasPinSet(): Promise<boolean> {
  const h = await SecureStore.getItemAsync(KEY_PIN_HASH);
  return !!h;
}

export async function clearPin(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY_PIN_HASH);
  await SecureStore.deleteItemAsync(KEY_LOCKOUT_COUNT);
}

// ─── Session gating ───────────────────────────────────────────────────────────

/**
 * Record the current time as the last successful authentication timestamp.
 */
export async function recordAuthSuccess(): Promise<void> {
  await SecureStore.setItemAsync(KEY_LAST_AUTH_TS, String(Date.now()));
}

/**
 * Returns true if the app has been in the background for longer than the
 * BACKGROUND_TIMEOUT_MS threshold (5 minutes).
 */
export async function isReauthRequired(): Promise<boolean> {
  const raw = await SecureStore.getItemAsync(KEY_LAST_AUTH_TS);
  if (!raw) return true;
  const lastAuth = parseInt(raw, 10);
  return Date.now() - lastAuth > BACKGROUND_TIMEOUT_MS;
}

// ─── Core authentication flows ────────────────────────────────────────────────

/**
 * Prompt for biometric authentication.
 * Caller should fall back to `authenticateWithPin` if this returns false.
 */
export async function authenticateWithBiometrics(): Promise<AuthResult> {
  const available = await isBiometricAvailable();
  if (!available) {
    return { success: false, method: "biometric", error: "Biometrics not available" };
  }

  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: "Authenticate to access Aura Vault",
    fallbackLabel:  "Use PIN",
    cancelLabel:    "Cancel",
    disableDeviceFallback: false, // allow device passcode as final fallback
  });

  if (result.success) {
    await recordAuthSuccess();
    return { success: true, method: "biometric" };
  }

  return {
    success: false,
    method: "biometric",
    error: result.error ?? "Authentication failed",
  };
}

/**
 * Authenticate using the app's PIN fallback.
 */
export async function authenticateWithPin(pin: string): Promise<AuthResult> {
  const { success, locked } = await verifyPin(pin);
  if (locked) {
    return { success: false, method: "pin", error: "Too many failed attempts. Please contact support." };
  }
  if (success) {
    await recordAuthSuccess();
    return { success: true, method: "pin" };
  }
  return { success: false, method: "pin", error: "Incorrect PIN" };
}

/**
 * Primary auth entry point.
 *
 * 1. If biometrics are available and enrolled → try biometrics
 * 2. If biometrics fail (cancel / lockout) → caller shows PIN screen
 * 3. If no biometrics → go straight to PIN
 */
export async function authenticate(): Promise<AuthResult> {
  const enrolled = await isBiometricEnrolled();
  const available = await isBiometricAvailable();

  if (enrolled && available) {
    return authenticateWithBiometrics();
  }

  // Signal to the UI that PIN is needed
  return { success: false, method: "pin", error: "Biometrics not enrolled or unavailable" };
}

// ─── Enrollment flow (called on first login) ──────────────────────────────────

/**
 * Guide the user through biometric enrollment.
 *
 * Returns:
 *   - { enrolled: true }  if the user opted in and biometrics worked
 *   - { enrolled: false } if the user skipped or biometrics unavailable
 */
export async function enrollBiometrics(): Promise<{ enrolled: boolean; reason?: string }> {
  const { hasHardware, isEnrolled } = await getBiometricCapability();

  if (!hasHardware) {
    return { enrolled: false, reason: "This device has no biometric hardware." };
  }
  if (!isEnrolled) {
    return {
      enrolled: false,
      reason: "No biometric credentials enrolled on this device. Enable them in your device settings.",
    };
  }

  // Confirm biometrics work before opting in
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: "Confirm biometrics to enable quick sign-in",
    cancelLabel:   "Skip",
    disableDeviceFallback: true, // enrollment test — no device passcode fallback
  });

  if (result.success) {
    await setBiometricEnrolled(true);
    await recordAuthSuccess();
    return { enrolled: true };
  }

  return { enrolled: false, reason: result.error ?? "Authentication cancelled" };
}

/**
 * Disable biometric auth and clear related flags.
 * The PIN remains intact.
 */
export async function disableBiometrics(): Promise<void> {
  await setBiometricEnrolled(false);
}
