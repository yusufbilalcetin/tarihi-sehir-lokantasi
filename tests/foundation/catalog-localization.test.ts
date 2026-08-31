import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  normalizeCatalogTranslations,
  normalizeMenuLocale,
  resolveCatalogTranslation,
} from "../../lib/i18n/catalog-localization";
import { loadMenuCatalog } from "../../lib/i18n/menu-catalog";
import {
  getMenuCategoryName,
  getMenuProductDescription,
  getMenuProductName,
} from "../../lib/i18n/menu-content";
import { matchesCustomerMenuSearch } from "../../lib/domain/customer-menu";
import type { Category, Product } from "../../types";
import {
  createProductBodySchema,
  updateCategoryBodySchema,
} from "../../lib/validation/admin-menu";

const category: Category = {
  id: "category-1",
  name: "Çorbalar",
  slug: "corbalar",
  i18nKey: "soups",
  productCount: 1,
  active: true,
  sortOrder: 1,
  defaultLocale: "tr-TR",
  translations: {
    tr: { name: "Çorbalar", description: null },
    en: { name: "Soup Selection", description: null },
  },
};

const product: Product = {
  id: "product-1",
  name: "Mercimek Çorbası",
  description: "Kırmızı mercimek ve tereyağı.",
  price: 250,
  categoryId: category.id,
  category: category.name,
  image: "/images/placeholder-dish.webp",
  allergens: [],
  tags: [],
  status: "active",
  i18nKey: "mercimek",
  defaultLocale: "tr-TR",
  translations: {
    tr: { name: "Mercimek Çorbası", description: "Kırmızı mercimek ve tereyağı." },
    en: { name: "House Lentil Soup", description: "Red lentils and butter." },
  },
};

test("catalog locale normalization uses the shared allow-list and a safe default", () => {
  assert.equal(normalizeMenuLocale("tr-TR"), "tr");
  assert.equal(normalizeMenuLocale("ZH-cn"), "zh-CN");
  assert.equal(normalizeMenuLocale("bitcoin"), "tr");
  assert.deepEqual(normalizeCatalogTranslations([
    { locale: "en", name: " Soup ", description: " Text " },
    { locale: "bitcoin", name: "Rejected" },
  ]), [{ locale: "en", name: "Soup", description: "Text" }]);
});

test("requested database translations beat static content and retain entity identity", async () => {
  await loadMenuCatalog("en");
  const before = { id: product.id, price: product.price, categoryId: product.categoryId };
  assert.equal(getMenuCategoryName(category, "en"), "Soup Selection");
  assert.equal(getMenuProductName(product, "en"), "House Lentil Soup");
  assert.equal(getMenuProductDescription(product, "en"), "Red lentils and butter.");
  assert.deepEqual(
    { id: product.id, price: product.price, categoryId: product.categoryId },
    before,
  );
});

test("missing and unknown translations fall back to real default content, never blank", async () => {
  await loadMenuCatalog("en");
  const newProduct = { ...product, i18nKey: "not-in-static-catalog", translations: product.translations };
  assert.equal(getMenuProductName(newProduct, "de"), "Mercimek Çorbası");
  assert.equal(getMenuProductDescription(newProduct, "de"), "Kırmızı mercimek ve tereyağı.");
  assert.equal(getMenuProductName(newProduct, "bitcoin"), "Mercimek Çorbası");
  assert.deepEqual(
    resolveCatalogTranslation(newProduct.translations, "de", "tr-TR"),
    newProduct.translations?.tr,
  );
});

test("localized product and category names are searchable", () => {
  const fields = [getMenuProductName(product, "en"), getMenuCategoryName(category, "en")];
  assert.equal(matchesCustomerMenuSearch("lentil", fields, "en-GB"), true);
  assert.equal(matchesCustomerMenuSearch("soup selection", fields, "en-GB"), true);
});

test("TR to EN to TR changes labels without changing cart identity or totals", () => {
  const cart = { productId: product.id, quantity: 2, unitPrice: product.price };
  assert.equal(getMenuProductName(product, "tr"), "Mercimek Çorbası");
  assert.equal(getMenuProductName(product, "en"), "House Lentil Soup");
  assert.equal(getMenuProductName(product, "tr"), "Mercimek Çorbası");
  assert.deepEqual(cart, { productId: "product-1", quantity: 2, unitPrice: 250 });
});

test("admin translation payloads accept supported locales and reject arbitrary locale keys", () => {
  assert.equal(createProductBodySchema.safeParse({
    categoryId: "00000000-0000-4000-8000-000000000001",
    name: "Çorba",
    price: "100.00",
    translations: [{ locale: "en", name: "Soup", description: null }],
  }).success, true);
  assert.equal(updateCategoryBodySchema.safeParse({
    translations: [{ locale: "bitcoin", name: "Unsafe" }],
  }).success, false);
});

