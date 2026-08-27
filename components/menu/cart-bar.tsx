"use client";

import { ChevronRight, ShoppingBag } from "lucide-react";

import { useMenuPreferences } from "@/components/menu/menu-preferences-provider";
import { MotionValue } from "@/components/shared/motion-value";

/**
 * What is in the cart, without leaving the menu.
 *
 * This is a row, not a floating bar. It used to position itself above the tab
 * bar and the two then read as two competing objects fighting over the bottom
 * of a phone. It now renders *inside* the tab bar's own surface, so the bottom
 * of the screen is one thing with two rows rather than two things stacked.
 *
 * It appears only with something in it. An empty bar would be a permanent strip
 * of furniture over the dishes, which is the opposite of what it is for.
 *
 * The whole row is the target and it does one thing: open the cart. It is
 * labelled "Sepet" and not "Siparişim", because nothing has been ordered yet
 * and a guest who reads "my order" on an unsent basket reasonably thinks the
 * kitchen already has it.
 */

/** Kept in step with the padding the menu reserves for the bottom stack. */
export const CART_BAR_HEIGHT_PX = 56;

export function CartBar({
  count,
  total,
  onOpen,
}: {
  readonly count: number;
  readonly total: number;
  readonly onOpen: () => void;
}) {
  const { formatPrice, t } = useMenuPreferences();

  if (count < 1) return null;

  return (
    <div className="motion-cart-bar px-[var(--menu-gutter)] pt-2">
      <button
        type="button"
        onClick={onOpen}
        className="motion-press motion-ripple flex h-14 w-full items-center gap-3 rounded-xl bg-burgundy px-4 text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/15">
          <ShoppingBag className="size-4" strokeWidth={2} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1 text-start text-sm font-semibold">
          {t("itemCount", { count })}
        </span>
        <MotionValue
          value={formatPrice(total)}
          numericValue={total}
          className="shrink-0 text-base font-extrabold tabular-nums"
        />
        <span className="flex shrink-0 items-center gap-0.5 text-sm font-bold">
          {t("cart")}
          <ChevronRight className="size-4 rtl:rotate-180" aria-hidden="true" />
        </span>
      </button>
    </div>
  );
}
