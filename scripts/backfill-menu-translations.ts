import { loadEnvConfig } from "@next/env";
import { readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

import { DEFAULT_MENU_LANGUAGE } from "../lib/i18n/languages";
import { SUPPORTED_MENU_LOCALE_CODES } from "../lib/i18n/supported-locales";

const CATEGORY_KEY_BY_SLUG: Readonly<Record<string, string>> = {
  corbalar: "soups",
  izgaralar: "grill",
  "ana-yemekler": "mains",
  icecekler: "drinks",
  kebaplar: "kebabs",
  tatlilar: "dessert",
};

interface LocaleCatalog {
  readonly categories: Readonly<Record<string, string>>;
  readonly products: Readonly<Record<string, { readonly name: string; readonly description: string }>>;
}

interface CoreCategory {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
}

type CoreProduct = CoreCategory;

function argument(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length).trim();
}

async function loadCatalog(locale: string): Promise<LocaleCatalog> {
  const file = path.join(process.cwd(), "lib", "i18n", "locales", `${locale}.json`);
  return JSON.parse(await readFile(file, "utf8")) as LocaleCatalog;
}

function chunk<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const execute = process.argv.includes("--execute");
  if (dryRun === execute) {
    throw new Error("Exactly one mode is required: --dry-run or --execute.");
  }

  const restaurantSlug = argument("restaurant-slug");
  if (!restaurantSlug) {
    throw new Error("--restaurant-slug=<slug> is required.");
  }

  loadEnvConfig(process.cwd());
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");

  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    const restaurants = await sql<{ id: string; name: string; slug: string }[]>`
      select id, name, slug
      from restaurants
      where slug = ${restaurantSlug} and is_active = true
      limit 2
    `;
    if (restaurants.length !== 1) {
      throw new Error(`Expected exactly one active restaurant for slug ${restaurantSlug}.`);
    }
    const restaurant = restaurants[0]!;
    const [categories, products, tableRows] = await Promise.all([
      sql<CoreCategory[]>`
        select id, name, slug, description
        from categories
        where restaurant_id = ${restaurant.id}
        order by id
      `,
      sql<CoreProduct[]>`
        select id, name, slug, description
        from products
        where restaurant_id = ${restaurant.id}
        order by id
      `,
      sql<{ category_table: string | null; product_table: string | null }[]>`
        select
          to_regclass('public.category_translations')::text as category_table,
          to_regclass('public.product_translations')::text as product_table
      `,
    ]);

    const tablesReady = Boolean(tableRows[0]?.category_table && tableRows[0]?.product_table);
    const categoryRows: Array<Record<string, string | null>> = [];
    const productRows: Array<Record<string, string | null>> = [];
    let missingCategoryTranslations = 0;
    let missingProductTranslations = 0;

    const catalogs = new Map<string, LocaleCatalog>();
    for (const locale of SUPPORTED_MENU_LOCALE_CODES) {
      catalogs.set(locale, await loadCatalog(locale));
    }

    for (const category of categories) {
      categoryRows.push({
        restaurant_id: restaurant.id,
        category_id: category.id,
        locale: DEFAULT_MENU_LANGUAGE,
        name: category.name,
        description: category.description,
      });
      const key = CATEGORY_KEY_BY_SLUG[category.slug] ?? category.slug;
      for (const locale of SUPPORTED_MENU_LOCALE_CODES) {
        if (locale === DEFAULT_MENU_LANGUAGE) continue;
        const name = catalogs.get(locale)?.categories[key]?.trim();
        if (!name) {
          missingCategoryTranslations += 1;
          continue;
        }
        categoryRows.push({
          restaurant_id: restaurant.id,
          category_id: category.id,
          locale,
          name,
          description: null,
        });
      }
    }

    for (const product of products) {
      productRows.push({
        restaurant_id: restaurant.id,
        product_id: product.id,
        locale: DEFAULT_MENU_LANGUAGE,
        name: product.name,
        description: product.description,
      });
      for (const locale of SUPPORTED_MENU_LOCALE_CODES) {
        if (locale === DEFAULT_MENU_LANGUAGE) continue;
        const translation = catalogs.get(locale)?.products[product.slug];
        if (!translation?.name.trim()) {
          missingProductTranslations += 1;
          continue;
        }
        productRows.push({
          restaurant_id: restaurant.id,
          product_id: product.id,
          locale,
          name: translation.name.trim(),
          description: translation.description?.trim() || null,
        });
      }
    }

    let existingCategoryRows = 0;
    let existingProductRows = 0;
    if (tablesReady) {
      const [categoryCount, productCount] = await Promise.all([
        sql<{ count: string }[]>`
          select count(*)::text as count from category_translations where restaurant_id = ${restaurant.id}
        `,
        sql<{ count: string }[]>`
          select count(*)::text as count from product_translations where restaurant_id = ${restaurant.id}
        `,
      ]);
      existingCategoryRows = Number(categoryCount[0]?.count ?? 0);
      existingProductRows = Number(productCount[0]?.count ?? 0);
    }

    console.log("MENU TRANSLATION BACKFILL PREVIEW");
    console.log(`Restaurant: ${restaurant.name} (${restaurant.slug})`);
    console.log(`Restaurant ID: ${restaurant.id}`);
    console.log(`Supported locales: ${SUPPORTED_MENU_LOCALE_CODES.length}`);
    console.log(`Default locale: ${DEFAULT_MENU_LANGUAGE}`);
    console.log(`Core categories: ${categories.length}`);
    console.log(`Core products: ${products.length}`);
    console.log(`Candidate category translations: ${categoryRows.length}`);
    console.log(`Candidate product translations: ${productRows.length}`);
    console.log(`Missing category translations: ${missingCategoryTranslations}`);
    console.log(`Missing product translations: ${missingProductTranslations}`);
    console.log(`Existing category translations: ${existingCategoryRows}`);
    console.log(`Existing product translations: ${existingProductRows}`);
    console.log(`Translation tables ready: ${tablesReady ? "YES" : "NO"}`);
    console.log("Conflict policy: KEEP EXISTING");

    if (dryRun) {
      console.log("DRY RUN: PASS (no database writes)");
      return;
    }
    if (!tablesReady) {
      throw new Error("Translation tables are missing. Apply the generated migration before execute.");
    }

    const inserted = await sql.begin(async (transaction) => {
      let insertedCategories = 0;
      let insertedProducts = 0;
      for (const rows of chunk(categoryRows, 500)) {
        const result = await transaction`
          insert into category_translations ${transaction(
            rows,
            "restaurant_id",
            "category_id",
            "locale",
            "name",
            "description",
          )}
          on conflict (restaurant_id, category_id, locale) do nothing
          returning id
        `;
        insertedCategories += result.length;
      }
      for (const rows of chunk(productRows, 500)) {
        const result = await transaction`
          insert into product_translations ${transaction(
            rows,
            "restaurant_id",
            "product_id",
            "locale",
            "name",
            "description",
          )}
          on conflict (restaurant_id, product_id, locale) do nothing
          returning id
        `;
        insertedProducts += result.length;
      }
      return { insertedCategories, insertedProducts };
    });
    console.log(`COMMITTED: category_translations=${inserted.insertedCategories} product_translations=${inserted.insertedProducts}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Backfill failed.");
  process.exitCode = 1;
});
