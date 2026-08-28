"use client";

import type { ReactNode } from "react";
import { UtensilsCrossed } from "lucide-react";

import { HighlightCard } from "@/components/menu/highlight-card";
import { useMenuPreferences } from "@/components/menu/menu-preferences-provider";
import { ProductCard } from "@/components/menu/product-card";
import type { CustomerMenuSections } from "@/lib/adapters/customer-menu-sections";
import type { MenuViewCategory } from "@/lib/adapters/menu-view-model";
import { getMenuCategoryName, getMenuTag } from "@/lib/i18n/menu-content";
import { cn } from "@/lib/utils";
import type { Product } from "@/types";

/**
 * The body of the menu: two rails of suggestions, then every category as its
 * own titled chapter.
 *
 * This exists so there is exactly one of it. The administrator's editor is the
 * guest's menu — not a drawing of it — so the markup a guest reads and the
 * markup an administrator clicks on have to be the same file, or they drift
 * apart the first time either is touched.
 *
 * Editing is added by decoration, never by a second tree: the optional render
 * props hang a control off a heading or a card and are simply absent on the
 * public menu, so nothing admin-shaped reaches a guest's bundle.
 */

export interface MenuSectionsProps extends CustomerMenuSections {
  readonly canOrder?: boolean;
  readonly onOpenProduct: (product: Product) => void;
  readonly onAddProduct: (product: Product) => void;
  /** Admin only: a control beside a category heading. */
  readonly renderCategoryAction?: (category: MenuViewCategory) => ReactNode;
  /** Admin only: a control layered over one dish. */
  readonly renderProductAction?: (product: Product, index: number, total: number) => ReactNode;
  /** Admin only: a control beside the chef's rail heading. */
  readonly renderFeaturedAction?: () => ReactNode;
  /** Admin only: categories that are visible but have nothing to show. */
  readonly emptyCategories?: readonly MenuViewCategory[];
  readonly emptyState?: ReactNode;
}

function Rail({
  title,
  action,
  products,
  onOpen,
  idPrefix,
}: {
  readonly title: string;
  readonly action?: ReactNode;
  readonly products: readonly Product[];
  readonly onOpen: (product: Product) => void;
  readonly idPrefix: string;
}) {
  return (
    <section className="mb-7" aria-labelledby={`${idPrefix}-title`}>
      <div className="mb-2.5 flex items-center gap-2">
        <h2 id={`${idPrefix}-title`} className="font-heading text-lg font-semibold text-text-primary">
          {title}
        </h2>
        {action}
      </div>
      <div className="-mx-[var(--menu-gutter)] flex snap-x snap-mandatory gap-2.5 overflow-x-auto px-[var(--menu-gutter)] pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {products.map((product) => (
          <div key={`${idPrefix}-${product.id}`} className="w-[17rem] shrink-0 snap-start">
            <HighlightCard product={product} onOpen={() => onOpen(product)} />
          </div>
        ))}
      </div>
    </section>
  );
}

export function MenuSections({
  sections,
  featured,
  popular,
  canOrder = true,
  onOpenProduct,
  onAddProduct,
  renderCategoryAction,
  renderProductAction,
  renderFeaturedAction,
  emptyCategories,
  emptyState,
}: MenuSectionsProps) {
  const { language, t } = useMenuPreferences();

  if (sections.length === 0 && !emptyCategories?.length) {
    return <>{emptyState}</>;
  }

  return (
    <>
      {/*
        Discovery, capped at three.

        These rails used to carry full-size product cards, so the top of the
        menu was a second copy of dishes the guest was about to meet again
        under their own category. Three small suggestions is a recommendation;
        ten full cards is the menu twice.
      */}
      {popular.length ? (
        <Rail
          idPrefix="popular-products"
          title={getMenuTag("Popüler", language)}
          products={popular}
          onOpen={onOpenProduct}
        />
      ) : null}

      {featured.length ? (
        <Rail
          idPrefix="featured-products"
          title={getMenuTag("Şefin Önerisi", language)}
          action={renderFeaturedAction?.()}
          products={featured}
          onOpen={onOpenProduct}
        />
      ) : null}

      <div data-customer-menu-content="category-sections" className="space-y-7">
        {sections.map(({ category, products }) => (
          <section key={category.id} aria-labelledby={`menu-category-${category.id}`}>
            <div className="mb-3 flex items-end justify-between gap-4 border-b border-border/50 pb-2">
              <div className="flex min-w-0 items-center gap-2">
                <h2
                  id={`menu-category-${category.id}`}
                  className="font-heading text-[22px] font-semibold text-text-primary sm:text-3xl"
                >
                  {getMenuCategoryName(category, language)}
                </h2>
                {renderCategoryAction?.(category)}
              </div>
              <p className="shrink-0 text-xs font-medium tabular-nums text-[#70665C]">
                {t("itemCount", { count: products.length })}
              </p>
            </div>
            <div className="grid gap-2 lg:grid-cols-2 lg:gap-3">
              {products.map((product, index) => {
                const card = (
                  <ProductCard
                    product={product}
                    index={index}
                    canOrder={canOrder}
                    onOpen={() => onOpenProduct(product)}
                    onAdd={() => onAddProduct(product)}
                  />
                );
                const action = renderProductAction?.(product, index, products.length);
                return action ? (
                  <div key={product.id} className="group/edit relative">
                    {card}
                    {action}
                  </div>
                ) : (
                  <div key={product.id}>{card}</div>
                );
              })}
            </div>
          </section>
        ))}

        {/* Administrator-only: a category the guest will not be shown, said
            plainly rather than left as a silent gap in the menu. */}
        {emptyCategories?.map((category) => (
          <section key={`empty-${category.id}`} aria-labelledby={`menu-category-${category.id}`}>
            <div className="mb-3 flex items-end justify-between gap-4 border-b border-border/50 pb-2">
              <div className="flex min-w-0 items-center gap-2">
                <h2
                  id={`menu-category-${category.id}`}
                  className={cn(
                    "font-heading text-[22px] font-semibold text-text-primary sm:text-3xl",
                    "opacity-55",
                  )}
                >
                  {getMenuCategoryName(category, language)}
                </h2>
                {renderCategoryAction?.(category)}
              </div>
            </div>
            <p className="flex items-center gap-2 rounded-xl border border-dashed border-border/70 px-4 py-6 text-sm text-text-muted">
              <UtensilsCrossed className="size-4 shrink-0" aria-hidden="true" />
              Bu kategoride görünür ürün yok. Müşteri menüsünde gösterilmez.
            </p>
          </section>
        ))}
      </div>
    </>
  );
}
