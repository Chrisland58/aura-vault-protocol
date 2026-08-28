"use client";

import { useState } from "react";

const NAV_LINKS = [
  { label: "Home", href: "/" },
  { label: "FAQ", href: "/faq" },
  { label: "Settings", href: "/settings" },
];

/**
 * Mobile-only header with hamburger menu.
 * Displayed on viewports below the `sm` (640px) Tailwind breakpoint.
 *
 * Key selectors used by Playwright tests:
 *   data-cy="mobile-menu-btn"   – hamburger / close toggle button
 *   data-cy="mobile-nav"        – the <nav> panel (hidden until open)
 *   data-cy="mobile-nav-link"   – individual nav links inside the panel
 */
export default function MobileNavHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header
      className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-800"
      data-cy="mobile-header"
    >
      <a href="/" className="text-sm font-semibold tracking-tight">
        Aura Vault
      </a>

      {/* Hamburger / Close button — minimum 44×44 px tap target */}
      <button
        data-cy="mobile-menu-btn"
        aria-label={open ? "Close navigation menu" : "Open navigation menu"}
        aria-expanded={open}
        aria-controls="mobile-nav-panel"
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center justify-center rounded-md p-2"
        style={{ minWidth: "44px", minHeight: "44px" }}
      >
        {open ? (
          /* X icon */
          <svg
            aria-hidden="true"
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <line x1="4" y1="4" x2="16" y2="16" />
            <line x1="16" y1="4" x2="4" y2="16" />
          </svg>
        ) : (
          /* Hamburger icon */
          <svg
            aria-hidden="true"
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <line x1="3" y1="5" x2="17" y2="5" />
            <line x1="3" y1="10" x2="17" y2="10" />
            <line x1="3" y1="15" x2="17" y2="15" />
          </svg>
        )}
      </button>

      {/* Slide-down nav panel */}
      {open && (
        <nav
          id="mobile-nav-panel"
          data-cy="mobile-nav"
          aria-label="Mobile navigation"
          className="absolute top-[52px] left-0 right-0 z-50 flex flex-col border-b border-zinc-200 bg-white shadow-md dark:border-zinc-700 dark:bg-zinc-900"
        >
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              data-cy="mobile-nav-link"
              onClick={() => setOpen(false)}
              className="px-5 py-4 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
              style={{ minHeight: "44px", display: "flex", alignItems: "center" }}
            >
              {link.label}
            </a>
          ))}
        </nav>
      )}
    </header>
  );
}
