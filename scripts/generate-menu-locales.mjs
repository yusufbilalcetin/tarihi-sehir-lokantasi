import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const { translate: translateWithBing, lang: bingLanguages } = require("bing-translate-api");

const projectRoot = process.cwd();
const localeDirectory = path.join(projectRoot, "lib", "i18n", "locales");
const languageSourcePath = path.join(projectRoot, "lib", "i18n", "languages.ts");
const sourceEnglishCatalogPath = path.join(localeDirectory, "en.json");
const MAX_BATCH_CHARACTERS = 760;
const MAX_CONCURRENT_LOCALES = 8;
const BING_LOCALE_OVERRIDES = {
  jv: "jav",
  nn: "nno",
  no: "nb",
  ny: "nya",
  sr: "sr-Cyrl",
  tg: "tgk",
  tl: "fil",
  yi: "ydd",
  "zh-CN": "zh-Hans",
  "zh-TW": "zh-Hant",
};

function translationTarget(locale) {
  return BING_LOCALE_OVERRIDES[locale] ?? locale;
}

function loadTypeScriptModule(relativePath, dependencyMap = {}) {
  const filePath = path.join(projectRoot, relativePath);
  const source = fs.readFileSync(filePath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
    fileName: filePath,
  }).outputText;
  const moduleRecord = { exports: {} };
  const localRequire = (request) => {
    if (request in dependencyMap) return dependencyMap[request];
    throw new Error(`Unexpected runtime import ${request} while loading ${relativePath}.`);
  };
  new Function("require", "module", "exports", output)(localRequire, moduleRecord, moduleRecord.exports);
  return moduleRecord.exports;
}

function readRegistryCodes() {
  const source = fs.readFileSync(languageSourcePath, "utf8");
  const match = source.match(/const ISO_639_1_CODES = \(\s*"([^"]+)"/s);
  if (!match) throw new Error("Could not read ISO language codes from languages.ts.");
  return match[1].split(" ").flatMap((code) => code === "zh" ? ["zh-CN", "zh-TW"] : [code]);
}

function localizedValue(value, locale) {
  if (typeof value === "string") return value;
  return value?.[locale] ?? value?.[locale.split("-")[0]] ?? value?.en ?? value?.tr ?? "";
}

function buildCanonicalCatalog() {
  const catalogStub = { getLoadedMenuCatalog: () => undefined };
  const translations = loadTypeScriptModule("lib/i18n/menu-translations.ts", {
    "./menu-catalog": catalogStub,
  });
  const content = loadTypeScriptModule("lib/i18n/menu-content.ts", {
    "./menu-translations": translations,
    "./menu-catalog": catalogStub,
    "./languages": { getMenuLanguage: () => undefined },
  });
  const productModule = loadTypeScriptModule("lib/mock-data/products.ts");
  const categoryModule = loadTypeScriptModule("lib/mock-data/categories.ts");
  const existingEnglishCatalog = fs.existsSync(sourceEnglishCatalogPath)
    ? JSON.parse(fs.readFileSync(sourceEnglishCatalogPath, "utf8"))
    : null;

  const products = Object.fromEntries(productModule.products.map((product) => [
    product.id,
    {
      name: localizedValue(content.productNames[product.id] ?? product.name, "en"),
      description: existingEnglishCatalog?.products?.[product.id]?.description ?? product.description,
      sourceDescription: product.description,
    },
  ]));

  return {
    english: {
      locale: "en",
      ui: translations.menuTranslations.en,
      categories: Object.fromEntries(categoryModule.categories.map((category) => [category.id, localizedValue(content.categoryNames[category.id] ?? category.name, "en")])),
      products,
      allergens: Object.fromEntries(Object.entries(content.allergenTranslations).map(([key, value]) => [key, localizedValue(value, "en")])),
      tags: Object.fromEntries(Object.entries(content.tagTranslations).map(([key, value]) => [key, localizedValue(value, "en")])),
    },
    turkish: {
      locale: "tr",
      ui: translations.menuTranslations.tr,
      categories: Object.fromEntries(categoryModule.categories.map((category) => [category.id, category.name])),
      products: Object.fromEntries(productModule.products.map((product) => [product.id, { name: product.name, description: product.description }])),
      allergens: Object.fromEntries(Object.keys(content.allergenTranslations).map((key) => [key, key])),
      tags: Object.fromEntries(Object.keys(content.tagTranslations).map((key) => [key, key])),
    },
    curated: Object.fromEntries(["de", "ar"].map((locale) => [locale, {
      ui: translations.menuTranslations[locale],
      categories: Object.fromEntries(categoryModule.categories.map((category) => [category.id, localizedValue(content.categoryNames[category.id] ?? category.name, locale)])),
      productNames: Object.fromEntries(productModule.products.map((product) => [product.id, localizedValue(content.productNames[product.id] ?? product.name, locale)])),
      allergens: Object.fromEntries(Object.entries(content.allergenTranslations).map(([key, value]) => [key, localizedValue(value, locale)])),
      tags: Object.fromEntries(Object.entries(content.tagTranslations).map(([key, value]) => [key, localizedValue(value, locale)])),
    }])),
  };
}

