"use client";

import Image from "next/image";
import { Plus, UtensilsCrossed } from "lucide-react";
import { MENU_PLACEHOLDER_IMAGE } from "@/lib/adapters/menu-view-model";
import { Button } from "@/components/ui/button";
import { useMenuPreferences } from "@/components/menu/menu-preferences-provider";
import { getMenuProductDescription, getMenuProductName, getMenuTag } from "@/lib/i18n/menu-content";
import type { Product } from "@/types";
import { useRevealOnce } from "@/lib/motion/use-reveal-once";
import { MotionValue } from "@/components/shared/motion-value";

/**
 * One dish, as a line on a menu.
 *
 * It used to be a card: a visible border, a drop shadow, a photograph bled to
 * the edge, and — stacked sixty-one times — a page that read as a dashboard
 * rather than as something a restaurant hands you. Three things were competing
 * with the food and each of them lost:
 *
 *   the border, which is gone; rows separate by their own warm surface
 *   the badges, which were filled pills sitting *above* the dish name, so the
 *     first thing the eye met on every row was the word "Popüler"
 *   the oversized empty band in the middle, replaced by compact two-line text
 *     lanes that keep neighbouring prices aligned without making a tall tile
 *
 * What is left, in reading order, is the plate, the name, what it is, and what
 * it costs. The one control is the add button, and it is the only filled thing
 * on the row.
 */
export function ProductCard({
  product,
  index = 0,
  canOrder = true,
  onOpen,
  onAdd,
}: {
  product: Product;
  index?: number;
  canOrder?: boolean;
  onOpen: () => void;
  onAdd: () => void;
}) {
  const { formatPrice, language, t } = useMenuPreferences();
  const soldOut = product.status === "sold-out";
  const hasPhoto = product.image !== MENU_PLACEHOLDER_IMAGE;
  const name = getMenuProductName(product, language);
  const description = getMenuProductDescription(product, language);
  const { ref, revealed, animate } = useRevealOnce<HTMLElement>(`product-${product.id}`);
  // Two at most: a third is decoration, and the full set is on the dish itself.
  const badges = product.tags.slice(0, 2);

  return (
    <article
      ref={ref}
      data-revealed={revealed}
      data-reveal-animate={animate}
      className="motion-reveal motion-card-hover group relative flex h-full gap-3 rounded-xl bg-card p-3"
      style={{ "--motion-delay": `${Math.min(index * 20, 80)}ms` } as React.CSSProperties}
    >
      <button
        type="button"
        onClick={onOpen}
        className="motion-card-trigger motion-press absolute inset-0 z-[1] rounded-xl text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        aria-label={t("productDetails", { name })}
      />

      <div className="motion-card-media pointer-events-none relative size-23 shrink-0 overflow-hidden rounded-lg bg-muted">
        {hasPhoto ? (
          <Image
            src={product.image}
            alt={name}
            fill
            sizes="92px"
            className={`motion-product-image object-cover ${soldOut ? "grayscale-[0.55]" : ""}`}
            onLoad={(event) => {
              event.currentTarget.dataset.loaded = "true";
            }}
          />
        ) : (
          /* No photograph of this dish exists yet. A stock plate stretched to
             fill the frame reads as a broken image and cheapens the whole
             menu, so the row shows the restaurant's own mark instead and lets
             the dish name carry it. */
          <div aria-hidden="true" className="flex h-full w-full items-center justify-center bg-sidebar">
            <UtensilsCrossed className="size-6 text-gold/70" strokeWidth={1.5} />
          </div>
        )}
        {soldOut ? <div className="absolute inset-0 bg-[#25211D]/25" /> : null}
      </div>

      <div className="pointer-events-none relative flex min-w-0 flex-1 flex-col">
        {/* The dish leads. Everything under it is what the dish is.
            `h3`, not `h2`: every card renders inside a category section whose
            own heading is the `h2` — `menu-sections.tsx` on the QR menu and in
            the admin editor, `guest-order-experience.tsx` on the takeaway page.
            As an `h2` the dish was a sibling of the category that contains it,
            so a screen reader moving by heading read one flat run of dish names
            with no section boundary anywhere in it. */}
        <h3
          title={name}
          className="line-clamp-2 min-h-10 font-heading text-[17px] font-semibold leading-5 text-foreground sm:text-lg"
        >
          {name}
        </h3>

        <div className="mt-1 flex h-5 min-w-0 items-center gap-1 overflow-hidden">
          {badges.length || soldOut ? (
            <p className="flex min-w-0 items-center gap-1 overflow-hidden">
              {badges.map((tag) => (
                <span
                  key={tag}
                  title={getMenuTag(tag, language)}
                  className="min-w-0 truncate rounded border border-copper/30 px-1.5 text-[10px] font-semibold uppercase tracking-[0.04em] leading-4 text-text-secondary"
                >
                  {getMenuTag(tag, language)}
                </span>
              ))}
              {soldOut ? (
                <span className="rounded border border-order-void/30 px-1.5 text-[10px] font-semibold uppercase tracking-[0.04em] leading-4 text-order-void">
                  {t("soldOut")}
                </span>
              ) : null}
            </p>
          ) : null}
        </div>

        <p
          title={description}
          className="mt-1 line-clamp-2 min-h-10 text-xs leading-5 text-muted-foreground sm:text-sm"
        >
          {description}
        </p>

        <MotionValue
          value={formatPrice(product.price)}
          numericValue={product.price}
          delayMs={Math.min(index * 10, 40)}
          className="mt-auto pt-1.5 text-base font-extrabold tabular-nums text-burgundy sm:text-lg"
        />
      </div>

      {/* Its own column, aligned with the price row. Sharing a line with the
          price makes both controls drift when a title wraps. */}
      <Button
        type="button"
        size="icon"
        disabled={soldOut || !canOrder}
        onClick={onAdd}
        aria-label={`${name}: ${t("addToCart")}`}
        className="pointer-events-auto relative z-10 size-11 shrink-0 self-end rounded-full shadow-none"
      >
        <Plus className="size-5" strokeWidth={2.2} />
      </Button>
    </article>
  );
}
