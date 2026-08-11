import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const failures = [];

function fail(message) {
  failures.push(message);
}

function loadTypeScriptModule(relativePath, dependencyMap = {}) {
  const filePath = path.join(root, relativePath);
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
    throw new Error(`Unexpected import ${request} while validating ${relativePath}.`);
  };
  new Function("require", "module", "exports", output)(localRequire, moduleRecord, moduleRecord.exports);
  return moduleRecord.exports;
}

function sameKeys(actual, expected) {
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function placeholders(value) {
  return [...value.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((match) => match[1]).sort();
}

function assertCompleteMap(locale, section, actual, expectedKeys) {
  const actualKeys = Object.keys(actual ?? {}).sort();
  if (!sameKeys(actualKeys, expectedKeys)) {
    const missing = expectedKeys.filter((key) => !actualKeys.includes(key));
    const extra = actualKeys.filter((key) => !expectedKeys.includes(key));
    if (missing.length) fail(`${locale}.${section}: missing ${missing.join(", ")}`);
    if (extra.length) fail(`${locale}.${section}: unknown ${extra.join(", ")}`);
  }
  for (const key of expectedKeys) {
    if (typeof actual?.[key] !== "string" || !actual[key].trim()) fail(`${locale}.${section}.${key}: blank translation`);
  }
}

const translations = loadTypeScriptModule("lib/i18n/menu-translations.ts", {
  "./menu-catalog": { getLoadedMenuCatalog: () => undefined },
});
const content = loadTypeScriptModule("lib/i18n/menu-content.ts", {
  "./menu-translations": translations,
  "./menu-catalog": { getLoadedMenuCatalog: () => undefined },
  "./languages": { getMenuLanguage: () => undefined },
});
const products = loadTypeScriptModule("lib/mock-data/products.ts").products;
const categories = loadTypeScriptModule("lib/mock-data/categories.ts").categories;
const supported = loadTypeScriptModule("lib/i18n/supported-locales.ts");
const languages = loadTypeScriptModule("lib/i18n/languages.ts", {
  "./supported-locales": supported,
});

const registry = languages.MENU_LANGUAGE_REGISTRY;
const selectable = languages.MENU_LANGUAGES;
const supportedCodes = [...supported.SUPPORTED_MENU_LOCALE_CODES];
const registryCodes = registry.map((language) => language.code);
const selectableCodes = selectable.map((language) => language.code);
const loaderSource = fs.readFileSync(path.join(root, "lib", "i18n", "locale-loaders.ts"), "utf8");
const loaderCodes = [...loaderSource.matchAll(/\.\/locales\/([^"/]+)\.json/g)].map((match) => match[1]).sort();
const expectedUiKeys = Object.keys(translations.menuTranslations.tr).sort();
const expectedProductIds = products.map((product) => product.id).sort();
const expectedCategoryIds = categories.map((category) => category.id).sort();
const expectedAllergens = Object.keys(content.allergenTranslations).sort();
const expectedTags = Object.keys(content.tagTranslations).sort();
const usedAllergens = [...new Set(products.flatMap((product) => product.allergens))].sort();
const usedTags = [...new Set(products.flatMap((product) => product.tags))].sort();
const expectedRtl = new Set(["ar", "dv", "fa", "ps", "sd", "ug", "ur", "yi"]);
const criticalFlagMappings = {
  tr: "tr", en: "gb", de: "de", ar: "sa", fa: "ir", ur: "pk",
  hi: "in", bn: "bd", ja: "jp", ko: "kr", "zh-CN": "cn", "zh-TW": "tw",
  ru: "ru", uk: "ua", fr: "fr", es: "es", pt: "pt",
};

if (registryCodes.includes("ku") || supportedCodes.includes("ku")) fail("Kurdish (ku) must remain removed.");
if (registryCodes.includes("he") || supportedCodes.includes("he")) fail("Hebrew (he) must remain removed.");
if (languages.ISO_639_1_LANGUAGE_COUNT !== 182) fail(`Expected 182 ISO codes after explicit Kurdish and Hebrew removal; found ${languages.ISO_639_1_LANGUAGE_COUNT}.`);
if (registry.length !== 183) fail(`Expected 183 registry entries after splitting Chinese; found ${registry.length}.`);
if (expectedProductIds.length !== 48) fail(`Expected 48 menu products; found ${expectedProductIds.length}.`);
if (expectedCategoryIds.length !== 6) fail(`Expected 6 menu categories; found ${expectedCategoryIds.length}.`);
for (const allergen of usedAllergens) if (!expectedAllergens.includes(allergen)) fail(`Missing canonical allergen key: ${allergen}.`);
for (const tag of usedTags) if (!expectedTags.includes(tag)) fail(`Missing canonical tag key: ${tag}.`);
if (new Set(registryCodes).size !== registryCodes.length) fail("Duplicate registry language code.");
if (new Set(registry.map((language) => language.locale)).size !== registry.length) fail("Duplicate registry locale.");
if (!sameKeys([...selectableCodes].sort(), [...supportedCodes].sort())) fail("Selectable languages and generated catalogs differ.");
if (!sameKeys(loaderCodes, [...supportedCodes].sort())) fail("Lazy locale loaders and selectable languages differ.");

for (const language of registry) {
  if (!language.nativeName?.trim() || !language.turkishName?.trim() || !language.englishName?.trim()) fail(`${language.code}: missing language display metadata.`);
  if (!Array.isArray(language.searchTerms) || language.searchTerms.length === 0) fail(`${language.code}: missing search metadata.`);
  if (!language.flag?.emoji?.trim()) fail(`${language.code}: missing emoji/globe fallback.`);
  if (!['ltr', 'rtl'].includes(language.direction)) fail(`${language.code}: invalid direction.`);
  if (expectedRtl.has(language.baseCode) !== (language.direction === "rtl")) fail(`${language.code}: incorrect RTL direction.`);
  try { new Intl.Locale(language.locale); } catch { fail(`${language.code}: malformed locale ${language.locale}.`); }
  if (language.flag.countryCode) {
    const flagPath = path.join(root, "public", "images", "flags", `${language.flag.countryCode}.svg`);
    if (!fs.existsSync(flagPath)) fail(`${language.code}: missing desktop flag ${language.flag.countryCode}.svg.`);
  }
}

for (const [code, countryCode] of Object.entries(criticalFlagMappings)) {
  const language = registry.find((entry) => entry.code === code);
  if (language?.flag.countryCode !== countryCode) fail(`${code}: expected ${countryCode} flag mapping.`);
}

for (const [query, expectedCode] of [["almanca", "de"], ["arabic", "ar"], ["日本語", "ja"], ["korean", "ko"], ["cince", "zh-CN"]]) {
  if (!languages.searchMenuLanguages(query).some((language) => language.code === expectedCode)) {
    fail(`Language search ${JSON.stringify(query)} did not return ${expectedCode}.`);
  }
}

const englishPath = path.join(root, "lib", "i18n", "locales", "en.json");
if (!fs.existsSync(englishPath)) fail("Missing canonical English catalog.");
const english = fs.existsSync(englishPath) ? JSON.parse(fs.readFileSync(englishPath, "utf8")) : null;
const turkishPath = path.join(root, "lib", "i18n", "locales", "tr.json");
const turkish = fs.existsSync(turkishPath) ? JSON.parse(fs.readFileSync(turkishPath, "utf8")) : null;

for (const locale of supportedCodes) {
  const catalogPath = path.join(root, "lib", "i18n", "locales", `${locale}.json`);
  if (!fs.existsSync(catalogPath)) {
    fail(`${locale}: catalog file is missing.`);
    continue;
  }
  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  if (/TSL_|<\/?tsl|\[\[\[/i.test(JSON.stringify(catalog))) fail(`${locale}: translation marker leaked into the catalog.`);
  if (JSON.stringify(catalog).includes("\uFFFD")) fail(`${locale}: Unicode replacement character found.`);
  if (catalog.locale !== locale) fail(`${locale}: catalog locale field is ${catalog.locale}.`);
  assertCompleteMap(locale, "ui", catalog.ui, expectedUiKeys);
  assertCompleteMap(locale, "categories", catalog.categories, expectedCategoryIds);
  assertCompleteMap(locale, "allergens", catalog.allergens, expectedAllergens);
  assertCompleteMap(locale, "tags", catalog.tags, expectedTags);
  if (!catalog.ui?.splashLabel?.includes("Tarihi Şehir Lokantası")) fail(`${locale}.ui.splashLabel: protected brand name changed.`);

  const actualProductIds = Object.keys(catalog.products ?? {}).sort();
  if (!sameKeys(actualProductIds, expectedProductIds)) {
    const missing = expectedProductIds.filter((id) => !actualProductIds.includes(id));
    const extra = actualProductIds.filter((id) => !expectedProductIds.includes(id));
    if (missing.length) fail(`${locale}.products: missing ${missing.join(", ")}`);
    if (extra.length) fail(`${locale}.products: unknown ${extra.join(", ")}`);
  }
  for (const id of expectedProductIds) {
    if (!catalog.products?.[id]?.name?.trim()) fail(`${locale}.products.${id}.name: blank translation.`);
    if (!catalog.products?.[id]?.description?.trim()) fail(`${locale}.products.${id}.description: blank translation.`);
  }

  if (english) {
    for (const key of expectedUiKeys) {
      const expectedPlaceholders = placeholders(english.ui[key] ?? "");
      const actualPlaceholders = placeholders(catalog.ui?.[key] ?? "");
      if (!sameKeys(actualPlaceholders, expectedPlaceholders)) fail(`${locale}.ui.${key}: placeholder mismatch.`);
    }
    if (locale !== "en" && JSON.stringify(catalog.ui) === JSON.stringify(english.ui)) fail(`${locale}: entire UI is an English fallback.`);
    if (locale !== "en" && JSON.stringify(catalog.products) === JSON.stringify(english.products)) fail(`${locale}: entire product catalog is an English fallback.`);
  }
  if (turkish && locale !== "tr" && JSON.stringify(catalog.ui) === JSON.stringify(turkish.ui)) fail(`${locale}: entire UI is a Turkish fallback.`);
}

const rtlLocales = selectable.filter((language) => language.direction === "rtl").map((language) => language.code);
const flagFallbacks = registry.filter((language) => !language.flag.countryCode).map((language) => language.code);
console.log(`REGISTERED LANGUAGES: ${registry.length}`);
console.log(`SELECTABLE LANGUAGES: ${selectable.length}`);
console.log(`PRODUCTS PER LOCALE: ${expectedProductIds.length}`);
console.log(`CATEGORIES PER LOCALE: ${expectedCategoryIds.length}`);
console.log(`RTL LANGUAGES: ${rtlLocales.join(", ") || "none"}`);
console.log(`FLAG FALLBACKS: ${flagFallbacks.join(", ") || "none"}`);
console.log(`LANGUAGES CHECKED: ALL (${supportedCodes.length})`);

if (failures.length) {
  console.error(`I18N VALIDATION FAILED (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("INCOMPLETE SELECTABLE LANGUAGES: 0");
console.log("MISSING TRANSLATION KEYS: 0");
console.log("MISSING PRODUCT TRANSLATIONS: 0");
console.log("MISSING CATEGORY TRANSLATIONS: 0");
console.log("I18N VALIDATION: PASS");
