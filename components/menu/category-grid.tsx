"use client";

import Image from "next/image";
import { useMenuPreferences } from "@/components/menu/menu-preferences-provider";
import { getMenuCategoryName } from "@/lib/i18n/menu-content";
import type { Category } from "@/types";
import { useRevealOnce } from "@/lib/motion/use-reveal-once";

export interface MenuCategory extends Category {
  image: string;
}

interface CategoryGridProps {
  categories: MenuCategory[];
  onSelect: (category: MenuCategory, focusHeading: boolean) => void;
}

function CategoryCard({ category, index, onSelect }: { category: MenuCategory; index: number; onSelect: (category: MenuCategory, focusHeading: boolean) => void }) {
  const { language, t } = useMenuPreferences();
  const categoryName = getMenuCategoryName(category, language);
  const { ref, revealed, animate } = useRevealOnce<HTMLLIElement>(`category-${category.id}`);

  return (
    <li ref={ref} data-revealed={revealed} data-reveal-animate={animate} className="motion-reveal min-w-0" style={{ "--motion-delay": `${Math.min(index * 28, 112)}ms` } as React.CSSProperties}>
      <button
        id={`menu-category-${category.id}`}
        type="button"
        disabled={!category.active}
        onClick={(event) => onSelect(category, event.detail === 0)}
        aria-label={t("openCategory", { name: categoryName, count: category.productCount })}
        className="motion-press motion-ripple motion-card-hover motion-card-press group h-full w-full overflow-hidden rounded-[var(--menu-card-radius)] border border-border bg-card text-start shadow-[0_12px_32px_rgba(104,31,37,0.055)] hover:border-copper/70 hover:shadow-[0_16px_36px_rgba(104,31,37,0.09)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-cream disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="motion-card-media relative block aspect-[4/3] overflow-hidden bg-muted">
          <Image
            src={category.image}
            alt=""
            fill
            sizes="(max-width: 1023px) 50vw, 33vw"
            className="motion-product-image object-cover group-disabled:grayscale"
            onLoad={(event) => { event.currentTarget.dataset.loaded = "true"; }}
          />
        </span>

        <span className="block min-h-24 p-[var(--menu-card-padding)]">
          <span className="block font-heading text-base font-semibold leading-tight text-foreground sm:text-lg">{categoryName}</span>
          <span className="mt-1 block text-xs font-medium tabular-nums text-muted-foreground sm:text-sm">{t("itemCount", { count: category.productCount })}</span>
        </span>
      </button>
    </li>
  );
}

export function CategoryGrid({ categories, onSelect }: CategoryGridProps) {
  const { t } = useMenuPreferences();

  return (
    <nav aria-label={t("categoryNavigation")}>
      <ul className="grid grid-cols-2 gap-[var(--menu-grid-gap)]">
        {categories.map((category, index) => <CategoryCard key={category.id} category={category} index={index} onSelect={onSelect} />)}
      </ul>
    </nav>
  );
}
