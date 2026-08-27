"use client";

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  createContext,
  useContext,
  type ReactNode,
  type KeyboardEvent,
} from "react";
import { AlertTriangle, ShieldAlert, DollarSign, Pause } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CriticalMessageType =
  | "vault_paused"
  | "emergency_withdrawal"
  | "fee_change"
  | "generic";

export interface CriticalMessage {
  id: string;
  type: CriticalMessageType;
  title: string;
  body: string;
  /** Optional extra detail shown in a callout box */
  detail?: string;
}

interface AcknowledgementRecord {
  id: string;
  acknowledgedAt: number; // Unix ms timestamp
}

// ─── localStorage helpers ─────────────────────────────────────────────────────

const STORAGE_KEY = "aura_critical_ack";

function loadAcknowledgements(): Map<string, AcknowledgementRecord> {
  if (typeof window === "undefined") return new Map();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Map();
    const arr: AcknowledgementRecord[] = JSON.parse(raw);
    return new Map(arr.map((r) => [r.id, r]));
  } catch {
    return new Map();
  }
}

function saveAcknowledgement(id: string): void {
  try {
    const existing = loadAcknowledgements();
    existing.set(id, { id, acknowledgedAt: Date.now() });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(existing.values())));
  } catch {
    // silently ignore (private browsing / quota exceeded)
  }
}

function isAcknowledged(id: string): boolean {
  return loadAcknowledgements().has(id);
}

// ─── Icon helper ──────────────────────────────────────────────────────────────

