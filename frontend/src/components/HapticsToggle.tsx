"use client";

/**
 * HapticsToggle — settings control for haptic feedback preference.
 * Can be used within or outside HapticsProvider.
 * When used outside the provider it falls back to direct localStorage access.
 */

import { useState, useEffect, useCallback } from "react";
import { Vibrate } from "lucide-react";

const STORAGE_KEY = "aura_haptics_enabled";

function isVibrationSupported() {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.vibrate === "function"
  );
}

function loadPreference(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === null ? true : raw === "true";
  } catch {
    return true;
  }
}

function savePreference(enabled: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, String(enabled));
    if (!enabled && isVibrationSupported()) {
      navigator.vibrate(0); // cancel any ongoing vibration
    }
  } catch {
    // ignore
  }
}

export function HapticsToggle() {
  const [enabled, setEnabled] = useState(true);
  const [supported, setSupported] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setEnabled(loadPreference());
    setSupported(isVibrationSupported());
    setMounted(true);
  }, []);

  const toggle = useCallback(() => {
    const next = !enabled;
    setEnabled(next);
    savePreference(next);
    // Give a quick test vibration when enabling
    if (next && isVibrationSupported()) {
      navigator.vibrate([80]);
    }
  }, [enabled]);

  if (!mounted) return null;

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 bg-white dark:bg-zinc-900">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Vibrate
            size={18}
            className="mt-0.5 shrink-0 text-zinc-500"
            aria-hidden="true"
          />
          <div>
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              Haptic Feedback
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              {supported
                ? "Vibrate on transaction success, failure, and confirmation."
                : "Not supported on this device."}
            </p>
          </div>
        </div>

        <button
          role="switch"
          aria-checked={enabled}
          aria-label={`Haptic feedback ${enabled ? "enabled" : "disabled"}`}
          onClick={toggle}
          disabled={!supported}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 ${
            enabled
              ? "bg-indigo-600"
              : "bg-zinc-300 dark:bg-zinc-600"
          }`}
          data-cy="haptics-toggle"
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition-transform ${
              enabled ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
      </div>

      {!supported && (
        <p className="mt-2 text-xs text-amber-600 dark:text-amber-400" role="status">
          The Vibration API is not available in this browser or device.
        </p>
      )}
    </div>
  );
}
