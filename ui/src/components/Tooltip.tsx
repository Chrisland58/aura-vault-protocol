import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useId,
  type ReactNode,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";

/* ── Types ──────────────────────────────────────────────────────── */

export interface TooltipDefinition {
  /** Plain-language explanation (1-2 sentences). */
  content: string;
  /** Optional docs URL for "Learn more" link. */
  docsUrl?: string;
}

export interface TooltipProps {
  /** The tooltip definition with content and optional docs link. */
  definition: TooltipDefinition;
  /** Accessible label for the trigger button (defaults to "What is this?"). */
  label?: string;
  children?: ReactNode;
}

/* ── Glossary ───────────────────────────────────────────────────── */

export const GLOSSARY: Record<string, TooltipDefinition> = {
  "Share Price": {
    content:
      "The current value of one vault share in underlying tokens, calculated as total assets divided by total shares. It rises as yield is harvested.",
    docsUrl: "https://docs.aura.finance/concepts#share-price",
  },
  APY: {
    content:
      "Annual Percentage Yield — the projected yearly return on your deposit, accounting for auto-compounding of harvested yield.",
    docsUrl: "https://docs.aura.finance/concepts#apy",
  },
  TVL: {
    content:
      "Total Value Locked — the total amount of underlying tokens currently deposited across all users in this vault.",
    docsUrl: "https://docs.aura.finance/concepts#tvl",
  },
  "Vault Shares": {
    content:
      "Tokens representing your proportional ownership of the vault. Redeeming shares returns your deposit plus any accrued yield.",
    docsUrl: "https://docs.aura.finance/concepts#vault-shares",
  },
  Harvest: {
    content:
      "The act of injecting yield tokens into the vault, which raises the share price for all depositors without minting new shares.",
    docsUrl: "https://docs.aura.finance/concepts#harvest",
  },
  Keeper: {
    content:
      "Any account (person or bot) that calls the harvest function to inject yield. Keepers are permissionless — anyone can trigger a harvest.",
    docsUrl: "https://docs.aura.finance/concepts#keeper",
  },
};

/* ── Tooltip component ──────────────────────────────────────────── */

/**
 * Tooltip — renders a '?' trigger button that shows a floating popover on
 * hover (desktop) or tap (mobile). Keyboard-accessible: focusable, Escape
 * closes, click outside closes.
 *
 * The popover is portaled to document.body so it never clips inside overflow-
 * hidden containers.
 */
export function Tooltip({ definition, label = "What is this?", children }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const tooltipId = useId();

  const position = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const popoverW = 260;
    const gap = 8;

    // Default: place above the trigger, centred
    let left = rect.left + rect.width / 2 - popoverW / 2 + window.scrollX;
    let top = rect.top - gap + window.scrollY;

    // Clamp to viewport
    const maxLeft = window.innerWidth - popoverW - 8;
    left = Math.max(8, Math.min(left, maxLeft));

    setCoords({ top, left });
  }, []);

  const show = useCallback(() => {
    position();
    setOpen(true);
  }, [position]);

  const hide = useCallback(() => setOpen(false), []);

  /* Close on Escape */
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === "Escape") {
        hide();
        triggerRef.current?.focus();
      }
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open ? hide() : show();
      }
    },
    [open, show, hide]
  );

  /* Close on outside click */
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        hide();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, hide]);

  /* Reposition on scroll/resize */
  useEffect(() => {
    if (!open) return;
    const update = () => position();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update, { passive: true });
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [open, position]);

  return (
    <span className="tooltip-wrap">
      {children}
      <button
        ref={triggerRef}
        type="button"
        className="tooltip-trigger"
        aria-label={label}
        aria-describedby={open ? tooltipId : undefined}
        aria-expanded={open}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={(e) => {
          /* Only hide if focus leaves the entire tooltip+popover */
          if (!popoverRef.current?.contains(e.relatedTarget as Node)) {
            hide();
          }
        }}
        onClick={() => (open ? hide() : show())}
        onKeyDown={handleKeyDown}
      >
        ?
      </button>

      {open &&
        createPortal(
          <div
            id={tooltipId}
            ref={popoverRef}
            role="tooltip"
            className="tooltip-popover"
            style={{
              position: "absolute",
              top: coords.top,
              left: coords.left,
              zIndex: "var(--z-tooltip)" as unknown as number,
              transform: "translateY(-100%)",
            }}
            /* Keep open while hovering the popover itself */
            onMouseEnter={show}
            onMouseLeave={hide}
          >
            <p className="tooltip-popover__content">{definition.content}</p>
            {definition.docsUrl && (
              <a
                href={definition.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="tooltip-popover__link"
              >
                Learn more ↗
              </a>
            )}
          </div>,
          document.body
        )}
    </span>
  );
}

/* ── TermTooltip convenience wrapper ────────────────────────────── */

/**
 * Renders a technical term label with an inline '?' tooltip icon
 * sourced from the shared GLOSSARY.
 *
 * ```tsx
 * <TermTooltip term="APY" />      // renders "APY ?"
 * <TermTooltip term="APY">7.4%</TermTooltip>  // renders "APY ? 7.4%"
 * ```
 */
export interface TermTooltipProps {
  term: keyof typeof GLOSSARY;
  children?: ReactNode;
}

export function TermTooltip({ term, children }: TermTooltipProps) {
  const def = GLOSSARY[term];
  return (
    <span className="term-tooltip">
      <span className="term-tooltip__label">{term}</span>
      <Tooltip definition={def} label={`What is ${term}?`} />
      {children && <span className="term-tooltip__value">{children}</span>}
    </span>
  );
}
