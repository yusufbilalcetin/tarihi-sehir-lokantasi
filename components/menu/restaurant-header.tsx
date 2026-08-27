"use client";

import { useEffect, useRef } from "react";

import { CurrencySelector } from "@/components/menu/currency-selector";
import { LanguageSelector } from "@/components/menu/language-selector";
import { useMenuPreferences } from "@/components/menu/menu-preferences-provider";
import { BrandMark } from "@/components/shared/brand-mark";

/**
 * The guest's first three seconds, and every second after them.
 *
 * The previous header spent most of a phone screen on the wordmark, a slogan,
 * an address and opening hours before a single dish appeared. None of that is
 * why someone scans a code at a table they are already sitting at — they want
 * the food. So the identity is stated once, warmly and briefly, and the screen
 * is handed over to the menu.
 *
 * Two things do earn their place: the table, because ordering to the wrong one
 * is the guest's biggest fear, and language/currency, because a guest who
 * cannot read the menu cannot order at all. All three stay reachable, because
 * this bar is sticky: it used to scroll away and hand over to a separate fixed
 * strip that faded in behind it, which meant two bars, an observer, and a
 * moment mid-scroll where both were on screen. One bar that never leaves is
 * less code and less movement.
 *
 * Its height is a token rather than whatever the content happens to add up to,
 * because the category bar parks directly underneath and has to know where
 * "underneath" is.
 */

// The shell is persistent across tabs, so the entry animation is gated on the
// first mount of the session rather than replaying on every return.
//
// Read and written on the client only. It used to be read during render, which
// on the server meant one guest's request decided the next guest's animation:
// the module survives between requests, so after the first render the server
// emitted "false" while every fresh browser emitted "true", and React reported
// a hydration mismatch on every menu load. Deciding after mount makes the two
// sides agree and puts the flag where the session actually lives.
let shellEntered = false;

export function RestaurantHeader({ tableName }: { tableName: string | null }) {
  const { t } = useMenuPreferences();
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (shellEntered) return;
    shellEntered = true;
    // The animation is a DOM concern, so it is turned on directly rather than
    // through state: nothing else in the tree depends on whether it played.
    headerRef.current?.setAttribute("data-motion-enter", "true");
  }, []);

  return (
    <header
      ref={headerRef}
      data-motion-enter="false"
      data-menu-header="true"
      // A thin rule, not a drop shadow: this and the category bar below it are
      // one navigation system, and a shadow between them would cut it in two.
      className="motion-header sticky top-0 z-[var(--z-appbar)] border-b border-gold/30 bg-sidebar px-[var(--menu-gutter)] pt-[env(safe-area-inset-top)] text-[#FBF7EF]"
    >
      <div className="mx-auto flex h-[var(--menu-header-height)] max-w-5xl items-center gap-3">
        <BrandMark compact className="size-9 shrink-0 sm:size-10" />

        <div className="min-w-0 flex-1">
          <p className="truncate font-heading text-sm font-semibold leading-tight sm:text-base">
            Tarihi Şehir Lokantası
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-[#F5EBDD]/60">
            {tableName ? (
              <>
                <span className="truncate font-semibold text-[#F5EBDD]/85">{tableName}</span>
                <span aria-hidden="true" className="text-[#F5EBDD]/25">·</span>
              </>
            ) : null}
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
  );
}
