"use client";

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type KeyboardEvent,
} from "react";
import { X, Search, Keyboard } from "lucide-react";

// ─── Shortcut data ────────────────────────────────────────────────────────────

interface Shortcut {
  keys: string[];
  description: string;
}

interface ShortcutCategory {
  label: string;
  shortcuts: Shortcut[];
}

const SHORTCUT_CATEGORIES: ShortcutCategory[] = [
  {
    label: "Navigation",
    shortcuts: [
      { keys: ["g", "h"], description: "Go to Home" },
      { keys: ["g", "d"], description: "Go to Dashboard" },
      { keys: ["g", "f"], description: "Go to FAQ" },
      { keys: ["g", "s"], description: "Go to Settings" },
      { keys: ["Alt", "←"], description: "Go back" },
      { keys: ["Alt", "→"], description: "Go forward" },
    ],
  },
  {
    label: "Actions",
    shortcuts: [
      { keys: ["d"], description: "Open Deposit modal" },
      { keys: ["w"], description: "Open Withdraw modal" },
      { keys: ["r"], description: "Refresh vault stats" },
      { keys: ["c"], description: "Connect / disconnect wallet" },
      { keys: ["t"], description: "Toggle dark / light theme" },
      { keys: ["p"], description: "Print this help card" },
    ],
  },
  {
    label: "Modals",
    shortcuts: [
      { keys: ["Esc"], description: "Close active modal or panel" },
      { keys: ["Enter"], description: "Confirm / proceed to next step" },
      { keys: ["Backspace"], description: "Go back one step" },
      { keys: ["Tab"], description: "Move focus to next field" },
      { keys: ["Shift", "Tab"], description: "Move focus to previous field" },
    ],
  },
  {
    label: "Help",
    shortcuts: [
      { keys: ["?"], description: "Open this keyboard shortcuts help" },
      { keys: ["Shift", "/"], description: "Open this keyboard shortcuts help" },
    ],
  },
];

// ─── Key badge component ──────────────────────────────────────────────────────

