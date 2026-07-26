"use client";

import { type ReactNode } from "react";
import { NotificationProvider } from "@/components/notifications";
import { CriticalMessageProvider, type CriticalMessage } from "@/components/CriticalMessageAck";

/**
 * Example pending critical messages.
 * In production these would come from an API or feature flags.
 * They are queued on mount; any already-acknowledged messages are silently skipped.
 */
const PENDING_CRITICAL_MESSAGES: CriticalMessage[] = [
  {
    id: "vault-paused-2026-07-25",
    type: "vault_paused",
    title: "Vault Operations Paused",
    body: "The Aura Vault has been temporarily paused by the admin. Deposits, withdrawals, and harvests are disabled until further notice.",
    detail:
      "This pause was triggered as a precautionary measure. Your funds are safe and remain in the vault. No action is required from you at this time.",
  },
];

export default function ClientProviders({ children }: { children: ReactNode }) {
  return (
    <NotificationProvider>
      <CriticalMessageProvider initialMessages={PENDING_CRITICAL_MESSAGES}>
        {children}
      </CriticalMessageProvider>
    </NotificationProvider>
  );
}
