"use client";

import { BellRing, ClipboardList, ReceiptText, UtensilsCrossed } from "lucide-react";
import { useEffect, useRef } from "react";
import { useMenuPreferences } from "@/components/menu/menu-preferences-provider";
import { cn } from "@/lib/utils";
import { MotionValue } from "@/components/shared/motion-value";

export type MenuTab = "menu" | "order" | "waiter" | "bill";

const items = [
  { id: "menu" as const, labelKey: "menu" as const, icon: UtensilsCrossed },
  { id: "order" as const, labelKey: "order" as const, icon: ClipboardList },
  { id: "waiter" as const, labelKey: "waiter" as const, icon: BellRing },
  { id: "bill" as const, labelKey: "bill" as const, icon: ReceiptText },
];

export function BottomNavigation({ active, cartCount, onChange }: { active: MenuTab; cartCount: number; onChange: (tab: MenuTab) => void }) {
  const { direction, formatNumber, t } = useMenuPreferences();
  const activeIndex = items.findIndex((item) => item.id === active);
  const indicatorOffset = (direction === "rtl" ? -activeIndex : activeIndex) * 100;
  const badgeRef = useRef<HTMLSpanElement>(null);
  const badgeAnimation = useRef<Animation | null>(null);

  useEffect(() => {
    const badge = badgeRef.current;
    if (!badge || cartCount < 1 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    badgeAnimation.current?.cancel();
    badgeAnimation.current = badge.animate(
      [
        { transform: "scale(0.92)", offset: 0 },
        { transform: "scale(1.04)", offset: 0.6 },
        { transform: "scale(1)", offset: 1 },
      ],
      { duration: 190, delay: 30, easing: "cubic-bezier(0.22, 0.75, 0.25, 1)" },
    );
    return () => badgeAnimation.current?.cancel();
  }, [cartCount]);

  return (
    <nav dir={direction} aria-label={t("customerNavigation")} className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/96 pb-[env(safe-area-inset-bottom)] shadow-[0_-12px_36px_rgba(37,33,29,0.1)] backdrop-blur-xl">
      <div className="relative mx-auto grid h-16 w-full max-w-xl grid-cols-4 px-2">
        <span className="motion-nav-indicator" style={{ "--motion-nav-offset": `${indicatorOffset}%` } as React.CSSProperties} aria-hidden="true" />
        {items.map(({ id, labelKey, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            className={cn(
              "motion-nav-item motion-press motion-ripple relative grid h-16 min-w-0 grid-rows-[1.25rem_1rem] place-items-center content-center gap-1 rounded-xl px-1 text-center text-[11px] font-semibold leading-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active === id ? "text-burgundy" : "text-muted-foreground hover:text-foreground",
            )}
            aria-current={active === id ? "page" : undefined}
          >
            <Icon className="size-5" strokeWidth={active === id ? 2.2 : 1.7} aria-hidden="true" />
            <span className="w-full truncate">{t(labelKey)}</span>
            {id === "order" && cartCount > 0 ? <span ref={badgeRef} className="motion-nav-badge absolute end-[20%] top-1.5 flex min-w-4 items-center justify-center rounded-full bg-burgundy px-1 text-[9px] font-bold leading-4 text-white"><MotionValue value={formatNumber(cartCount)} numericValue={cartCount} /></span> : null}
          </button>
        ))}
      </div>
    </nav>
  );
}
