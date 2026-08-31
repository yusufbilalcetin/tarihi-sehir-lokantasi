import type { CustomerMenuPayload } from "@/lib/api/endpoints";
import type {
  AdminCategoryResult,
  AdminProductResult,
} from "@/lib/services/admin-menu-service";
import type { PublicMenuResult } from "@/lib/services/menu-service";
import { categoryKeyBySlug } from "@/lib/i18n/menu-content";
import type { Category, Product } from "@/types";

export interface MenuViewCategory extends Category {
  image: string;
}

/** The admin rows the preview reads, unsaved edits included. */
export type AdminMenuDraftCategory = AdminCategoryResult;
export type AdminMenuDraftProduct = AdminProductResult;

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
  // "Ürün fotoğrafları" is a real switch, not a label: with it off, dishes fall
  // back to the same no-photo mark a dish without a picture already gets, so
  // the menu stays whole instead of showing a grid of placeholders.
  const showPhotos = payload.settings.menuImagesEnabled;
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
      translations: category.translations,
      defaultLocale: payload.restaurant.defaultLocale,
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
      image: showPhotos
        ? imageOrPlaceholder(product.imageUrl, MENU_PLACEHOLDER_IMAGE)
        : MENU_PLACEHOLDER_IMAGE,
      weight: product.weightLabel ?? undefined,
      allergens: [...product.allergens],
      tags: [...product.tags],
      status: product.isAvailable ? "active" : "sold-out",
      featured: product.isFeatured,
      popular: product.isPopular === true,
      translations: product.translations,
      defaultLocale: payload.restaurant.defaultLocale,
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

/**
 * The administrator's working copy, seen the way a guest would see it.
 *
 * It deliberately goes the long way round — admin rows are shaped into the
 * public menu payload and then handed to {@link menuApiToViewModel} — so the
 * preview inherits every mapping rule the real menu uses (cover artwork,
 * placeholder images, sold-out status, translation keys) instead of growing a
 * second, drifting copy of them.
 *
 * The filters and the sort mirror the public SQL exactly: inactive or archived
 * rows are gone, a product inside a hidden category is gone with it, and the
 * order is `sort_order` then name.
 */
export function adminMenuToViewModel(input: {
  readonly restaurantName: string;
  readonly settings: CustomerMenuPayload["settings"];
  readonly categories: readonly AdminMenuDraftCategory[];
  readonly products: readonly AdminMenuDraftProduct[];
}): MenuViewModel {
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "tr");
  const visibleCategories = input.categories
    .filter((category) => category.isActive && !category.archived)
    .sort((a, b) => a.sortOrder - b.sortOrder || byName(a, b));

  const visibleProducts = input.products
    .filter((product) => product.isActive && !product.archived)
    .sort((a, b) => a.sortOrder - b.sortOrder || byName(a, b));

  return menuApiToViewModel({
    restaurant: {
      id: "preview",
      name: input.restaurantName,
      slug: "preview",
      logoUrl: null,
      phone: null,
      address: null,
      currency: "TRY",
      timezone: "Europe/Istanbul",
      defaultLocale: "tr",
    },
    settings: input.settings,
    categories: visibleCategories.map((category) => ({
      id: category.id,
      name: category.name,
      slug: category.slug,
      description: category.description,
      imageUrl: category.imageUrl,
      sortOrder: category.sortOrder,
      products: visibleProducts
        .filter((product) => product.categoryId === category.id)
        .map((product) => ({
          id: product.id,
          categoryId: product.categoryId,
          name: product.name,
          slug: product.slug,
          description: product.description,
          price: product.price,
          imageUrl: product.imageUrl,
          weightLabel: product.weightLabel,
          isAvailable: product.isAvailable,
          isFeatured: product.isFeatured,
          // Popularity is earned from real sales rather than chosen, so the
          // preview cannot know it and says so instead of guessing.
          isPopular: false,
          isSpicy: product.isSpicy,
          isVegetarian: product.isVegetarian,
          allergens: product.allergens,
          tags: product.tags,
          sortOrder: product.sortOrder,
          version: product.version,
          translations: product.translations,
        })),
      translations: category.translations,
    })),
  } satisfies PublicMenuResult);
}
