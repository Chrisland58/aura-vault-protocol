"use client";

import { useCallback, useEffect, useState } from "react";

type WalletType = "freighter" | "metamask" | "xBull";

type WalletState = {
  type: WalletType;
  address: string;
};

type WalletConnectProps = {
  onConnected?: () => void;
  onDisconnected?: () => void;
};

function truncate(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function getInstalledWallets(): WalletType[] {
  if (typeof window === "undefined") {
    return [];
  }

  const wallets: WalletType[] = [];

  const win = window as Window & {
    freighterApi?: unknown;
    ethereum?: unknown;
    xBullSDK?: unknown;
  };

  if (win.freighterApi) wallets.push("freighter");
  if (win.ethereum) wallets.push("metamask");
  if (win.xBullSDK) wallets.push("xBull");

  return wallets;
}

export default function WalletConnect({
  onConnected,
  onDisconnected,
}: WalletConnectProps) {
  const [wallets, setWallets] = useState<WalletType[]>([]);
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detectWallets = useCallback(() => {
    setWallets(getInstalledWallets());
  }, []);

  useEffect(() => {
    detectWallets();
  }, [detectWallets]);

  async function connectWallet(type: WalletType) {
    setLoading(true);
    setError(null);

    try {
      if (type === "metamask") {
        const win = window as Window & {
          ethereum?: {
            request: (args: {
              method: string;
            }) => Promise<string[]>;
          };
        };

        if (!win.ethereum) {
          throw new Error("MetaMask is not installed.");
        }

        const accounts = await win.ethereum.request({
          method: "eth_requestAccounts",
        });

        if (!accounts.length) {
          throw new Error("No MetaMask account was returned.");
        }

        setWallet({
          type,
          address: accounts[0],
        });

        onConnected?.();
        return;
      }

      if (type === "freighter") {
        const win = window as Window & {
          freighterApi?: {
            requestAccess?: () => Promise<{
              address?: string;
            }>;
            getPublicKey?: () => Promise<string>;
          };
        };

        if (!win.freighterApi) {
          throw new Error("Freighter is not installed.");
        }

        let address: string | undefined;

        if (win.freighterApi.requestAccess) {
          const result = await win.freighterApi.requestAccess();
          address = result.address;
        }

        if (!address && win.freighterApi.getPublicKey) {
          address = await win.freighterApi.getPublicKey();
        }

        if (!address) {
          throw new Error("No Freighter address was returned.");
        }

        setWallet({
          type,
          address,
        });

        onConnected?.();
        return;
      }

      if (type === "xBull") {
        throw new Error("xBull connection is not implemented yet.");
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to connect wallet."
      );
    } finally {
      setLoading(false);
    }
  }

  function disconnectWallet() {
    setWallet(null);
    setError(null);
    onDisconnected?.();
  }

  if (wallet) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border p-4">
        <div>
          <p className="text-sm font-medium">Connected Wallet</p>

          <p
            data-testid="wallet-address"
            className="text-sm text-gray-500"
          >
            {wallet.type}: {truncate(wallet.address)}
          </p>

          <p
            data-testid="network-badge"
            className="text-xs font-semibold text-emerald-600"
          >
            TESTNET
          </p>
        </div>

        <button
          data-testid="disconnect-wallet-btn"
          type="button"
          onClick={disconnectWallet}
          className="rounded-md border px-4 py-2 text-sm"
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div>
        <p className="text-sm font-medium">Connect Wallet</p>

        <p className="text-sm text-gray-500">
          Select an installed wallet.
        </p>
      </div>

      {wallets.length === 0 ? (
        <p className="text-sm text-gray-500">
          No supported wallet detected.
        </p>
      ) : (
        wallets.map((type) => (
          <button
            key={type}
            data-testid="connect-wallet-btn"
            type="button"
            onClick={() => connectWallet(type)}
            disabled={loading}
            className="rounded-md border px-4 py-2 text-sm disabled:opacity-50"
          >
            {loading ? "Connecting..." : `Connect ${type}`}
          </button>
        ))
      )}

      {error && (
        <p className="text-sm text-red-500" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}