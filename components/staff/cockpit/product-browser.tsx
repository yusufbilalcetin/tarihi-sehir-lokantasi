"use client";

import { useCallback, useMemo, useState } from "react";
import Image from "next/image";
import { Plus, Search, UtensilsCrossed } from "lucide-react";

import { Input } from "@/components/ui/input";
import { staffApi } from "@/lib/api/endpoints";
import { formatCurrency } from "@/lib/format";
import { useApiResource } from "@/lib/hooks/use-api-resource";
import { cn } from "@/lib/utils";

/**
 * The middle column: what a waiter can put on a table.
 *
 * It reads the same `/api/staff/menu` payload the order pad has always used and
 * hands product ids upward — no price, tax or total is computed here, because
 * the order transaction locks those from the product rows server-side. This
 * component only ever answers "which dish did they tap".
 */

export interface BrowserCategory {
  readonly id: string;
  readonly name: string;
  readonly count: number;
}

interface BrowserProduct {
  readonly id: string;
  readonly name: string;
  readonly price: string;
  readonly imageUrl: string | null;
  readonly categoryId: string;
  readonly categoryName: string;
  readonly isAvailable: boolean;
}

export function useStaffMenu() {
  const loadMenu = useCallback((signal: AbortSignal) => staffApi.menu(signal), []);
  const menu = useApiResource(loadMenu);

  const products = useMemo<readonly BrowserProduct[]>(
    () =>
      (menu.data?.categories ?? []).flatMap((category) =>
        category.products.map((product) => ({
          id: product.id,
          name: product.name,
          price: product.price,
          imageUrl: product.imageUrl,
          categoryId: category.id,
          categoryName: category.name,
          isAvailable: product.isAvailable,
        })),
      ),
    [menu.data],
  );

  const categories = useMemo<readonly BrowserCategory[]>(
    () =>
      (menu.data?.categories ?? []).map((category) => ({
        id: category.id,
        name: category.name,
        count: category.products.length,
      })),
    [menu.data],
  );

  return { categories, products, loading: menu.loading, error: menu.error };
}

export function ProductBrowser({
  products,
  activeCategoryId,
  canAdd,
  pendingProductId,
  onAdd,
  loading,
  className,
}: {
  readonly products: readonly BrowserProduct[];
  readonly activeCategoryId: string | null;
  /** False until a table is chosen: a dish has to land somewhere. */
  readonly canAdd: boolean;
  readonly pendingProductId: string | null;
  readonly onAdd: (productId: string) => void;
  readonly loading: boolean;
  readonly className?: string;
}) {
  const [search, setSearch] = useState("");

  const visible = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("tr-TR");
    return products.filter((product) => {
      if (activeCategoryId && product.categoryId !== activeCategoryId) return false;
      if (!term) return true;
      return (
        product.name.toLocaleLowerCase("tr-TR").includes(term) ||
        product.categoryName.toLocaleLowerCase("tr-TR").includes(term)
      );
    });
  }, [activeCategoryId, products, search]);

  return (
    <section className={cn("flex min-h-0 flex-col", className)} aria-labelledby="product-browser-title">
      <div className="flex flex-wrap items-center gap-3 pb-3">
        <h2 id="product-browser-title" className="font-heading text-lg font-semibold text-text-primary">
          Ürünler
        </h2>
        <div className="relative ms-auto w-full min-w-0 sm:w-64">
          <Search
            className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-text-muted"
            strokeWidth={1.8}
            aria-hidden="true"
          />
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            placeholder="Ürün ara..."
            aria-label="Ürün ara"
            className="h-11 ps-9"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {loading && !products.length ? (
          <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-3 2xl:grid-cols-4">
            {Array.from({ length: 6 }, (_, index) => (
              <div
                key={index}
                className="h-40 animate-pulse rounded-xl border border-border-subtle bg-surface-muted/60 motion-reduce:animate-none"
              />
            ))}
          </div>
        ) : visible.length ? (
          <ul className="grid grid-cols-2 gap-2.5 xl:grid-cols-3 2xl:grid-cols-4">
            {visible.map((product) => (
              <li key={product.id} className="h-full">
                <button
                  type="button"
                  disabled={!canAdd || !product.isAvailable || pendingProductId === product.id}
                  onClick={() => onAdd(product.id)}
                  className={cn(
                    "motion-press group flex h-full w-full flex-col overflow-hidden rounded-xl border border-border-subtle bg-surface-raised text-start",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
                    "enabled:hover:border-copper/50 disabled:opacity-55",
                  )}
                  aria-label={
                    canAdd
                      ? `${product.name}, ${formatCurrency(Number(product.price))}. Seçili masaya ekle.`
                      : `${product.name}. Eklemek için önce bir masa seçin.`
                  }
                >
                  <span className="relative block aspect-[4/3] w-full overflow-hidden bg-surface-muted">
                    {product.imageUrl ? (
                      <Image
                        src={product.imageUrl}
                        alt=""
                        fill
                        sizes="(max-width: 1024px) 45vw, 220px"
                        className="object-cover"
                      />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center bg-sidebar">
                        <UtensilsCrossed className="size-6 text-gold/70" strokeWidth={1.5} aria-hidden="true" />
                      </span>
                    )}
                    {product.isAvailable ? null : (
                      <span className="absolute inset-x-0 bottom-0 bg-order-void/85 px-2 py-1 text-center text-[11px] font-bold text-white">
                        Tükendi
                      </span>
                    )}
                  </span>

                  <span className="flex min-h-[4.25rem] flex-1 flex-col p-2.5">
                    <span className="line-clamp-2 min-h-9 text-sm font-semibold leading-[1.15rem] text-text-primary">
                      {product.name}
                    </span>
                    <span className="mt-auto flex items-center justify-between gap-2 pt-1.5">
                      <span className="text-sm font-extrabold tabular-nums text-burgundy">
                        {formatCurrency(Number(product.price))}
                      </span>
                      <span
                        aria-hidden="true"
                        className={cn(
                          "flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground",
                          (!canAdd || !product.isAvailable) && "bg-surface-muted text-text-muted",
                        )}
                      >
                        <Plus className="size-4" strokeWidth={2.4} />
                      </span>
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed border-border/70 bg-surface-raised px-4 py-8 text-center text-sm text-text-muted">
            {search.trim() ? "Aramayla eşleşen ürün yok." : "Bu kategoride ürün yok."}
          </p>
        )}
      </div>
    </section>
  );
}
