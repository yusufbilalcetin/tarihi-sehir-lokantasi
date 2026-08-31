import { DEFAULT_MENU_LANGUAGE } from "./languages";
import {
  SUPPORTED_MENU_LOCALE_CODES,
  SUPPORTED_MENU_LOCALE_SET,
} from "./supported-locales";

export interface CatalogTranslation {
  readonly name: string;
  readonly description: string | null;
}

export type CatalogTranslations = Readonly<Record<string, CatalogTranslation>>;

export interface CatalogTranslationInput {
  readonly locale: string;
  readonly name: string;
  readonly description?: string | null;
}

export function supportedMenuLocale(value: string | null | undefined): string | null {
  const candidate = value?.trim();
  if (!candidate) return null;
  if (SUPPORTED_MENU_LOCALE_SET.has(candidate)) return candidate;
  return SUPPORTED_MENU_LOCALE_CODES.find(
    (locale) => locale.toLocaleLowerCase("en-US") === candidate.toLocaleLowerCase("en-US"),
  ) ?? null;
}

/**
 * Restaurant defaults historically use regional tags (`tr-TR`), while the
 * customer language registry uses its canonical menu codes (`tr`, `zh-CN`).
 * Only codes from that registry are allowed to reach a translation lookup.
 */
export function normalizeMenuLocale(
  value: string | null | undefined,
  fallback = DEFAULT_MENU_LANGUAGE,
): string {
  const candidate = value?.trim();
  const supported = supportedMenuLocale(candidate);
  if (supported) return supported;

  if (candidate) {
    const base = candidate.split("-")[0]?.toLocaleLowerCase("en-US");
    if (base && SUPPORTED_MENU_LOCALE_SET.has(base)) return base;
  }

  return SUPPORTED_MENU_LOCALE_SET.has(fallback) ? fallback : DEFAULT_MENU_LANGUAGE;
}

export function normalizeCatalogTranslations(
  translations: readonly CatalogTranslationInput[] | null | undefined,
): readonly CatalogTranslationInput[] {
  const byLocale = new Map<string, CatalogTranslationInput>();
  for (const translation of translations ?? []) {
    const locale = supportedMenuLocale(translation.locale);
    if (!locale) continue;
    const name = translation.name.trim();
    if (!name) continue;
    byLocale.set(locale, {
      locale,
      name,
      description: translation.description?.trim() || null,
    });
  }
  return [...byLocale.values()];
}

export function translationMap(
  translations: readonly CatalogTranslationInput[],
): CatalogTranslations {
  return Object.fromEntries(
    translations.map(({ locale, name, description }) => [
      locale,
      { name, description: description ?? null },
    ]),
  );
}

/**
 * Folds the languages a run just wrote back into the form on screen, without
 * stepping on anything the administrator typed.
 *
 * The editor holds unsaved drafts: somebody can type an English name, then press
 * "translate the rest" before saving. The server does not know about that draft,
 * so it happily produces English too — and a naive merge would replace the
 * person's own wording with a machine's. Their text wins; the run only fills
 * what is genuinely empty.
 */
export function mergeAutoTranslatedDraft(
  local: CatalogTranslations,
  saved: CatalogTranslations | undefined,
  translatedLocales: readonly string[],
): CatalogTranslations {
  const merged: Record<string, CatalogTranslation> = { ...local };
  for (const locale of translatedLocales) {
    if (merged[locale]?.name.trim()) continue;
    const value = saved?.[locale];
    if (value?.name.trim()) merged[locale] = value;
  }
  return merged;
}

export function resolveCatalogTranslation(
  translations: CatalogTranslations | undefined,
  requestedLocale: string,
  defaultLocale: string,
): CatalogTranslation | null {
  const requested = normalizeMenuLocale(requestedLocale);
  const fallback = normalizeMenuLocale(defaultLocale);
  return translations?.[requested] ?? translations?.[fallback] ?? null;
}
