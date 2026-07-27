"use client";

/**
 * AnimatedShareBalance (#478)
 *
 * Wraps any numeric share balance value and:
 *   - Triggers a CSS count-up highlight animation when the value increases
 *   - Triggers a green/red flash on price change (up / down)
 *
 * All animations are CSS-transform-based and respect prefers-reduced-motion
 * via the global `@media (prefers-reduced-motion: reduce)` rule in globals.css.
 */

import { useEffect, useRef, useState } from "react";

type FlashDir = "up" | "down" | "none";

interface AnimatedShareBalanceProps {
  /** Formatted balance string to display, e.g. "123.45" */
  value: string;
  /** Optional className forwarded to the root span */
  className?: string;
  /** If true, only flashes on price-change direction (used on price cells) */
  priceMode?: boolean;
}

/**
 * Parse a numeric string safely, returning 0 if unparseable.
 */
function toNum(s: string): number {
  const n = parseFloat(s.replace(/[^0-9.-]/g, ""));
  return isNaN(n) ? 0 : n;
}

export function AnimatedShareBalance({
  value,
  className = "",
  priceMode = false,
}: AnimatedShareBalanceProps) {
  const prevRef = useRef<string>(value);
  const [animKey, setAnimKey] = useState(0);
  const [flashDir, setFlashDir] = useState<FlashDir>("none");
  const [isCountUp, setIsCountUp] = useState(false);

  useEffect(() => {
    const prev = prevRef.current;
    if (prev === value) return;

    const prevNum = toNum(prev);
    const nextNum = toNum(value);
    const delta = nextNum - prevNum;

    if (!priceMode && delta > 0) {
      // Balance increased — trigger count-up highlight
      setIsCountUp(true);
      setFlashDir("none");
    } else if (delta > 0) {
      setFlashDir("up");
      setIsCountUp(false);
    } else if (delta < 0) {
      setFlashDir("down");
      setIsCountUp(false);
    } else {
      setFlashDir("none");
      setIsCountUp(false);
    }

    // Bump key so animation class re-applies even on repeated changes
    setAnimKey((k) => k + 1);
    prevRef.current = value;

    // Clear flash state after animation completes
    const t = setTimeout(() => {
      setFlashDir("none");
      setIsCountUp(false);
    }, 900);
    return () => clearTimeout(t);
  }, [value, priceMode]);

  const animClass =
    isCountUp
      ? "animate-count-up"
      : flashDir === "up"
      ? "animate-price-flash-up rounded-sm px-0.5"
      : flashDir === "down"
      ? "animate-price-flash-down rounded-sm px-0.5"
      : "";

  return (
    <span
      key={animKey}
      className={["inline-block transition-colors", animClass, className]
        .filter(Boolean)
        .join(" ")}
      aria-live="polite"
      aria-atomic="true"
    >
      {value}
    </span>
  );
}

export default AnimatedShareBalance;
