"use client";

import { useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Globe2, Search, X } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { LanguageFlag } from "@/components/menu/language-flag";
import { useMenuPreferences } from "./menu-preferences-provider";
import {
  MENU_LANGUAGES,
  searchMenuLanguages,
  type MenuLanguageDefinition,
} from "@/lib/i18n/languages";
import { cn } from "@/lib/utils";

function LanguageRow({
  definition,
  selected,
  disabled,
  onSelect,
}: {
  definition: MenuLanguageDefinition;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const secondaryName = definition.turkishName === definition.nativeName
    ? definition.englishName
    : definition.turkishName;

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        "motion-press motion-ripple group flex min-h-14 w-full items-center gap-3 rounded-xl px-3 py-2 text-start outline-none hover:bg-[#EFE4D4] focus-visible:ring-2 focus-visible:ring-burgundy focus-visible:ring-offset-2",
        selected && "bg-[#E9DDCA]",
        disabled && "cursor-wait opacity-65",
      )}
    >
      <LanguageFlag language={definition} />
      <span className="min-w-0 flex-1">
        <span
          lang={definition.locale}
          dir={definition.direction}
          className="block truncate text-left text-[15px] font-bold text-[#292D25] [font-family:system-ui,-apple-system,'Segoe_UI','Noto_Sans',Arial,sans-serif]"
        >
          {definition.nativeName}
        </span>
        <span className="mt-0.5 block truncate text-xs text-[#70665C]">{secondaryName}</span>
      </span>
      {selected ? <Check className="size-5 shrink-0 text-burgundy" aria-hidden="true" /> : null}
    </button>
  );
}

function LanguageSection({
  title,
  languages,
  selectedLanguage,
  disabled,
  onSelect,
}: {
  title: string;
  languages: readonly MenuLanguageDefinition[];
  selectedLanguage: string;
  disabled: boolean;
  onSelect: (language: MenuLanguageDefinition) => void;
}) {
  if (languages.length === 0) return null;
  return (
    <section aria-labelledby={`language-section-${title.replaceAll(" ", "-")}`} className="space-y-1.5">
      <h3 id={`language-section-${title.replaceAll(" ", "-")}`} className="px-3 pt-3 text-center text-xs font-extrabold uppercase tracking-[0.12em] text-burgundy">
        {title}
      </h3>
      <div className="grid grid-cols-1 gap-0.5 sm:grid-cols-2">
        {languages.map((definition) => (
          <LanguageRow
            key={definition.code}
            definition={definition}
            selected={definition.code === selectedLanguage}
            disabled={disabled}
            onSelect={() => onSelect(definition)}
          />
        ))}
      </div>
    </section>
  );
}

export function LanguageSelector() {
  const { direction, language, languageDefinition, languageLoading, setLanguage, t } = useMenuPreferences();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [loadError, setLoadError] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchResults = useMemo(() => searchMenuLanguages(query), [query]);

  async function selectLanguage(definition: MenuLanguageDefinition) {
    setLoadError(false);
    const changed = await setLanguage(definition.code);
    if (changed) {
      setOpen(false);
      setQuery("");
    } else {
      setLoadError(true);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      setOpen(nextOpen);
      if (!nextOpen) setQuery("");
    }}>
      <DialogTrigger
        aria-label={t("languageLabel")}
        className="motion-press motion-ripple motion-hover inline-flex h-10 min-w-0 items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/[0.07] px-2.5 text-xs font-bold text-[#FFFDF8] outline-none hover:bg-white/[0.12] focus-visible:ring-2 focus-visible:ring-copper sm:px-3"
      >
        <Globe2 className="size-3.5 text-copper" aria-hidden="true" />
        <LanguageFlag language={languageDefinition} size="sm" />
        <span className="sm:hidden">{languageDefinition.code.split("-")[0]?.toUpperCase()}</span>
        <span className="hidden max-w-24 truncate sm:inline">{languageDefinition.nativeName}</span>
        <ChevronDown className="size-3.5 opacity-70" aria-hidden="true" />
      </DialogTrigger>
      <DialogContent
        dir={direction}
        showCloseButton={false}
        initialFocus={searchInputRef}
        className="flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-[600px] flex-col gap-0 overflow-hidden rounded-[24px] border border-[#D8C7AF] bg-[#F8F0E4] p-0 text-[#292D25] shadow-[0_24px_70px_rgba(24,30,23,0.24)] sm:max-h-[82dvh] sm:max-w-[600px]"
      >
        <DialogHeader className="relative items-center gap-1 px-14 pb-4 pt-5 text-center sm:px-16 sm:pt-6">
          <DialogTitle className="font-heading text-2xl font-semibold text-[#292D25]">{t("languagePickerTitle")}</DialogTitle>
          <DialogDescription className="mx-auto max-w-md text-sm leading-5 text-[#70665C]">{t("languagePickerDescription")}</DialogDescription>
          <DialogClose
            aria-label={t("close")}
            className="absolute end-4 top-4 inline-flex size-10 items-center justify-center rounded-full text-[#5E584F] outline-none transition-colors hover:bg-[#E9DDCA] focus-visible:ring-2 focus-visible:ring-burgundy"
          >
            <X className="size-5" aria-hidden="true" />
          </DialogClose>
        </DialogHeader>

        <div className="sticky top-0 z-10 border-y border-[#DFD1BD] bg-[#F8F0E4]/96 px-5 py-3 backdrop-blur-sm sm:px-6">
          <label className="relative block">
            <span className="sr-only">{t("searchLanguage")}</span>
            <Search className="pointer-events-none absolute start-3.5 top-1/2 size-5 -translate-y-1/2 text-burgundy" aria-hidden="true" />
            <input
              ref={searchInputRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("searchLanguage")}
              autoComplete="off"
              className="h-12 w-full rounded-2xl border border-[#CDBDA7] bg-[#FFFDF8] ps-11 pe-11 text-base text-[#292D25] outline-none placeholder:text-[#776D62] focus:border-burgundy focus:ring-2 focus:ring-burgundy/20"
            />
            {query ? (
              <button type="button" onClick={() => setQuery("")} aria-label={t("clearSearch")} className="absolute end-2 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-[#70665C] hover:bg-[#EFE4D4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-burgundy">
                <X className="size-4" aria-hidden="true" />
              </button>
            ) : null}
          </label>
        </div>

        <p className="sr-only" aria-live="polite">{query ? `${searchResults.length} ${t("items")}` : ""}</p>
        {languageLoading ? <p className="px-6 py-2 text-sm font-semibold text-burgundy" role="status">{t("loadingLanguage")}</p> : null}
        {loadError ? <p className="motion-error px-6 py-2 text-sm font-semibold text-destructive" role="alert">{t("languageLoadError")}</p> : null}
        <div className="menu-dialog-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-5 pt-1 sm:px-4">
          {query ? (
            searchResults.length > 0 ? (
              <LanguageSection title={t("allLanguages")} languages={searchResults} selectedLanguage={language} disabled={languageLoading} onSelect={selectLanguage} />
            ) : (
              <div className="px-6 py-14 text-center">
                <Globe2 className="mx-auto size-8 text-burgundy" aria-hidden="true" />
                <p className="mt-3 font-bold">{t("languageNotFound")}</p>
                <p className="mt-1 text-sm text-[#70665C]">{t("languageNotFoundDescription")}</p>
              </div>
            )
          ) : (
            <LanguageSection title={t("allLanguages")} languages={MENU_LANGUAGES} selectedLanguage={language} disabled={languageLoading} onSelect={selectLanguage} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