function flattenCatalog(value, prefix = "", output = {}) {
  for (const [key, child] of Object.entries(value)) {
    const pathKey = prefix ? `${prefix}.${key}` : key;
    if (typeof child === "string") output[pathKey] = child;
    else flattenCatalog(child, pathKey, output);
  }
  return output;
}

function unflattenCatalog(flattened) {
  const output = {};
  for (const [pathKey, value] of Object.entries(flattened)) {
    const parts = pathKey.split(".");
    let current = output;
    for (const part of parts.slice(0, -1)) current = current[part] ??= {};
    current[parts.at(-1)] = value;
  }
  return output;
}

function protectText(value) {
  return value
    .replaceAll("Tarihi Şehir Lokantası", "__TSL_BRAND_NAME__")
    .replace(/\{([a-zA-Z0-9_]+)\}/g, (_, name) => `__TSL_VAR_${name.toUpperCase()}__`);
}

function restoreText(value) {
  return value
    .replaceAll("__TSL_BRAND_NAME__", "Tarihi Şehir Lokantası")
    .replace(/__TSL_VAR_([A-Z0-9_]+)__/g, (_, name) => `{${name.toLocaleLowerCase("en-US")}}`)
    .trim();
}

function splitBatches(entries) {
  const batches = [];
  let current = [];
  let length = 0;
  for (const entry of entries) {
    const nextLength = entry[1].length + 32;
    if (current.length && length + nextLength > MAX_BATCH_CHARACTERS) {
      batches.push(current);
      current = [];
      length = 0;
    }
    current.push(entry);
    length += nextLength;
  }
  if (current.length) batches.push(current);
  return batches;
}

async function requestTranslation(text, target, attempt = 0, source = "en") {
  try {
    const result = await translateWithBing(text, source, translationTarget(target));
    if (!result?.translation) throw new Error("Empty translation response");
    return result.translation;
  } catch (error) {
    process.stderr.write(`Retry ${attempt + 1} for ${source} -> ${target}: ${String(error)}\n`);
    if (attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
      return requestTranslation(text, target, attempt + 1, source);
    }
    throw new Error(`Translation request failed for ${source} -> ${target}: ${String(error)}`);
  }
}

async function translateBatch(batch, target, source = "en") {
  const request = batch.map(([, value], index) => `<tsl${index}>${protectText(value)}</tsl${index}>`).join("");
  const response = await requestTranslation(request, target, 0, source);
  const matches = [...response.matchAll(/<tsl(\d+)>([\s\S]*?)<\/tsl\1>/gi)];
  if (matches.length !== batch.length) {
    if (batch.length === 1) return [[batch[0][0], restoreText(response.replace(/<\/?tsl0>/gi, ""))]];
    const midpoint = Math.ceil(batch.length / 2);
    return [
      ...await translateBatch(batch.slice(0, midpoint), target, source),
      ...await translateBatch(batch.slice(midpoint), target, source),
    ];
  }
  return matches.map((match) => {
    const index = Number(match[1]);
    return [batch[index][0], restoreText(match[2])];
  });
}

async function ensureEnglishDescriptions(catalog) {
  const entries = Object.entries(catalog.products).filter(([, product]) => product.description === product.sourceDescription);
  let completed = 0;
  for (const batch of splitBatches(entries.map(([id, product]) => [id, product.sourceDescription]))) {
    for (const [id, description] of await translateBatch(batch, "en", "tr")) {
      catalog.products[id].description = description;
      completed += 1;
    }
    process.stdout.write(`English descriptions: ${completed}/${entries.length}\n`);
  }
  for (const product of Object.values(catalog.products)) delete product.sourceDescription;
}

