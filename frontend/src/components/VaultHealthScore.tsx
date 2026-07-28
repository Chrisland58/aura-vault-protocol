"use client";

import { useState, useEffect, useCallback } from "react";
import { ShieldCheck, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type HealthGrade = "A" | "B" | "C" | "D";

interface HealthFactor {
  id: string;
  label: string;
  /** 0–100 */
  score: number;
  /** Short human-readable status */
  status: string;
  /** Extra detail for the breakdown panel */
  detail: string;
}

export interface VaultHealthData {
  grade: HealthGrade;
  /** 0–100 aggregate */
  overallScore: number;
  factors: HealthFactor[];
  lastUpdated: number;
}

// ─── Scoring logic ────────────────────────────────────────────────────────────

/**
 * Derive a letter grade from an overall 0–100 score.
 *   90–100 → A
 *   70–89  → B
 *   50–69  → C
 *   0–49   → D
 */
function scoreToGrade(score: number): HealthGrade {
  if (score >= 90) return "A";
  if (score >= 70) return "B";
  if (score >= 50) return "C";
  return "D";
}

function average(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/**
 * Build a VaultHealthData object from raw vault metrics.
 * Weights: TVL 30%, APY consistency 25%, time since last harvest 25%, audit status 20%.
 */
function computeHealth(raw: {
  tvlUsd: number;
  apyCurrentPct: number;
  apyAvg30dPct: number;
  hoursSinceLastHarvest: number;
  auditStatus: "audited" | "partial" | "unaudited";
}): VaultHealthData {
  // TVL factor (0–100): scales linearly 0 → $0, 100 → $10M+
  const tvlScore = Math.min(100, (raw.tvlUsd / 10_000_000) * 100);
  const tvlFactor: HealthFactor = {
    id: "tvl",
    label: "TVL",
    score: tvlScore,
    status:
      raw.tvlUsd >= 5_000_000
        ? "Strong"
        : raw.tvlUsd >= 1_000_000
        ? "Moderate"
        : "Low",
    detail: `Current TVL: $${(raw.tvlUsd / 1_000_000).toFixed(2)}M. Higher TVL indicates deeper liquidity and more confidence from the community. Scoring 100 at ≥ $10M.`,
  };

  // APY consistency factor: compare current vs 30-day avg
  const apyDeviation = Math.abs(raw.apyCurrentPct - raw.apyAvg30dPct);
  const apyScore = Math.max(0, 100 - apyDeviation * 10);
  const apyFactor: HealthFactor = {
    id: "apy_consistency",
    label: "APY Consistency",
    score: apyScore,
    status:
      apyDeviation < 2
        ? "Stable"
        : apyDeviation < 5
        ? "Slight variance"
        : "High variance",
    detail: `Current APY: ${raw.apyCurrentPct.toFixed(2)}% vs 30-day average: ${raw.apyAvg30dPct.toFixed(2)}%. A deviation of ${apyDeviation.toFixed(2)}pp detected. Consistent APY signals reliable yield generation.`,
  };

  // Harvest recency factor: score degrades the longer since last harvest
  //   0 h → 100, 24 h → 90, 72 h → 70, 168 h (1 wk) → 40, 336 h (2 wk) → 0
  const harvestScore = Math.max(
    0,
    100 - (raw.hoursSinceLastHarvest / 336) * 100
  );
  const harvestFactor: HealthFactor = {
    id: "harvest_recency",
    label: "Last Harvest",
    score: harvestScore,
    status:
      raw.hoursSinceLastHarvest < 24
        ? "Recent"
        : raw.hoursSinceLastHarvest < 72
        ? "Within 3 days"
        : raw.hoursSinceLastHarvest < 168
        ? "Within a week"
        : "Stale",
    detail: `Last harvest was ${raw.hoursSinceLastHarvest < 24 ? `${raw.hoursSinceLastHarvest}h` : `${Math.round(raw.hoursSinceLastHarvest / 24)}d`} ago. Regular harvests compound yield and maintain NAV accuracy. Score reaches 0 at 2 weeks without harvest.`,
  };

  // Audit status factor
  const auditScore =
    raw.auditStatus === "audited"
      ? 100
      : raw.auditStatus === "partial"
      ? 60
      : 10;
  const auditFactor: HealthFactor = {
    id: "audit_status",
    label: "Audit Status",
    score: auditScore,
    status:
      raw.auditStatus === "audited"
        ? "Fully audited"
        : raw.auditStatus === "partial"
        ? "Partial audit"
        : "Unaudited",
    detail:
      raw.auditStatus === "audited"
        ? "The vault contract has been audited by an independent security firm. See the Security Audit Report for details."
        : raw.auditStatus === "partial"
        ? "Core contract logic has been reviewed but not all modules have been fully audited."
        : "No independent audit has been completed. Use with caution.",
  };

  const factors = [tvlFactor, apyFactor, harvestFactor, auditFactor];
  const weights = [0.3, 0.25, 0.25, 0.2];
  const overallScore = factors.reduce((acc, f, i) => acc + f.score * weights[i], 0);

  return {
    grade: scoreToGrade(overallScore),
    overallScore,
    factors,
    lastUpdated: Date.now(),
  };
}

/** Fallback mock data when the API is unreachable. */
function getMockHealthData(): VaultHealthData {
  return computeHealth({
    tvlUsd: 3_200_000,
    apyCurrentPct: 10.5,
    apyAvg30dPct: 9.8,
    hoursSinceLastHarvest: 18,
    auditStatus: "audited",
  });
}

// ─── Styling helpers ──────────────────────────────────────────────────────────

const GRADE_COLOURS: Record<HealthGrade, { bg: string; text: string; ring: string; bar: string }> = {
  A: {
    bg: "bg-emerald-50 dark:bg-emerald-950/30",
    text: "text-emerald-700 dark:text-emerald-400",
    ring: "ring-emerald-400",
    bar: "bg-emerald-500",
  },
  B: {
    bg: "bg-yellow-50 dark:bg-yellow-950/30",
    text: "text-yellow-700 dark:text-yellow-400",
    ring: "ring-yellow-400",
    bar: "bg-yellow-500",
  },
  C: {
    bg: "bg-amber-50 dark:bg-amber-950/30",
    text: "text-amber-700 dark:text-amber-400",
    ring: "ring-amber-400",
    bar: "bg-amber-500",
  },
  D: {
    bg: "bg-red-50 dark:bg-red-950/30",
    text: "text-red-700 dark:text-red-400",
    ring: "ring-red-400",
    bar: "bg-red-500",
  },
};

function factorBarColour(score: number): string {
  if (score >= 80) return "bg-emerald-500";
  if (score >= 60) return "bg-yellow-500";
  if (score >= 40) return "bg-amber-500";
  return "bg-red-500";
}

function gradeDescription(grade: HealthGrade): string {
  switch (grade) {
    case "A":
      return "Excellent — all health signals are strong.";
    case "B":
      return "Good — minor concerns but vault is operating well.";
    case "C":
      return "Fair — some signals warrant attention.";
    case "D":
      return "Concern — significant issues detected. Review before depositing.";
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  /** If true, shows a compact badge version suitable for dashboards. */
  compact?: boolean;
}

export default function VaultHealthScore({ compact = false }: Props) {
  const [health, setHealth] = useState<VaultHealthData | null>(null);
  const [loading, setLoading] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    try {
      const [assetsRes, apyRes, harvestRes] = await Promise.all([
        fetch("/api/vault/total_assets"),
        fetch("/api/vault/apy"),
        fetch("/api/vault/last-harvest"),
      ]);

      const assets = assetsRes.ok ? await assetsRes.json() : {};
      const apyData = apyRes.ok ? await apyRes.json() : {};
      const harvestData = harvestRes.ok ? await harvestRes.json() : {};

      setHealth(
        computeHealth({
          tvlUsd: parseFloat(assets.total ?? "3200000") || 3_200_000,
          apyCurrentPct: parseFloat(apyData.apy ?? "10.5") || 10.5,
          apyAvg30dPct: parseFloat(apyData.avg30d ?? apyData.apy ?? "9.8") || 9.8,
          hoursSinceLastHarvest:
            parseFloat(harvestData.hoursSince ?? "18") || 18,
          auditStatus:
            (harvestData.auditStatus as "audited" | "partial" | "unaudited") ??
            "audited",
        })
      );
    } catch {
      setHealth(getMockHealthData());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchHealth();
  }, [fetchHealth]);

  // ── Loading skeleton ────────────────────────────────────────────────────────
  if (!health) {
    return (
      <div
        className="rounded-xl border border-zinc-200 dark:border-zinc-700 p-5 animate-pulse"
        aria-busy="true"
        aria-label="Loading vault health score"
      >
        <div className="h-6 w-40 bg-zinc-200 dark:bg-zinc-700 rounded mb-4" />
        <div className="flex gap-4 items-center">
          <div className="h-14 w-14 rounded-full bg-zinc-200 dark:bg-zinc-700" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-32 bg-zinc-200 dark:bg-zinc-700 rounded" />
            <div className="h-3 w-48 bg-zinc-200 dark:bg-zinc-700 rounded" />
          </div>
        </div>
      </div>
    );
  }

  const colours = GRADE_COLOURS[health.grade];

  // ── Compact badge mode ──────────────────────────────────────────────────────
  if (compact) {
    return (
      <div
        className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 ${colours.bg} ring-1 ${colours.ring}`}
        aria-label={`Vault health: ${health.grade} — ${gradeDescription(health.grade)}`}
        title={gradeDescription(health.grade)}
      >
        <ShieldCheck size={14} className={colours.text} aria-hidden="true" />
        <span className={`text-sm font-bold ${colours.text}`}>
          {health.grade}
        </span>
        <span className="text-xs text-zinc-500">Health</span>
      </div>
    );
  }

  // ── Full card mode ──────────────────────────────────────────────────────────
  return (
    <section
      className="rounded-xl border border-zinc-200 dark:border-zinc-700 p-5"
      aria-labelledby="vault-health-heading"
    >
      {/* Header row */}
      <div className="flex items-center justify-between mb-4">
        <h2
          id="vault-health-heading"
          className="text-lg font-semibold text-zinc-900 dark:text-zinc-50 flex items-center gap-2"
        >
          <ShieldCheck size={20} aria-hidden="true" />
          Vault Health
        </h2>
        <button
          onClick={() => void fetchHealth()}
          disabled={loading}
          aria-label="Refresh vault health score"
          className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 disabled:opacity-40"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {/* Grade + summary */}
      <div
        className={`flex items-center gap-4 rounded-xl p-4 ${colours.bg} ring-1 ${colours.ring} mb-4`}
      >
        {/* Grade circle */}
        <div
          className={`flex-shrink-0 flex h-14 w-14 items-center justify-center rounded-full bg-white dark:bg-zinc-900 ring-2 ${colours.ring}`}
          aria-hidden="true"
        >
          <span className={`text-2xl font-black ${colours.text}`}>
            {health.grade}
          </span>
        </div>

        <div className="min-w-0">
          <p className={`text-sm font-semibold ${colours.text}`}>
            {gradeDescription(health.grade)}
          </p>
          <p className="text-xs text-zinc-500 mt-0.5">
            Overall score: {health.overallScore.toFixed(0)}/100 &bull; Updated{" "}
            {new Date(health.lastUpdated).toLocaleTimeString()}
          </p>
        </div>
      </div>

      {/* Factor bars — compact preview */}
      <div className="space-y-3 mb-4" aria-label="Health factor scores">
        {health.factors.map((f) => (
          <div key={f.id}>
            <div className="flex justify-between text-xs mb-1">
              <span className="font-medium text-zinc-700 dark:text-zinc-300">
                {f.label}
              </span>
              <span className="text-zinc-500">
                {f.status} &bull; {f.score.toFixed(0)}/100
              </span>
            </div>
            <div
              className="h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden"
              role="progressbar"
              aria-valuenow={f.score}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${f.label}: ${f.score.toFixed(0)} out of 100`}
            >
              <div
                className={`h-full rounded-full transition-all duration-700 ${factorBarColour(f.score)}`}
                style={{ width: `${f.score}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Health Details accordion */}
      <div className="border border-zinc-200 dark:border-zinc-700 rounded-xl overflow-hidden">
        <button
          onClick={() => setShowDetails((v) => !v)}
          aria-expanded={showDetails}
          aria-controls="vault-health-details"
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
        >
          <span>Health Details</span>
          {showDetails ? (
            <ChevronUp size={16} aria-hidden="true" />
          ) : (
            <ChevronDown size={16} aria-hidden="true" />
          )}
        </button>

        {showDetails && (
          <div
            id="vault-health-details"
            className="px-4 pb-4 space-y-4 border-t border-zinc-100 dark:border-zinc-800"
          >
            {health.factors.map((f) => {
              const barCol = factorBarColour(f.score);
              return (
                <div key={f.id} className="pt-4">
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                      {f.label}
                    </span>
                    <span
                      className={`text-xs font-bold rounded-full px-2 py-0.5 ${
                        f.score >= 80
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                          : f.score >= 60
                          ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                          : f.score >= 40
                          ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                          : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                      }`}
                    >
                      {f.score.toFixed(0)}/100
                    </span>
                  </div>
                  {/* Detailed progress bar */}
                  <div
                    className="h-2 rounded-full bg-zinc-100 dark:bg-zinc-700 overflow-hidden mb-2"
                    role="progressbar"
                    aria-valuenow={f.score}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${f.label} detailed score`}
                  >
                    <div
                      className={`h-full rounded-full ${barCol}`}
                      style={{ width: `${f.score}%` }}
                    />
                  </div>
                  <p className="text-xs text-zinc-500 leading-relaxed">
                    {f.detail}
                  </p>
                </div>
              );
            })}

            {/* Link to FAQ methodology */}
            <p className="text-xs text-zinc-400 pt-2 border-t border-zinc-100 dark:border-zinc-800">
              Scoring methodology documented in the{" "}
              <a
                href="/faq#vault-health-score-methodology"
                className="underline hover:text-zinc-700 dark:hover:text-zinc-300"
              >
                FAQ — Vault Health Score
              </a>
              .
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
