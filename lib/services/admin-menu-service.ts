import { DomainError } from "@/lib/api/domain-error";
import {
  authorizeRestaurantAccess,
  type RestaurantPrincipal,
} from "@/lib/domain/restaurant-scope";
import type { UserRole } from "@/lib/domain/status";
import type {
  AdminCategoryRecord,
  AdminMenuRepository,
  AdminProductRecord,
} from "@/lib/repositories/admin-menu-repository";
import {
  normalizeCatalogTranslations,
  translationMap,
  type CatalogTranslationInput,
  type CatalogTranslations,
} from "@/lib/i18n/catalog-localization";
import { DEFAULT_MENU_LANGUAGE } from "@/lib/i18n/languages";

export const MENU_EDITOR_ROLES = ["ADMIN", "MANAGER"] as const satisfies readonly UserRole[];

export interface AdminCategoryResult {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly imageUrl: string | null;
  readonly sortOrder: number;
  readonly isActive: boolean;
  readonly archived: boolean;
  readonly translations?: CatalogTranslations;
}

export interface AdminProductResult {
  readonly id: string;
  readonly categoryId: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly price: string;
  readonly imageUrl: string | null;
  readonly weightLabel: string | null;
  readonly isActive: boolean;
  readonly isAvailable: boolean;
  readonly isFeatured: boolean;
  readonly isSpicy: boolean;
  readonly isVegetarian: boolean;
  readonly allergens: readonly string[];
  readonly tags: readonly string[];
  readonly sortOrder: number;
  readonly version: number;
  readonly archived: boolean;
  readonly translations?: CatalogTranslations;
}

export interface SaveCategoryCommand {
  readonly categoryId?: string;
  readonly name?: string;
  readonly description?: string | null;
  readonly sortOrder?: number;
  readonly isActive?: boolean;
  readonly archived?: boolean;
  readonly requestId?: string;
  readonly translations?: readonly CatalogTranslationInput[];
}

export interface SaveProductCommand {
  readonly productId?: string;
  readonly categoryId?: string;
  readonly name?: string;
  readonly description?: string | null;
  readonly price?: string;
  readonly imageUrl?: string | null;
  readonly weightLabel?: string | null;
  readonly isActive?: boolean;
  readonly isAvailable?: boolean;
  readonly isFeatured?: boolean;
  readonly isSpicy?: boolean;
  readonly isVegetarian?: boolean;
  readonly allergens?: readonly string[];
  readonly tags?: readonly string[];
  readonly sortOrder?: number;
  readonly archived?: boolean;
  readonly requestId?: string;
  readonly translations?: readonly CatalogTranslationInput[];
}

/** One row's new place in the menu. */
export interface MenuOrderEntry {
  readonly id: string;
  readonly sortOrder: number;
}

export interface ReorderMenuCommand {
  readonly categories?: readonly MenuOrderEntry[];
  readonly products?: readonly MenuOrderEntry[];
  readonly requestId?: string;
}

/** Enough rows for a very large menu, and a ceiling on a hostile payload. */
const MAX_REORDER_ENTRIES = 500;

export interface AdminMenuServiceOptions {
  readonly clock?: () => Date;
}

/** Latin-1 friendly slug that satisfies the database slug format check. */
export function toSlug(value: string): string {
  const map: Record<string, string> = {
    ç: "c", ğ: "g", ı: "i", İ: "i", ö: "o", ş: "s", ü: "u",
    Ç: "c", Ğ: "g", Ö: "o", Ş: "s", Ü: "u",
  };
  const normalized = value
    .split("")
    .map((character) => map[character] ?? character)
    .join("")
    .toLocaleLowerCase("en-US")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "menu";
}

/**
 * PostgreSQL reports a unique-index violation as 23505.
 *
 * Both `categories` and `products` carry a unique slug per restaurant, and the
 * slug is derived from the name — so two rows given the same name collide.
 * Without this the collision left the transaction as a bare driver error and
 * the administrator was told the server had failed, which is both untrue and
 * unactionable.
 */
