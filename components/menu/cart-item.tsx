import Image from "next/image";
import { Minus, Plus, Trash2 } from "lucide-react";
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
      className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-[var(--menu-grid-gap)] rounded-[var(--menu-card-radius)] border bg-card p-[var(--menu-card-padding)] shadow-[0_8px_26px_rgba(104,31,37,0.04)] sm:grid-cols-[5.5rem_minmax(0,1fr)]"
    >
      <div className="relative aspect-square overflow-hidden rounded-xl bg-muted"><Image src={item.product.image} alt={name} fill sizes="88px" className="motion-product-image object-cover" onLoad={(event) => { event.currentTarget.dataset.loaded = "true"; }} /></div>
      <div className="min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div><h3 className="font-heading text-base font-semibold">{name}</h3><p dir="ltr" className="mt-0.5 text-xs text-muted-foreground"><MotionValue value={`${formatPrice(item.unitPrice)} / ${t("each")}`} numericValue={item.unitPrice} delayMs={Math.min(motionIndex * 20, 60)} /></p></div>
        </div>
        {item.note ? <p className="mt-2 rounded-lg bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">{t("note")}: {item.note}</p> : null}
        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="flex h-10 items-center rounded-xl border bg-background">
            <button
              type="button"
              onClick={handleDecreaseOrRemove}
              className="motion-press motion-ripple touch-target flex items-center justify-center px-2.5"
              aria-label={item.quantity === 1 ? t("removeFromCart", { name }) : t("decreaseQuantity")}
            >
              <span className="motion-icon-swap" aria-hidden="true">
                <Minus className="size-3.5" data-icon-kind="minus" data-active={item.quantity > 1} />
                <Trash2 className="size-3.5" data-icon-kind="trash" data-active={item.quantity === 1} />
              </span>
            </button>
            <span className="min-w-6 text-center text-sm font-bold tabular-nums"><MotionValue value={formatNumber(item.quantity)} numericValue={item.quantity} direction={quantityDirection} /></span>
            <button type="button" onClick={() => { setQuantityDirection("up"); onIncrease(); }} className="motion-press motion-ripple touch-target flex items-center justify-center px-2.5" aria-label={t("increaseQuantity")}><Plus className="size-3.5" /></button>
          </div>
          <strong dir="ltr" className="text-sm tabular-nums text-burgundy"><MotionValue value={formatPrice(item.unitPrice * item.quantity)} numericValue={item.unitPrice * item.quantity} direction={quantityDirection} delayMs={40 + Math.min(motionIndex * 20, 60)} /></strong>
        </div>
      </div>
    </article>
  );
}
