import Image from "next/image";
import { Minus, Plus, Trash2 } from "lucide-react";
import { useMenuPreferences } from "@/components/menu/menu-preferences-provider";
import { getMenuProductName } from "@/lib/i18n/menu-content";
import type { CartItem as CartItemType } from "@/types";

export function CartItem({ item, onDecrease, onIncrease, onRemove }: { item: CartItemType; onDecrease: () => void; onIncrease: () => void; onRemove: () => void }) {
  const { formatNumber, formatPrice, language, t } = useMenuPreferences();
  const name = getMenuProductName(item.product, language);

  return (
    <article className="grid grid-cols-[4.5rem_1fr] gap-3 rounded-2xl border bg-card p-3 shadow-[0_8px_26px_rgba(104,31,37,0.04)] sm:grid-cols-[5.5rem_1fr]">
      <div className="relative aspect-square overflow-hidden rounded-xl bg-muted"><Image src={item.product.image} alt={name} fill sizes="88px" className="object-cover" /></div>
      <div className="min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div><h3 className="font-heading text-base font-semibold">{name}</h3><p dir="ltr" className="mt-0.5 text-xs text-muted-foreground">{formatPrice(item.unitPrice)} / {t("each")}</p></div>
          <button type="button" onClick={onRemove} className="touch-target -me-2 -mt-2 flex items-center justify-center text-muted-foreground hover:text-destructive" aria-label={t("removeFromCart", { name })}><Trash2 className="size-4" /></button>
        </div>
        {item.note ? <p className="mt-2 rounded-lg bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">{t("note")}: {item.note}</p> : null}
        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="flex h-10 items-center rounded-xl border bg-background">
            <button type="button" onClick={onDecrease} className="touch-target flex items-center justify-center px-2.5" aria-label={t("decreaseQuantity")}><Minus className="size-3.5" /></button>
            <span className="min-w-6 text-center text-sm font-bold tabular-nums">{formatNumber(item.quantity)}</span>
            <button type="button" onClick={onIncrease} className="touch-target flex items-center justify-center px-2.5" aria-label={t("increaseQuantity")}><Plus className="size-3.5" /></button>
          </div>
          <strong dir="ltr" className="text-sm tabular-nums text-burgundy">{formatPrice(item.unitPrice * item.quantity)}</strong>
        </div>
      </div>
    </article>
  );
}
