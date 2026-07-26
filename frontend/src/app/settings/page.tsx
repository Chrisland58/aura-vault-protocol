"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Bell, BellOff, Mail, AlertTriangle } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { HapticsToggle } from "@/components/HapticsToggle";
import "@/lib/i18n";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Settings {
  slippageTolerance: number;
  notifyDeposits: boolean;
  notifyWithdrawals: boolean;
  notifyVaultEvents: boolean;
  emailNotifications: boolean;
  email: string;
  twoFactorEnabled: boolean;
  // APY alert fields
  apyAlertEnabled: boolean;
  apyAlertThreshold: number;
  apyAlertEmail: boolean;
  apyAlertPush: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  slippageTolerance: 0.5,
  notifyDeposits: true,
  notifyWithdrawals: true,
  notifyVaultEvents: false,
  emailNotifications: false,
  email: "",
  twoFactorEnabled: false,
  apyAlertEnabled: false,
  apyAlertThreshold: 5,
  apyAlertEmail: false,
  apyAlertPush: false,
};

const APY_ALERT_STATE_KEY = "aura_apy_alert_state"; // tracks last-notified crossing

// ─── Storage helpers ──────────────────────────────────────────────────────────

function loadSettings(): Settings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const stored = localStorage.getItem("aura_settings");
    return stored
      ? { ...DEFAULT_SETTINGS, ...JSON.parse(stored) }
      : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(settings: Settings) {
  localStorage.setItem("aura_settings", JSON.stringify(settings));
}

// ─── Web Push helpers ─────────────────────────────────────────────────────────

async function requestPushPermission(): Promise<NotificationPermission> {
  if (!("Notification" in window)) return "denied";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  return Notification.requestPermission();
}

function sendBrowserNotification(apy: number, threshold: number) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  new Notification("Aura Vault — APY Alert", {
    body: `The vault APY has dropped to ${apy.toFixed(2)}%, below your alert threshold of ${threshold}%.`,
    icon: "/favicon.ico",
    tag: "aura-apy-alert", // deduplicates — only one notification per tag
  });
}

// ─── APY polling hook ─────────────────────────────────────────────────────────

/**
 * Polls APY every `intervalMs` ms.
 * When APY drops below `threshold`:
 *   - fires a browser notification if `pushEnabled`
 *   - calls `onEmailAlert` callback if `emailEnabled`
 * Stores the "already-notified" state in localStorage so a second poll in the
 * same crossing does NOT fire again (resets once APY goes back above threshold).
 */
function useApyAlert(
  enabled: boolean,
  threshold: number,
  pushEnabled: boolean,
  emailEnabled: boolean,
  email: string,
  onEmailAlert: (apy: number) => void,
  intervalMs = 30 * 60 * 1000 // 30 minutes
) {
  const lastApyRef = useRef<number | null>(null);
  const didNotifyRef = useRef<boolean>(false);

  // Restore "already notified" state from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(APY_ALERT_STATE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        didNotifyRef.current = parsed.didNotify === true;
      }
    } catch {
      // ignore
    }
  }, []);

  const checkApy = useCallback(async () => {
    if (!enabled) return;
    try {
      const res = await fetch("/api/vault/apy");
      let apy: number;
      if (res.ok) {
        const data = await res.json();
        apy = parseFloat(data.apy);
        if (isNaN(apy)) return;
      } else {
        // Fallback: use mock value for demonstration
        apy = 4.2;
      }

      lastApyRef.current = apy;

      const isBelowThreshold = apy < threshold;

      if (isBelowThreshold && !didNotifyRef.current) {
        // First time crossing below — fire alerts
        didNotifyRef.current = true;
        localStorage.setItem(
          APY_ALERT_STATE_KEY,
          JSON.stringify({ didNotify: true, apy, threshold, timestamp: Date.now() })
        );

        if (pushEnabled) sendBrowserNotification(apy, threshold);
        if (emailEnabled && email) onEmailAlert(apy);
      } else if (!isBelowThreshold && didNotifyRef.current) {
        // APY recovered above threshold — reset so next crossing fires again
        didNotifyRef.current = false;
        localStorage.removeItem(APY_ALERT_STATE_KEY);
      }
    } catch {
      // network error — silently skip
    }
  }, [enabled, threshold, pushEnabled, emailEnabled, email, onEmailAlert]);

  useEffect(() => {
    if (!enabled) return;
    void checkApy(); // immediate first check
    const id = setInterval(() => void checkApy(), intervalMs);
    return () => clearInterval(id);
  }, [enabled, checkApy, intervalMs]);
}

