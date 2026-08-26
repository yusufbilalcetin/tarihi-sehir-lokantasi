import assert from "node:assert/strict";
import test from "node:test";

import { DomainError } from "../../lib/api/domain-error";
import type { RestaurantPrincipal } from "../../lib/domain/restaurant-scope";
import type {
  AdminCategoryRecord,
  AdminMenuAuditInput,
  AdminMenuOutboxInput,
  AdminMenuRepository,
  AdminMenuTransactionRepository,
  AdminProductRecord,
  UpsertCategoryInput,
  UpsertProductInput,
} from "../../lib/repositories/admin-menu-repository";
import { AdminMenuService, toSlug } from "../../lib/services/admin-menu-service";

const at = new Date("2026-08-13T18:00:00.000Z");

const category: AdminCategoryRecord = {
  id: "category-a",
  name: "Çorbalar",
  slug: "corbalar",
  description: null,
  imageUrl: null,
  sortOrder: 1,
  isActive: true,
  deletedAt: null,
};

const product: AdminProductRecord = {
  id: "product-a",
  categoryId: "category-a",
  name: "Etli Kuru Fasulye",
  slug: "kuru-fasulye",
  description: null,
  price: "260.00",
  imageUrl: null,
  weightLabel: null,
  isActive: true,
  isAvailable: true,
  isFeatured: false,
  isSpicy: false,
  isVegetarian: false,
  allergens: [],
  tags: [],
  sortOrder: 1,
  version: 3,
  deletedAt: null,
};

class FakeTransaction implements AdminMenuTransactionRepository {
  category: AdminCategoryRecord | null = category;
  product: AdminProductRecord | null = product;
  inserted: UpsertProductInput[] = [];
  updated: UpsertProductInput[] = [];
  categoryWrites: UpsertCategoryInput[] = [];
  audits: AdminMenuAuditInput[] = [];
  outbox: AdminMenuOutboxInput[] = [];

  async findCategoryForUpdate(restaurantId: string, categoryId: string) {
    if (!this.category) return null;
    return restaurantId === "restaurant-a" && categoryId === this.category.id ? this.category : null;
  }

  async findProductForUpdate(restaurantId: string, productId: string) {
    if (!this.product) return null;
    return restaurantId === "restaurant-a" && productId === this.product.id ? this.product : null;
  }

  async insertCategory(input: UpsertCategoryInput) {
    this.categoryWrites.push(input);
    return { ...category, id: "category-new", name: input.name ?? "", slug: input.slug ?? "" };
  }

  async updateCategory(input: UpsertCategoryInput) {
    this.categoryWrites.push(input);
    if (!this.category) return null;
    return {
      ...this.category,
      name: input.name ?? this.category.name,
      isActive: input.archived ? false : input.isActive ?? this.category.isActive,
      deletedAt: input.archived ? input.at : this.category.deletedAt,
    };
  }

  async insertProduct(input: UpsertProductInput) {
    this.inserted.push(input);
    return {
      ...product,
      id: "product-new",
      name: input.name ?? "",
      slug: input.slug ?? "",
      price: input.price ?? "0.00",
      version: 1,
    };
  }

  async updateProduct(input: UpsertProductInput) {
    this.updated.push(input);
    if (!this.product) return null;
    return {
      ...this.product,
      name: input.name ?? this.product.name,
      price: input.price ?? this.product.price,
      isAvailable: input.archived ? false : input.isAvailable ?? this.product.isAvailable,
      isActive: input.archived ? false : input.isActive ?? this.product.isActive,
      deletedAt: input.archived ? input.at : this.product.deletedAt,
      version: this.product.version + 1,
    };
  }

  async insertAuditLog(input: AdminMenuAuditInput) {
    this.audits.push(input);
  }

  async insertOutboxEvent(input: AdminMenuOutboxInput) {
    this.outbox.push(input);
  }
}

class FakeRepository implements AdminMenuRepository {
  transactionRepository = new FakeTransaction();

  async listCategories() {
    return [category];
  }

  async listProducts() {
    return [product];
  }

