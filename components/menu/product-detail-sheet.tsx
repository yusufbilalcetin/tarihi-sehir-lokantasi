"use client";

import Image from "next/image";
import { Minus, Plus, Scale, ShieldAlert, X } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useMenuPreferences } from "@/components/menu/menu-preferences-provider";
import { getMenuAllergen, getMenuProductDescription, getMenuProductName, getMenuTag, getMenuWeight } from "@/lib/i18n/menu-content";
import type { Product } from "@/types";

export function ProductDetailSheet({ product, open, onOpenChange, onAdd }: { product: Product | null; open: boolean; onOpenChange: (open: boolean) => void; onAdd: (product: Product, quantity: number, note: string) => void }) {
  const { direction, formatNumber, formatPrice, language, t } = useMenuPreferences();
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState("");

  if (!product) return null;
  const soldOut = product.status === "sold-out";
  const name = getMenuProductName(product, language);
  const description = getMenuProductDescription(product, language);

  function handleAdd() {
    onAdd(product as Product, quantity, note.trim());
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir={direction} showCloseButton={false} className="flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-2xl flex-col gap-0 overflow-hidden rounded-3xl border-border p-0 sm:max-w-2xl">
        <DialogClose className="absolute end-3 top-3 z-10 inline-flex size-10 items-center justify-center rounded-xl bg-black/35 text-white backdrop-blur-sm transition-colors hover:bg-black/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper">
          <X className="size-4" aria-hidden="true" />
          <span className="sr-only">{t("close")}</span>
        </DialogClose>
        <div className="menu-dialog-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="relative aspect-[16/9] min-h-44 shrink-0 overflow-hidden rounded-t-3xl bg-muted sm:min-h-52">
          <Image src={product.image} alt={name} fill sizes="(max-width: 768px) 100vw, 672px" className="object-cover" />
          <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#25211D]/55 to-transparent" />
        </div>
        <DialogHeader className="items-center px-5 pb-0 pt-5 text-center sm:px-6">
          <div className="flex flex-wrap justify-center gap-2">{product.tags.map((tag) => <Badge key={tag} variant="outline" className="border-copper/40 bg-copper/10 text-burgundy">{getMenuTag(tag, language)}</Badge>)}</div>
          <DialogTitle className="mt-2 font-heading text-3xl font-semibold leading-tight">{name}</DialogTitle>
          <DialogDescription className="mx-auto max-w-xl text-sm leading-6">{description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 px-5 py-5 sm:grid-cols-2 sm:px-6">
          <div className="flex items-start gap-3 rounded-2xl border bg-background p-4">
            <Scale className="mt-0.5 size-5 text-copper" />
            <div><p className="text-xs font-semibold text-muted-foreground">{t("portion")}</p><p className="mt-0.5 text-sm font-bold">{product.weight ? getMenuWeight(product.weight, language) : t("standardPortion")}</p></div>
          </div>
          <div className="flex items-start gap-3 rounded-2xl border bg-background p-4">
            <ShieldAlert className="mt-0.5 size-5 text-copper" />
            <div><p className="text-xs font-semibold text-muted-foreground">{t("allergens")}</p><p className="mt-0.5 text-sm font-bold">{product.allergens.length ? product.allergens.map((item) => getMenuAllergen(item, language)).join(", ") : t("noAllergens")}</p></div>
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="product-note" className="mb-2 block text-sm font-semibold">{t("productNote")}</label>
            <Textarea id="product-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder={t("productNotePlaceholder")} className="min-h-20 bg-card" />
          </div>
        </div>
        </div>
        <DialogFooter className="sticky bottom-0 m-0 !grid grid-cols-[auto_minmax(0,1fr)] gap-4 rounded-none border-t bg-card/95 px-5 py-4 backdrop-blur sm:grid-cols-[auto_minmax(0,1fr)] sm:px-6">
            <div className="flex h-12 items-center rounded-xl border bg-background">
              <button type="button" className="touch-target flex items-center justify-center px-3" aria-label={t("decreaseQuantity")} onClick={() => setQuantity((value) => Math.max(1, value - 1))}><Minus className="size-4" /></button>
              <span className="min-w-8 text-center font-bold tabular-nums">{formatNumber(quantity)}</span>
              <button type="button" className="touch-target flex items-center justify-center px-3" aria-label={t("increaseQuantity")} onClick={() => setQuantity((value) => value + 1)}><Plus className="size-4" /></button>
            </div>
            <Button type="button" onClick={handleAdd} disabled={soldOut} className="h-12 flex-1 rounded-xl px-5 text-sm font-bold">
              {soldOut ? t("soldOut") : `${t("addToCart")} · ${formatPrice(product.price * quantity)}`}
            </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
