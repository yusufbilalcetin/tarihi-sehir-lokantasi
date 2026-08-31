import Image from "next/image";
import { Minus, Plus, Trash2, UtensilsCrossed } from "lucide-react";
import { MENU_PLACEHOLDER_IMAGE } from "@/lib/adapters/menu-view-model";
import { useState } from "react";
import { MotionValue } from "@/components/shared/motion-value";
import { useMenuPreferences } from "@/components/menu/menu-preferences-provider";
import { getMenuProductName } from "@/lib/i18n/menu-content";
import type { CartItem as CartItemType } from "@/types";

export function CartItem({ item, motionIndex = 0, onDecrease, onIncrease, onRemove }: { item: CartItemType; motionIndex?: number; onDecrease: () => void; onIncrease: () => void; onRemove: () => void }) {
  const { formatNumber, formatPrice, language, t } = useMenuPreferences();
  const name = getMenuProductName(item.product, language);
  const [quantityDirection, setQuantityDirection] = useState<"up" | "down">("up");

  function handleDecreaseOrRemove() {
    if (item.quantity === 1) {
      onRemove();
      return;
    }
    setQuantityDirection("down");
    onDecrease();
  }

  return (
    <article
      data-cart-item-id={item.id}
      className="grid grid-cols-[4rem_minmax(0,1fr)] items-start gap-[var(--menu-grid-gap)] rounded-[var(--menu-card-radius)] border bg-card p-[var(--menu-card-padding)] shadow-[0_8px_26px_rgba(104,31,37,0.04)] sm:grid-cols-[5.5rem_minmax(0,1fr)]"
    >
      <div className="relative aspect-square overflow-hidden rounded-xl bg-muted">
        {item.product.image !== MENU_PLACEHOLDER_IMAGE ? (
          <Image src={item.product.image} alt={name} fill sizes="(max-width: 639px) 64px, 88px" className="motion-product-image object-cover" onLoad={(event) => { event.currentTarget.dataset.loaded = "true"; }} />
        ) : (
          <div aria-hidden="true" className="flex h-full w-full items-center justify-center bg-olive"><UtensilsCrossed className="size-5 text-gold/70" strokeWidth={1.5} /></div>
        )}
      </div>
      <div className="flex min-h-full min-w-0 flex-col">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0"><h3 title={name} className="line-clamp-2 min-h-10 font-heading text-base font-semibold leading-5">{name}</h3><p dir="ltr" className="mt-0.5 text-xs text-muted-foreground"><MotionValue value={`${formatPrice(item.unitPrice)} / ${t("each")}`} numericValue={item.unitPrice} delayMs={Math.min(motionIndex * 10, 30)} /></p></div>
        </div>
        {item.note ? <p className="mt-2 rounded-lg bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">{t("note")}: {item.note}</p> : null}
        {/* The stepper holds 44px targets and the line total is never
            abbreviated, so at 320px a four-figure total has nowhere to go on
            one line: it wraps to its own row instead of spilling out of the
            card. Above ~360px both still share a line. */}
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
          <div className="flex h-12 items-center rounded-xl border bg-background">
            <button
              type="button"
              onClick={handleDecreaseOrRemove}
              className="motion-press motion-ripple flex size-11 items-center justify-center"
              aria-label={item.quantity === 1 ? t("removeFromCart", { name }) : t("decreaseQuantity")}
            >
              <span className="motion-icon-swap" aria-hidden="true">
                <Minus className="size-3.5" data-icon-kind="minus" data-active={item.quantity > 1} />
                <Trash2 className="size-3.5" data-icon-kind="trash" data-active={item.quantity === 1} />
              </span>
            </button>
            <span className="min-w-7 text-center text-sm font-bold tabular-nums"><MotionValue value={formatNumber(item.quantity)} numericValue={item.quantity} direction={quantityDirection} /></span>
            <button type="button" onClick={() => { setQuantityDirection("up"); onIncrease(); }} className="motion-press motion-ripple flex size-11 items-center justify-center" aria-label={t("increaseQuantity")}><Plus className="size-3.5" /></button>
          </div>
          <strong dir="ltr" className="ms-auto shrink-0 text-end text-sm tabular-nums text-burgundy"><MotionValue value={formatPrice(item.unitPrice * item.quantity)} numericValue={item.unitPrice * item.quantity} direction={quantityDirection} delayMs={20 + Math.min(motionIndex * 10, 20)} /></strong>
        </div>
      </div>
    </article>
  );
}