function KeyBadge({ children }: { children: string }) {
  return (
    <kbd className="inline-flex items-center rounded border border-zinc-300 bg-zinc-100 px-1.5 py-0.5 font-mono text-xs font-medium text-zinc-700 shadow-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
      {children}
    </kbd>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function KeyboardShortcutsHelp() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // ── Open / close ────────────────────────────────────────────────────────────

  const openHelp = useCallback(() => {
    setOpen(true);
    setQuery("");
  }, []);

  const closeHelp = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  // ── Global keyboard listener for "?" ────────────────────────────────────────

  useEffect(() => {
    function handleGlobalKey(e: globalThis.KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      const isEditable =
        tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

      if (isEditable) return;

      if (e.key === "?" || (e.key === "/" && e.shiftKey)) {
        e.preventDefault();
        openHelp();
      }

      if (e.key === "Escape" && open) {
        e.preventDefault();
        closeHelp();
      }
    }

    window.addEventListener("keydown", handleGlobalKey);
    return () => window.removeEventListener("keydown", handleGlobalKey);
  }, [open, openHelp, closeHelp]);

  // ── Focus management & focus trap ──────────────────────────────────────────

  useEffect(() => {
    if (open) {
      // Small delay to let the DOM settle
      const t = setTimeout(() => searchRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open]);

  function handleDialogKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      closeHelp();
      return;
    }

    if (e.key === "Tab") {
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button, input, a, [tabindex]:not([tabindex="-1"])'
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

  // ── Print handler ────────────────────────────────────────────────────────────

  function handlePrint() {
    window.print();
  }

  // ── Filtered categories ──────────────────────────────────────────────────────

  const filteredCategories = SHORTCUT_CATEGORIES.map((cat) => ({
    ...cat,
    shortcuts: cat.shortcuts.filter(
      (s) =>
        query === "" ||
        s.description.toLowerCase().includes(query.toLowerCase()) ||
        s.keys.some((k) => k.toLowerCase().includes(query.toLowerCase()))
    ),
  })).filter((cat) => cat.shortcuts.length > 0);

  return (
    <>
      {/* ── Header trigger button ── */}
      <button
        onClick={openHelp}
        aria-label="Open keyboard shortcuts help"
        title="Keyboard shortcuts (?)"
        className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 transition-colors"
        data-cy="shortcuts-trigger"
      >
        <Keyboard size={16} aria-hidden="true" />
        <span className="hidden sm:inline text-xs font-medium">Shortcuts</span>
        <KeyBadge>?</KeyBadge>
      </button>

      {/* ── Modal overlay ── */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 print:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Keyboard shortcuts reference"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeHelp();
          }}
          data-cy="shortcuts-dialog"
        >
          <div
            ref={dialogRef}
            onKeyDown={handleDialogKeyDown}
            className="relative w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl bg-white shadow-2xl dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100 dark:border-zinc-800">
              <div className="flex items-center gap-2">
                <Keyboard size={18} className="text-zinc-500" aria-hidden="true" />
                <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
                  Keyboard Shortcuts
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handlePrint}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors print:hidden"
                  aria-label="Print shortcuts reference"
                  data-cy="shortcuts-print"
                >
                  Print
                </button>
                <button
                  ref={closeRef}
                  onClick={closeHelp}
                  aria-label="Close keyboard shortcuts"
                  className="rounded-lg p-1.5 text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 dark:hover:text-zinc-200 transition-colors"
                  data-cy="shortcuts-close"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Search */}
            <div className="px-5 py-3 border-b border-zinc-100 dark:border-zinc-800">
              <div className="relative">
                <Search
                  size={15}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"
                  aria-hidden="true"
                />
                <input
                  ref={searchRef}
                  type="search"
                  placeholder="Search shortcuts…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="w-full rounded-lg border border-zinc-200 bg-zinc-50 pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
                  aria-label="Search shortcuts"
                  data-cy="shortcuts-search"
                />
              </div>
            </div>

            {/* Shortcuts table — scrollable */}
            <div
              className="overflow-y-auto flex-1 p-5"
              role="region"
              aria-label="Shortcuts list"
            >
              {filteredCategories.length === 0 ? (
                <p className="text-center text-sm text-zinc-400 py-8">
                  No shortcuts match &ldquo;{query}&rdquo;
                </p>
              ) : (
                <div className="flex flex-col gap-6">
                  {filteredCategories.map((cat) => (
                    <section key={cat.label} aria-labelledby={`cat-${cat.label}`}>
                      <h3
                        id={`cat-${cat.label}`}
                        className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500"
                      >
                        {cat.label}
                      </h3>
                      <table className="w-full text-sm">
                        <thead className="sr-only">
                          <tr>
                            <th>Keys</th>
                            <th>Description</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-50 dark:divide-zinc-800">
                          {cat.shortcuts.map((s) => (
                            <tr
                              key={s.description}
                              className="group"
                              data-cy={`shortcut-row-${s.description.replace(/\s+/g, "-").toLowerCase()}`}
                            >
                              <td className="py-2 pr-6 whitespace-nowrap w-36">
                                <span className="flex flex-wrap items-center gap-1">
                                  {s.keys.map((k, i) => (
                                    <span key={i} className="flex items-center gap-1">
                                      <KeyBadge>{k}</KeyBadge>
                                      {i < s.keys.length - 1 && (
                                        <span className="text-zinc-400 text-xs">+</span>
                                      )}
                                    </span>
                                  ))}
                                </span>
                              </td>
                              <td className="py-2 text-zinc-700 dark:text-zinc-300">
                                {s.description}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </section>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between print:hidden">
              <p className="text-xs text-zinc-400">
                Press <KeyBadge>?</KeyBadge> to toggle this panel
              </p>
              <p className="text-xs text-zinc-400">
                Press <KeyBadge>Esc</KeyBadge> to close
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Print-only full card (visible only when window.print() is called) ── */}
      <div className="hidden print:block">
        <h1 className="text-xl font-bold mb-4">Aura Vault — Keyboard Shortcuts</h1>
        {SHORTCUT_CATEGORIES.map((cat) => (
          <section key={cat.label} className="mb-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide mb-2 border-b pb-1">
              {cat.label}
            </h2>
            <table className="w-full text-sm">
              <tbody>
                {cat.shortcuts.map((s) => (
                  <tr key={s.description} className="border-b border-gray-200">
                    <td className="py-1.5 pr-8 font-mono font-medium w-32">
                      {s.keys.join(" + ")}
                    </td>
                    <td className="py-1.5">{s.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </>
  );
}
