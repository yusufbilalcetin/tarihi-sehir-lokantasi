import assert from "node:assert/strict";
import test from "node:test";

import { menuApiToViewModel } from "../../lib/adapters/menu-view-model";
import {
  staffCallToViewModel,
  staffOrderToViewModel,
  staffTableToViewModel,
  toApiOrderItemStatus,
  toApiOrderStatus,
} from "../../lib/adapters/staff-view-model";
import type { CustomerMenuPayload, StaffCallPayload } from "../../lib/api/endpoints";
import type { StaffOrderListResult } from "../../lib/services/staff-order-service";
import type { StaffTableResult } from "../../lib/services/staff-table-service";

const now = Date.parse("2026-08-13T18:30:00.000Z");

const menuPayload = {
  restaurant: {
    id: "restaurant-a",
    name: "Tarihi Şehir Lokantası",
    slug: "tarihi-sehir-lokantasi",
    logoUrl: null,
    phone: null,
    address: null,
    currency: "TRY",
    timezone: "Europe/Istanbul",
    defaultLocale: "tr",
  },
  table: { id: "table-a", name: "Masa 3", number: 3 },
  settings: {
    menuEnabled: true,
    orderingEnabled: true,
    customerNotesEnabled: true,
    menuImagesEnabled: true,
    serviceFeeRate: "0.00",
    taxRate: "0.00",
    maxItemQuantity: 20,
    orderNotesMaxLength: 500,
  },
  categories: [
    {
      id: "uuid-category-soups",
      name: "Çorbalar",
      slug: "corbalar",
      description: null,
      imageUrl: null,
      sortOrder: 1,
      products: [
        {
          id: "uuid-product-mercimek",
          categoryId: "uuid-category-soups",
          name: "Mercimek Çorbası",
          slug: "mercimek",
          description: "Ev yapımı.",
          price: "120.00",
          imageUrl: "/images/food/mercimek-corbasi.webp",
          weightLabel: "300 ml",
          isAvailable: true,
          isFeatured: true,
          isSpicy: false,
          isVegetarian: true,
          allergens: ["Gluten"],
          tags: ["Popüler"],
          sortOrder: 1,
          version: 1,
        },
        {
          id: "uuid-product-tarhana",
          categoryId: "uuid-category-soups",
          name: "Tarhana Çorbası",
          slug: "tarhana-corbasi",
          description: null,
          price: "110.00",
          imageUrl: null,
          weightLabel: null,
          isAvailable: false,
          isFeatured: false,
          isSpicy: false,
          isVegetarian: true,
          allergens: [],
          tags: [],
          sortOrder: 2,
          version: 1,
        },
      ],
    },
  ],
} satisfies CustomerMenuPayload;

test("customer menu keeps database ids for the API and slugs for translations", () => {
  const view = menuApiToViewModel(menuPayload);

  assert.equal(view.categories[0]?.id, "uuid-category-soups");
  // The Turkish slug maps back to the stable translation-catalog key.
  assert.equal(view.categories[0]?.i18nKey, "soups");
  assert.equal(view.products[0]?.id, "uuid-product-mercimek");
  assert.equal(view.products[0]?.i18nKey, "mercimek");
  assert.equal(view.products[0]?.price, 120);
});

test("an unavailable product stays visible but is marked sold out", () => {
  const view = menuApiToViewModel(menuPayload);
  const soldOut = view.products.find((product) => product.i18nKey === "tarhana-corbasi");

  assert.equal(view.products.length, 2);
  assert.equal(soldOut?.status, "sold-out");
  assert.equal(view.products[0]?.status, "active");
});

test("a category without an uploaded image falls back to local artwork", () => {
  const view = menuApiToViewModel(menuPayload);
  assert.equal(view.categories[0]?.image, "/images/food/category-corbalar.jpg");
});