function isUniqueViolation(error: unknown): boolean {
  // The driver's error is usually wrapped by the query builder, so the code is
  // looked for along the cause chain rather than only on the surface.
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (typeof current !== "object") return false;
    const candidate = current as { code?: unknown; cause?: unknown };
    if (candidate.code === "23505") return true;
    current = candidate.cause;
  }
  return false;
}

async function rejectDuplicateName<TResult>(
  work: () => Promise<TResult>,
  message: string,
): Promise<TResult> {
  try {
    return await work();
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new DomainError("CONFLICT", message, { httpStatus: 409 });
    }
    throw error;
  }
}

function toCategoryResult(
  record: AdminCategoryRecord,
  translations: readonly CatalogTranslationInput[] = [],
): AdminCategoryResult {
  return {
    id: record.id,
    name: record.name,
    slug: record.slug,
    description: record.description,
    imageUrl: record.imageUrl,
    sortOrder: record.sortOrder,
    isActive: record.isActive,
    archived: Boolean(record.deletedAt),
    translations: translationMap(translations),
  };
}

function toProductResult(
  record: AdminProductRecord,
  translations: readonly CatalogTranslationInput[] = [],
): AdminProductResult {
  return {
    id: record.id,
    categoryId: record.categoryId,
    name: record.name,
    slug: record.slug,
    description: record.description,
    price: record.price,
    imageUrl: record.imageUrl,
    weightLabel: record.weightLabel,
    isActive: record.isActive,
    isAvailable: record.isAvailable,
    isFeatured: record.isFeatured,
    isSpicy: record.isSpicy,
    isVegetarian: record.isVegetarian,
    allergens: record.allergens,
    tags: record.tags,
    sortOrder: record.sortOrder,
    version: record.version,
    archived: Boolean(record.deletedAt),
    translations: translationMap(translations),
  };
}

function groupTranslations<TEntityKey extends "categoryId" | "productId">(
  rows: readonly (CatalogTranslationInput & Record<TEntityKey, string>)[],
  key: TEntityKey,
) {
  const grouped = new Map<string, CatalogTranslationInput[]>();
  for (const row of rows) {
    const values = grouped.get(row[key]) ?? [];
    values.push({ locale: row.locale, name: row.name, description: row.description });
    grouped.set(row[key], values);
  }
  return grouped;
}

function withDefaultTranslation(
  translations: readonly CatalogTranslationInput[] | undefined,
  name: string,
  description: string | null,
) {
  const normalized = normalizeCatalogTranslations(translations);
  return [
    ...normalized.filter((translation) => translation.locale !== DEFAULT_MENU_LANGUAGE),
    { locale: DEFAULT_MENU_LANGUAGE, name, description },
  ];
}

export class AdminMenuService {
  private readonly clock: () => Date;

  constructor(
    private readonly repository: AdminMenuRepository,
    options: AdminMenuServiceOptions = {},
  ) {
    this.clock = options.clock ?? (() => new Date());
  }

  private authorize(principal: RestaurantPrincipal | null | undefined): RestaurantPrincipal {
    const decision = authorizeRestaurantAccess(principal, principal?.restaurantId ?? "", {
      allowedRoles: MENU_EDITOR_ROLES,
    });
    if (decision.allowed) return decision.principal;
    const authenticationFailure = decision.reason === "AUTHENTICATION_REQUIRED";
    throw new DomainError(
      authenticationFailure ? "AUTHENTICATION_REQUIRED" : "FORBIDDEN",
      authenticationFailure ? "Oturum açmanız gerekiyor." : "Menü yönetimi yetkiniz yok.",
      { httpStatus: authenticationFailure ? 401 : 403 },
    );
  }

  async getMenu(principal: RestaurantPrincipal | null | undefined) {
    const actor = this.authorize(principal);
    const [categoryRecords, productRecords, categoryTranslationRows, productTranslationRows] = await Promise.all([
      this.repository.listCategories(actor.restaurantId),
      this.repository.listProducts(actor.restaurantId),
      this.repository.listCategoryTranslations(actor.restaurantId),
      this.repository.listProductTranslations(actor.restaurantId),
    ]);
    const categoryTranslationsById = groupTranslations(categoryTranslationRows, "categoryId");
    const productTranslationsById = groupTranslations(productTranslationRows, "productId");
    return {
      categories: categoryRecords.map((category) =>
        toCategoryResult(category, categoryTranslationsById.get(category.id))),
      products: productRecords.map((product) =>
        toProductResult(product, productTranslationsById.get(product.id))),
    };
  }

