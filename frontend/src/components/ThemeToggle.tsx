"use client";

import { Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useTheme } from "./ThemeProvider";
import "@/lib/i18n";

export function ThemeToggle() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();

  return (
    <div className="flex gap-1 rounded-lg border border-zinc-200 dark:border-zinc-700 p-1 bg-white dark:bg-zinc-900">
      <button
        onClick={() => setTheme("light")}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
          theme === "light"
            ? "bg-zinc-100 dark:bg-zinc-800"
            : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
        }`}
        aria-label={t("theme.light")}
      >
        <Sun size={14} />
        {t("theme.light")}
      </button>
      <button
        onClick={() => setTheme("dark")}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
          theme === "dark"
            ? "bg-zinc-100 dark:bg-zinc-800"
            : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
        }`}
        aria-label={t("theme.dark")}
      >
        <Moon size={14} />
        {t("theme.dark")}
      </button>
      <button
        onClick={() => setTheme("system")}
        className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
          theme === "system"
            ? "bg-zinc-100 dark:bg-zinc-800"
            : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
        }`}
        aria-label={t("theme.auto")}
      >
        {t("theme.auto")}
      </button>
    </div>
  );
}
