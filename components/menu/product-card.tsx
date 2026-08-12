"use client";

import Image from "next/image";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useMenuPreferences } from "@/components/menu/menu-preferences-provider";
import { getMenuProductDescription, getMenuProductName, getMenuTag } from "@/lib/i18n/menu-content";
import type { Product } from "@/types";
import { useRevealOnce } from "@/lib/motion/use-reveal-once";
import { MotionValue } from "@/components/shared/motion-value";

export function ProductCard({ product, index = 0, onOpen, onAdd }: { product: Product; index?: number; onOpen: () => void; onAdd: () => void }) {
  const { formatPrice, language, t } = useMenuPreferences();
  const soldOut = product.status === "sold-out";
  const name = getMenuProductName(product, language);
  const description = getMenuProductDescription(product, language);
  const { ref, revealed, animate } = useRevealOnce<HTMLElement>(`product-${product.id}`);

  return (
    <article ref={ref} data-revealed={revealed} data-reveal-animate={animate} className="motion-reveal motion-card-hover group relative grid min-h-44 grid-cols-[7.75rem_minmax(0,1fr)] overflow-hidden rounded-[var(--menu-card-radius)] border bg-card shadow-[0_12px_32px_rgba(104,31,37,0.055)] sm:grid-cols-[10rem_minmax(0,1fr)]" style={{ "--motion-delay": `${Math.min(index * 20, 80)}ms` } as React.CSSProperties}>
      <button type="button" onClick={onOpen} className="motion-card-trigger motion-press motion-ripple absolute inset-0 z-[1] rounded-2xl text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" aria-label={t("productDetails", { name })} />
      <div className="motion-card-media pointer-events-none relative overflow-hidden">
        <Image src={product.image} alt={name} fill sizes="(max-width: 640px) 124px, 160px" className={`motion-product-image object-cover ${soldOut ? "grayscale-[0.55]" : ""}`} onLoad={(event) => { event.currentTarget.dataset.loaded = "true"; }} />
        {soldOut ? <div className="absolute inset-0 bg-[#25211D]/25" /> : null}
      </div>
      <div className="pointer-events-none relative flex min-w-0 flex-col p-[var(--menu-card-padding)]">
        <div>
          <div className="flex flex-wrap gap-1.5">
            {product.tags.slice(0, 2).map((tag) => <Badge key={tag} variant="outline" className="border-copper/35 bg-copper/10 px-1.5 py-0 text-[10px] font-semibold text-burgundy">{getMenuTag(tag, language)}</Badge>)}
            {soldOut ? <Badge variant="outline" className="border-rose-200 bg-rose-50 px-1.5 py-0 text-[10px] text-rose-800">{t("soldOut")}</Badge> : null}
          </div>
          <h2 className="mt-2 font-heading text-lg font-semibold leading-tight text-foreground sm:text-xl">{name}</h2>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground sm:text-sm">{description}</p>
        </div>
        <div className="mt-auto flex items-end justify-between gap-2 pt-3">
          <MotionValue value={formatPrice(product.price)} numericValue={product.price} delayMs={Math.min(index * 10, 40)} className="text-base font-extrabold tabular-nums text-burgundy sm:text-lg" />
          <Button type="button" size="icon" disabled={soldOut} onClick={onAdd} aria-label={`${name}: ${t("addToCart")}`} className="pointer-events-auto relative z-10 size-11 rounded-xl shadow-sm">
            <Plus className="size-5" strokeWidth={2.2} />
          </Button>
        </div>
      </div>
    </article>
  );
}
