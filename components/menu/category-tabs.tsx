"use client";

import type { Category } from "@/types";
import { cn } from "@/lib/utils";
import { useMenuPreferences } from "./menu-preferences-provider";
import { getMenuCategoryName } from "@/lib/i18n/menu-content";

export function CategoryTabs({ categories, activeId, onChange }: { categories: Category[]; activeId: string; onChange: (id: string) => void }) {
  const { language, t } = useMenuPreferences();
  return (
    <nav aria-label={t("categoryNavigation")} className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:-mx-6 sm:px-6">
      <div className="flex w-max gap-2 pb-1">
        {categories.map((category) => (
          <button
            key={category.id}
            type="button"
            onClick={() => onChange(category.id)}
            aria-current={activeId === category.id ? "page" : undefined}
            className={cn(
              "min-h-11 whitespace-nowrap rounded-xl border px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              activeId === category.id
                ? "border-burgundy bg-burgundy text-[#FFFDF8]"
                : "border-border bg-card text-muted-foreground hover:border-copper/70 hover:text-foreground",
            )}
          >
            {getMenuCategoryName(category, language)}
          </button>
        ))}
      </div>
    </nav>
  );
}
