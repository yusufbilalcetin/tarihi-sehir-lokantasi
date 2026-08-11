"use client";

import Image from "next/image";
import { Minus, Plus, Scale, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency } from "@/lib/format";
import type { Product } from "@/types";

export function ProductDetailSheet({ product, open, onOpenChange, onAdd }: { product: Product | null; open: boolean; onOpenChange: (open: boolean) => void; onAdd: (product: Product, quantity: number, note: string) => void }) {
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState("");

  if (!product) return null;
  const soldOut = product.status === "sold-out";

  function handleAdd() {
    onAdd(product as Product, quantity, note.trim());
    onOpenChange(false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl border-border p-0 sm:max-w-2xl">
        <div className="relative aspect-[16/9] min-h-52 overflow-hidden rounded-t-3xl bg-muted">
          <Image src={product.image} alt={product.name} fill sizes="(max-width: 768px) 100vw, 672px" className="object-cover" />
          <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#25211D]/55 to-transparent" />
        </div>
        <SheetHeader className="px-5 pb-0 pt-5 text-left">
          <div className="flex flex-wrap gap-2">{product.tags.map((tag) => <Badge key={tag} variant="outline" className="border-copper/40 bg-copper/10 text-burgundy">{tag}</Badge>)}</div>
          <SheetTitle className="mt-2 font-heading text-3xl font-semibold leading-tight">{product.name}</SheetTitle>
          <SheetDescription className="text-sm leading-6">{product.description}</SheetDescription>
        </SheetHeader>
        <div className="grid gap-3 px-5 py-5 sm:grid-cols-2">
          <div className="flex items-start gap-3 rounded-2xl border bg-background p-3.5">
            <Scale className="mt-0.5 size-5 text-copper" />
            <div><p className="text-xs font-semibold text-muted-foreground">Porsiyon</p><p className="mt-0.5 text-sm font-bold">{product.weight ?? "Standart porsiyon"}</p></div>
          </div>
          <div className="flex items-start gap-3 rounded-2xl border bg-background p-3.5">
            <ShieldAlert className="mt-0.5 size-5 text-copper" />
            <div><p className="text-xs font-semibold text-muted-foreground">Alerjenler</p><p className="mt-0.5 text-sm font-bold">{product.allergens.length ? product.allergens.join(", ") : "Bildirilmiş alerjen yok"}</p></div>
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="product-note" className="mb-2 block text-sm font-semibold">Ürün notu</label>
            <Textarea id="product-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Örn. tereyağsız olsun" className="min-h-20 bg-card" />
          </div>
        </div>
        <SheetFooter className="sticky bottom-0 border-t bg-card/95 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4 backdrop-blur">
          <div className="flex items-center justify-between gap-4">
            <div className="flex h-12 items-center rounded-xl border bg-background">
              <button type="button" className="touch-target flex items-center justify-center px-3" aria-label="Adedi azalt" onClick={() => setQuantity((value) => Math.max(1, value - 1))}><Minus className="size-4" /></button>
              <span className="min-w-8 text-center font-bold tabular-nums">{quantity}</span>
              <button type="button" className="touch-target flex items-center justify-center px-3" aria-label="Adedi artır" onClick={() => setQuantity((value) => value + 1)}><Plus className="size-4" /></button>
            </div>
            <Button type="button" onClick={handleAdd} disabled={soldOut} className="h-12 flex-1 rounded-xl px-5 text-sm font-bold">
              {soldOut ? "Bugün Tükendi" : `Sepete Ekle · ${formatCurrency(product.price * quantity)}`}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
