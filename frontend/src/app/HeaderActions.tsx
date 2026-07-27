"use client";

import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { KeyboardShortcutsHelp } from "@/components/KeyboardShortcutsHelp";

export default function HeaderActions() {
  return (
    <div className="flex items-center gap-2">
      <nav className="flex gap-4 text-sm mr-2">
        <a
          href="/faq"
          className="text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
        >
          FAQ
        </a>
        <a
          href="/settings"
          className="text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
        >
          Settings
        </a>
      </nav>
      <KeyboardShortcutsHelp />
      <LanguageSwitcher />
      <ThemeToggle />
    </div>
  );
}