const staffOrder: StaffOrderListResult = {
  id: "order-a",
  orderNumber: "1042",
  status: "READY",
  channel: "DINE_IN",
  table: { id: "table-a", name: "Masa 8", number: 8 },
  placeLabel: "Masa 8",
  amounts: { subtotal: "905.00", serviceCharge: "0.00", tax: "0.00", total: "905.00" },
  notes: null,
  createdAt: "2026-08-13T18:00:00.000Z",
  updatedAt: "2026-08-13T18:10:00.000Z",
  items: [
    {
      id: "item-a",
      productName: "Tas Kebabı",
      unitPrice: "320.00",
      quantity: 2,
      lineTotal: "640.00",
      notes: "Az pişmiş",
      status: "PREPARING",
    },
  ],
};

test("staff orders map database statuses to the panel view model", () => {
  const view = staffOrderToViewModel(staffOrder, now);

  assert.equal(view.status, "ready");
  assert.equal(view.orderNumber, "#1042");
  assert.equal(view.total, 905);
  assert.equal(view.elapsedMinutes, 30);
  assert.equal(view.items[0]?.status, "preparing");
  assert.equal(view.items[0]?.unitPrice, 320);
});

test("view statuses round-trip back to the API enums", () => {
  assert.equal(toApiOrderStatus("pending"), "NEW");
  assert.equal(toApiOrderStatus("served"), "SERVED");
  assert.equal(toApiOrderItemStatus("preparing"), "PREPARING");
  assert.equal(toApiOrderItemStatus("served"), "SERVED");
});

test("a bill request keeps its guest-facing label and open state", () => {
  const call: StaffCallPayload = {
    id: "call-a",
    type: "BILL_REQUEST",
    status: "ACKNOWLEDGED",
    requestLabel: null,
    notes: null,
    table: { id: "table-a", name: "Masa 12", number: 12 },
    acknowledgedAt: "2026-08-13T18:29:00.000Z",
    resolvedAt: null,
    createdAt: "2026-08-13T18:28:00.000Z",
    updatedAt: "2026-08-13T18:29:00.000Z",
  };

  const view = staffCallToViewModel(call, now);
  assert.equal(view.type, "Hesap istiyor");
  assert.equal(view.status, "assigned");
  assert.equal(view.elapsed, "2 dakika önce");
});

test("an inactive table is never shown as available on the floor", () => {
  const table: StaffTableResult = {
    id: "table-a",
    name: "Masa 5",
    number: 5,
    seats: 4,
    isActive: false,
    status: "AVAILABLE",
    qrTokenVersion: 3,
    qrRevoked: true,
    openCallCount: 0,
    lastActivityAt: "2026-08-13T18:00:00.000Z",
    activeOrder: null,
  };

  const view = staffTableToViewModel(table, now);
  assert.equal(view.status, "inactive");
  assert.equal(view.qrAvailable, false);
  assert.equal(view.total, undefined);
});

test("a table with an open order carries its total and elapsed minutes", () => {
  const table: StaffTableResult = {
    id: "table-b",
    name: "Masa 8",
    number: 8,
    seats: 4,
    isActive: true,
    status: "DINING",
    qrTokenVersion: 1,
    qrRevoked: false,
    openCallCount: 1,
    lastActivityAt: "2026-08-13T18:25:00.000Z",
    activeOrder: {
      id: "order-a",
      orderNumber: "1042",
      total: "905.00",
      createdAt: "2026-08-13T18:00:00.000Z",
    },
  };

  const view = staffTableToViewModel(table, now);
  assert.equal(view.status, "dining");
  assert.equal(view.total, 905);
  assert.equal(view.activeMinutes, 30);
  assert.equal(view.orderId, "order-a");
});

test("a product without an image gets the neutral placeholder, never another dish", () => {
  const view = menuApiToViewModel(menuPayload);
  const withImage = view.products.find((product) => product.i18nKey === "mercimek");
  const withoutImage = view.products.find((product) => product.i18nKey === "tarhana-corbasi");

  assert.equal(withImage?.image, "/images/food/mercimek-corbasi.webp");
  assert.equal(withoutImage?.image, "/images/placeholder-dish.webp");
  // The regression this guards: an image-less product borrowing a real dish photo.
  assert.ok(!withoutImage?.image.startsWith("/images/food/"));
  assert.notEqual(withoutImage?.image, withImage?.image);
});
