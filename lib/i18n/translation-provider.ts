/**
 * Where translated catalog text comes from, as the application sees it.
 *
 * The restaurant's own words — a dish name, the sentence under it — are the
 * only thing here that is worth anything, so the supplier of the other 108
 * languages is kept behind one narrow door. Nothing above this file knows
 * whether a translation was bought from a vendor, produced by a model, or is
 * simply unavailable today; and no vendor's error text, key or prompt is ever
 * allowed back through it.
 *
 * There is deliberately no shipped implementation. The repository has no
 * production-grade translation vendor configured, and the one translation
 * package present (`bing-translate-api`) is an unofficial development-only
 * dependency used by the locale generator script — using it as a runtime
 * provider would put an unsupported scraper on the guest-facing path.
 */

export const TRANSLATION_ERROR_CODES = [
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_TIMEOUT",
  "PROVIDER_ERROR",
  "INVALID_OUTPUT",
  "UNSUPPORTED_LOCALE",
] as const;

export type TranslationErrorCode = (typeof TRANSLATION_ERROR_CODES)[number];

export interface CatalogTranslationRequest {
  readonly sourceLocale: string;
  readonly targetLocale: string;
  readonly name: string;
  readonly description: string | null;
}

export type CatalogTranslationOutcome =
  | {
      readonly targetLocale: string;
      readonly ok: true;
      readonly name: string;
      readonly description: string | null;
    }
  | {
      readonly targetLocale: string;
      readonly ok: false;
      readonly errorCode: TranslationErrorCode;
    };

/**
 * One bounded batch at a time. Batch size, concurrency, timeout and retry are
 * the caller's business — see `menu-auto-translate-service` — so a future
 * adapter gets all four for free and cannot quietly open 108 sockets.
 */
export interface TranslationProvider {
  readonly id: string;
  readonly available: boolean;
  translateCatalogBatch(
    requests: readonly CatalogTranslationRequest[],
    signal: AbortSignal,
  ): Promise<readonly CatalogTranslationOutcome[]>;
}

/**
 * The fail-closed default: every locale comes back as a named failure rather
 * than as an exception, so a caller's partial-result accounting is identical
 * whether the provider is missing or merely having a bad afternoon.
 */
export const UNAVAILABLE_TRANSLATION_PROVIDER: TranslationProvider = {
  id: "unavailable",
  available: false,
  async translateCatalogBatch(requests) {
    return requests.map((request) => ({
      targetLocale: request.targetLocale,
      ok: false as const,
      errorCode: "PROVIDER_UNAVAILABLE" as const,
    }));
  },
};

/**
 * Reads only the selector name, never a secret value. `MENU_TRANSLATION_PROVIDER`
 * is unset in every environment today, which is why this always resolves to the
 * unavailable provider; a real adapter registers itself here and nowhere else.
 */
export function resolveTranslationProvider(
  environment: Record<string, string | undefined> = process.env,
): TranslationProvider {
  const selected = environment.MENU_TRANSLATION_PROVIDER?.trim();
  if (!selected || selected === "none") return UNAVAILABLE_TRANSLATION_PROVIDER;
  return UNAVAILABLE_TRANSLATION_PROVIDER;
}