  /**
   * Writes a whole new running order in one transaction.
   *
   * Reordering used to be a pair of PATCHes that swapped two rows' sort values,
   * which needed every row to already hold a distinct value and left the menu
   * half-reordered if the second call failed. This renumbers the list the
   * administrator actually sees, so a menu seeded with a column full of zeroes
   * sorts correctly from the first drag.
   *
   * Rows are scoped to the principal's restaurant by the same predicate every
   * other update uses; an id from another tenant simply matches nothing.
   */
  async reorderMenu(
    principal: RestaurantPrincipal | null | undefined,
    command: ReorderMenuCommand,
  ): Promise<{ readonly categories: number; readonly products: number }> {
    const actor = this.authorize(principal);
    const categoryEntries = command.categories ?? [];
    const productEntries = command.products ?? [];
    if (categoryEntries.length + productEntries.length === 0) {
      throw new DomainError("VALIDATION_ERROR", "Sıralanacak öğe gönderin.", {
        httpStatus: 400,
      });
    }
    if (categoryEntries.length > MAX_REORDER_ENTRIES || productEntries.length > MAX_REORDER_ENTRIES) {
      throw new DomainError("VALIDATION_ERROR", "Çok fazla öğe gönderildi.", {
        httpStatus: 400,
      });
    }
    const at = this.clock();

    return this.repository.transaction(async (transaction) => {
      let categoryCount = 0;
      for (const entry of categoryEntries) {
        const updated = await transaction.updateCategory({
          restaurantId: actor.restaurantId,
          categoryId: entry.id,
          sortOrder: entry.sortOrder,
          at,
        });
        if (!updated) {
          throw new DomainError("NOT_FOUND", "Kategori bulunamadı.", { httpStatus: 404 });
        }
        categoryCount += 1;
      }

      let productCount = 0;
      for (const entry of productEntries) {
        const updated = await transaction.updateProduct({
          restaurantId: actor.restaurantId,
          productId: entry.id,
          sortOrder: entry.sortOrder,
          at,
        });
        if (!updated) {
          throw new DomainError("PRODUCT_NOT_FOUND", "Ürün bulunamadı.", { httpStatus: 404 });
        }
        productCount += 1;
      }

      // One audit entry for the whole running order rather than one per row:
      // the change an administrator made was "this is the new order".
      await this.record(
        transaction,
        actor,
        "menu.reordered",
        "MENU",
        actor.restaurantId,
        null,
        { categories: categoryCount, products: productCount },
        command.requestId,
        "MENU_REORDERED",
        {
          categories: categoryCount,
          products: productCount,
          updatedAt: at.toISOString(),
        },
      );

      return { categories: categoryCount, products: productCount };
    });
  }

