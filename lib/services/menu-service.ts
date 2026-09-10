import { DomainError } from "../api/domain-error";
import type { MenuRepository } from "../repositories/menu-repository";
import type { CatalogTranslations } from "../i18n/catalog-localization";
import { normalizeMenuLocale } from "../i18n/catalog-localization";
import { loadMenuCatalog } from "../i18n/menu-catalog";
import { categoryKeyBySlug } from "../i18n/menu-content";

export interface PublicMenuProduct {
  readonly id: string;
  readonly categoryId: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  /** Exact major-unit decimal from PostgreSQL; never a JavaScript float. */
  readonly price: string;
  readonly imageUrl: string | null;
  readonly weightLabel: string | null;
  readonly isAvailable: boolean;
  readonly isFeatured: boolean;
  readonly isPopular?: boolean;
  readonly isSpicy: boolean;
  readonly isVegetarian: boolean;
  readonly allergens: readonly string[];
  readonly tags: readonly string[];
  readonly sortOrder: number;
  readonly version: number;
  readonly translations?: CatalogTranslations;
}

export interface PublicMenuCategory {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly imageUrl: string | null;
  readonly sortOrder: number;
  readonly translations?: CatalogTranslations;
  readonly products: readonly PublicMenuProduct[];
}

export interface PublicMenuResult {
  readonly restaurant: {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
    readonly logoUrl: string | null;
    readonly phone: string | null;
    readonly address: string | null;
    readonly currency: string;
    readonly timezone: string;
    readonly defaultLocale: string;
  };
  readonly settings: {
    readonly menuEnabled: boolean;
    readonly orderingEnabled: boolean;
    readonly customerNotesEnabled: boolean;
    readonly menuImagesEnabled: boolean;
    readonly serviceFeeRate: string;
    readonly taxRate: string;
    readonly maxItemQuantity: number;
    readonly orderNotesMaxLength: number;
  };
  readonly categories: readonly PublicMenuCategory[];
}

const DEFAULT_PUBLIC_SETTINGS: PublicMenuResult["settings"] = {
  menuEnabled: true,
  orderingEnabled: false,
  customerNotesEnabled: false,
  menuImagesEnabled: true,
  serviceFeeRate: "0.00",
  taxRate: "0.00",
  maxItemQuantity: 20,
  orderNotesMaxLength: 500,
};

export class MenuService {
  constructor(private readonly repository: MenuRepository) {}

  async getPublicMenu(restaurantId: string, requestedLocale?: string | null): Promise<PublicMenuResult> {
    const records = await this.repository.findPublicMenuByRestaurantId(restaurantId);
    if (!records.restaurant) {
      throw new DomainError("NOT_FOUND", "Restoran bulunamadı.", { httpStatus: 404 });
    }
    if (records.settings && !records.settings.menuEnabled) {
      throw new DomainError("NOT_FOUND", "Menü bulunamadı.", { httpStatus: 404 });
    }
    const locale = requestedLocale ? normalizeMenuLocale(requestedLocale) : null;
    const defaultLocale = normalizeMenuLocale(records.restaurant.defaultLocale);
    const staticCatalog = locale ? await loadMenuCatalog(locale) : null;

    const categoryTranslations = new Map<string, Record<string, { name: string; description: string | null }>>();
    for (const translation of records.categoryTranslations ?? []) {
      const values = categoryTranslations.get(translation.categoryId) ?? {};
      values[translation.locale] = { name: translation.name, description: translation.description };
      categoryTranslations.set(translation.categoryId, values);
    }

    const productTranslations = new Map<string, Record<string, { name: string; description: string | null }>>();
    for (const translation of records.productTranslations ?? []) {
      const values = productTranslations.get(translation.productId) ?? {};
      values[translation.locale] = { name: translation.name, description: translation.description };
      productTranslations.set(translation.productId, values);
    }

    const productsByCategory = new Map<string, PublicMenuProduct[]>();
    for (const product of records.products) {
      const current = productsByCategory.get(product.categoryId) ?? [];
      const translations = productTranslations.get(product.id) ?? {};
      const requested = locale ? translations[locale] : null;
      const staticTranslation = locale ? staticCatalog?.products[product.slug] : null;
      const fallback = translations[defaultLocale];
      current.push({
        ...product,
        name: requested?.name || staticTranslation?.name || fallback?.name || product.name,
        description:
          requested?.description
          || staticTranslation?.description
          || fallback?.description
          || product.description,
        translations,
      });
      productsByCategory.set(product.categoryId, current);
    }

    return {
      restaurant: { ...records.restaurant },
      settings: records.settings ? { ...records.settings } : DEFAULT_PUBLIC_SETTINGS,
      categories: records.categories.map((category) => {
        const translations = categoryTranslations.get(category.id) ?? {};
        const requested = locale ? translations[locale] : null;
        const staticName = locale
          ? staticCatalog?.categories[categoryKeyBySlug[category.slug] ?? category.slug]
          : null;
        const fallback = translations[defaultLocale];
        return {
          ...category,
          name: requested?.name || staticName || fallback?.name || category.name,
          description: requested?.description || fallback?.description || category.description,
          translations,
          products: productsByCategory.get(category.id) ?? [],
        };
      }),
    };
  }
}