function MessageIcon({ type }: { type: CriticalMessageType }) {
  const cls = "w-8 h-8";
  switch (type) {
    case "vault_paused":
      return <Pause className={cls} aria-hidden="true" />;
    case "emergency_withdrawal":
      return <ShieldAlert className={cls} aria-hidden="true" />;
    case "fee_change":
      return <DollarSign className={cls} aria-hidden="true" />;
    default:
      return <AlertTriangle className={cls} aria-hidden="true" />;
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface CriticalMessageContextValue {
  /** Show a critical message that must be explicitly acknowledged */
  showCritical: (msg: CriticalMessage) => void;
  /** Programmatically check if a message has been acknowledged */
  hasAcknowledged: (id: string) => boolean;
}

const CriticalMessageContext = createContext<CriticalMessageContextValue | null>(null);

export function useCriticalMessage(): CriticalMessageContextValue {
  const ctx = useContext(CriticalMessageContext);
  if (!ctx)
    throw new Error("useCriticalMessage must be used within CriticalMessageProvider");
  return ctx;
}

// ─── Provider + Modal ─────────────────────────────────────────────────────────

interface CriticalMessageProviderProps {
  children: ReactNode;
  /**
   * Optional list of messages to check on mount.
   * Any message not yet acknowledged will be queued immediately.
   */
  initialMessages?: CriticalMessage[];
}

export function CriticalMessageProvider({
  children,
  initialMessages = [],
}: CriticalMessageProviderProps) {
  const [queue, setQueue] = useState<CriticalMessage[]>([]);
  const [acknowledged, setAcknowledged] = useState<Set<string>>(new Set());
  const dialogRef = useRef<HTMLDivElement>(null);
  const ackBtnRef = useRef<HTMLButtonElement>(null);

  // Hydrate acknowledged set from localStorage on mount
  useEffect(() => {
    const acks = loadAcknowledgements();
    setAcknowledged(new Set(acks.keys()));

    // Queue any initial messages that have not been acknowledged yet
    const pending = initialMessages.filter((m) => !acks.has(m.id));
    if (pending.length > 0) {
      setQueue(pending);
    }
  // Only run on mount — intentionally omitting initialMessages from deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showCritical = useCallback((msg: CriticalMessage) => {
    if (isAcknowledged(msg.id)) return;
    setQueue((prev) => {
      if (prev.some((m) => m.id === msg.id)) return prev;
      return [...prev, msg];
    });
  }, []);

  const hasAcknowledged = useCallback(
    (id: string) => acknowledged.has(id),
    [acknowledged]
  );

  // Focus the "I understand" button when modal opens
  const current = queue[0] ?? null;
  useEffect(() => {
    if (current) {
      const t = setTimeout(() => ackBtnRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
  }, [current]);

  // Focus trap
  function handleDialogKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      // Critical messages CANNOT be dismissed with Esc — intentional
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.key === "Tab") {
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button, a, input, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
  }

  function handleAcknowledge(id: string) {
    saveAcknowledgement(id);
    setAcknowledged((prev) => new Set([...prev, id]));
    setQueue((prev) => prev.filter((m) => m.id !== id));
  }

  // Stripe colour per type
  function stripeClass(type: CriticalMessageType) {
    switch (type) {
      case "vault_paused":
        return "border-l-4 border-amber-500 bg-amber-50 dark:bg-amber-950/30";
      case "emergency_withdrawal":
        return "border-l-4 border-red-600 bg-red-50 dark:bg-red-950/30";
      case "fee_change":
        return "border-l-4 border-blue-600 bg-blue-50 dark:bg-blue-950/30";
      default:
        return "border-l-4 border-zinc-500 bg-zinc-50 dark:bg-zinc-800/60";
    }
  }

  function iconColorClass(type: CriticalMessageType) {
    switch (type) {
      case "vault_paused":
        return "text-amber-500";
      case "emergency_withdrawal":
        return "text-red-600";
      case "fee_change":
        return "text-blue-600";
      default:
        return "text-zinc-500";
    }
  }

  return (
    <CriticalMessageContext.Provider value={{ showCritical, hasAcknowledged }}>
      {children}

      {/* Modal — only rendered when there is an unacknowledged message */}
      {current && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="critical-msg-title"
          aria-describedby="critical-msg-body"
          data-cy="critical-message-modal"
          // Clicking the backdrop does NOT dismiss — per acceptance criteria
        >
          <div
            ref={dialogRef}
            onKeyDown={handleDialogKeyDown}
            className={`relative w-full max-w-md rounded-2xl bg-white shadow-2xl dark:bg-zinc-900 overflow-hidden ${stripeClass(current.type)}`}
          >
            {/* Icon + title */}
            <div className="flex items-start gap-4 px-6 pt-6 pb-4">
              <span className={iconColorClass(current.type)}>
                <MessageIcon type={current.type} />
              </span>
              <div className="flex-1">
                <h2
                  id="critical-msg-title"
                  className="text-lg font-bold text-zinc-900 dark:text-zinc-50"
                >
                  {current.title}
                </h2>
                <p className="mt-0.5 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                  Critical System Message
                </p>
              </div>
            </div>

            {/* Body */}
            <div className="px-6 pb-2">
              <p
                id="critical-msg-body"
                className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300"
              >
                {current.body}
              </p>

              {current.detail && (
                <div className="mt-3 rounded-lg bg-zinc-100 px-4 py-3 dark:bg-zinc-800">
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                    {current.detail}
                  </p>
                </div>
              )}
            </div>

            {/* Queue indicator (if multiple pending) */}
            {queue.length > 1 && (
              <p className="px-6 pt-2 text-xs text-zinc-400">
                {queue.length - 1} more message{queue.length > 2 ? "s" : ""} pending after this.
              </p>
            )}

            {/* Cannot dismiss by clicking outside — only via this button */}
            <div className="flex flex-col gap-3 px-6 py-5">
              <button
                ref={ackBtnRef}
                onClick={() => handleAcknowledge(current.id)}
                className="w-full rounded-xl bg-zinc-900 px-4 py-3 font-semibold text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-black dark:hover:bg-zinc-300 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-zinc-700"
                data-cy="critical-ack-btn"
                aria-label="Acknowledge and close this critical message"
              >
                I understand
              </button>
              <p className="text-center text-xs text-zinc-400">
                This message cannot be dismissed without acknowledgement.
              </p>
            </div>
          </div>
        </div>
      )}
    </CriticalMessageContext.Provider>
  );
}
