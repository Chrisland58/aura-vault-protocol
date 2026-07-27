import { useState, useEffect, useRef } from "react";

function formatNumber(value: number, decimals?: number): string {
  if (decimals !== undefined) {
    return value.toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function useAnimatedNumber(
  value: number,
  options?: {
    duration?: number;   // default 600ms
    easing?: "ease-out"; // only option for now
    decimals?: number;   // number of decimal places to format to
  }
): string {
  const duration = options?.duration ?? 600;
  const decimals = options?.decimals;

  const prevValueRef = useRef<number>(value);
  const rafRef = useRef<number | null>(null);
  const [displayed, setDisplayed] = useState<string>(formatNumber(value, decimals));

  useEffect(() => {
    const from = prevValueRef.current;
    const to = value;

    // Skip animation if value hasn't changed
    if (from === to) return;

    prevValueRef.current = to;

    // Skip animation if user prefers reduced motion
    if (prefersReducedMotion()) {
      setDisplayed(formatNumber(to, decimals));
      return;
    }

    // Cancel any in-progress animation
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    const startTime = performance.now();

    function tick(now: number) {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1); // linear 0..1
      // Ease-out cubic: progress = 1 - (1 - t)^3
      const progress = 1 - Math.pow(1 - t, 3);
      const current = from + (to - from) * progress;

      setDisplayed(formatNumber(current, decimals));

      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
        // Ensure final value is exact
        setDisplayed(formatNumber(to, decimals));
      }
    }

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [value, duration, decimals]);

  return displayed;
}