  async saveCategory(
    principal: RestaurantPrincipal | null | undefined,
    command: SaveCategoryCommand,
  ): Promise<AdminCategoryResult> {
    const actor = this.authorize(principal);
    const at = this.clock();

    return rejectDuplicateName(() => this.repository.transaction(async (transaction) => {
      if (!command.categoryId) {
        if (!command.name?.trim()) {
          throw new DomainError("VALIDATION_ERROR", "Kategori adı gereklidir.", { httpStatus: 400 });
        }
        const created = await transaction.insertCategory({
          restaurantId: actor.restaurantId,
          name: command.name.trim(),
          slug: toSlug(command.name),
          description: command.description ?? null,
          sortOrder: command.sortOrder ?? 0,
          isActive: command.isActive ?? true,
          at,
        });
        if (!created) {
          throw new DomainError("CONFLICT", "Kategori oluşturulamadı.", { httpStatus: 409 });
        }
        const translations = withDefaultTranslation(
          command.translations,
          created.name,
          created.description,
        );
        await transaction.upsertCategoryTranslations({
          restaurantId: actor.restaurantId,
          categoryId: created.id,
          translations,
          at,
        });
        await this.record(transaction, actor, "category.created", "CATEGORY", created.id, null, {
          name: created.name,
          slug: created.slug,
        }, command.requestId, "CATEGORY_UPDATED", {
          categoryId: created.id,
          name: created.name,
          isActive: created.isActive,
          updatedAt: at.toISOString(),
        });
        return toCategoryResult(created, translations);
      }

      const existing = await transaction.findCategoryForUpdate(
        actor.restaurantId,
        command.categoryId,
      );
      if (!existing) {
        throw new DomainError("NOT_FOUND", "Kategori bulunamadı.", { httpStatus: 404 });
      }

      const updated = await transaction.updateCategory({
        restaurantId: actor.restaurantId,
        categoryId: command.categoryId,
        name: command.name?.trim(),
        slug: command.name ? toSlug(command.name) : undefined,
        description: command.description,
        sortOrder: command.sortOrder,
        isActive: command.isActive,
        archived: command.archived,
        at,
      });
      if (!updated) {
        throw new DomainError("NOT_FOUND", "Kategori bulunamadı.", { httpStatus: 404 });
      }

      const translations = withDefaultTranslation(
        command.translations,
        updated.name,
        updated.description,
      );
      await transaction.upsertCategoryTranslations({
        restaurantId: actor.restaurantId,
        categoryId: updated.id,
        translations,
        at,
      });

      await this.record(
        transaction,
        actor,
        command.archived ? "category.archived" : "category.updated",
        "CATEGORY",
        updated.id,
        { name: existing.name, isActive: existing.isActive },
        { name: updated.name, isActive: updated.isActive },
        command.requestId,
        "CATEGORY_UPDATED",
        {
          categoryId: updated.id,
          name: updated.name,
          isActive: updated.isActive,
          updatedAt: at.toISOString(),
        },
      );
      return toCategoryResult(updated, translations);
    }), "Bu adda bir kategori zaten var.");
  }

