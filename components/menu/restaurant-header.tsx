"use client";

import { Clock3, MapPin } from "lucide-react";
import { CurrencySelector } from "@/components/menu/currency-selector";
import { LanguageSelector } from "@/components/menu/language-selector";
import { useMenuPreferences } from "@/components/menu/menu-preferences-provider";
import { BrandMark } from "@/components/shared/brand-mark";

export function RestaurantHeader({ tableName }: { tableName: string }) {
  const { t } = useMenuPreferences();

  return (
    <header className="motion-header overflow-hidden rounded-b-[2rem] bg-[#17130F] px-[var(--menu-gutter)] pb-6 pt-[max(1.25rem,env(safe-area-inset-top))] text-[#FFFDF8] shadow-[0_22px_60px_rgba(37,33,29,0.18)] sm:pb-8">
      <div className="mx-auto max-w-5xl">
        <BrandMark className="mx-auto max-w-xl" />
        <p className="mt-2 text-center font-heading text-xs tracking-[0.16em] text-[#F5EBDD]/65 sm:text-sm">
          {t("slogan")}
        </p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-[#F5EBDD]/70">
          <span className="flex items-center gap-1.5"><MapPin className="size-3.5 text-copper" /> {t("location")}</span>
          <span className="flex items-center gap-1.5"><Clock3 className="size-3.5 text-copper" /> 11:00 - 22:00</span>
        </div>
        <div className="motion-table mt-5 flex min-w-0 items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-3 sm:px-4">
          <div>
            <p className="text-[11px] font-semibold tracking-wide text-[#F5EBDD]/55">{t("yourTable")}</p>
            <p className="mt-0.5 font-heading text-xl font-semibold">{tableName}</p>
          </div>
          <div className="hidden items-center gap-2 rounded-xl border border-emerald-300/20 bg-emerald-400/10 px-3 py-2 text-xs font-semibold text-emerald-100 min-[390px]:flex">
            <span className="size-1.5 rounded-full bg-emerald-300" aria-hidden="true" />
            {t("serviceOpen")}
          </div>
        </div>
        <div className="mt-3 flex min-w-0 items-center justify-center gap-2">
          <LanguageSelector />
          <CurrencySelector />
        </div>
      </div>
    </header>
  );
}
