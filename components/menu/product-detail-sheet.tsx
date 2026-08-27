"use client";

import Image from "next/image";
import { Minus, Plus, UtensilsCrossed, X } from "lucide-react";
import { MENU_PLACEHOLDER_IMAGE } from "@/lib/adapters/menu-view-model";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useMenuPreferences } from "@/components/menu/menu-preferences-provider";
import {
  getMenuAllergen,
  getMenuProductDescription,
  getMenuProductName,
  getMenuTag,
  getMenuWeight,
} from "@/lib/i18n/menu-content";
import type { Product } from "@/types";
import { MotionValue } from "@/components/shared/motion-value";

/**
 * A dish, opened.
 *
 * This used to be a dialog floating in the middle of the screen, which on a
 * phone is the one place a thumb cannot comfortably reach and the one shape
 * that has to shrink its own content to fit. It is a sheet now: it rises from
 * the edge the hand is already at, it may use most of the screen because it has
 * the screen's attention, and the button that costs money never leaves the
 * bottom of it however long the description runs.
 *
 * The same sheet serves a wide screen. Its content is capped and centred rather
 * than stretched, so a laptop gets a panel and not a billboard.
 */
export function ProductDetailSheet({
  product,
  open,
  canOrder = true,
  onOpenChange,
  onAdd,
}: {
  product: Product | null;
  open: boolean;
  canOrder?: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (product: Product, quantity: number, note: string) => void;
}) {
  const { direction, formatNumber, formatPrice, language, t } = useMenuPreferences();
  const [quantity, setQuantity] = useState(1);
  const [quantityDirection, setQuantityDirection] = useState<"up" | "down">("up");
  const [note, setNote] = useState("");

  if (!product) return null;
  const soldOut = product.status === "sold-out";
  const hasPhoto = product.image !== MENU_PLACEHOLDER_IMAGE;
  const name = getMenuProductName(product, language);
  const description = getMenuProductDescription(product, language);

  function handleAdd() {
    onAdd(product as Product, quantity, note.trim());
    onOpenChange(false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        dir={direction}
        className="max-h-[90dvh] gap-0 rounded-t-2xl border-copper/30 p-0"
        showCloseButton={false}
      >
        {/* The default close is a dark glyph on a transparent ground, which
            disappears over a photograph of a dark dish. This one carries its
            own contrast. */}
        <SheetClose
          className="absolute end-3 top-3 z-10 inline-flex size-11 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm hover:bg-black/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
          aria-label={t("close")}
        >
          <X className="size-5" aria-hidden="true" />
        </SheetClose>
        {/* Capped rather than stretched: the sheet spans the edge, its contents
            stay a readable column on any screen. */}
        <div className="mx-auto flex max-h-[90dvh] w-full max-w-2xl flex-col">
          <div className="menu-dialog-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <div className="relative aspect-[16/9] max-h-60 min-h-44 shrink-0 overflow-hidden bg-muted">
              {hasPhoto ? (
                <>
                  <Image
                    src={product.image}
                    alt={name}
                    fill
                    sizes="(max-width: 768px) 100vw, 672px"
                    className="motion-product-image object-cover"
                    onLoad={(event) => {
                      event.currentTarget.dataset.loaded = "true";
                    }}
                  />
                  <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#25211D]/55 to-transparent" />
                </>
              ) : (
                /* Same contract as the product card: no photograph means the
                   restaurant's own mark, never a stretched stock plate. */
                <div aria-hidden="true" className="flex h-full w-full items-center justify-center bg-sidebar">
                  <UtensilsCrossed className="size-12 text-gold/70" strokeWidth={1.4} />
                </div>
              )}
            </div>

            <SheetHeader className="gap-1 px-4 pb-0 pt-4 sm:px-6">
              {product.tags.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {product.tags.map((tag) => (
                    <Badge
                      key={tag}
                      variant="outline"
                      className="border-copper/30 bg-transparent px-1.5 py-0 text-[10px] font-semibold uppercase tracking-[0.04em] text-text-secondary"
                    >
                      {getMenuTag(tag, language)}
                    </Badge>
                  ))}
                </div>
              ) : null}
              <SheetTitle className="font-heading text-2xl font-semibold leading-tight">{name}</SheetTitle>
              <p dir="ltr" className="text-2xl font-bold tabular-nums text-primary">
                {formatPrice(product.price)}
              </p>
              {soldOut ? (
                <span className="inline-flex w-fit items-center rounded-full border border-order-void/25 bg-order-void-tint px-2.5 py-1 text-xs font-semibold text-order-void">
                  {t("soldOut")}
                </span>
              ) : null}
              <SheetDescription className="text-sm leading-6">{description}</SheetDescription>
            </SheetHeader>

            {/* Facts about the dish, as lines on a menu rather than as two
                little dashboard tiles. A label, a value, a rule between. */}
            <dl className="mt-4 border-y border-border/50 px-4 text-sm sm:px-6">
              <div className="flex items-baseline justify-between gap-4 border-b border-border/40 py-2.5">
                <dt className="shrink-0 text-muted-foreground">{t("portion")}</dt>
                <dd className="min-w-0 text-end font-semibold text-foreground">
                  {product.weight ? getMenuWeight(product.weight, language) : t("standardPortion")}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-4 py-2.5">
                <dt className="shrink-0 text-muted-foreground">{t("allergens")}</dt>
                <dd className="min-w-0 text-end font-semibold text-foreground">
                  {product.allergens.length
                    ? product.allergens.map((item) => getMenuAllergen(item, language)).join(", ")
                    : t("noAllergens")}
                </dd>
              </div>
            </dl>

            <div className="grid gap-3 px-4 py-4 sm:px-6">
              <div>
                <label htmlFor="product-note" className="mb-2 block text-sm font-semibold">
                  {t("productNote")}
                </label>
                <Textarea
                  id="product-note"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder={t("productNotePlaceholder")}
                  className="min-h-20 bg-card"
                />
              </div>
            </div>
          </div>

          {/* However long the dish reads, the price and the button that spends
              money are the last thing under the thumb. */}
          <div className="sticky bottom-0 flex items-center gap-3 border-t bg-card/96 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:px-6">
            <div className="flex h-13 shrink-0 items-center rounded-xl border bg-background">
              <button
                type="button"
                className="motion-press motion-ripple flex size-11 items-center justify-center"
                aria-label={t("decreaseQuantity")}
                onClick={() => {
                  setQuantityDirection("down");
                  setQuantity((value) => Math.max(1, value - 1));
                }}
              >
                <Minus className="size-4" aria-hidden="true" />
              </button>
              <span className="min-w-7 text-center font-bold tabular-nums">
                <MotionValue value={formatNumber(quantity)} numericValue={quantity} direction={quantityDirection} />
              </span>
              <button
                type="button"
                className="motion-press motion-ripple flex size-11 items-center justify-center"
                aria-label={t("increaseQuantity")}
                onClick={() => {
                  setQuantityDirection("up");
                  setQuantity((value) => value + 1);
                }}
              >
                <Plus className="size-4" aria-hidden="true" />
              </button>
            </div>
            <Button
              type="button"
              onClick={handleAdd}
              disabled={soldOut || !canOrder}
              className="motion-cta h-13 min-w-0 flex-1 rounded-xl px-4 text-sm font-bold"
            >
              {soldOut ? (
                t("soldOut")
              ) : (
                <>
                  {t("addToCart")} ·{" "}
                  <MotionValue
                    value={formatPrice(product.price * quantity)}
                    numericValue={product.price * quantity}
                    direction={quantityDirection}
                    delayMs={40}
                  />
                </>
              )}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
