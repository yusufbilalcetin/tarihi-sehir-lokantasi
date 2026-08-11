import Image from "next/image";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/format";
import type { Product } from "@/types";

export function ProductCard({ product, onOpen, onAdd }: { product: Product; onOpen: () => void; onAdd: () => void }) {
  const soldOut = product.status === "sold-out";

  return (
    <article className="group relative grid min-h-44 grid-cols-[7.75rem_1fr] overflow-hidden rounded-2xl border bg-card shadow-[0_12px_32px_rgba(104,31,37,0.055)] sm:grid-cols-[10rem_1fr]">
      <button type="button" onClick={onOpen} className="absolute inset-0 z-[1] rounded-2xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" aria-label={`${product.name} detayını aç`} />
      <div className="pointer-events-none relative overflow-hidden">
        <Image src={product.image} alt={product.name} fill sizes="(max-width: 640px) 124px, 160px" className={`object-cover transition-transform duration-300 group-hover:scale-[1.025] ${soldOut ? "grayscale-[0.55]" : ""}`} />
        {soldOut ? <div className="absolute inset-0 bg-[#25211D]/25" /> : null}
      </div>
      <div className="pointer-events-none relative flex min-w-0 flex-col p-3.5 sm:p-4">
        <div>
          <div className="flex flex-wrap gap-1.5">
            {product.tags.slice(0, 2).map((tag) => <Badge key={tag} variant="outline" className="border-copper/35 bg-copper/10 px-1.5 py-0 text-[10px] font-semibold text-burgundy">{tag}</Badge>)}
            {soldOut ? <Badge variant="outline" className="border-rose-200 bg-rose-50 px-1.5 py-0 text-[10px] text-rose-800">Bugün Tükendi</Badge> : null}
          </div>
          <h2 className="mt-2 font-heading text-lg font-semibold leading-tight text-foreground sm:text-xl">{product.name}</h2>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground sm:text-sm">{product.description}</p>
        </div>
        <div className="mt-auto flex items-end justify-between gap-2 pt-3">
          <span className="text-base font-extrabold tabular-nums text-burgundy sm:text-lg">{formatCurrency(product.price)}</span>
          <Button type="button" size="icon" disabled={soldOut} onClick={onAdd} aria-label={`${product.name} sepete ekle`} className="pointer-events-auto relative z-10 size-11 rounded-xl shadow-sm">
            <Plus className="size-5" strokeWidth={2.2} />
          </Button>
        </div>
      </div>
    </article>
  );
}
