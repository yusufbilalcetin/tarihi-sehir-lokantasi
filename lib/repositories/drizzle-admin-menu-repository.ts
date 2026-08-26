import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { auditLogs, categories, outboxEvents, products } from "@/db/schema";
import type {
  AdminCategoryRecord,
  AdminMenuAuditInput,
  AdminMenuOutboxInput,
  AdminMenuRepository,
  AdminMenuTransactionRepository,
  AdminProductRecord,
  UpsertCategoryInput,
  UpsertProductInput,
} from "./admin-menu-repository";

type TransactionDatabase = Parameters<Parameters<Database["transaction"]>[0]>[0];

const CATEGORY_SELECTION = {
  id: categories.id,
  name: categories.name,
  slug: categories.slug,
  description: categories.description,
  imageUrl: categories.imageUrl,
  sortOrder: categories.sortOrder,
  isActive: categories.isActive,
  deletedAt: categories.deletedAt,
} as const;

const PRODUCT_SELECTION = {
  id: products.id,
  categoryId: products.categoryId,
  name: products.name,
  slug: products.slug,
  description: products.description,
  price: products.price,
  imageUrl: products.imageUrl,
  weightLabel: products.weightLabel,
  isActive: products.isActive,
  isAvailable: products.isAvailable,
  isFeatured: products.isFeatured,
  isSpicy: products.isSpicy,
  isVegetarian: products.isVegetarian,
  allergens: products.allergens,
  tags: products.tags,
  sortOrder: products.sortOrder,
  version: products.version,
  deletedAt: products.deletedAt,
} as const;

/** Only the fields the caller actually supplied reach the UPDATE statement. */
function definedOnly<TValue extends Record<string, unknown>>(value: TValue): TValue {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as TValue;
}

class DrizzleAdminMenuTransactionRepository implements AdminMenuTransactionRepository {
  constructor(private readonly db: TransactionDatabase) {}

  async findCategoryForUpdate(restaurantId: string, categoryId: string) {
    const rows = await this.db
      .select(CATEGORY_SELECTION)
      .from(categories)
      .where(and(eq(categories.restaurantId, restaurantId), eq(categories.id, categoryId)))
      .for("update")
      .limit(1);
    return rows[0] ?? null;
  }

  async findProductForUpdate(restaurantId: string, productId: string) {
    const rows = await this.db
      .select(PRODUCT_SELECTION)
      .from(products)
      .where(and(eq(products.restaurantId, restaurantId), eq(products.id, productId)))
      .for("update")
      .limit(1);
    return rows[0] ?? null;
  }

  async insertCategory(input: UpsertCategoryInput): Promise<AdminCategoryRecord | null> {
    const rows = await this.db
      .insert(categories)
      .values({
        restaurantId: input.restaurantId,
        name: input.name ?? "",
        slug: input.slug ?? "",
        description: input.description ?? null,
        sortOrder: input.sortOrder ?? 0,
        isActive: input.isActive ?? true,
        createdAt: input.at,
        updatedAt: input.at,
      })
      .returning(CATEGORY_SELECTION);
    return rows[0] ?? null;
  }

  async updateCategory(input: UpsertCategoryInput): Promise<AdminCategoryRecord | null> {
    const rows = await this.db
      .update(categories)
      .set(
        definedOnly({
          name: input.name,
          slug: input.slug,
          description: input.description,
          sortOrder: input.sortOrder,
          isActive: input.archived ? false : input.isActive,
          deletedAt: input.archived === undefined ? undefined : input.archived ? input.at : null,
          updatedAt: input.at,
        }),
      )
      .where(
        and(
          eq(categories.restaurantId, input.restaurantId),
          eq(categories.id, input.categoryId ?? ""),
        ),
      )
      .returning(CATEGORY_SELECTION);
    return rows[0] ?? null;
  }

  async insertProduct(input: UpsertProductInput): Promise<AdminProductRecord | null> {
    const rows = await this.db
      .insert(products)
      .values({
        restaurantId: input.restaurantId,
        categoryId: input.categoryId ?? "",
        name: input.name ?? "",
        slug: input.slug ?? "",
        description: input.description ?? null,
        price: input.price ?? "0.00",
        imageUrl: input.imageUrl ?? null,
        weightLabel: input.weightLabel ?? null,
        isActive: input.isActive ?? true,
        isAvailable: input.isAvailable ?? true,
        isFeatured: input.isFeatured ?? false,
        isSpicy: input.isSpicy ?? false,
        isVegetarian: input.isVegetarian ?? false,
        allergens: input.allergens ? [...input.allergens] : [],
        tags: input.tags ? [...input.tags] : [],
        sortOrder: input.sortOrder ?? 0,
        createdAt: input.at,
        updatedAt: input.at,
      })
      .returning(PRODUCT_SELECTION);
    return rows[0] ?? null;
  }

  async updateProduct(input: UpsertProductInput): Promise<AdminProductRecord | null> {
    const rows = await this.db
      .update(products)
      .set(
        definedOnly({
          categoryId: input.categoryId,
          name: input.name,
          slug: input.slug,
          description: input.description,
          price: input.price,
          imageUrl: input.imageUrl,
          weightLabel: input.weightLabel,
          isActive: input.archived ? false : input.isActive,
          isAvailable: input.archived ? false : input.isAvailable,
          isFeatured: input.isFeatured,
          isSpicy: input.isSpicy,
          isVegetarian: input.isVegetarian,
          allergens: input.allergens ? [...input.allergens] : undefined,
          tags: input.tags ? [...input.tags] : undefined,
          sortOrder: input.sortOrder,
          deletedAt: input.archived === undefined ? undefined : input.archived ? input.at : null,
          // Bumping the version lets caches and clients detect a menu change.
          version: sql`${products.version} + 1`,
          updatedAt: input.at,
        }),
      )
      .where(
        and(
          eq(products.restaurantId, input.restaurantId),
          eq(products.id, input.productId ?? ""),
        ),
      )
      .returning(PRODUCT_SELECTION);
    return rows[0] ?? null;
  }

  async insertAuditLog(input: AdminMenuAuditInput): Promise<void> {
    await this.db.insert(auditLogs).values({
      restaurantId: input.restaurantId,
      actorUserId: input.actorUserId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      oldValue: input.oldValue,
      newValue: input.newValue,
      requestId: input.requestId,
    });
  }

  async insertOutboxEvent(input: AdminMenuOutboxInput): Promise<void> {
    await this.db.insert(outboxEvents).values(input);
  }
}

export class DrizzleAdminMenuRepository implements AdminMenuRepository {
  constructor(private readonly db: Database) {}

  listCategories(restaurantId: string): Promise<readonly AdminCategoryRecord[]> {
    return this.db
      .select(CATEGORY_SELECTION)
      .from(categories)
      .where(eq(categories.restaurantId, restaurantId))
      .orderBy(asc(categories.sortOrder), asc(categories.name));
  }

  listProducts(restaurantId: string): Promise<readonly AdminProductRecord[]> {
    return this.db
      .select(PRODUCT_SELECTION)
      .from(products)
      .where(eq(products.restaurantId, restaurantId))
      .orderBy(asc(products.sortOrder), asc(products.name));
  }

  transaction<TResult>(
    work: (repository: AdminMenuTransactionRepository) => Promise<TResult>,
  ): Promise<TResult> {
    return this.db.transaction((transaction) =>
      work(new DrizzleAdminMenuTransactionRepository(transaction)),
    );
  }
}
