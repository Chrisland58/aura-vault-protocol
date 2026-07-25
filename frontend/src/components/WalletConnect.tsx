"use client";

import { useState, useEffect, useCallback } from "react";
import { ChevronDown } from "lucide-react";

interface WalletState {
  address: string | null;
  network: string | null;
  connected: boolean;
  walletType: "freighter" | "metamask" | "walletconnect" | "coinbase" | null;
}

type WalletType = "freighter" | "metamask" | "walletconnect" | "coinbase";

const STORAGE_KEY = "aura_wallet_state";
const LAST_WALLET_KEY = "aura_last_wallet_type";

function truncate(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function getInstalledWallets(): WalletType[] {
  const wallets: WalletType[] = [];

  if (typeof window !== "undefined") {
    const w = window as unknown as Record<string, unknown>;
    if (w.freighterApi) wallets.push("freighter");
    if (w.ethereum) wallets.push("metamask");
    wallets.push("walletconnect");
    if (w.coinbaseWalletSDK) wallets.push("coinbase");
  }

  return wallets;
}

export default function WalletConnect() {
  const [wallet, setWallet] = useState<WalletState>({ address: null, network: null, connected: false, walletType: null });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [installedWallets, setInstalledWallets] = useState<WalletType[]>([]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInstalledWallets(getInstalledWallets());

    // Restore last session on mount
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const state = JSON.parse(saved);
        setWallet(state);
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
  }, []);

  const connectFreighter = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const w = window as unknown as Record<string, unknown>;
      const api = w.freighterApi as Record<string, (...args: unknown[]) => Promise<unknown>> | undefined;
      if (!api) {
        setError("Freighter wallet not found. Please install the extension.");
        return;
      }
      const connected = await api.isConnected();
      if (!connected) {
        setError("Freighter is not connected. Please unlock your wallet.");
        return;
      }
      const address = (await api.getPublicKey()) as string;
      const network = (await api.getNetwork()) as string;
      const state: WalletState = { address, network: network.toUpperCase(), connected: true, walletType: "freighter" };
      setWallet(state);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      localStorage.setItem(LAST_WALLET_KEY, "freighter");
      setShowDropdown(false);
    } catch (err: unknown) {
      setError((err instanceof Error ? err.message : "Failed to connect to Freighter") ?? "Failed to connect to Freighter");
    } finally {
      setLoading(false);
    }
  }, []);

  const connectMetaMask = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const w = window as unknown as Record<string, unknown>;
      const ethereum = w.ethereum as Record<string, (...args: unknown[]) => Promise<unknown>> | undefined;
      if (!ethereum) {
        setError("MetaMask not found. Please install the extension.");
        return;
      }
      const accounts = await ethereum.request({ method: "eth_requestAccounts" }) as string[];
      const chainId = await ethereum.request({ method: "eth_chainId" }) as string;
      const networkName = chainId === "0x1" ? "ETHEREUM" : "TESTNET";
      const state: WalletState = {
        address: accounts[0],
        network: networkName,
        connected: true,
        walletType: "metamask"
      };
      setWallet(state);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      localStorage.setItem(LAST_WALLET_KEY, "metamask");
      setShowDropdown(false);
    } catch (err: unknown) {
      setError((err instanceof Error ? err.message : "Failed to connect to MetaMask") ?? "Failed to connect to MetaMask");
    } finally {
      setLoading(false);
    }
  }, []);

  const connectCoinbase = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const { CoinbaseWalletSDK } = await import("@coinbase/wallet-sdk");
      const coinbaseWallet = new CoinbaseWalletSDK({
        appName: "Aura Vault Protocol",
        appLogoUrl: "/logo.png",
      });
      const provider = coinbaseWallet.makeWeb3Provider();
      const accounts = await provider.request({ method: "eth_requestAccounts" }) as string[];
      const state: WalletState = {
        address: accounts[0],
        network: "ETHEREUM",
        connected: true,
        walletType: "coinbase"
      };
      setWallet(state);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      localStorage.setItem(LAST_WALLET_KEY, "coinbase");
      setShowDropdown(false);
    } catch (err: unknown) {
      setError((err instanceof Error ? err.message : "Failed to connect to Coinbase Wallet") ?? "Failed to connect to Coinbase Wallet");
    } finally {
      setLoading(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    const empty: WalletState = { address: null, network: null, connected: false, walletType: null };
    setWallet(empty);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LAST_WALLET_KEY);
    setError(null);
    setShowDropdown(false);
  }, []);

  return (
    <div className="flex flex-col gap-4 w-full">
      {/* Wallet bar */}
      <div className="flex items-center gap-3 relative">
        {wallet.connected ? (
          <>
            <span
              data-cy="wallet-type-badge"
              className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700 dark:bg-blue-900 dark:text-blue-300"
            >
              {wallet.walletType && wallet.walletType.charAt(0).toUpperCase() + wallet.walletType.slice(1)}
            </span>
            <span
              data-cy="network-badge"
              className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300"
            >
              {wallet.network}
            </span>
            <span data-cy="wallet-address" className="font-mono text-sm text-zinc-700 dark:text-zinc-300">
              {truncate(wallet.address!)}
            </span>
            <button
              data-cy="disconnect-wallet-btn"
              onClick={disconnect}
              className="ml-auto rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-800"
            >
              Disconnect
            </button>
          </>
        ) : (
          <div className="relative w-full">
            <button
              data-cy="connect-wallet-btn"
              onClick={() => setShowDropdown(!showDropdown)}
              disabled={loading}
              className="w-full rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-black flex items-center justify-between"
            >
              {loading ? "Connecting…" : "Connect Wallet"}
              <ChevronDown size={16} className={`transition-transform ${showDropdown ? "rotate-180" : ""}`} />
            </button>

            {showDropdown && (
              <div
                data-cy="wallet-dropdown"
                className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg z-50"
              >
                {installedWallets.includes("freighter") && (
                  <button
                    data-cy="wallet-option-freighter"
                    onClick={connectFreighter}
                    disabled={loading}
                    className="w-full text-left px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700 last:border-b-0 text-sm font-medium"
                  >
                    🌟 Freighter Wallet
                  </button>
                )}
                {installedWallets.includes("metamask") && (
                  <button
                    data-cy="wallet-option-metamask"
                    onClick={connectMetaMask}
                    disabled={loading}
                    className="w-full text-left px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700 last:border-b-0 text-sm font-medium"
                  >
                    🦊 MetaMask
                  </button>
                )}
                {installedWallets.includes("coinbase") && (
                  <button
                    data-cy="wallet-option-coinbase"
                    onClick={connectCoinbase}
                    disabled={loading}
                    className="w-full text-left px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700 last:border-b-0 text-sm font-medium"
                  >
                    💎 Coinbase Wallet
                  </button>
                )}
                <button
                  data-cy="wallet-option-walletconnect"
                  onClick={() => setError("WalletConnect coming soon")}
                  disabled={loading}
                  className="w-full text-left px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-sm font-medium"
                >
                  📱 WalletConnect (Coming Soon)
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}

      {/* Portfolio section — only when connected */}
      {wallet.connected && (
        <PortfolioSection address={wallet.address!} />
      )}
    </div>
  );
}

function PortfolioSection({ address }: { address: string }) {
  const [data, setData] = useState<{ totalAssets: string; shareBalance: string; pricePerShare: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      // Fetch from backend API
      const [assetsRes, balanceRes] = await Promise.all([
        fetch(`/api/vault/total_assets`),
        fetch(`/api/vault/balance_of?address=${encodeURIComponent(address)}`),
      ]);
      const assets = assetsRes.ok ? await assetsRes.json() : { total: "0" };
      const balance = balanceRes.ok ? await balanceRes.json() : { balance: "0" };
      const total = BigInt(assets.total ?? 0);
      const shares = BigInt(balance.balance ?? 0);
      const pps = total > 0n && shares > 0n ? (total * 10000n / shares).toString() : "10000";
      setData({ totalAssets: assets.total ?? "0", shareBalance: balance.balance ?? "0", pricePerShare: pps });
    } catch {
      setData({ totalAssets: "—", shareBalance: "—", pricePerShare: "—" });
    } finally {
      setRefreshing(false);
    }
  }, [address]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  return (
    <section data-cy="portfolio-section" className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Portfolio</h2>
        <button
          data-cy="refresh-btn"
          onClick={load}
          disabled={refreshing}
          className="text-xs text-zinc-500 hover:text-zinc-800 disabled:opacity-50 dark:hover:text-zinc-200"
        >
          {refreshing ? "Refreshing…" : "↻ Refresh"}
        </button>
      </div>
      <dl className="grid grid-cols-3 gap-4 text-center">
        <div>
          <dt className="text-xs text-zinc-500 mb-1">Total Vault Assets</dt>
          <dd data-cy="total-assets" className="font-mono text-sm font-semibold">
            {data?.totalAssets ?? "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500 mb-1">Your Shares</dt>
          <dd data-cy="share-balance" className="font-mono text-sm font-semibold">
            {data?.shareBalance ?? "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500 mb-1">Price / Share</dt>
          <dd data-cy="price-per-share" className="font-mono text-sm font-semibold">
            {data?.pricePerShare ?? "—"}
          </dd>
        </div>
      </dl>
    </section>
  );
}
