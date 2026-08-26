import assert from "node:assert/strict";
import test from "node:test";

import { DomainError } from "../../lib/api/domain-error";
import type { MenuRepository } from "../../lib/repositories/menu-repository";
import { MenuService } from "../../lib/services/menu-service";

test("MenuService groups one bounded repository result without changing exact prices", async () => {
  let calls = 0;
  const repository: MenuRepository = {
    async findPublicMenuByRestaurantId() {
      calls += 1;
      return {
        restaurant: {
          id: "restaurant-1",
          name: "Tarihi Sehir Lokantasi",
          slug: "tarihi-sehir-lokantasi",
          logoUrl: null,
          phone: null,
          address: null,
          currency: "TRY",
          timezone: "Europe/Istanbul",
          defaultLocale: "tr-TR",
        },
        settings: null,
        categories: [{
          id: "category-1",
          name: "Corbalar",
          slug: "corbalar",
          description: null,
          imageUrl: null,
          sortOrder: 1,
        }],
        products: [{
          id: "product-1",
          categoryId: "category-1",
          name: "Mercimek Corbasi",
          slug: "mercimek-corbasi",
          description: null,
          price: "250.00",
          imageUrl: null,
          weightLabel: null,
          isAvailable: false,
          isFeatured: true,
          isSpicy: false,
          isVegetarian: true,
          allergens: [],
          tags: [],
          sortOrder: 1,
          version: 3,
        }],
      };
    },
  };

  const menu = await new MenuService(repository).getPublicMenu("restaurant-1");
  assert.equal(calls, 1);
  assert.equal(menu.categories[0]?.products[0]?.price, "250.00");
  assert.equal(menu.categories[0]?.products[0]?.isAvailable, false);
  assert.equal(menu.settings.orderingEnabled, false);
});

test("MenuService fails closed when the restaurant menu is disabled", async () => {
  const repository: MenuRepository = {
    async findPublicMenuByRestaurantId() {
      return {
        restaurant: {
          id: "restaurant-1", name: "Restaurant", slug: "restaurant", logoUrl: null,
          phone: null, address: null, currency: "TRY", timezone: "Europe/Istanbul",
          defaultLocale: "tr-TR",
        },
        settings: {
          menuEnabled: false,
          orderingEnabled: false,
          customerNotesEnabled: false,
          menuImagesEnabled: true,
          serviceFeeRate: "0.00",
          taxRate: "0.00",
          maxItemQuantity: 20,
          orderNotesMaxLength: 500,
        },
        categories: [],
        products: [],
      };
    },
  };
  await assert.rejects(
    () => new MenuService(repository).getPublicMenu("restaurant-1"),
    (error: unknown) => error instanceof DomainError && error.code === "NOT_FOUND",
  );
});

test("MenuService hides inactive/missing restaurants behind NOT_FOUND", async () => {
  const repository: MenuRepository = {
    async findPublicMenuByRestaurantId() {
      return { restaurant: null, settings: null, categories: [], products: [] };
    },
  };

  await assert.rejects(
    () => new MenuService(repository).getPublicMenu("missing"),
    (error: unknown) => error instanceof DomainError && error.code === "NOT_FOUND",
  );
});
