import Image from "next/image";
import { Minus, Plus, Trash2 } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import type { CartItem as CartItemType } from "@/types";

export function CartItem({ item, onDecrease, onIncrease, onRemove }: { item: CartItemType; onDecrease: () => void; onIncrease: () => void; onRemove: () => void }) {
  return (
    <article className="grid grid-cols-[4.5rem_1fr] gap-3 rounded-2xl border bg-card p-3 shadow-[0_8px_26px_rgba(104,31,37,0.04)] sm:grid-cols-[5.5rem_1fr]">
      <div className="relative aspect-square overflow-hidden rounded-xl bg-muted"><Image src={item.product.image} alt={item.productName} fill sizes="88px" className="object-cover" /></div>
      <div className="min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div><h3 className="font-heading text-base font-semibold">{item.productName}</h3><p className="mt-0.5 text-xs text-muted-foreground">{formatCurrency(item.unitPrice)} / adet</p></div>
          <button type="button" onClick={onRemove} className="touch-target -mr-2 -mt-2 flex items-center justify-center text-muted-foreground hover:text-destructive" aria-label={`${item.productName} ürününü kaldır`}><Trash2 className="size-4" /></button>
        </div>
        {item.note ? <p className="mt-2 rounded-lg bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">Not: {item.note}</p> : null}
        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="flex h-10 items-center rounded-xl border bg-background">
            <button type="button" onClick={onDecrease} className="touch-target flex items-center justify-center px-2.5" aria-label="Adedi azalt"><Minus className="size-3.5" /></button>
            <span className="min-w-6 text-center text-sm font-bold tabular-nums">{item.quantity}</span>
            <button type="button" onClick={onIncrease} className="touch-target flex items-center justify-center px-2.5" aria-label="Adedi artır"><Plus className="size-3.5" /></button>
          </div>
          <strong className="text-sm tabular-nums text-burgundy">{formatCurrency(item.unitPrice * item.quantity)}</strong>
        </div>
      </div>
    </article>
  );
}
