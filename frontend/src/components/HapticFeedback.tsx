"use client";

/**
 * useHaptics — Vibration API wrapper for Aura Vault Protocol
 *
 * Provides haptic feedback on key transaction events on mobile devices.
 * Gracefully degrades on devices without the Vibration API.
 * Respects a user preference stored in localStorage (aura_haptics_enabled).
 *
 * Patterns:
 *   transactionSuccess  — 2 short vibrations: [100ms on, 100ms gap, 100ms on]
 *   transactionFailure  — 3 long vibrations:  [300ms on, 100ms gap, 300ms on, 100ms gap, 300ms on]
 *   confirmationOpen    — 1 short vibration:  [80ms on]
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type HapticPattern =
  | "transactionSuccess"
  | "transactionFailure"
  | "confirmationOpen";

// ─── Vibration patterns ───────────────────────────────────────────────────────

const PATTERNS: Record<HapticPattern, VibratePattern> = {
  // 2 short pulses with 100 ms gap
  transactionSuccess: [100, 100, 100],
  // 3 long pulses with 100 ms gaps
  transactionFailure: [300, 100, 300, 100, 300],
  // 1 short pulse
  confirmationOpen: [80],
};

// ─── localStorage key ─────────────────────────────────────────────────────────

const STORAGE_KEY = "aura_haptics_enabled";

function loadPreference(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    // Default ON if never set
    return raw === null ? true : raw === "true";
  } catch {
    return true;
  }
}

function savePreference(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(enabled));
  } catch {
    // ignore
  }
}

// ─── Vibration API availability check ────────────────────────────────────────

function isVibrationSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.vibrate === "function"
  );
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface HapticsContextValue {
  /** Fire a named haptic pattern */
  vibrate: (pattern: HapticPattern) => void;
  /** Whether the Vibration API is supported on this device */
  isSupported: boolean;
  /** Whether haptics are currently enabled (user preference) */
  enabled: boolean;
  /** Toggle or explicitly set haptics preference */
  setEnabled: (value: boolean) => void;
}

const HapticsContext = createContext<HapticsContextValue | null>(null);

export function useHaptics(): HapticsContextValue {
  const ctx = useContext(HapticsContext);
  if (!ctx) throw new Error("useHaptics must be used within HapticsProvider");
  return ctx;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function HapticsProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabledState] = useState(true);
  const [supported, setSupported] = useState(false);

  // Hydrate from localStorage after mount (SSR-safe)
  useEffect(() => {
    setEnabledState(loadPreference());
    setSupported(isVibrationSupported());
  }, []);

  const setEnabled = useCallback((value: boolean) => {
    setEnabledState(value);
    savePreference(value);
    // Cancel any in-progress vibration when disabling
    if (!value && isVibrationSupported()) {
      navigator.vibrate(0);
    }
  }, []);

  const vibrate = useCallback(
    (pattern: HapticPattern) => {
      if (!enabled) return;
      if (!isVibrationSupported()) return; // graceful degradation
      const sequence = PATTERNS[pattern];
      navigator.vibrate(sequence);
    },
    [enabled]
  );

  return (
    <HapticsContext.Provider
      value={{ vibrate, isSupported: supported, enabled, setEnabled }}
    >
      {children}
    </HapticsContext.Provider>
  );
}

// ─── Standalone hook (no provider required for simple checks) ─────────────────

/**
 * A lighter hook that can be used outside the provider tree.
 * It reads the preference from localStorage directly each call.
 * For components inside HapticsProvider, prefer useHaptics().
 */
export function useHapticsStandalone() {
  const vibrate = useCallback((pattern: HapticPattern) => {
    if (!isVibrationSupported()) return;
    if (!loadPreference()) return;
    navigator.vibrate(PATTERNS[pattern]);
  }, []);

  return { vibrate, isSupported: isVibrationSupported() };
}
