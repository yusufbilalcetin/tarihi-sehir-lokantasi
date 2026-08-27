"use client";

import Image from "next/image";
import { UtensilsCrossed } from "lucide-react";

import { useMenuPreferences } from "@/components/menu/menu-preferences-provider";
import { MENU_PLACEHOLDER_IMAGE } from "@/lib/adapters/menu-view-model";
import { getMenuProductName } from "@/lib/i18n/menu-content";
import type { Product } from "@/types";

/**
 * A suggestion, not a second menu.
 *
 * The recommendation rails used to render the same full product card the
 * category feed uses, so the first thing a guest met was Mercimek Çorbası at
 * full size, and then Mercimek Çorbası again forty pixels lower under Çorbalar.
 * Two identical cards for one dish reads as a bug, not a recommendation.
 *
 * This card is deliberately smaller and quieter than the real thing: a plate, a
 * name, a price. It carries no add control, because the category below is where
 * the menu is ordered from — this is only a way in. Tapping opens the dish.
 */
export function HighlightCard({ product, onOpen }: { product: Product; onOpen: () => void }) {
  const { formatPrice, language, t } = useMenuPreferences();
  const name = getMenuProductName(product, language);
  const hasPhoto = product.image !== MENU_PLACEHOLDER_IMAGE;
  const soldOut = product.status === "sold-out";

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={t("productDetails", { name })}
      className="motion-press flex h-[4.75rem] w-full items-center gap-3 overflow-hidden rounded-xl border border-border/60 bg-card pe-3 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <span className="relative h-full w-[4.75rem] shrink-0 overflow-hidden bg-muted">
        {hasPhoto ? (
          <Image
            src={product.image}
            alt=""
            fill
            sizes="76px"
            className={`object-cover ${soldOut ? "grayscale-[0.55]" : ""}`}
          />
        ) : (
          <span aria-hidden="true" className="flex h-full w-full items-center justify-center bg-sidebar">
            <UtensilsCrossed className="size-5 text-gold/70" strokeWidth={1.5} />
          </span>
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-heading text-[15px] font-semibold leading-tight text-foreground">
          {name}
        </span>
        <span className="mt-1 text-sm font-extrabold tabular-nums text-burgundy">
          {formatPrice(product.price)}
        </span>
      </span>
    </button>
  );
}
