"use client";

import { useEffect, useRef } from "react";

import { useMenuPreferences } from "@/components/menu/menu-preferences-provider";
import type { MenuViewCategory } from "@/lib/adapters/menu-view-model";
import { getMenuCategoryName } from "@/lib/i18n/menu-content";
import { cn } from "@/lib/utils";

/**
 * Switching courses without going back.
 *
 * The category grid is a good front door, but it made every later change of
 * mind a round trip: back to the grid, find the tile, tap in again. A guest
 * comparing the soups with the grills does that repeatedly. This rail keeps
 * every category one tap away while the dishes stay on screen.
 *
 * The grid still owns the first visit — it is browsable and photographic, which
 * is what an unfamiliar menu needs. The rail owns everything after it.
 *
 * It scrolls the active chip into view on change, because the tapped category
 * is often the one that was half off-screen.
 */
export function CategoryChips({
  categories,
  activeCategoryId,
  onSelect,
}: {
  readonly categories: readonly MenuViewCategory[];
  readonly activeCategoryId: string | null;
  readonly onSelect: (category: MenuViewCategory, focusHeading: boolean) => void;
}) {
  const { language, t } = useMenuPreferences();
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [activeCategoryId]);

  if (categories.length === 0) return null;

  return (
    <nav
      aria-label={t("categoryNavigation")}
      // Edge-to-edge so chips bleed off the screen, which is what tells a
      // thumb there is more to scroll.
      className="-mx-[var(--menu-gutter)] overflow-x-auto px-[var(--menu-gutter)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <ul className="flex w-max items-center gap-2 pb-0.5">
        {categories.map((category) => {
          const active = category.id === activeCategoryId;
          const name = getMenuCategoryName(category, language);
          return (
            <li key={category.id}>
              <button
                ref={active ? activeRef : undefined}
                type="button"
                disabled={!category.active}
                aria-current={active ? "true" : undefined}
                onClick={(event) => onSelect(category, event.detail === 0)}
                className={cn(
                  // 44px minimum, because this is a thumb target on a phone.
                  "motion-press inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-sm font-semibold transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
                  "disabled:cursor-not-allowed disabled:opacity-45",
                  active
                    ? "border-primary bg-primary text-primary-foreground shadow-sm"
                    : "border-border-strong bg-surface-raised text-text-secondary hover:border-copper/60 hover:text-text-primary",
                )}
              >
                {name}
                <span
                  className={cn(
                    "tabular-nums text-xs font-medium",
                    active ? "text-primary-foreground/70" : "text-text-muted",
                  )}
                >
                  {category.productCount}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
