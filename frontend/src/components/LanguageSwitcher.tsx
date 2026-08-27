"use client";

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import "@/lib/i18n";
import { SUPPORTED_LANGS, RTL_LANGS } from "@/lib/i18n";

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const current = i18n.language?.slice(0, 2) ?? "en";

  useEffect(() => {
    const dir = RTL_LANGS.has(current) ? "rtl" : "ltr";
    document.documentElement.setAttribute("lang", current);
    document.documentElement.setAttribute("dir", dir);
  }, [current]);

  return (
    <div className="flex items-center gap-1" role="navigation" aria-label="Language switcher">
      {SUPPORTED_LANGS.map(({ code, label, flag }) => (
        <button
          key={code}
          onClick={() => i18n.changeLanguage(code)}
          title={label}
          aria-label={label}
          aria-pressed={current === code}
          className={`px-2 py-1 rounded-md text-sm transition-colors ${
            current === code
              ? "bg-zinc-100 dark:bg-zinc-800 font-medium"
              : "hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500"
          }`}
        >
          {flag}
        </button>
      ))}
    </div>
  );
}
