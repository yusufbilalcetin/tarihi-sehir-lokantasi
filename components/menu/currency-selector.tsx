"use client";

import { Check, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMenuPreferences } from "./menu-preferences-provider";
import type { MenuCurrency } from "@/lib/i18n/menu-translations";

const currencyOptions: Array<{
  id: MenuCurrency;
  symbol: string;
  label: string;
}> = [
  { id: "TRY", symbol: "₺", label: "₺ TRY" },
  { id: "USD", symbol: "$", label: "$ USD" },
  { id: "EUR", symbol: "€", label: "€ EUR" },
];

export function CurrencySelector() {
  const { currency, direction, setCurrency, t } = useMenuPreferences();
  const selected = currencyOptions.find((option) => option.id === currency)!;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("currencyLabel")}
        className="inline-flex h-10 min-w-0 items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/[0.07] px-2.5 text-xs font-bold text-[#FFFDF8] outline-none transition-colors hover:bg-white/[0.12] focus-visible:ring-2 focus-visible:ring-copper sm:px-3"
      >
        <span className="text-copper" aria-hidden="true">{selected.symbol}</span>
        <span>{selected.id}</span>
        <ChevronDown className="size-3.5 opacity-70" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        dir={direction}
        className="min-w-36 rounded-xl p-1.5"
      >
        {currencyOptions.map((option) => (
          <DropdownMenuItem
            key={option.id}
            onClick={() => setCurrency(option.id)}
            className="min-h-10 justify-between rounded-lg px-3 text-sm"
          >
            <span dir="ltr">{option.label}</span>
            {currency === option.id ? (
              <Check className="size-4 text-burgundy" aria-hidden="true" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