async function translateCatalog(sourceCatalog, locale) {
  const target = translationTarget(locale);
  const flattened = flattenCatalog({
    ui: sourceCatalog.ui,
    categories: sourceCatalog.categories,
    products: sourceCatalog.products,
    allergens: sourceCatalog.allergens,
    tags: sourceCatalog.tags,
  });
  const translated = {};
  for (const batch of splitBatches(Object.entries(flattened))) {
    for (const [key, value] of await translateBatch(batch, target)) translated[key] = value;
  }
  return { locale, ...unflattenCatalog(translated) };
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sameKeySet(first, second) {
  const firstKeys = Object.keys(first ?? {}).sort();
  const secondKeys = Object.keys(second ?? {}).sort();
  return firstKeys.length === secondKeys.length && firstKeys.every((key, index) => key === secondKeys[index]);
}

function placeholderSignature(value) {
  return [...String(value).matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((match) => match[1]).sort().join("|");
}

function hasCompleteCatalog(locale, sourceCatalog) {
  const filePath = path.join(localeDirectory, `${locale}.json`);
  if (!fs.existsSync(filePath)) return false;
  try {
    const catalog = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (catalog.locale !== locale) return false;
    if (/TSL_|<\/?tsl|\[\[\[|\uFFFD/i.test(JSON.stringify(catalog))) return false;
    if (!sameKeySet(catalog.ui, sourceCatalog.ui)
      || !sameKeySet(catalog.categories, sourceCatalog.categories)
      || !sameKeySet(catalog.products, sourceCatalog.products)
      || !sameKeySet(catalog.allergens, sourceCatalog.allergens)
      || !sameKeySet(catalog.tags, sourceCatalog.tags)) return false;
    if (!catalog.ui.splashLabel.includes("Tarihi Şehir Lokantası")) return false;
    if (Object.entries(sourceCatalog.ui).some(([key, value]) => placeholderSignature(catalog.ui[key]) !== placeholderSignature(value))) return false;
    return Object.values(catalog.ui).every((value) => typeof value === "string" && value.trim())
      && Object.values(catalog.categories).every((value) => typeof value === "string" && value.trim())
      && Object.values(catalog.allergens).every((value) => typeof value === "string" && value.trim())
      && Object.values(catalog.tags).every((value) => typeof value === "string" && value.trim())
      && Object.values(catalog.products).every((product) => product?.name?.trim() && product?.description?.trim());
  } catch {
    return false;
  }
}

function writeGeneratedModules(locales) {
  const supportedPath = path.join(projectRoot, "lib", "i18n", "supported-locales.ts");
  const loadersPath = path.join(projectRoot, "lib", "i18n", "locale-loaders.ts");
  fs.writeFileSync(supportedPath, `export const SUPPORTED_MENU_LOCALE_CODES = ${JSON.stringify(locales)} as const;\nexport const SUPPORTED_MENU_LOCALE_SET = new Set<string>(SUPPORTED_MENU_LOCALE_CODES);\n`, "utf8");
  const loaderLines = locales.map((locale) => `  ${JSON.stringify(locale)}: () => import("./locales/${locale}.json").then((module) => module.default as MenuLocaleCatalog),`);
  fs.writeFileSync(loadersPath, `import type { MenuLocaleCatalog } from "./menu-catalog";\n\nexport const localeCatalogLoaders: Record<string, () => Promise<MenuLocaleCatalog>> = {\n${loaderLines.join("\n")}\n};\n`, "utf8");
}

async function main() {
  process.stdout.write("Reading locale registry...\n");
  fs.mkdirSync(localeDirectory, { recursive: true });
  const registryLocales = readRegistryCodes();
  const supportedLocales = registryLocales.filter((locale) =>
    locale === "tr" || locale === "en" || bingLanguages.isSupported(translationTarget(locale)),
  );
  process.stdout.write(`Registry locales: ${registryLocales.length}; translatable: ${supportedLocales.length}.\n`);
  const source = buildCanonicalCatalog();
  process.stdout.write("Canonical customer catalog loaded.\n");
  await ensureEnglishDescriptions(source.english);
  writeJson(path.join(localeDirectory, "tr.json"), source.turkish);
  writeJson(sourceEnglishCatalogPath, source.english);

  const generatedLocales = new Set(["tr", "en"]);
  for (const locale of supportedLocales) {
    if (!["tr", "en"].includes(locale) && hasCompleteCatalog(locale, source.english)) generatedLocales.add(locale);
  }
  const pendingLocales = supportedLocales.filter((locale) => !generatedLocales.has(locale));
  const failedLocales = [];
  let nextIndex = 0;
  let completed = 0;
  async function worker() {
    while (nextIndex < pendingLocales.length) {
      const locale = pendingLocales[nextIndex++];
      try {
        const catalog = await translateCatalog(source.english, locale);
        const curated = source.curated[locale];
        if (curated) {
          catalog.ui = curated.ui;
          catalog.categories = curated.categories;
          catalog.allergens = curated.allergens;
          catalog.tags = curated.tags;
          for (const [id, name] of Object.entries(curated.productNames)) catalog.products[id].name = name;
        }
        writeJson(path.join(localeDirectory, `${locale}.json`), catalog);
        generatedLocales.add(locale);
        completed += 1;
        process.stdout.write(`Locale catalogs: ${completed}/${pendingLocales.length} (${locale})\n`);
      } catch (error) {
        failedLocales.push(locale);
        process.stderr.write(`Skipped incomplete locale ${locale}: ${String(error)}\n`);
      }
    }
  }
  await Promise.all(Array.from({ length: MAX_CONCURRENT_LOCALES }, () => worker()));
  const completeLocales = supportedLocales.filter((locale) =>
    generatedLocales.has(locale) && hasCompleteCatalog(locale, source.english),
  );
  for (const fileName of fs.readdirSync(localeDirectory)) {
    if (!fileName.endsWith(".json")) continue;
    const locale = fileName.slice(0, -5);
    if (!completeLocales.includes(locale)) fs.unlinkSync(path.join(localeDirectory, fileName));
  }
  writeGeneratedModules(completeLocales);
  process.stdout.write(`Generated ${completeLocales.length} complete selectable locale catalogs.\n`);
  process.stdout.write(`Registry-only locales: ${registryLocales.filter((locale) => !completeLocales.includes(locale)).join(", ")}\n`);
  if (failedLocales.length) process.stdout.write(`Failed generation locales: ${failedLocales.join(", ")}\n`);
}

await main();
