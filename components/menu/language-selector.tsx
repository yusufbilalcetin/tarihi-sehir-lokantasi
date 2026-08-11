"use client";

import { Check, ChevronDown, Languages } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMenuPreferences } from "./menu-preferences-provider";
import type { MenuLanguage } from "@/lib/i18n/menu-translations";

const languageOptions: Array<{
  id: MenuLanguage;
  shortLabel: string;
  label: string;
}> = [
  { id: "tr", shortLabel: "TR", label: "Türkçe" },
  { id: "en", shortLabel: "EN", label: "English" },
  { id: "de", shortLabel: "DE", label: "Deutsch" },
  { id: "ar", shortLabel: "AR", label: "العربية" },
];

export function LanguageSelector() {
  const { direction, language, setLanguage, t } = useMenuPreferences();
  const selected = languageOptions.find((option) => option.id === language)!;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("languageLabel")}
        className="inline-flex h-10 min-w-0 items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/[0.07] px-2.5 text-xs font-bold text-[#FFFDF8] outline-none transition-colors hover:bg-white/[0.12] focus-visible:ring-2 focus-visible:ring-copper sm:px-3"
      >
        <Languages className="size-3.5 text-copper" aria-hidden="true" />
        <span className="sm:hidden">{selected.shortLabel}</span>
        <span className="hidden max-w-20 truncate sm:inline">{selected.label}</span>
        <ChevronDown className="size-3.5 opacity-70" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        dir={direction}
        className="min-w-44 rounded-xl p-1.5"
      >
        {languageOptions.map((option) => (
          <DropdownMenuItem
            key={option.id}
            onClick={() => setLanguage(option.id)}
            className="min-h-10 justify-between rounded-lg px-3 text-sm"
          >
            <span lang={option.id}>{option.label}</span>
            {language === option.id ? (
              <Check className="size-4 text-burgundy" aria-hidden="true" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