  transaction<TResult>(
    work: (repository: AdminMenuTransactionRepository) => Promise<TResult>,
  ): Promise<TResult> {
    return work(this.transactionRepository);
  }
}

function principal(role: RestaurantPrincipal["role"]): RestaurantPrincipal {
  return { userId: `user-${role}`, restaurantId: "restaurant-a", role, isActive: true };
}

function service(repository: FakeRepository) {
  return new AdminMenuService(repository, { clock: () => at });
}

test("slugs stay database-safe for Turkish product names", () => {
  assert.equal(toSlug("Etli Kuru Fasulye"), "etli-kuru-fasulye");
  assert.equal(toSlug("Şalgam Suyu"), "salgam-suyu");
  assert.equal(toSlug("Çığ Köfte  "), "cig-kofte");
  assert.match(toSlug("İzmir Köfte"), /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
});

test("marking a product sold out emits an availability event and an audit entry", async () => {
  const repository = new FakeRepository();
  const result = await service(repository).saveProduct(principal("ADMIN"), {
    productId: "product-a",
    isAvailable: false,
  });

  assert.equal(result.isAvailable, false);
  assert.equal(repository.transactionRepository.outbox[0]?.eventType, "PRODUCT_AVAILABILITY_CHANGED");
  assert.equal(repository.transactionRepository.audits[0]?.action, "product.updated");
});

test("a price change emits PRODUCT_UPDATED and bumps the product version", async () => {
  const repository = new FakeRepository();
  const result = await service(repository).saveProduct(principal("MANAGER"), {
    productId: "product-a",
    price: "285.00",
  });

  assert.equal(result.price, "285.00");
  assert.equal(result.version, 4);
  assert.equal(repository.transactionRepository.outbox[0]?.eventType, "PRODUCT_UPDATED");
});

test("archiving a product deactivates it and emits PRODUCT_ARCHIVED", async () => {
  const repository = new FakeRepository();
  const result = await service(repository).saveProduct(principal("ADMIN"), {
    productId: "product-a",
    archived: true,
  });

  assert.equal(result.archived, true);
  assert.equal(result.isAvailable, false);
  assert.equal(repository.transactionRepository.outbox[0]?.eventType, "PRODUCT_ARCHIVED");
});

test("a new product must reference a category in the same restaurant", async () => {
  const repository = new FakeRepository();
  await assert.rejects(
    () => service(repository).saveProduct(principal("ADMIN"), {
      categoryId: "category-from-another-restaurant",
      name: "Yeni Ürün",
      price: "100.00",
    }),
    (error: unknown) => error instanceof DomainError && error.code === "NOT_FOUND",
  );
  assert.equal(repository.transactionRepository.inserted.length, 0);
});

test("waiter, kitchen and cashier roles cannot edit the menu", async () => {
  for (const role of ["WAITER", "KITCHEN", "CASHIER"] as const) {
    await assert.rejects(
      () => service(new FakeRepository()).saveProduct(principal(role), {
        productId: "product-a",
        isAvailable: false,
      }),
      (error: unknown) => error instanceof DomainError && error.code === "FORBIDDEN",
    );
  }
});

test("another restaurant's manager cannot reach this product", async () => {
  await assert.rejects(
    () => service(new FakeRepository()).saveProduct(
      { ...principal("MANAGER"), restaurantId: "restaurant-b" },
      { productId: "product-a", price: "1.00" },
    ),
    (error: unknown) => error instanceof DomainError && error.code === "PRODUCT_NOT_FOUND",
  );
});

test("creating a category derives its slug and emits CATEGORY_UPDATED", async () => {
  const repository = new FakeRepository();
  const result = await service(repository).saveCategory(principal("ADMIN"), {
    name: "Zeytinyağlılar",
  });

  assert.equal(result.slug, "zeytinyaglilar");
  assert.equal(repository.transactionRepository.outbox[0]?.eventType, "CATEGORY_UPDATED");
  assert.equal(repository.transactionRepository.audits[0]?.action, "category.created");
});
