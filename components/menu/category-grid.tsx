"use client";

import Image from "next/image";
import { useMenuPreferences } from "@/components/menu/menu-preferences-provider";
import { getMenuCategoryName } from "@/lib/i18n/menu-content";
import type { Category } from "@/types";

export interface MenuCategory extends Category {
  image: string;
}

interface CategoryGridProps {
  categories: MenuCategory[];
  onSelect: (category: MenuCategory) => void;
}

export function CategoryGrid({ categories, onSelect }: CategoryGridProps) {
  const { language, t } = useMenuPreferences();

  return (
    <nav aria-label={t("categoryNavigation")}>
      <ul className="grid grid-cols-2 gap-3 sm:gap-4">
        {categories.map((category) => {
          const categoryName = getMenuCategoryName(category, language);
          return (
          <li key={category.id} className="min-w-0">
            <button
              id={`menu-category-${category.id}`}
              type="button"
              disabled={!category.active}
              onClick={() => onSelect(category)}
              aria-label={t("openCategory", { name: categoryName, count: category.productCount })}
              className="group w-full overflow-hidden rounded-2xl border border-border bg-card text-start shadow-[0_12px_32px_rgba(104,31,37,0.055)] transition-[transform,border-color,box-shadow] duration-200 hover:border-copper/70 hover:shadow-[0_16px_36px_rgba(104,31,37,0.09)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-cream active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
            >
              <span className="relative block aspect-[4/3] overflow-hidden bg-muted">
                <Image
                  src={category.image}
                  alt=""
                  fill
                  sizes="(max-width: 1023px) 50vw, 33vw"
                  className="object-cover transition-transform duration-300 group-hover:scale-[1.025] group-disabled:grayscale motion-reduce:transition-none"
                />
              </span>

              <span className="block min-h-20 px-3 py-3 sm:min-h-24 sm:px-4 sm:py-4">
                <span className="block font-heading text-base font-semibold leading-tight text-foreground sm:text-lg">
                  {categoryName}
                </span>
                <span className="mt-1 block text-xs font-medium tabular-nums text-muted-foreground sm:text-sm">
                  {category.productCount} {t("items")}
                </span>
              </span>
            </button>
          </li>
          );
        })}
      </ul>
    </nav>
  );
}
