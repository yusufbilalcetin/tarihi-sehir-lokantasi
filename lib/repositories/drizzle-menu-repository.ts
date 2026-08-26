import "server-only";

import { and, asc, eq, isNull, sql } from "drizzle-orm";

import type { Database } from "../../db";
import {
  categories,
  products,
  popularProductSnapshots,
  restaurants,
  restaurantSettings,
} from "../../db/schema";
import type { MenuRepository, PublicMenuRecords } from "./menu-repository";

export class DrizzleMenuRepository implements MenuRepository {
  constructor(private readonly db: Database) {}

  async findPublicMenuByRestaurantId(restaurantId: string): Promise<PublicMenuRecords> {
    const [restaurantRows, settingsRows, categoryRows, productRows] = await Promise.all([
      this.db
        .select({
          id: restaurants.id,
          name: restaurants.name,
          slug: restaurants.slug,
          logoUrl: restaurants.logoUrl,
          phone: restaurants.phone,
          address: restaurants.address,
          currency: restaurants.currency,
          timezone: restaurants.timezone,
          defaultLocale: restaurants.defaultLocale,
        })
        .from(restaurants)
        .where(and(eq(restaurants.id, restaurantId), eq(restaurants.isActive, true)))
        .limit(1),
      this.db
        .select({
          menuEnabled: restaurantSettings.menuEnabled,
          orderingEnabled: restaurantSettings.orderingEnabled,
          customerNotesEnabled: restaurantSettings.customerNotesEnabled,
          menuImagesEnabled: restaurantSettings.menuImagesEnabled,
          serviceFeeRate: restaurantSettings.serviceFeeRate,
          taxRate: restaurantSettings.taxRate,
          maxItemQuantity: restaurantSettings.maxItemQuantity,
          orderNotesMaxLength: restaurantSettings.orderNotesMaxLength,
        })
        .from(restaurantSettings)
        .where(eq(restaurantSettings.restaurantId, restaurantId))
        .limit(1),
      this.db
        .select({
          id: categories.id,
          name: categories.name,
          slug: categories.slug,
          description: categories.description,
          imageUrl: categories.imageUrl,
          sortOrder: categories.sortOrder,
        })
        .from(categories)
        .where(
          and(
            eq(categories.restaurantId, restaurantId),
            eq(categories.isActive, true),
            isNull(categories.deletedAt),
          ),
        )
        .orderBy(asc(categories.sortOrder), asc(categories.name)),
      this.db
        .select({
          id: products.id,
          categoryId: products.categoryId,
          name: products.name,
          slug: products.slug,
          description: products.description,
          price: products.price,
          imageUrl: products.imageUrl,
          weightLabel: products.weightLabel,
          isAvailable: products.isAvailable,
          isFeatured: products.isFeatured,
          isPopular: sql<boolean>`${popularProductSnapshots.productId} is not null`,
          isSpicy: products.isSpicy,
          isVegetarian: products.isVegetarian,
          allergens: products.allergens,
          tags: products.tags,
          sortOrder: products.sortOrder,
          version: products.version,
        })
        .from(products)
        .innerJoin(
          categories,
          and(
            eq(categories.restaurantId, products.restaurantId),
            eq(categories.id, products.categoryId),
          ),
        )
        .leftJoin(
          popularProductSnapshots,
          and(
            eq(popularProductSnapshots.restaurantId, products.restaurantId),
            eq(popularProductSnapshots.productId, products.id),
            eq(popularProductSnapshots.windowDays, 30),
          ),
        )
        .where(
          and(
            eq(products.restaurantId, restaurantId),
            eq(products.isActive, true),
            isNull(products.deletedAt),
            eq(categories.isActive, true),
            isNull(categories.deletedAt),
          ),
        )
        .orderBy(asc(products.sortOrder), asc(products.name)),
    ]);

    return {
      restaurant: restaurantRows[0] ?? null,
      settings: settingsRows[0] ?? null,
      categories: categoryRows,
      products: productRows,
    };
  }
}