// ─── APY Alert Section component ─────────────────────────────────────────────

interface ApyAlertSectionProps {
  settings: Settings;
  update: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  onEmailAlert: (apy: number) => void;
}

function ApyAlertSection({ settings, update, onEmailAlert }: ApyAlertSectionProps) {
  const [pushPermission, setPushPermission] =
    useState<NotificationPermission>("default");
  const [pushError, setPushError] = useState("");
  const [thresholdInput, setThresholdInput] = useState(
    String(settings.apyAlertThreshold)
  );

  // Sync input when settings load
  useEffect(() => {
    setThresholdInput(String(settings.apyAlertThreshold));
  }, [settings.apyAlertThreshold]);

  // Read current permission
  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      setPushPermission(Notification.permission);
    }
  }, []);

  async function handleEnablePush() {
    setPushError("");
    const perm = await requestPushPermission();
    setPushPermission(perm);
    if (perm === "granted") {
      update("apyAlertPush", true);
    } else {
      setPushError(
        "Browser notifications were denied. Enable them in your browser settings."
      );
      update("apyAlertPush", false);
    }
  }

  function handleThresholdBlur() {
    const val = parseFloat(thresholdInput);
    if (!isNaN(val) && val > 0 && val <= 100) {
      update("apyAlertThreshold", val);
    } else {
      setThresholdInput(String(settings.apyAlertThreshold));
    }
  }

  // Active hook — runs in background
  useApyAlert(
    settings.apyAlertEnabled,
    settings.apyAlertThreshold,
    settings.apyAlertPush,
    settings.apyAlertEmail,
    settings.email,
    onEmailAlert
  );

  const emailAvailable = settings.emailNotifications && !!settings.email;

  return (
    <section className="mb-8" aria-labelledby="apy-alert-heading">
      <h2 id="apy-alert-heading" className="text-lg font-medium mb-3 flex items-center gap-2">
        <Bell size={18} className="text-amber-500" />
        APY Alert
      </h2>

      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 divide-y divide-zinc-100 dark:divide-zinc-800">
        {/* Master enable */}
        <div className="p-4">
          <label className="flex items-start justify-between gap-4 cursor-pointer">
            <div>
              <span className="text-sm font-medium">Enable APY alerts</span>
              <p className="text-xs text-zinc-500 mt-0.5">
                Get notified when the vault APY drops below your chosen
                threshold. Checked every 30 minutes; one alert per crossing.
              </p>
            </div>
            <input
              type="checkbox"
              checked={settings.apyAlertEnabled}
              onChange={(e) => update("apyAlertEnabled", e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
              aria-describedby="apy-alert-desc"
            />
          </label>
          <p id="apy-alert-desc" className="sr-only">
            When enabled, you will receive a notification once each time the APY
            falls below your set threshold.
          </p>
        </div>

        {/* Threshold input */}
        {settings.apyAlertEnabled && (
          <>
            <div className="p-4">
              <label
                htmlFor="apy-threshold-input"
                className="text-sm font-medium block mb-2"
              >
                Alert me if APY drops below
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="apy-threshold-input"
                  type="number"
                  min="0.1"
                  max="100"
                  step="0.1"
                  value={thresholdInput}
                  onChange={(e) => setThresholdInput(e.target.value)}
                  onBlur={handleThresholdBlur}
                  className="w-28 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  aria-label="APY alert threshold percentage"
                />
                <span className="text-sm text-zinc-500">% APY</span>
              </div>
              {settings.apyAlertThreshold < 1 && (
                <p className="mt-1 text-xs text-amber-600 flex items-center gap-1">
                  <AlertTriangle size={12} />
                  Very low threshold — you may not receive alerts often.
                </p>
              )}
            </div>

            {/* Browser push notifications */}
            <div className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-2">
                  {settings.apyAlertPush && pushPermission === "granted" ? (
                    <Bell size={15} className="text-indigo-500" />
                  ) : (
                    <BellOff size={15} className="text-zinc-400" />
                  )}
                  <div>
                    <span className="text-sm font-medium">
                      Browser push notifications
                    </span>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      {pushPermission === "denied"
                        ? "Blocked by browser — enable in site settings."
                        : pushPermission === "granted"
                        ? "Permission granted."
                        : "Click to request permission."}
                    </p>
                  </div>
                </div>

                {pushPermission === "granted" ? (
                  <input
                    type="checkbox"
                    checked={settings.apyAlertPush}
                    onChange={(e) => update("apyAlertPush", e.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
                    aria-label="Enable browser push notifications for APY alerts"
                  />
                ) : (
                  <button
                    onClick={() => void handleEnablePush()}
                    disabled={pushPermission === "denied"}
                    className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    Enable
                  </button>
                )}
              </div>
              {pushError && (
                <p
                  role="alert"
                  className="mt-2 text-xs text-red-600 dark:text-red-400"
                >
                  {pushError}
                </p>
              )}
            </div>

            {/* Email alerts */}
            <div className="p-4">
              <label className="flex items-start justify-between gap-4 cursor-pointer">
                <div className="flex items-center gap-2">
                  <Mail size={15} className="text-zinc-400" />
                  <div>
                    <span className="text-sm font-medium">Email alert</span>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      {emailAvailable
                        ? `Alerts will be sent to ${settings.email}`
                        : "Enable email notifications and add your address above to use this."}
                    </p>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.apyAlertEmail}
                  onChange={(e) => update("apyAlertEmail", e.target.checked)}
                  disabled={!emailAvailable}
                  className="mt-1 h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-40"
                  aria-label="Enable email notifications for APY alerts"
                />
              </label>
            </div>

            {/* Status summary */}
            <div className="p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-b-xl">
              <p className="text-xs text-zinc-500">
                <span className="font-medium">Active alerts: </span>
                {!settings.apyAlertPush && !settings.apyAlertEmail
                  ? "None — enable push or email above."
                  : [
                      settings.apyAlertPush && pushPermission === "granted"
                        ? "browser push"
                        : null,
                      settings.apyAlertEmail && emailAvailable
                        ? "email"
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" + ")}
              </p>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);
  const [showDeactivate, setShowDeactivate] = useState(false);
  const [emailAlertSent, setEmailAlertSent] = useState(false);

  useEffect(() => {
    setSettings(loadSettings());
  }, []);

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    saveSettings(next);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleEmailAlert = useCallback(
    async (apy: number) => {
      if (!settings.email) return;
      try {
        await fetch("/api/notifications/apy-alert", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: settings.email,
            apy,
            threshold: settings.apyAlertThreshold,
          }),
        });
        setEmailAlertSent(true);
        setTimeout(() => setEmailAlertSent(false), 5000);
      } catch {
        // silently fail — notification is best-effort
      }
    },
    [settings.email, settings.apyAlertThreshold]
  );

  const slippageOptions = [0.1, 0.5, 1.0, 3.0];

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black text-zinc-900 dark:text-zinc-100">
      <div className="max-w-2xl mx-auto px-4 py-12">
        <h1 className="text-2xl font-semibold mb-8">{t("settings.title")}</h1>

        {saved && (
          <div
            role="status"
            className="mb-4 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-4 py-2 text-sm text-emerald-600 dark:text-emerald-400"
          >
            {t("settings.saved")}
          </div>
        )}

        {emailAlertSent && (
          <div
            role="status"
            className="mb-4 rounded-lg bg-amber-500/10 border border-amber-500/20 px-4 py-2 text-sm text-amber-600 dark:text-amber-400 flex items-center gap-2"
          >
            <Bell size={14} />
            APY alert email sent to {settings.email}
          </div>
        )}

        {/* Appearance */}
        <section className="mb-8">
          <h2 className="text-lg font-medium mb-3">
            {t("settings.appearance.title")}
          </h2>
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 bg-white dark:bg-zinc-900">
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-3">
              {t("settings.appearance.description")}
            </p>
            <ThemeToggle />
          </div>
        </section>

        {/* Wallet Info */}
        <section className="mb-8">
          <h2 className="text-lg font-medium mb-3">
            {t("settings.wallet.title")}
          </h2>
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 bg-white dark:bg-zinc-900">
            <p className="text-sm text-zinc-500">
              {t("settings.wallet.no_wallet")}
            </p>
            <button className="mt-3 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors">
              {t("settings.wallet.connect")}
            </button>
          </div>
        </section>

        {/* Slippage */}
        <section className="mb-8">
          <h2 className="text-lg font-medium mb-3">
            {t("settings.slippage.title")}
          </h2>
          <div className="flex gap-2">
            {slippageOptions.map((val) => (
              <button
                key={val}
                onClick={() => update("slippageTolerance", val)}
                className={`w-full rounded-lg px-4 py-2 text-sm font-medium border transition-colors sm:w-auto ${
                  settings.slippageTolerance === val
                    ? "bg-indigo-600 text-white border-indigo-600"
                    : "bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700 hover:border-indigo-400"
                }`}
              >
                {val}%
              </button>
            ))}
          </div>
          {settings.slippageTolerance >= 3 && (
            <p className="mt-2 text-xs text-amber-600">
              {t("settings.slippage.high_warning")}
            </p>
          )}
        </section>

        {/* Notifications */}
        <section className="mb-8">
          <h2 className="text-lg font-medium mb-3">
            {t("settings.notifications.title")}
          </h2>
          <div className="space-y-3 rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 bg-white dark:bg-zinc-900">
            {(
              [
                [
                  "notifyDeposits",
                  t("settings.notifications.deposits"),
                ] as const,
                [
                  "notifyWithdrawals",
                  t("settings.notifications.withdrawals"),
                ] as const,
                [
                  "notifyVaultEvents",
                  t("settings.notifications.vault_events"),
                ] as const,
                [
                  "emailNotifications",
                  t("settings.notifications.email"),
                ] as const,
              ] as const
            ).map(([key, label]) => (
              <label
                key={key}
                className="flex items-center justify-between cursor-pointer"
              >
                <span className="text-sm">{label}</span>
                <input
                  type="checkbox"
                  checked={settings[key] as boolean}
                  onChange={(e) => update(key, e.target.checked)}
                  className="h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
                />
              </label>
            ))}
            {settings.emailNotifications && (
              <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800">
                <label className="text-xs text-zinc-500 block mb-1">
                  {t("settings.notifications.email_address")}
                </label>
                <input
                  type="email"
                  value={settings.email}
                  onChange={(e) => update("email", e.target.value)}
                  placeholder={t("settings.notifications.email_placeholder")}
                  className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            )}
          </div>
        </section>

        {/* ── APY Alert (Feature 3) ──────────────────────────────────────── */}
        <ApyAlertSection
          settings={settings}
          update={update}
          onEmailAlert={handleEmailAlert}
        />

        {/* Security */}
        <section className="mb-8">
          <h2 className="text-lg font-medium mb-3">
            {t("settings.security.title")}
          </h2>
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 bg-white dark:bg-zinc-900">
            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <span className="text-sm font-medium">
                  {t("settings.security.two_factor")}
                </span>
                <p className="text-xs text-zinc-500 mt-0.5">
                  {t("settings.security.two_factor_desc")}
                </p>
              </div>
              <input
                type="checkbox"
                checked={settings.twoFactorEnabled}
                onChange={(e) => update("twoFactorEnabled", e.target.checked)}
                className="h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
              />
            </label>
          </div>
        </section>

        {/* Haptic Feedback */}
        <section className="mb-8">
          <h2 className="text-lg font-medium mb-3">Haptic Feedback</h2>
          <HapticsToggle />
        </section>

        {/* Danger Zone */}
        <section>
          <h2 className="text-lg font-medium mb-3 text-red-600">
            {t("settings.danger.title")}
          </h2>
          <div className="rounded-xl border border-red-200 dark:border-red-900/30 p-4 bg-red-50 dark:bg-red-950/20">
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-3">
              {t("settings.danger.description")}
            </p>
            <button
              onClick={() => setShowDeactivate(true)}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors"
            >
              {t("settings.danger.deactivate")}
            </button>
            {showDeactivate && (
              <div className="mt-3 p-3 rounded-lg border border-red-300 dark:border-red-800 bg-white dark:bg-zinc-900">
                <p className="text-sm text-red-600 font-medium mb-2">
                  {t("settings.danger.confirm_message")}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowDeactivate(false)}
                    className="rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  >
                    {t("settings.danger.cancel")}
                  </button>
                  <button className="rounded-lg bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700">
                    {t("settings.danger.confirm")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
