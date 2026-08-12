"use client";

import { useState } from "react";
import Image from "next/image";
import { Check, ChevronDown, X } from "lucide-react";
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
  imageSrc: string;
  imageAlt: string;
}> = [
  {
    id: "TRY",
    symbol: "₺",
    name: "Türk Lirası",
    imageSrc: "/images/currency/try-1-lira.webp",
    imageAlt: "1 Türk lirası madeni para",
  },
  {
    id: "USD",
    symbol: "$",
    name: "Amerikan Doları",
    imageSrc: "/images/currency/usd-1-dollar.webp",
    imageAlt: "1 Amerikan doları banknotu",
  },
  {
    id: "EUR",
    symbol: "€",
    name: "Euro",
    imageSrc: "/images/currency/eur-1-euro.webp",
    imageAlt: "1 euro madeni para",
  },
];

function CurrencyThumbnail({ src, alt }: { src: string; alt: string }) {
  return (
    <span
      className="relative h-9 w-14 shrink-0 overflow-hidden rounded-lg border border-[#D4C2AA] bg-[#F7ECDD] shadow-[0_2px_7px_rgba(64,48,31,0.12)]"
    >
      <Image
        src={src}
        alt={alt}
        fill
        sizes="56px"
        className="object-cover"
      />
    </span>
  );
}

export function CurrencySelector({ variant = "header" }: { variant?: "header" | "surface" }) {
  const { currency, direction, setCurrency, t } = useMenuPreferences();
  const [open, setOpen] = useState(false);
  const selected = currencyOptions.find((option) => option.id === currency)!;

  function selectCurrency(nextCurrency: MenuCurrency) {
    setCurrency(nextCurrency);
    setOpen(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
    >
      <DialogTrigger
        aria-label={t("currencyLabel")}
        className={cn(
          "motion-press motion-ripple motion-hover inline-flex h-10 min-w-0 items-center justify-center gap-1.5 rounded-xl px-3 text-xs font-bold outline-none focus-visible:ring-2 focus-visible:ring-copper",
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

        <div className="menu-dialog-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-[#DFD1BD] p-4 sm:p-5">
          <div className="grid gap-2" role="listbox" aria-label="Döviz seçenekleri">
              {currencyOptions.map((option) => {
                const isSelected = currency === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => selectCurrency(option.id)}
                    className={cn(
                      "motion-press motion-ripple motion-hover grid min-h-16 w-full grid-cols-[3.5rem_minmax(0,1fr)_1.5rem] items-center gap-3 rounded-2xl border px-3 py-2.5 text-start outline-none focus-visible:ring-2 focus-visible:ring-burgundy focus-visible:ring-offset-2 focus-visible:ring-offset-[#F8F0E4]",
                      isSelected
                        ? "border-burgundy/45 bg-[#EDE0CD]"
                        : "border-[#DED0BC] bg-[#FFFDF8] hover:border-copper/70 hover:bg-[#F7EEDF]",
                    )}
                  >
                    <CurrencyThumbnail src={option.imageSrc} alt={option.imageAlt} />
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
