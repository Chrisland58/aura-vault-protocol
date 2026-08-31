/**
 * useWidgetLayout — persists dashboard widget order and visibility to localStorage.
 *
 * Issue #498: configurable dashboard widget layout with drag-and-drop.
 *
 * Provides:
 *  - `widgets`       — ordered array of widget descriptors (id + visible flag)
 *  - `setOrder`      — reorder widgets (called after a dnd-kit drag ends)
 *  - `toggleWidget`  — show/hide a widget by id
 *  - `resetLayout`   — restore the default order and visibility
 */

"use client";

import { useState, useEffect, useCallback } from "react";

// ─── Widget definitions ────────────────────────────────────────────────────────

export type WidgetId =
  | "hero"
  | "apy"
  | "depositors"
  | "last-harvest"
  | "user-position";

export interface WidgetDescriptor {
  id: WidgetId;
  /** Human-readable label shown in the settings visibility toggles */
  label: string;
  /** Whether the widget is currently shown on the dashboard */
  visible: boolean;
}

/** Canonical default layout — order and visibility */
export const DEFAULT_WIDGETS: WidgetDescriptor[] = [
  { id: "hero",          label: "TVL & Share Price",  visible: true },
  { id: "apy",           label: "7-Day APY",          visible: true },
  { id: "depositors",    label: "Depositor Count",    visible: true },
  { id: "last-harvest",  label: "Last Harvest",       visible: true },
  { id: "user-position", label: "Your Position",      visible: true },
];

const STORAGE_KEY = "aura_dashboard_layout";

// ─── Storage helpers ───────────────────────────────────────────────────────────

function loadLayout(): WidgetDescriptor[] {
  if (typeof window === "undefined") return DEFAULT_WIDGETS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_WIDGETS;
    const stored: { id: WidgetId; visible: boolean }[] = JSON.parse(raw);

    // Merge stored order/visibility with defaults to handle newly added widgets
    const storedIds = stored.map((w) => w.id);
    const merged: WidgetDescriptor[] = [
      // Restore stored order + visibility for known widgets
      ...stored
        .map((s) => {
          const def = DEFAULT_WIDGETS.find((d) => d.id === s.id);
          return def ? { ...def, visible: s.visible } : null;
        })
        .filter((w): w is WidgetDescriptor => w !== null),
      // Append any new widgets that weren't in storage yet
      ...DEFAULT_WIDGETS.filter((d) => !storedIds.includes(d.id)),
    ];
    return merged;
  } catch {
    return DEFAULT_WIDGETS;
  }
}

function saveLayout(widgets: WidgetDescriptor[]): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(widgets.map(({ id, visible }) => ({ id, visible })))
    );
  } catch {
    // localStorage may be unavailable in private browsing — fail silently
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface UseWidgetLayoutReturn {
  widgets: WidgetDescriptor[];
  /** Replace the full ordered array (called from dnd-kit's onDragEnd) */
  setOrder: (next: WidgetDescriptor[]) => void;
  /** Toggle a single widget's visibility by id */
  toggleWidget: (id: WidgetId) => void;
  /** Restore the default layout and clear localStorage */
  resetLayout: () => void;
}

export function useWidgetLayout(): UseWidgetLayoutReturn {
  const [widgets, setWidgets] = useState<WidgetDescriptor[]>(DEFAULT_WIDGETS);

  // Hydrate from localStorage on mount (client-only)
  useEffect(() => {
    setWidgets(loadLayout());
  }, []);

  const setOrder = useCallback((next: WidgetDescriptor[]) => {
    setWidgets(next);
    saveLayout(next);
  }, []);

  const toggleWidget = useCallback((id: WidgetId) => {
    setWidgets((prev) => {
      const next = prev.map((w) =>
        w.id === id ? { ...w, visible: !w.visible } : w
      );
      saveLayout(next);
      return next;
    });
  }, []);

  const resetLayout = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    setWidgets(DEFAULT_WIDGETS);
  }, []);

  return { widgets, setOrder, toggleWidget, resetLayout };
}
