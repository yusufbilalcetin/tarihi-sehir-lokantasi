import type { RepositoryJsonObject } from "./order-repository";

export interface AdminCategoryRecord {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly imageUrl: string | null;
  readonly sortOrder: number;
  readonly isActive: boolean;
  readonly deletedAt: Date | null;
}

export interface AdminProductRecord {
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
  readonly deletedAt: Date | null;
}

export interface UpsertCategoryInput {
  readonly restaurantId: string;
  readonly categoryId?: string;
  readonly name?: string;
  readonly slug?: string;
  readonly description?: string | null;
  readonly sortOrder?: number;
  readonly isActive?: boolean;
  readonly archived?: boolean;
  readonly at: Date;
}

export interface UpsertProductInput {
  readonly restaurantId: string;
  readonly productId?: string;
  readonly categoryId?: string;
  readonly name?: string;
  readonly slug?: string;
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
  readonly at: Date;
}

export interface AdminMenuAuditInput {
  readonly restaurantId: string;
  readonly actorUserId: string;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly oldValue: RepositoryJsonObject | null;
  readonly newValue: RepositoryJsonObject | null;
  readonly requestId?: string;
}

export interface AdminMenuOutboxInput {
  readonly restaurantId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly payload: RepositoryJsonObject;
}

export interface AdminMenuTransactionRepository {
  findCategoryForUpdate(
    restaurantId: string,
    categoryId: string,
  ): Promise<AdminCategoryRecord | null>;
  findProductForUpdate(
    restaurantId: string,
    productId: string,
  ): Promise<AdminProductRecord | null>;
  insertCategory(input: UpsertCategoryInput): Promise<AdminCategoryRecord | null>;
  updateCategory(input: UpsertCategoryInput): Promise<AdminCategoryRecord | null>;
  insertProduct(input: UpsertProductInput): Promise<AdminProductRecord | null>;
  updateProduct(input: UpsertProductInput): Promise<AdminProductRecord | null>;
  insertAuditLog(input: AdminMenuAuditInput): Promise<void>;
  insertOutboxEvent(input: AdminMenuOutboxInput): Promise<void>;
}

export interface AdminMenuRepository {
  listCategories(restaurantId: string): Promise<readonly AdminCategoryRecord[]>;
  listProducts(restaurantId: string): Promise<readonly AdminProductRecord[]>;
  transaction<TResult>(
    work: (repository: AdminMenuTransactionRepository) => Promise<TResult>,
  ): Promise<TResult>;
}