  async saveProduct(
    principal: RestaurantPrincipal | null | undefined,
    command: SaveProductCommand,
  ): Promise<AdminProductResult> {
    const actor = this.authorize(principal);
    const at = this.clock();

    return rejectDuplicateName(() => this.repository.transaction(async (transaction) => {
      if (!command.productId) {
        if (!command.name?.trim() || !command.categoryId || !command.price) {
          throw new DomainError("VALIDATION_ERROR", "Ürün adı, kategori ve fiyat gereklidir.", {
            httpStatus: 400,
          });
        }
        const category = await transaction.findCategoryForUpdate(
          actor.restaurantId,
          command.categoryId,
        );
        if (!category) {
          throw new DomainError("NOT_FOUND", "Kategori bulunamadı.", { httpStatus: 404 });
        }

        const created = await transaction.insertProduct({
          restaurantId: actor.restaurantId,
          categoryId: command.categoryId,
          name: command.name.trim(),
          slug: toSlug(command.name),
          description: command.description ?? null,
          price: command.price,
          imageUrl: command.imageUrl ?? null,
          weightLabel: command.weightLabel ?? null,
          isActive: command.isActive ?? true,
          isAvailable: command.isAvailable ?? true,
          isFeatured: command.isFeatured ?? false,
          isSpicy: command.isSpicy ?? false,
          isVegetarian: command.isVegetarian ?? false,
          allergens: command.allergens ?? [],
          tags: command.tags ?? [],
          sortOrder: command.sortOrder ?? 0,
          at,
        });
        if (!created) {
          throw new DomainError("CONFLICT", "Ürün oluşturulamadı.", { httpStatus: 409 });
        }
        const translations = withDefaultTranslation(
          command.translations,
          created.name,
          created.description,
        );
        await transaction.upsertProductTranslations({
          restaurantId: actor.restaurantId,
          productId: created.id,
          translations,
          at,
        });
        await this.record(
          transaction,
          actor,
          "product.created",
          "PRODUCT",
          created.id,
          null,
          { name: created.name, price: created.price },
          command.requestId,
          "PRODUCT_CREATED",
          this.productEventPayload(created, at),
        );
        return toProductResult(created, translations);
      }

      const existing = await transaction.findProductForUpdate(
        actor.restaurantId,
        command.productId,
      );
      if (!existing) {
        throw new DomainError("PRODUCT_NOT_FOUND", "Ürün bulunamadı.", { httpStatus: 404 });
      }
      if (command.categoryId && command.categoryId !== existing.categoryId) {
        const category = await transaction.findCategoryForUpdate(
          actor.restaurantId,
          command.categoryId,
        );
        if (!category) {
          throw new DomainError("NOT_FOUND", "Kategori bulunamadı.", { httpStatus: 404 });
        }
      }

      const updated = await transaction.updateProduct({
        restaurantId: actor.restaurantId,
        productId: command.productId,
        categoryId: command.categoryId,
        name: command.name?.trim(),
        slug: command.name ? toSlug(command.name) : undefined,
        description: command.description,
        price: command.price,
        imageUrl: command.imageUrl,
        weightLabel: command.weightLabel,
        isActive: command.isActive,
        isAvailable: command.isAvailable,
        isFeatured: command.isFeatured,
        isSpicy: command.isSpicy,
        isVegetarian: command.isVegetarian,
        allergens: command.allergens,
        tags: command.tags,
        sortOrder: command.sortOrder,
        archived: command.archived,
        at,
      });
      if (!updated) {
        throw new DomainError("PRODUCT_NOT_FOUND", "Ürün bulunamadı.", { httpStatus: 404 });
      }

      const translations = withDefaultTranslation(
        command.translations,
        updated.name,
        updated.description,
      );
      await transaction.upsertProductTranslations({
        restaurantId: actor.restaurantId,
        productId: updated.id,
        translations,
        at,
      });

      // Availability flips are the event guests care about most, so they get a
      // dedicated type the customer menu can act on.
      const availabilityChanged =
        command.isAvailable !== undefined && command.isAvailable !== existing.isAvailable;
      const eventType = command.archived
        ? "PRODUCT_ARCHIVED"
        : availabilityChanged
          ? "PRODUCT_AVAILABILITY_CHANGED"
          : "PRODUCT_UPDATED";

      await this.record(
        transaction,
        actor,
        command.archived ? "product.archived" : "product.updated",
        "PRODUCT",
        updated.id,
        {
          name: existing.name,
          price: existing.price,
          isActive: existing.isActive,
          isAvailable: existing.isAvailable,
        },
        {
          name: updated.name,
          price: updated.price,
          isActive: updated.isActive,
          isAvailable: updated.isAvailable,
        },
        command.requestId,
        eventType,
        this.productEventPayload(updated, at),
      );
      return toProductResult(updated, translations);
    }), "Bu adda bir ürün zaten var.");
  }

  private productEventPayload(product: AdminProductRecord, at: Date) {
    return {
      productId: product.id,
      categoryId: product.categoryId,
      name: product.name,
      isActive: product.isActive,
      isAvailable: product.isAvailable,
      isFeatured: product.isFeatured,
      version: product.version,
      updatedAt: at.toISOString(),
    };
  }

  private async record(
    transaction: Parameters<Parameters<AdminMenuRepository["transaction"]>[0]>[0],
    actor: RestaurantPrincipal,
    action: string,
    entityType: string,
    entityId: string,
    oldValue: Record<string, string | number | boolean | null> | null,
    newValue: Record<string, string | number | boolean | null> | null,
    requestId: string | undefined,
    eventType: string,
    payload: Record<string, string | number | boolean | null>,
  ) {
    await transaction.insertAuditLog({
      restaurantId: actor.restaurantId,
      actorUserId: actor.userId,
      action,
      entityType,
      entityId,
      oldValue,
      newValue,
      requestId,
    });
    await transaction.insertOutboxEvent({
      restaurantId: actor.restaurantId,
      aggregateType: entityType,
      aggregateId: entityId,
      eventType,
      payload,
    });
  }
}
