import type { MenuTranslationKey } from "./menu-translations";
import { localeCatalogLoaders } from "./locale-loaders";

export interface MenuLocaleCatalog {
  locale: string;
  ui: Record<MenuTranslationKey, string>;
  categories: Record<string, string>;
  products: Record<string, { name: string; description: string }>;
  allergens: Record<string, string>;
  tags: Record<string, string>;
}

const catalogCache = new Map<string, MenuLocaleCatalog>();
const catalogPromises = new Map<string, Promise<MenuLocaleCatalog>>();

export function getLoadedMenuCatalog(locale: string) {
  return catalogCache.get(locale) ?? catalogCache.get(locale.split("-")[0] ?? locale);
}

export function hasMenuCatalog(locale: string) {
  return Boolean(localeCatalogLoaders[locale] ?? localeCatalogLoaders[locale.split("-")[0] ?? locale]);
}

export async function loadMenuCatalog(locale: string) {
  const catalogCode = localeCatalogLoaders[locale]
    ? locale
    : locale.split("-")[0] ?? locale;
  const cached = catalogCache.get(catalogCode);
  if (cached) return cached;

  const existingPromise = catalogPromises.get(catalogCode);
  if (existingPromise) return existingPromise;

  const loader = localeCatalogLoaders[catalogCode] ?? localeCatalogLoaders.en ?? localeCatalogLoaders.tr;
  if (!loader) throw new Error(`No customer menu catalog loader for ${catalogCode}.`);

  const promise = loader().then((catalog) => {
    catalogCache.set(catalogCode, catalog);
    catalogCache.set(locale, catalog);
    return catalog;
  });
  catalogPromises.set(catalogCode, promise);
  try {
    return await promise;
  } finally {
    catalogPromises.delete(catalogCode);
  }
}
