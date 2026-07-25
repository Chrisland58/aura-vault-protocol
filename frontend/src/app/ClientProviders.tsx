"use client";

import { type ReactNode } from "react";
import { NotificationProvider } from "@/components/notifications";
import { HapticsProvider } from "@/components/HapticFeedback";

export default function ClientProviders({ children }: { children: ReactNode }) {
  return (
    <NotificationProvider>
      <HapticsProvider>
        {children}
      </HapticsProvider>
    </NotificationProvider>
  );
}
