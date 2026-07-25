"use client";

import { OnboardingChecklist } from "@/components/OnboardingChecklist";
import { NotificationProvider } from "@/components/notifications";
import { type ReactNode, useState, useEffect } from "react";

const WALLET_STORAGE_KEY = "aura_wallet_state";

function useWalletAddress(): string | null {
  const [address, setAddress] = useState<string | null>(null);

  useEffect(() => {
    function read() {
      try {
        const raw = localStorage.getItem(WALLET_STORAGE_KEY);
        if (raw) {
          const state = JSON.parse(raw);
          setAddress(state.address ?? null);
        }
      } catch {
        // ignore
      }
    }
    read();
    // Re-read whenever another tab or the same page updates wallet state
    window.addEventListener("storage", read);
    return () => window.removeEventListener("storage", read);
  }, []);

  return address;
}

export default function ClientProviders({ children }: { children: ReactNode }) {
  const walletAddress = useWalletAddress();

  return (
    <NotificationProvider>
      <OnboardingChecklist walletAddress={walletAddress}>
        {children}
      </OnboardingChecklist>
    </NotificationProvider>
  );
}
