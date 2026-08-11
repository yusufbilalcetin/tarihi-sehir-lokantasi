"use client";

import { useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { MenuCurrency } from "@/lib/i18n/menu-translations";
import { cn } from "@/lib/utils";
import { useMenuPreferences } from "./menu-preferences-provider";

const currencyOptions: Array<{
  id: MenuCurrency;
  symbol: string;
  name: string;
}> = [
  { id: "TRY", symbol: "₺", name: "Türk Lirası" },
  { id: "USD", symbol: "$", name: "Amerikan Doları" },
  { id: "EUR", symbol: "€", name: "Euro" },
];

function CurrencyThumbnail({ id, symbol }: { id: MenuCurrency; symbol: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative flex h-9 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border shadow-sm",
        id === "TRY" && "border-[#B98A87] bg-[#F0D9D1] text-[#7A2029]",
        id === "USD" && "border-[#9CAE91] bg-[#DCE7D4] text-[#35563D]",
        id === "EUR" && "border-[#9EADC5] bg-[#DCE4F0] text-[#243F70]",
      )}
    >
      <span className="absolute inset-1 rounded-[5px] border border-current/25" />
      <span className="absolute start-1.5 size-2 rounded-full border border-current/25" />
      <span className="absolute end-1.5 size-2 rounded-full border border-current/25" />
      <span className="relative text-sm font-black tracking-tight">
        {id === "TRY" ? symbol : `${symbol}1`}
      </span>
    </span>
  );
}

export function CurrencySelector({ variant = "header" }: { variant?: "header" | "surface" }) {
  const { currency, direction, setCurrency, t } = useMenuPreferences();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const selected = currencyOptions.find((option) => option.id === currency)!;
  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("tr-TR");
    if (!normalizedQuery) return currencyOptions;

    return currencyOptions.filter((option) =>
      `${option.symbol} ${option.id} ${option.name}`
        .toLocaleLowerCase("tr-TR")
        .includes(normalizedQuery),
    );
  }, [query]);

  function selectCurrency(nextCurrency: MenuCurrency) {
    setCurrency(nextCurrency);
    setOpen(false);
    setQuery("");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setQuery("");
      }}
    >
      <DialogTrigger
        aria-label={t("currencyLabel")}
        className={cn(
          "inline-flex h-10 min-w-0 items-center justify-center gap-1.5 rounded-xl px-3 text-xs font-bold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-copper",
          variant === "header"
            ? "border border-white/15 bg-white/[0.07] text-[#FFFDF8] hover:bg-white/[0.12]"
            : "min-w-28 border border-[#DCCBB7] bg-[#FFFDF8] text-foreground shadow-sm hover:border-copper/70 hover:bg-[#F9F1E6]",
        )}
      >
        <span className="text-copper" aria-hidden="true">{selected.symbol}</span>
        <span>{selected.id}</span>
        <ChevronDown className="size-3.5 opacity-70" aria-hidden="true" />
      </DialogTrigger>

      <DialogContent
        dir={direction}
        showCloseButton={false}
        initialFocus={searchInputRef}
        className="flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-[32rem] flex-col gap-0 overflow-hidden rounded-[24px] border border-[#D8C7AF] bg-[#F8F0E4] p-0 text-[#292D25] shadow-[0_24px_70px_rgba(24,30,23,0.24)] sm:max-h-[82dvh] sm:max-w-[32rem]"
      >
        <DialogHeader className="relative items-center gap-1 px-14 pb-4 pt-5 text-center sm:px-16 sm:pt-6">
          <DialogTitle className="font-heading text-2xl font-semibold text-[#292D25]">
            Döviz Seç
          </DialogTitle>
          <DialogDescription className="mx-auto max-w-sm text-sm leading-5 text-[#70665C]">
            Fiyatları görüntülemek istediğiniz para birimini seçin.
          </DialogDescription>
          <DialogClose
            aria-label={t("close")}
            className="absolute end-4 top-4 inline-flex size-10 items-center justify-center rounded-full text-[#5E584F] outline-none transition-colors hover:bg-[#E9DDCA] focus-visible:ring-2 focus-visible:ring-burgundy"
          >
            <X className="size-5" aria-hidden="true" />
          </DialogClose>
        </DialogHeader>

        <div className="border-y border-[#DFD1BD] bg-[#F8F0E4]/96 px-5 py-3 backdrop-blur-sm sm:px-6">
          <label className="relative block">
            <span className="sr-only">Döviz ara</span>
            <Search
              className="pointer-events-none absolute start-3.5 top-1/2 size-5 -translate-y-1/2 text-burgundy"
              aria-hidden="true"
            />
            <input
              ref={searchInputRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Döviz ara..."
              autoComplete="off"
              className="h-12 w-full rounded-2xl border border-[#CDBDA7] bg-[#FFFDF8] ps-11 pe-11 text-base text-[#292D25] outline-none placeholder:text-[#776D62] focus:border-burgundy focus:ring-2 focus:ring-burgundy/20"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label={t("clearSearch")}
                className="absolute end-2 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-[#70665C] outline-none transition-colors hover:bg-[#EFE4D4] focus-visible:ring-2 focus-visible:ring-burgundy"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            ) : null}
          </label>
        </div>

        <p className="sr-only" aria-live="polite">
          {query ? `${filteredOptions.length} döviz bulundu` : ""}
        </p>
        <div className="menu-dialog-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5">
          {filteredOptions.length > 0 ? (
            <div className="grid gap-2" role="listbox" aria-label="Döviz seçenekleri">
              {filteredOptions.map((option) => {
                const isSelected = currency === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => selectCurrency(option.id)}
                    className={cn(
                      "grid min-h-16 w-full grid-cols-[3.5rem_minmax(0,1fr)_1.5rem] items-center gap-3 rounded-2xl border px-3 py-2.5 text-start outline-none transition-colors focus-visible:ring-2 focus-visible:ring-burgundy focus-visible:ring-offset-2 focus-visible:ring-offset-[#F8F0E4]",
                      isSelected
                        ? "border-burgundy/45 bg-[#EDE0CD]"
                        : "border-[#DED0BC] bg-[#FFFDF8] hover:border-copper/70 hover:bg-[#F7EEDF]",
                    )}
                  >
                    <CurrencyThumbnail id={option.id} symbol={option.symbol} />
                    <span className="min-w-0">
                      <span dir="ltr" className="block text-sm font-bold text-[#292D25]">
                        {option.symbol} {option.id}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-[#70665C]">
                        {option.name}
                      </span>
                    </span>
                    <span className="flex size-6 items-center justify-center justify-self-end">
                      {isSelected ? <Check className="size-5 text-burgundy" aria-hidden="true" /> : null}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="px-6 py-10 text-center">
              <p className="font-bold text-[#292D25]">Döviz bulunamadı.</p>
              <p className="mt-1 text-sm text-[#70665C]">TRY, USD veya EUR koduyla aramayı deneyin.</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
