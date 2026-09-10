export interface MenuRestaurantRecord {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly logoUrl: string | null;
  readonly phone: string | null;
  readonly address: string | null;
  readonly currency: string;
  readonly timezone: string;
  readonly defaultLocale: string;
}

export interface MenuSettingsRecord {
  readonly menuEnabled: boolean;
  readonly orderingEnabled: boolean;
  readonly customerNotesEnabled: boolean;
  readonly menuImagesEnabled: boolean;
  readonly serviceFeeRate: string;
  readonly taxRate: string;
  readonly maxItemQuantity: number;
  readonly orderNotesMaxLength: number;
}

export interface MenuCategoryRecord {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly imageUrl: string | null;
  readonly sortOrder: number;
}

export interface MenuCategoryTranslationRecord {
  readonly categoryId: string;
  readonly locale: string;
  readonly name: string;
  readonly description: string | null;
}

export interface MenuProductRecord {
  readonly id: string;
  readonly categoryId: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  /** Exact PostgreSQL numeric value. */
  readonly price: string;
  readonly imageUrl: string | null;
  readonly weightLabel: string | null;
  readonly isAvailable: boolean;
  readonly isFeatured: boolean;
  /** True only when present in the bounded sales-derived popularity snapshot. */
  readonly isPopular?: boolean;
  readonly isSpicy: boolean;
  readonly isVegetarian: boolean;
  readonly allergens: readonly string[];
  readonly tags: readonly string[];
  readonly sortOrder: number;
  readonly version: number;
}

export interface MenuProductTranslationRecord {
  readonly productId: string;
  readonly locale: string;
  readonly name: string;
  readonly description: string | null;
}

export interface PublicMenuRecords {
  readonly restaurant: MenuRestaurantRecord | null;
  readonly settings: MenuSettingsRecord | null;
  readonly categories: readonly MenuCategoryRecord[];
  readonly products: readonly MenuProductRecord[];
  readonly categoryTranslations?: readonly MenuCategoryTranslationRecord[];
  readonly productTranslations?: readonly MenuProductTranslationRecord[];
}

export interface MenuRepository {
  /** Must use a bounded number of set-based queries; never query once per category. */
  findPublicMenuByRestaurantId(restaurantId: string): Promise<PublicMenuRecords>;
}
