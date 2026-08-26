import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { categories } from "../../db/seed-data/categories";
import { products } from "../../db/seed-data/products";

/**
 * A menu whose pictures 404 is worse than one with no pictures at all, and a
 * missing file is invisible until a customer opens the page. These cases pin
 * the manifest: every referenced asset exists, covers stay separate from
 * product photos, and no two dishes share a picture.
 */

const FOOD_DIR = path.join(process.cwd(), "public", "images", "food");
const PUBLIC_DIR = path.join(process.cwd(), "public");

const assetPath = (url: string) => path.join(PUBLIC_DIR, url.replace(/^\//, ""));

test("every product points at an asset that exists on disk", () => {
  assert.ok(products.length > 0, "seed products must not be empty");
  for (const product of products) {
    assert.ok(
      existsSync(assetPath(product.image)),
      `${product.name} -> ${product.image} is missing`,
    );
  }
});

test("every category cover exists and is a category-scoped asset", () => {
  assert.ok(categories.length > 0, "seed categories must not be empty");
  for (const category of categories) {
    assert.ok(
      existsSync(assetPath(category.image)),
      `${category.name} -> ${category.image} is missing`,
    );
    // The filename itself has to say "cover", so a product photo cannot drift
    // into this slot unnoticed.
    assert.match(
      category.image,
      /\/images\/food\/category-[a-z-]+\.(jpg|webp)$/,
      `${category.name} cover must be a category-* asset`,
    );
  }
});

test("no category cover reuses a product photograph", () => {
  const productImages = new Set(products.map((product) => product.image));
  for (const category of categories) {
    assert.ok(
      !productImages.has(category.image),
      `${category.name} cover duplicates a product image`,
    );
  }
});

test("no two products share the same photograph", () => {
  const seen = new Map<string, string>();
  for (const product of products) {
    const previous = seen.get(product.image);
    assert.equal(
      previous,
      undefined,
      `${product.name} reuses the image of ${previous}`,
    );
    seen.set(product.image, product.name);
  }
});

test("every product resolves to a real category", () => {
  const ids = new Set(categories.map((category) => category.id));
  for (const product of products) {
    assert.ok(ids.has(product.categoryId), `${product.name} has no category`);
  }
});

test("asset filenames are lowercase, so Linux serves what Windows wrote", () => {
  // Vercel is case-sensitive; a capital letter here is a production-only 404.
  for (const file of readdirSync(FOOD_DIR)) {
    assert.equal(file, file.toLowerCase(), `${file} must be lowercase`);
    assert.doesNotMatch(file, /\s/, `${file} must not contain whitespace`);
  }
});

test("referenced urls are clean absolute paths", () => {
  for (const url of [...products.map((p) => p.image), ...categories.map((c) => c.image)]) {
    assert.ok(url.startsWith("/images/"), `${url} must be an absolute public path`);
    assert.doesNotMatch(url, /\/\//, `${url} must not contain a double slash`);
    assert.doesNotMatch(url, /\\/, `${url} must not contain a backslash`);
  }
});
