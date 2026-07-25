"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import WalletConnect from "./WalletConnect";
import VaultActions from "./VaultActions";

interface VaultStats {
  tvl: string;
  apy: string;
  userBalance: string;
  userShares: string;
  pricePerShare: string;
}

interface Transaction {
  id: string;
  type: "deposit" | "withdraw" | "harvest";
  amount: string;
  timestamp: number;
  hash: string;
}

function StatCard({
  label,
  value,
  sub,
  "data-cy": dataCy,
}: {
  label: string;
  value: string;
  sub?: string;
  "data-cy"?: string;
}) {
  return (
    <div
      data-cy={dataCy}
      className="flex flex-col gap-1 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900"
    >
      <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</span>
      <span className="font-mono text-2xl font-semibold text-zinc-900 dark:text-zinc-50">{value}</span>
      {sub && <span className="text-xs text-zinc-400">{sub}</span>}
    </div>
  );
}

function TxRow({ tx }: { tx: Transaction }) {
  const icon = tx.type === "deposit" ? "↓" : tx.type === "withdraw" ? "↑" : "⚡";
  const color =
    tx.type === "deposit"
      ? "text-emerald-600 dark:text-emerald-400"
      : tx.type === "withdraw"
      ? "text-red-500 dark:text-red-400"
      : "text-amber-500 dark:text-amber-400";
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-zinc-100 dark:border-zinc-800 last:border-0">
      <div className="flex items-center gap-3">
        <span className={`text-lg font-bold ${color}`} aria-hidden="true">
          {icon}
        </span>
        <div>
          <p className="text-sm font-medium capitalize text-zinc-800 dark:text-zinc-200">{tx.type}</p>
          <p className="font-mono text-xs text-zinc-400">
            {new Date(tx.timestamp).toLocaleString()}
          </p>
        </div>
      </div>
      <div className="text-right">
        <p className="font-mono text-sm font-semibold text-zinc-800 dark:text-zinc-200">{tx.amount}</p>
        <a
          href={`https://stellar.expert/explorer/testnet/tx/${tx.hash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
          aria-label={`View transaction ${tx.hash} on explorer`}
        >
          {tx.hash.slice(0, 8)}…
        </a>
      </div>
    </div>
  );
}

const MOCK_TXS: Transaction[] = [
  { id: "1", type: "deposit", amount: "500 USDC", timestamp: Date.now() - 3600_000, hash: "abc123def456" },
  { id: "2", type: "harvest", amount: "12.5 USDC", timestamp: Date.now() - 7200_000, hash: "fff999aaa111" },
  { id: "3", type: "withdraw", amount: "100 USDC", timestamp: Date.now() - 86400_000, hash: "dead1234beef" },
];

export default function VaultDashboard() {
  const [stats, setStats] = useState<VaultStats | null>(null);
  const [txs] = useState<Transaction[]>(MOCK_TXS);
  const [loading, setLoading] = useState(true);
  const [liveMsg, setLiveMsg] = useState("");
  const wsRef = useRef<WebSocket | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const [assetsRes, apyRes] = await Promise.all([
        fetch("/api/vault/total_assets"),
        fetch("/api/vault/apy"),
      ]);
      const assets = assetsRes.ok ? await assetsRes.json() : { total: "0" };
      const apyData = apyRes.ok ? await apyRes.json() : { apy: "0" };
      setStats({
        tvl: assets.total ?? "0",
        apy: apyData.apy ?? "0",
        userBalance: assets.userBalance ?? "—",
        userShares: assets.userShares ?? "—",
        pricePerShare: assets.pricePerShare ?? "1.0000",
      });
    } catch {
      setStats({ tvl: "—", apy: "—", userBalance: "—", userShares: "—", pricePerShare: "—" });
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // WebSocket for real-time balance updates
  useEffect(() => {
    const wsUrl =
      typeof window !== "undefined"
        ? (process.env.NEXT_PUBLIC_WS_URL ?? `ws://${window.location.host}/api/ws/vault`)
        : null;
    if (!wsUrl) return;

    let ws: WebSocket;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      ws = new WebSocket(wsUrl!);
      wsRef.current = ws;

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data as string);
          if (msg.type === "vault_update") {
            setStats((prev) =>
              prev
                ? { ...prev, tvl: msg.tvl ?? prev.tvl, apy: msg.apy ?? prev.apy }
                : prev
            );
            setLiveMsg("Balance updated");
            setTimeout(() => setLiveMsg(""), 3000);
          }
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        reconnectTimer = setTimeout(connect, 5000);
      };
    }

    connect();
    return () => {
      ws?.close();
      clearTimeout(reconnectTimer);
    };
  }, []);

  const fmtNumber = (val: string) => {
    const n = parseFloat(val);
    if (isNaN(n)) return val;
    return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
  };

  return (
    <main className="w-full max-w-4xl mx-auto px-4 py-8 flex flex-col gap-8">
      {/* Live region for screen readers */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {liveMsg}
      </div>

      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Vault Dashboard
        </h1>
        <p className="text-sm text-zinc-500">Real-time overview of your Aura vault positions.</p>
      </div>

      {/* Metric cards */}
      {loading ? (
        <div
          className="grid grid-cols-2 gap-4 sm:grid-cols-4"
          aria-busy="true"
          aria-label="Loading vault statistics"
        >
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-24 rounded-xl border border-zinc-200 bg-zinc-100 animate-pulse dark:border-zinc-700 dark:bg-zinc-800"
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4" role="region" aria-label="Vault statistics">
          <StatCard
            data-cy="stat-tvl"
            label="TVL"
            value={fmtNumber(stats!.tvl)}
            sub="Total Value Locked"
          />
          <StatCard
            data-cy="stat-apy"
            label="APY"
            value={`${fmtNumber(stats!.apy)}%`}
            sub="Annualized yield"
          />
          <StatCard
            data-cy="stat-balance"
            label="Your Balance"
            value={fmtNumber(stats!.userBalance)}
            sub="Underlying tokens"
          />
          <StatCard
            data-cy="stat-shares"
            label="Your Shares"
            value={fmtNumber(stats!.userShares)}
            sub={`@ ${stats!.pricePerShare} / share`}
          />
        </div>
      )}

      {/* Wallet + Actions row */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <section aria-labelledby="wallet-heading">
          <h2 id="wallet-heading" className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Wallet
          </h2>
          <WalletConnect />
        </section>

        <section aria-labelledby="actions-heading">
          <h2 id="actions-heading" className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Actions
          </h2>
          <VaultActions />
        </section>
      </div>

      {/* Recent transactions */}
      <section aria-labelledby="tx-heading">
        <div className="flex items-center justify-between mb-3">
          <h2 id="tx-heading" className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Recent Transactions
          </h2>
          <button
            data-cy="refresh-stats-btn"
            onClick={fetchStats}
            className="text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
            aria-label="Refresh vault statistics"
          >
            ↻ Refresh
          </button>
        </div>
        <div
          data-cy="tx-list"
          className="rounded-xl border border-zinc-200 bg-white px-4 dark:border-zinc-700 dark:bg-zinc-900"
          role="list"
          aria-label="Recent transactions"
        >
          {txs.length === 0 ? (
            <p className="py-6 text-center text-sm text-zinc-400">No transactions yet.</p>
          ) : (
            txs.map((tx) => (
              <div key={tx.id} role="listitem">
                <TxRow tx={tx} />
              </div>
            ))
          )}
        </div>
      </section>
    </main>
  );
}
