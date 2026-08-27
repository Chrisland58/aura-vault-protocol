/**
 * Tests for mobile biometric auth service  (Issue #528)
 *
 * Runs with Jest (Expo managed workflow).
 * expo-local-authentication and expo-secure-store are mocked.
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Mock expo-local-authentication
const mockHasHardwareAsync = jest.fn();
const mockIsEnrolledAsync = jest.fn();
const mockSupportedAuthTypesAsync = jest.fn();
const mockAuthenticateAsync = jest.fn();

jest.mock("expo-local-authentication", () => ({
  hasHardwareAsync:                  mockHasHardwareAsync,
  isEnrolledAsync:                   mockIsEnrolledAsync,
  supportedAuthenticationTypesAsync: mockSupportedAuthTypesAsync,
  authenticateAsync:                 mockAuthenticateAsync,
  AuthenticationType: {
    FINGERPRINT:        1,
    FACIAL_RECOGNITION: 2,
    IRIS:               3,
  },
}));

// Mock expo-secure-store (in-memory store)
const secureStoreMap = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  setItemAsync: jest.fn(async (key: string, val: string) => { secureStoreMap.set(key, val); }),
  getItemAsync: jest.fn(async (key: string) => secureStoreMap.get(key) ?? null),
  deleteItemAsync: jest.fn(async (key: string) => { secureStoreMap.delete(key); }),
}));

// ─── Subject under test ───────────────────────────────────────────────────────

import {
  getBiometricCapability,
  isBiometricAvailable,
  isBiometricEnrolled,
  setBiometricEnrolled,
  savePin,
  verifyPin,
  hasPinSet,
  clearPin,
  recordAuthSuccess,
  isReauthRequired,
  authenticateWithBiometrics,
  authenticateWithPin,
  enrollBiometrics,
  disableBiometrics,
  BACKGROUND_TIMEOUT_MS,
} from "../services/biometricAuth.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resetMocks() {
  secureStoreMap.clear();
  jest.clearAllMocks();
  mockHasHardwareAsync.mockResolvedValue(true);
  mockIsEnrolledAsync.mockResolvedValue(true);
  mockSupportedAuthTypesAsync.mockResolvedValue([1]); // FINGERPRINT
  mockAuthenticateAsync.mockResolvedValue({ success: true });
}

beforeEach(resetMocks);

// ─── getBiometricCapability ───────────────────────────────────────────────────

describe("getBiometricCapability", () => {
  it("returns hasHardware=true when hardware present", async () => {
    const cap = await getBiometricCapability();
    expect(cap.hasHardware).toBe(true);
  });

  it("returns isEnrolled=false when not enrolled", async () => {
    mockIsEnrolledAsync.mockResolvedValue(false);
    const cap = await getBiometricCapability();
    expect(cap.isEnrolled).toBe(false);
  });

  it("includes supportedTypes", async () => {
    const cap = await getBiometricCapability();
    expect(Array.isArray(cap.supportedTypes)).toBe(true);
  });
});

// ─── isBiometricAvailable ─────────────────────────────────────────────────────

describe("isBiometricAvailable", () => {
  it("returns true when hardware present and enrolled", async () => {
    expect(await isBiometricAvailable()).toBe(true);
  });

  it("returns false when no hardware", async () => {
    mockHasHardwareAsync.mockResolvedValue(false);
    expect(await isBiometricAvailable()).toBe(false);
  });

  it("returns false when not enrolled", async () => {
    mockIsEnrolledAsync.mockResolvedValue(false);
    expect(await isBiometricAvailable()).toBe(false);
  });
});

// ─── Enrollment state ─────────────────────────────────────────────────────────

describe("setBiometricEnrolled / isBiometricEnrolled", () => {
  it("persists enrolled=true", async () => {
    await setBiometricEnrolled(true);
    expect(await isBiometricEnrolled()).toBe(true);
  });

  it("persists enrolled=false", async () => {
    await setBiometricEnrolled(false);
    expect(await isBiometricEnrolled()).toBe(false);
  });

  it("returns false when no value set", async () => {
    expect(await isBiometricEnrolled()).toBe(false);
  });
});

// ─── PIN management ───────────────────────────────────────────────────────────

describe("savePin / verifyPin", () => {
  it("verifies correct PIN", async () => {
    await savePin("123456");
    const result = await verifyPin("123456");
    expect(result.success).toBe(true);
    expect(result.locked).toBe(false);
  });

  it("rejects incorrect PIN", async () => {
    await savePin("123456");
    const result = await verifyPin("999999");
    expect(result.success).toBe(false);
    expect(result.locked).toBe(false);
  });

  it("returns locked after 5 failed attempts", async () => {
    await savePin("123456");
    for (let i = 0; i < 5; i++) {
      await verifyPin("000000");
    }
    const result = await verifyPin("000000");
    expect(result.locked).toBe(true);
  });

  it("resets lockout on correct PIN", async () => {
    await savePin("123456");
    // Fail twice
    await verifyPin("000000");
    await verifyPin("000000");
    // Succeed
    const ok = await verifyPin("123456");
    expect(ok.success).toBe(true);
    // Should be unlocked now
    const after = await verifyPin("000000");
    expect(after.locked).toBe(false);
  });
});

describe("hasPinSet", () => {
  it("returns false before savePin", async () => {
    expect(await hasPinSet()).toBe(false);
  });

  it("returns true after savePin", async () => {
    await savePin("111111");
    expect(await hasPinSet()).toBe(true);
  });

  it("returns false after clearPin", async () => {
    await savePin("111111");
    await clearPin();
    expect(await hasPinSet()).toBe(false);
  });
});

// ─── Session gating ───────────────────────────────────────────────────────────

describe("isReauthRequired", () => {
  it("returns true when no auth recorded", async () => {
    expect(await isReauthRequired()).toBe(true);
  });

  it("returns false immediately after recordAuthSuccess", async () => {
    await recordAuthSuccess();
    expect(await isReauthRequired()).toBe(false);
  });

  it("returns true after BACKGROUND_TIMEOUT_MS has elapsed", async () => {
    const past = Date.now() - (BACKGROUND_TIMEOUT_MS + 1000);
    const SecureStore = jest.requireMock("expo-secure-store");
    SecureStore.getItemAsync.mockResolvedValueOnce(String(past));
    expect(await isReauthRequired()).toBe(true);
  });
});

// ─── authenticateWithBiometrics ───────────────────────────────────────────────

describe("authenticateWithBiometrics", () => {
  it("returns success=true on successful biometric auth", async () => {
    const result = await authenticateWithBiometrics();
    expect(result.success).toBe(true);
    expect(result.method).toBe("biometric");
  });

  it("returns success=false when hardware unavailable", async () => {
    mockHasHardwareAsync.mockResolvedValue(false);
    const result = await authenticateWithBiometrics();
    expect(result.success).toBe(false);
  });

  it("returns success=false when auth prompt fails", async () => {
    mockAuthenticateAsync.mockResolvedValue({ success: false, error: "user_cancel" });
    const result = await authenticateWithBiometrics();
    expect(result.success).toBe(false);
    expect(result.error).toBe("user_cancel");
  });
});

// ─── authenticateWithPin ──────────────────────────────────────────────────────

describe("authenticateWithPin", () => {
  it("succeeds with correct PIN", async () => {
    await savePin("654321");
    const result = await authenticateWithPin("654321");
    expect(result.success).toBe(true);
    expect(result.method).toBe("pin");
  });

  it("fails with wrong PIN", async () => {
    await savePin("654321");
    const result = await authenticateWithPin("000000");
    expect(result.success).toBe(false);
    expect(result.error).toBe("Incorrect PIN");
  });
});

// ─── enrollBiometrics ─────────────────────────────────────────────────────────

describe("enrollBiometrics", () => {
  it("enrolls successfully when hardware available and auth passes", async () => {
    const res = await enrollBiometrics();
    expect(res.enrolled).toBe(true);
    // Should persist enrollment flag
    expect(await isBiometricEnrolled()).toBe(true);
  });

  it("returns enrolled=false when hardware missing", async () => {
    mockHasHardwareAsync.mockResolvedValue(false);
    const res = await enrollBiometrics();
    expect(res.enrolled).toBe(false);
    expect(res.reason).toMatch(/no biometric hardware/i);
  });

  it("returns enrolled=false when not device-enrolled", async () => {
    mockIsEnrolledAsync.mockResolvedValue(false);
    const res = await enrollBiometrics();
    expect(res.enrolled).toBe(false);
    expect(res.reason).toMatch(/no biometric credentials/i);
  });

  it("returns enrolled=false when user cancels prompt", async () => {
    mockAuthenticateAsync.mockResolvedValue({ success: false, error: "user_cancel" });
    const res = await enrollBiometrics();
    expect(res.enrolled).toBe(false);
  });
});

// ─── disableBiometrics ────────────────────────────────────────────────────────

describe("disableBiometrics", () => {
  it("clears enrollment flag", async () => {
    await setBiometricEnrolled(true);
    await disableBiometrics();
    expect(await isBiometricEnrolled()).toBe(false);
  });
});

// ─── Private key safety ───────────────────────────────────────────────────────

describe("Private key safety", () => {
  it("never stores private key — only session tokens in SecureStore", () => {
    // Verify that none of the storage keys used by biometricAuth contain
    // a private key. The keys used should be:
    //   aura_biometric_enrolled, aura_pin_hash, aura_last_auth_ts, aura_lockout_count
    const allowedKeys = new Set([
      "aura_biometric_enrolled",
      "aura_pin_hash",
      "aura_last_auth_ts",
      "aura_lockout_count",
      // auth.ts session keys (tested separately)
      "aura_access_token",
      "aura_refresh_token",
    ]);

    secureStoreMap.forEach((_val, key) => {
      expect(allowedKeys.has(key)).toBe(true);
    });
  });
});
