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

const MENU_EDITOR_ROLES = ["ADMIN", "MANAGER"] as const satisfies readonly UserRole[];

export interface AdminCategoryResult {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly imageUrl: string | null;
  readonly sortOrder: number;
  readonly isActive: boolean;
  readonly archived: boolean;
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
}

export interface SaveCategoryCommand {
  readonly categoryId?: string;
  readonly name?: string;
  readonly description?: string | null;
  readonly sortOrder?: number;
  readonly isActive?: boolean;
  readonly archived?: boolean;
  readonly requestId?: string;
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
}

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

function toCategoryResult(record: AdminCategoryRecord): AdminCategoryResult {
  return {
    id: record.id,
    name: record.name,
    slug: record.slug,
    description: record.description,
    imageUrl: record.imageUrl,
    sortOrder: record.sortOrder,
    isActive: record.isActive,
    archived: Boolean(record.deletedAt),
  };
}

function toProductResult(record: AdminProductRecord): AdminProductResult {
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
  };
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
    const [categoryRecords, productRecords] = await Promise.all([
      this.repository.listCategories(actor.restaurantId),
      this.repository.listProducts(actor.restaurantId),
    ]);
    return {
      categories: categoryRecords.map(toCategoryResult),
      products: productRecords.map(toProductResult),
    };
  }

  async saveCategory(
    principal: RestaurantPrincipal | null | undefined,
    command: SaveCategoryCommand,
  ): Promise<AdminCategoryResult> {
    const actor = this.authorize(principal);
    const at = this.clock();

    return this.repository.transaction(async (transaction) => {
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
        await this.record(transaction, actor, "category.created", "CATEGORY", created.id, null, {
          name: created.name,
          slug: created.slug,
        }, command.requestId, "CATEGORY_UPDATED", {
          categoryId: created.id,
          name: created.name,
          isActive: created.isActive,
          updatedAt: at.toISOString(),
        });
        return toCategoryResult(created);
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
      return toCategoryResult(updated);
    });
  }

  async saveProduct(
    principal: RestaurantPrincipal | null | undefined,
    command: SaveProductCommand,
  ): Promise<AdminProductResult> {
    const actor = this.authorize(principal);
    const at = this.clock();

    return this.repository.transaction(async (transaction) => {
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
        return toProductResult(created);
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
      return toProductResult(updated);
    });
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
