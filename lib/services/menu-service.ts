import { DomainError } from "../api/domain-error";
import type { MenuRepository } from "../repositories/menu-repository";

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
}

export interface PublicMenuCategory {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly imageUrl: string | null;
  readonly sortOrder: number;
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

  async getPublicMenu(restaurantId: string): Promise<PublicMenuResult> {
    const records = await this.repository.findPublicMenuByRestaurantId(restaurantId);
    if (!records.restaurant) {
      throw new DomainError("NOT_FOUND", "Restoran bulunamadı.", { httpStatus: 404 });
    }
    if (records.settings && !records.settings.menuEnabled) {
      throw new DomainError("NOT_FOUND", "Menü bulunamadı.", { httpStatus: 404 });
    }

    const productsByCategory = new Map<string, PublicMenuProduct[]>();
    for (const product of records.products) {
      const current = productsByCategory.get(product.categoryId) ?? [];
      current.push({ ...product });
      productsByCategory.set(product.categoryId, current);
    }

    return {
      restaurant: { ...records.restaurant },
      settings: records.settings ? { ...records.settings } : DEFAULT_PUBLIC_SETTINGS,
      categories: records.categories.map((category) => ({
        ...category,
        products: productsByCategory.get(category.id) ?? [],
      })),
    };
  }
}