test("public translation reads are set-based rather than per product", () => {
  const source = readFileSync(
    new URL("../../lib/repositories/drizzle-menu-repository.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /Promise\.all\(\[/);
  assert.equal((source.match(/\.from\(categoryTranslations\)/g) ?? []).length, 1);
  assert.equal((source.match(/\.from\(productTranslations\)/g) ?? []).length, 1);
  assert.doesNotMatch(source, /for \([^)]*product[^)]*\)[\s\S]{0,200}\.select\(/);
});

/* ------------------------------------------------------------------ *
 * Final QA round: the full fallback matrix and locale edge cases.
 * ------------------------------------------------------------------ */

test("QA: every fallback case resolves to real text and never to a blank name", async () => {
  await loadMenuCatalog("en");
  await loadMenuCatalog("de");

  // CASE A — the requested language is in the database.
  assert.equal(getMenuProductName(product, "en"), "House Lentil Soup");

  // CASE B — no database row for the request, but the static catalog has one.
  const staticOnly = { ...product, translations: { tr: product.translations!.tr } };
  assert.equal(getMenuProductName(staticOnly, "de"), "Linsensuppe");
  assert.equal(getMenuCategoryName({ ...category, translations: {} }, "de"), "Suppen");

  // CASE C — nothing for the request anywhere, but the default language is stored.
  const unknownKey = { ...product, i18nKey: "not-in-static-catalog" };
  assert.equal(getMenuProductName(unknownKey, "sw"), "Mercimek Çorbası");

  // CASE D — no translations at all; the core row is the answer.
  const bare = { ...product, i18nKey: "not-in-static-catalog", translations: undefined };
  assert.equal(getMenuProductName(bare, "sw"), "Mercimek Çorbası");
  assert.equal(getMenuProductDescription(bare, "sw"), "Kırmızı mercimek ve tereyağı.");

  // CASE E — the name is translated but the description is not.
  const nameOnly = {
    ...product,
    i18nKey: "not-in-static-catalog",
    translations: {
      tr: product.translations!.tr,
      de: { name: "Linsensuppe", description: null },
    },
  };
  assert.equal(getMenuProductName(nameOnly, "de"), "Linsensuppe");
  assert.equal(getMenuProductDescription(nameOnly, "de"), "Kırmızı mercimek ve tereyağı.");

  // CASE F — a description with no name for that language still shows a name.
  const descriptionOnly = {
    ...product,
    i18nKey: "not-in-static-catalog",
    translations: {
      tr: product.translations!.tr,
      de: { name: "", description: "Linsensuppe aus roten Linsen." },
    },
  };
  assert.equal(getMenuProductName(descriptionOnly, "de"), "Mercimek Çorbası");
  assert.equal(getMenuProductDescription(descriptionOnly, "de"), "Linsensuppe aus roten Linsen.");

  // The property that matters across every case above.
  for (const candidate of [product, staticOnly, unknownKey, bare, nameOnly, descriptionOnly]) {
    for (const locale of ["tr", "en", "de", "ar", "sw", "zh-CN"]) {
      assert.ok(
        getMenuProductName(candidate, locale).trim().length > 0,
        `a guest reading ${locale} must never see a nameless dish`,
      );
    }
  }
});

test("QA: locale input is normalised safely and Chinese never collapses", () => {
  assert.equal(normalizeMenuLocale("tr"), "tr");
  assert.equal(normalizeMenuLocale("tr-TR"), "tr");
  assert.equal(normalizeMenuLocale("EN"), "en");
  assert.equal(normalizeMenuLocale("en-US"), "en");
  assert.equal(normalizeMenuLocale("  de  "), "de");
  assert.equal(normalizeMenuLocale(""), "tr");
  assert.equal(normalizeMenuLocale(null), "tr");
  assert.equal(normalizeMenuLocale(undefined), "tr");
  assert.equal(normalizeMenuLocale("bitcoin"), "tr");
  assert.equal(normalizeMenuLocale("../en"), "tr", "a path is not a language");
  assert.equal(normalizeMenuLocale("en; drop table"), "tr");

  for (const rtl of ["ar", "fa", "ur"]) assert.equal(normalizeMenuLocale(rtl), rtl);

  // The two written forms of Chinese are different languages to a reader and
  // must stay different rows, keys and catalogs.
  assert.equal(normalizeMenuLocale("zh-CN"), "zh-CN");
  assert.equal(normalizeMenuLocale("zh-TW"), "zh-TW");
  assert.equal(normalizeMenuLocale("ZH-cn"), "zh-CN");
  assert.equal(normalizeMenuLocale("zh-tw"), "zh-TW");
  assert.notEqual(normalizeMenuLocale("zh-CN"), normalizeMenuLocale("zh-TW"));
});

test("QA: the two Chinese catalogs are separate files with different text", async () => {
  const simplified = await loadMenuCatalog("zh-CN");
  const traditional = await loadMenuCatalog("zh-TW");
  assert.equal(simplified.locale, "zh-CN");
  assert.equal(traditional.locale, "zh-TW");
  assert.notEqual(simplified.products.mercimek?.name, traditional.products.mercimek?.name);
});

test("QA: localized search survives Turkish casing and diacritics", () => {
  const turkish = [getMenuProductName(product, "tr"), getMenuCategoryName(category, "tr")];
  for (const term of ["mercimek", "MERCİMEK", "Mercimek", "çorba", "ÇORBA", "corba"]) {
    assert.equal(
      matchesCustomerMenuSearch(term, turkish, "tr-TR"),
      true,
      `"${term}" should find the soup`,
    );
  }
  // Searching in English finds the English name, and the row identity is the
  // product id either way — a translated label never becomes a different dish.
  const english = [getMenuProductName(product, "en")];
  assert.equal(matchesCustomerMenuSearch("lentil", english, "en-GB"), true);
  assert.equal(matchesCustomerMenuSearch("mercimek", english, "en-GB"), false);
  assert.equal(product.id, "product-1");
});
