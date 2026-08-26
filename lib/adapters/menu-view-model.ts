import type { CustomerMenuPayload } from "@/lib/api/endpoints";
import type { PublicMenuResult } from "@/lib/services/menu-service";
import { categoryKeyBySlug } from "@/lib/i18n/menu-content";
import type { Category, Product } from "@/types";

export interface MenuViewCategory extends Category {
  image: string;
}

export interface MenuViewModel {
  readonly restaurantName: string;
  /** Null for a guest ordering online: the same menu, but no table. */
  readonly table: { readonly id: string; readonly name: string; readonly number: number } | null;
  readonly settings: CustomerMenuPayload["settings"];
  readonly categories: readonly MenuViewCategory[];
  readonly products: readonly Product[];
}

/**
 * Cover artwork for categories with no uploaded image of their own.
 *
 * These are `category-*` assets on purpose: a cover is a separate photograph
 * from any product card, so nobody can mistake one for the other or point a
 * category at a dish picture by editing a filename.
 */
const categoryImages: Record<string, string> = {
  soups: "/images/food/category-corbalar.jpg",
  grill: "/images/food/category-izgaralar.jpg",
  mains: "/images/food/category-ana-yemekler.jpg",
  drinks: "/images/food/category-icecekler.jpg",
  kebabs: "/images/food/category-kebaplar.jpg",
  dessert: "/images/food/category-tatlilar.jpg",
};

/**
 * Neutral artwork for entries with no image of their own. It must never be a
 * photograph of a real dish: a product without a picture has to look like a
 * product without a picture, not like whichever dish the fallback points at.
 */
export const MENU_PLACEHOLDER_IMAGE = "/images/placeholder-dish.webp";

function categoryTranslationKey(slug: string): string {
  return categoryKeyBySlug[slug] ?? slug;
}

/** Treats null, undefined and blank strings alike: all mean "no image". */
function imageOrPlaceholder(imageUrl: string | null | undefined, fallback: string): string {
  const trimmed = imageUrl?.trim();
  return trimmed ? trimmed : fallback;
}

/**
 * The API speaks database shapes (UUIDs, decimal strings); the menu components
 * were built against the fixture shape. Converting once here keeps entity
 * mapping out of every component.
 */
export function menuApiToViewModel(payload: CustomerMenuPayload | PublicMenuResult): MenuViewModel {
  const categories: MenuViewCategory[] = payload.categories.map((category) => {
    const key = categoryTranslationKey(category.slug);
    return {
      id: category.id,
      i18nKey: key,
      name: category.name,
      slug: category.slug,
      productCount: category.products.length,
      active: true,
      sortOrder: category.sortOrder,
      image: imageOrPlaceholder(category.imageUrl, categoryImages[key] ?? MENU_PLACEHOLDER_IMAGE),
    };
  });

  const products: Product[] = payload.categories.flatMap((category) =>
    category.products.map((product) => ({
      id: product.id,
      i18nKey: product.slug,
      name: product.name,
      description: product.description ?? "",
      price: Number(product.price),
      categoryId: category.id,
      category: category.name,
      image: imageOrPlaceholder(product.imageUrl, MENU_PLACEHOLDER_IMAGE),
      weight: product.weightLabel ?? undefined,
      allergens: [...product.allergens],
      tags: [...product.tags],
      status: product.isAvailable ? "active" : "sold-out",
      featured: product.isFeatured,
      popular: product.isPopular === true,
    })),
  );

  return {
    restaurantName: payload.restaurant.name,
    table: "table" in payload ? payload.table : null,
    settings: payload.settings,
    categories,
    products,
  };
}
