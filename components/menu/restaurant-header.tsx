"use client";

import { useEffect, useRef, useState } from "react";

import { CurrencySelector } from "@/components/menu/currency-selector";
import { LanguageSelector } from "@/components/menu/language-selector";
import { useMenuPreferences } from "@/components/menu/menu-preferences-provider";
import { BrandMark } from "@/components/shared/brand-mark";
import { cn } from "@/lib/utils";

/**
 * The guest's first three seconds.
 *
 * The previous header spent most of a phone screen on the wordmark, a slogan,
 * an address and opening hours before a single dish appeared. None of that is
 * why someone scans a code at a table they are already sitting at — they want
 * the food. So the identity is stated once, warmly and briefly, and the screen
 * is handed over to the menu.
 *
 * Two things do earn their place: the table, because ordering to the wrong one
 * is the guest's biggest fear, and language/currency, because a guest who
 * cannot read the menu cannot order at all.
 *
 * On scroll it collapses to a slim bar that keeps the table and the two
 * selectors reachable without covering the dishes.
 */

// The shell is persistent across tabs, so the entry animation is gated on the
// first mount of the session rather than replaying on every return.
let shellEntered = false;

export function RestaurantHeader({ tableName }: { tableName: string }) {
  const { t } = useMenuPreferences();
  const [enter] = useState(() => {
    const first = !shellEntered;
    shellEntered = true;
    return first;
  });

  const sentinelRef = useRef<HTMLDivElement>(null);
  const [condensed, setCondensed] = useState(false);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === "undefined") return;
    // An observer rather than a scroll listener: no work on frames where
    // nothing crossed the threshold.
    const observer = new IntersectionObserver(
      ([entry]) => setCondensed(!entry.isIntersecting),
      { rootMargin: "-1px 0px 0px 0px", threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <header
        data-motion-enter={enter}
        className="motion-header relative overflow-hidden rounded-b-[1.75rem] bg-[#17130F] px-[var(--menu-gutter)] pb-4 pt-[max(0.875rem,env(safe-area-inset-top))] text-[#FFFDF8] shadow-[0_18px_44px_rgba(37,33,29,0.16)]"
      >
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          <BrandMark compact className="shrink-0" />

          <div className="min-w-0 flex-1">
            <p className="truncate font-heading text-[15px] font-semibold leading-tight sm:text-base">
              Tarihi Şehir Lokantası
            </p>
            <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[#F5EBDD]/60 sm:text-xs">
              <span className="truncate">
                {t("yourTable")}: <span className="font-semibold text-[#F5EBDD]/85">{tableName}</span>
              </span>
              <span aria-hidden="true" className="text-[#F5EBDD]/25">·</span>
              <span className="flex shrink-0 items-center gap-1 text-status-success-tint/80">
                <span className="size-1.5 rounded-full bg-order-ready-tint" aria-hidden="true" />
                {t("serviceOpen")}
              </span>
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <LanguageSelector />
            <CurrencySelector />
          </div>
        </div>
      </header>

      {/* Marks where the full header ends; the slim bar takes over past it. */}
      <div ref={sentinelRef} aria-hidden="true" className="h-px w-full" />

      <div
        className={cn(
          "fixed inset-x-0 top-0 z-[var(--z-appbar)] border-b border-white/10 bg-[#17130F]/95 backdrop-blur-md transition-[opacity,transform] duration-200 ease-out",
          "px-[var(--menu-gutter)] pt-[max(0.5rem,env(safe-area-inset-top))] pb-2",
          condensed
            ? "pointer-events-auto translate-y-0 opacity-100"
            : "pointer-events-none -translate-y-full opacity-0",
        )}
        // A visual reminder of the header above, deliberately carrying nothing
        // focusable: a second copy of the language and currency controls would
        // put two identical buttons in the tab order and read the table twice
        // to a screen reader. Keeping it inert makes `aria-hidden` honest.
        aria-hidden="true"
      >
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          <BrandMark compact className="size-8 rounded-lg" />
          <p className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[#FFFDF8]">
            {t("yourTable")}: {tableName}
          </p>
        </div>
      </div>
    </>
  );
}
