import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  MENU_HIGHLIGHT_LIMIT,
  buildCustomerMenuSections,
} from "../../lib/adapters/customer-menu-sections";
import {
  adminMenuToViewModel,
  MENU_PLACEHOLDER_IMAGE,
} from "../../lib/adapters/menu-view-model";
import type { CustomerMenuPayload } from "../../lib/api/endpoints";
import type {
  AdminCategoryResult,
  AdminProductResult,
} from "../../lib/services/admin-menu-service";

function read(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

const settings: CustomerMenuPayload["settings"] = {
  menuEnabled: true,
  orderingEnabled: false,
  customerNotesEnabled: false,
  menuImagesEnabled: true,
  serviceFeeRate: "0.00",
  taxRate: "0.00",
  maxItemQuantity: 20,
  orderNotesMaxLength: 500,
};

function category(
  id: string,
  name: string,
  sortOrder: number,
  overrides: Partial<AdminCategoryResult> = {},
): AdminCategoryResult {
  return {
    id,
    name,
    slug: id,
    description: null,
    imageUrl: null,
    sortOrder,
    isActive: true,
    archived: false,
    ...overrides,
  };
}

function product(
  id: string,
  categoryId: string,
  name: string,
  sortOrder: number,
  overrides: Partial<AdminProductResult> = {},
): AdminProductResult {
  return {
    id,
    categoryId,
    name,
    slug: id,
    description: null,
    price: "100.00",
    imageUrl: "/images/food/x.webp",
    weightLabel: null,
    isActive: true,
    isAvailable: true,
    isFeatured: false,
    isSpicy: false,
    isVegetarian: false,
    allergens: [],
    tags: [],
    sortOrder,
    version: 1,
    archived: false,
    ...overrides,
  };
}

/** The menu a guest would be served from this administrator's working copy. */
function customerMenu(
  categories: readonly AdminCategoryResult[],
  products: readonly AdminProductResult[],
  menuImagesEnabled = true,
) {
  const model = adminMenuToViewModel({
    restaurantName: "Tarihi Şehir Lokantası",
    settings: { ...settings, menuImagesEnabled },
    categories,
    products,
  });
  return { model, ...buildCustomerMenuSections(model.categories, model.products) };
}

const soups = category("soups", "Çorbalar", 1);
const desserts = category("dessert", "Tatlılar", 2);
const drinks = category("drinks", "İçecekler", 3);

const lentil = product("lentil", "soups", "Mercimek", 2);
const chicken = product("chicken", "soups", "Tavuk Suyu", 1);
const baklava = product("baklava", "dessert", "Baklava", 1);

test("the category order the admin saves is the order the guest reads", () => {
  const { sections } = customerMenu([soups, desserts], [lentil, baklava]);
  assert.deepEqual(sections.map((section) => section.category.name), ["Çorbalar", "Tatlılar"]);

  // Moving desserts to the top is a change of sort_order and nothing else.
  const moved = customerMenu(
    [{ ...soups, sortOrder: 2 }, { ...desserts, sortOrder: 1 }],
    [lentil, baklava],
  );
  assert.deepEqual(moved.sections.map((section) => section.category.name), ["Tatlılar", "Çorbalar"]);
});

test("a hidden category leaves the menu entirely, and takes its dishes with it", () => {
  const { sections, model } = customerMenu(
    [soups, { ...desserts, isActive: false }],
    [lentil, baklava],
  );

  // No section, and nothing in the navigation: both read the same array.
  assert.deepEqual(sections.map((section) => section.category.id), ["soups"]);
  assert.equal(model.categories.some((item) => item.id === "dessert"), false);

  // And the dish inside it does not leak into the payload the page renders.
  assert.equal(model.products.some((item) => item.id === "baklava"), false);
  assert.equal(
    sections.flatMap((section) => section.products).some((item) => item.id === "baklava"),
    false,
  );
});

test("a hidden category still exists for the administrator", () => {
  // Visibility is not deletion: the row and its products are untouched.
  const hidden = { ...desserts, isActive: false };
  assert.equal(hidden.archived, false);
  const { sections } = customerMenu([soups, hidden], [lentil, baklava]);
  assert.equal(sections.length, 1);
});

test("a category with nothing visible in it is not a heading the guest can use", () => {
  const { sections } = customerMenu([soups, drinks], [lentil]);
  assert.deepEqual(sections.map((section) => section.category.id), ["soups"]);

  // Emptied by hiding every dish, not by hiding the category itself.
  const emptied = customerMenu([soups], [{ ...lentil, isActive: false }]);
  assert.equal(emptied.sections.length, 0);
});

test("the product order the admin saves is the order inside the section", () => {
  const { sections } = customerMenu([soups], [lentil, chicken]);
  assert.deepEqual(sections[0].products.map((item) => item.name), ["Tavuk Suyu", "Mercimek"]);

  const swapped = customerMenu(
    [soups],
    [{ ...lentil, sortOrder: 1 }, { ...chicken, sortOrder: 2 }],
  );
  assert.deepEqual(swapped.sections[0].products.map((item) => item.name), ["Mercimek", "Tavuk Suyu"]);
});

test("marking a dish as the chef's recommendation fills the rail", () => {
  const { featured } = customerMenu(
    [soups, desserts],
    [lentil, { ...baklava, isFeatured: true }],
  );
  assert.deepEqual(featured.map((item) => item.name), ["Baklava"]);
});

test("with no recommendation there is no empty rail to render", () => {
  const { featured, popular } = customerMenu([soups], [lentil]);
  assert.equal(featured.length, 0);
  assert.equal(popular.length, 0);
  // The rail is rendered only when the array has something in it, in the one
  // component the guest's menu and the administrator's editor share.
  assert.match(read("components/menu/menu-sections.tsx"), /\{featured\.length \? \(/);
  assert.match(read("components/menu/menu-sections.tsx"), /\{popular\.length \? \(/);
});

test("the rail never draws more than the cap, whatever the admin ticked", () => {
  const many = Array.from({ length: 6 }, (_, index) =>
    product(`f${index}`, "soups", `Ürün ${index}`, index + 1, { isFeatured: true }),
  );
  const { featured } = customerMenu([soups], many);
  assert.equal(MENU_HIGHLIGHT_LIMIT, 3);
  assert.equal(featured.length, MENU_HIGHLIGHT_LIMIT);
  // The editor refuses the fourth rather than letting it silently vanish.
  const dialogs = read("components/admin/menu-editor-dialogs.tsx");
  assert.match(dialogs, /En fazla \$\{MENU_HIGHLIGHT_LIMIT\} ürün Şefin Önerisi olarak seçilebilir\./);
  assert.match(dialogs, /featuredCount >= MENU_HIGHLIGHT_LIMIT && !product\.isFeatured/);
});

test("a recommendation inside a hidden category never reaches the rail", () => {
  const { featured } = customerMenu(
    [soups, { ...desserts, isActive: false }],
    [lentil, { ...baklava, isFeatured: true }],
  );
  assert.equal(featured.length, 0);
});

test("a sold-out dish stays on the menu and says so", () => {
  // "Satışta yok" and "gizli" are different decisions and stay different.
  const { sections } = customerMenu([soups], [{ ...lentil, isAvailable: false }]);
  assert.equal(sections[0].products.length, 1);
  assert.equal(sections[0].products[0].status, "sold-out");
});

test("turning product photographs off reaches the guest's cards", () => {
  const withPhotos = customerMenu([soups], [lentil], true);
  assert.notEqual(withPhotos.sections[0].products[0].image, MENU_PLACEHOLDER_IMAGE);

  const withoutPhotos = customerMenu([soups], [lentil], false);
  // Both cards already draw their no-photo mark for exactly this value.
  assert.equal(withoutPhotos.sections[0].products[0].image, MENU_PLACEHOLDER_IMAGE);
  for (const card of ["components/menu/product-card.tsx", "components/menu/highlight-card.tsx"]) {
    assert.match(read(card), /const hasPhoto = product\.image !== MENU_PLACEHOLDER_IMAGE;/);
  }
});

test("sections, category bar, popover and editor all read one derivation", () => {
  const experience = read("components/menu/menu-experience.tsx");
  const editor = read("components/admin/customer-menu-editor.tsx");

  // The customer menu derives once and hands the same array to the sticky
  // category bar, which owns both the popover and the scroll-spy.
  assert.match(experience, /buildCustomerMenuSections\(menuCategories, publicProducts\)/);
  assert.match(experience, /<CategoryJump sections=\{groupedProducts\}/);
  assert.match(editor, /buildCustomerMenuSections\(model\.categories, model\.products\)/);
  assert.match(editor, /<CategoryJump\s+sections=\{sections\}/);

  // Nothing hard-codes a running order.
  for (const source of [experience, editor, read("lib/adapters/customer-menu-sections.ts")]) {
    assert.doesNotMatch(source, /\[\s*"Çorbalar"/);
  }
});

test("the editor edits content and can do nothing else", () => {
  const editor = read("components/admin/customer-menu-editor.tsx");
  // No order, no waiter call, no bill, no session, no token.
  assert.doesNotMatch(editor, /customerApi|createOrder|waiterCall|billRequest|tableSession/);
  assert.match(editor, /canOrder=\{false\}/);
  assert.match(editor, /orderingEnabled: false/);
});

test("the admin's working copy is filtered by the same rules as the public query", () => {
  const repository = read("lib/repositories/drizzle-menu-repository.ts");
  // Category visibility is the parent rule on both sides: the public product
  // query joins categories and requires the category to be active.
  assert.match(repository, /eq\(categories\.isActive, true\)/);
  assert.match(repository, /orderBy\(asc\(categories\.sortOrder\), asc\(categories\.name\)\)/);
  assert.match(repository, /orderBy\(asc\(products\.sortOrder\), asc\(products\.name\)\)/);

  const adapter = read("lib/adapters/menu-view-model.ts");
  assert.match(adapter, /category\.isActive && !category\.archived/);
  assert.match(adapter, /product\.isActive && !product\.archived/);
});

test("reordering is one transactional write, scoped to the restaurant", () => {
  const service = read("lib/services/admin-menu-service.ts");
  assert.match(service, /async reorderMenu\(/);
  assert.match(service, /this\.repository\.transaction\(async \(transaction\) => \{/);
  // The restaurant comes from the authorised principal, never from the body.
  assert.match(service, /restaurantId: actor\.restaurantId,\s*\n\s*categoryId: entry\.id,/);
  assert.match(service, /restaurantId: actor\.restaurantId,\s*\n\s*productId: entry\.id,/);

  const route = read("app/api/admin/menu/order/route.ts");
  assert.match(route, /adminMutation\(request, "api\.admin\.menu\.order"/);
  assert.match(route, /reorderMenuBodySchema/);
});
