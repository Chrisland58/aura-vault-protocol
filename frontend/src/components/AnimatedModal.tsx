"use client";

/**
 * AnimatedModal (#478)
 *
 * Modal with:
 *   - Slide-up + scale-in on open  (animate-modal-slide-up)
 *   - Fade-out + slide-down on close (animate-modal-fade-out)
 *   - Backdrop fade-in / fade-out
 *   - All animations use CSS transforms only (no layout thrashing)
 *   - Respects prefers-reduced-motion via global CSS rule
 */

import { type ReactNode, useEffect, useState } from "react";

interface AnimatedModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

export function AnimatedModal({
  isOpen,
  onClose,
  title,
  children,
}: AnimatedModalProps) {
  /**
   * `visible` controls whether the DOM node exists.
   * `closing` triggers the exit animation before removal.
   */
  const [visible, setVisible] = useState(isOpen);
  const [closing, setClosing] = useState(false);

  // Sync open → visible
  useEffect(() => {
    if (isOpen) {
      setClosing(false);
      setVisible(true);
    } else if (visible) {
      // Start exit animation, then unmount after it finishes
      setClosing(true);
      const t = setTimeout(() => {
        setVisible(false);
        setClosing(false);
      }, 230); // matches animate-modal-fade-out duration (220ms) + buffer
      return () => clearTimeout(t);
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Body scroll lock
  useEffect(() => {
    document.body.style.overflow = isOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [isOpen]);

  // Keyboard escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  if (!visible) return null;

  return (
    <div
      className={[
        "fixed inset-0 z-40 bg-black/50 dark:bg-black/60 backdrop-blur-sm",
        closing ? "animate-modal-backdrop-out" : "animate-modal-backdrop",
      ].join(" ")}
      aria-hidden="true"
      onClick={onClose}
    >
      <div
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="animated-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={[
            "bg-white dark:bg-zinc-900 rounded-xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto",
            // Enter: slide up from below; Exit: fade + slide down
            closing ? "animate-modal-fade-out" : "animate-modal-slide-up",
          ].join(" ")}
        >
          {/* Header */}
          <div className="sticky top-0 flex items-center justify-between p-6 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 rounded-t-xl">
            <h2 id="animated-modal-title" className="text-lg font-semibold">
              {title}
            </h2>
            <button
              onClick={onClose}
              className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
              aria-label="Close modal"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {/* Body */}
          <div className="p-6">{children}</div>
        </div>
      </div>
    </div>
  );
}

export default AnimatedModal;
