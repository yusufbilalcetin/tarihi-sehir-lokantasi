import { DomainError } from "@/lib/api/domain-error";
import {
  authorizeRestaurantAccess,
  type RestaurantPrincipal,
} from "@/lib/domain/restaurant-scope";
import type { AdminMenuRepository } from "@/lib/repositories/admin-menu-repository";
import { supportedMenuLocale } from "@/lib/i18n/catalog-localization";
import { DEFAULT_MENU_LANGUAGE } from "@/lib/i18n/languages";
import { localeCatalogLoaders } from "@/lib/i18n/locale-loaders";
import { categoryKeyBySlug } from "@/lib/i18n/menu-content";
import { SUPPORTED_MENU_LOCALE_CODES } from "@/lib/i18n/supported-locales";
import {
  UNAVAILABLE_TRANSLATION_PROVIDER,
  type CatalogTranslationOutcome,
  type CatalogTranslationRequest,
  type TranslationErrorCode,
  type TranslationProvider,
} from "@/lib/i18n/translation-provider";
import { MENU_EDITOR_ROLES } from "@/lib/services/admin-menu-service";

/**
 * "Translate this dish into the other languages", as a piece of work the
 * restaurant's own data survives.
 *
 * The rule this whole file exists to keep: the product or category is already
 * saved and committed before a single byte leaves for a translation vendor. A
 * vendor that is slow, wrong, or absent costs the restaurant some languages for
 * a minute; it must never cost them the dish.
 *
 * The order of precedence for one target language is cheap before expensive:
 *
 *   1. a translation already in the database — never overwritten by a bulk run
 *   2. a real translation already in this repository's static locale catalog
 *   3. the provider
 *
 * Steps 1 and 2 are free, so a menu that ships with 109 hand-checked languages
 * costs nothing to "auto translate" — which is today's common case.
 */

export type CatalogEntityType = "CATEGORY" | "PRODUCT";

export interface AutoTranslateCommand {
  readonly entityType: CatalogEntityType;
  readonly entityId: string;
  /** Defaults to the catalog's own default language. */
  readonly sourceLocale?: string;
  /** Defaults to every supported locale except the source. */
  readonly targetLocales?: readonly string[];
  /** Only an explicit single-language retranslate may replace existing text. */
  readonly overwrite?: boolean;
  readonly requestId?: string;
}

export interface AutoTranslateResult {
  readonly entityType: CatalogEntityType;
  readonly entityId: string;
  readonly sourceLocale: string;
  /** Locales written in this run, whichever source they came from. */
  readonly translated: readonly string[];
  /** Locales left exactly as they were, because they already had text. */
  readonly skipped: readonly string[];
  readonly failed: readonly { readonly locale: string; readonly code: TranslationErrorCode }[];
  /** Observability only: how many locales actually cost a provider call. */
  readonly providerLocaleCount: number;
}

interface SourceEntity {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
}

export interface CatalogTextValue {
  readonly name: string;
  readonly description: string | null;
}

export type StaticTranslationLookup = (
  locale: string,
  entityType: CatalogEntityType,
  slug: string,
) => Promise<CatalogTextValue | null>;

export interface MenuAutoTranslateServiceOptions {
  readonly clock?: () => Date;
  readonly staticTranslation?: StaticTranslationLookup;
  /** Small enough that one slow batch cannot hold up the whole run. */
  readonly batchSize?: number;
  readonly concurrency?: number;
  readonly timeoutMs?: number;
  /** Attempts *after* the first; 0 disables retrying entirely. */
  readonly retries?: number;
}

const DEFAULT_BATCH_SIZE = 8;
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRIES = 1;

/** The same ceilings the manual translation editor and the database enforce. */
const NAME_LIMITS: Record<CatalogEntityType, number> = { CATEGORY: 120, PRODUCT: 180 };
const DESCRIPTION_LIMIT = 2_000;

/**
 * Marks a vendor that answered with a document rather than with a dish name.
 * A menu line is prose: no tags, no fences, no bullet list, no numbering.
 */
const MARKUP = /<[^>]+>|\[[^\]]*\]\([^)]*\)|(?:^|\n)[ \t]*(?:[-*+•][ \t]|\d+[.)][ \t])|(?:^|\n)[ \t]*#{1,6}[ \t]|```/;

function isCleanText(value: string): boolean {
  return value.length > 0 && !MARKUP.test(value);
}

/** Default lookup: this repository's own generated locale catalogs. */
const staticCatalogTranslation: StaticTranslationLookup = async (locale, entityType, slug) => {
  // No fallback loader on purpose: `loadMenuCatalog` degrades to English when a
  // locale is missing, and English text filed under `sw` is worse than nothing.
  const loader = localeCatalogLoaders[locale];
  if (!loader) return null;
  const catalog = await loader();
  if (entityType === "CATEGORY") {
    const name = catalog.categories[categoryKeyBySlug[slug] ?? slug]?.trim();
    // Static category entries carry a name only; descriptions stay unset.
    return name ? { name, description: null } : null;
  }
  const entry = catalog.products[slug];
  const name = entry?.name?.trim();
  if (!name) return null;
  return { name, description: entry?.description?.trim() || null };
};

function chunk<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

/**
 * Runs at most `limit` tasks at a time.
 *
 * 108 languages is 108 requests if nobody stops it. A menu edit is not worth
 * opening 108 sockets at the restaurant's expense, nor being throttled by the
 * vendor for the ten that would otherwise have succeeded.
 */
async function runBounded<TResult>(
  tasks: readonly (() => Promise<TResult>)[],
  limit: number,
): Promise<TResult[]> {
  const results = new Array<TResult>(tasks.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    for (let index = next++; index < tasks.length; index = next++) {
      results[index] = await tasks[index]!();
    }
  });
  await Promise.all(workers);
  return results;
}

export class MenuAutoTranslateService {
  private readonly clock: () => Date;
  private readonly staticTranslation: StaticTranslationLookup;
  private readonly batchSize: number;
  private readonly concurrency: number;
  private readonly timeoutMs: number;
  private readonly retries: number;

  constructor(
    private readonly repository: AdminMenuRepository,
    private readonly provider: TranslationProvider = UNAVAILABLE_TRANSLATION_PROVIDER,
    options: MenuAutoTranslateServiceOptions = {},
  ) {
    this.clock = options.clock ?? (() => new Date());
    this.staticTranslation = options.staticTranslation ?? staticCatalogTranslation;
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retries = options.retries ?? DEFAULT_RETRIES;
  }

  private authorize(principal: RestaurantPrincipal | null | undefined): RestaurantPrincipal {
    const decision = authorizeRestaurantAccess(principal, principal?.restaurantId ?? "", {
      allowedRoles: MENU_EDITOR_ROLES,
    });
    if (decision.allowed) return decision.principal;
    const authenticationFailure = decision.reason === "AUTHENTICATION_REQUIRED";
    throw new DomainError(
      authenticationFailure ? "AUTHENTICATION_REQUIRED" : "FORBIDDEN",
      authenticationFailure ? "Oturum açmanız gerekiyor." : "Menü yönetimi yetkiniz yok.",
      { httpStatus: authenticationFailure ? 401 : 403 },
    );
  }

  async autoTranslate(
    principal: RestaurantPrincipal | null | undefined,
    command: AutoTranslateCommand,
  ): Promise<AutoTranslateResult> {
    const actor = this.authorize(principal);
    if (!this.provider.available) {
      throw new DomainError(
        "TRANSLATION_PROVIDER_UNAVAILABLE",
        "Otomatik çeviri sağlayıcısı yapılandırılmamış.",
        // A 5xx is redacted by default, which is right for a fault and wrong
        // here: this is a deployment's configuration stated on purpose, and an
        // administrator told "unexpected server error" would go looking for a
        // bug that does not exist. The sentence names no vendor and no variable.
        { httpStatus: 503, expose: true },
      );
    }

    const sourceLocale = supportedMenuLocale(command.sourceLocale ?? DEFAULT_MENU_LANGUAGE);
    if (!sourceLocale) {
      throw new DomainError("VALIDATION_ERROR", "Desteklenmeyen kaynak dil.", { httpStatus: 400 });
    }

    const { entity, existing } = await this.loadEntity(
      actor.restaurantId,
      command.entityType,
      command.entityId,
    );

    // The source text is the saved translation for that language when there is
    // one, and the core row otherwise — an English panel retranslating from
    // `en` must not silently ship Turkish to the vendor.
    const sourceText = existing.get(sourceLocale) ?? {
      name: entity.name,
      description: entity.description,
    };
    if (sourceLocale !== DEFAULT_MENU_LANGUAGE && !existing.has(sourceLocale)) {
      throw new DomainError("VALIDATION_ERROR", "Bu dilde çevrilecek bir metin yok.", {
        httpStatus: 400,
      });
    }

    const targets = this.resolveTargets(command.targetLocales, sourceLocale);
    const translated: string[] = [];
    const skipped: string[] = [];
    const failed: { locale: string; code: TranslationErrorCode }[] = [];
    const writes = new Map<string, CatalogTextValue>();

    const needsProvider: string[] = [];
    for (const locale of targets) {
      if (!command.overwrite && existing.has(locale)) {
        skipped.push(locale);
        continue;
      }
      const fromStatic = await this.staticTranslation(locale, command.entityType, entity.slug);
      if (fromStatic && this.accepts(command.entityType, fromStatic)) {
        writes.set(locale, fromStatic);
        translated.push(locale);
        continue;
      }
      needsProvider.push(locale);
    }

    if (needsProvider.length > 0) {
      const outcomes = await this.callProvider(sourceLocale, sourceText, needsProvider);
      for (const outcome of outcomes) {
        if (!outcome.ok) {
          failed.push({ locale: outcome.targetLocale, code: outcome.errorCode });
          continue;
        }
        const candidate = {
          name: outcome.name.trim(),
          description: outcome.description?.trim() || null,
        };
        if (!this.accepts(command.entityType, candidate)) {
          // Never silently truncated: half a sentence on a menu is a defect the
          // restaurant would have to find by eye, in a language nobody there reads.
          failed.push({ locale: outcome.targetLocale, code: "INVALID_OUTPUT" });
          continue;
        }
        writes.set(outcome.targetLocale, candidate);
        translated.push(outcome.targetLocale);
      }
    }

    if (writes.size > 0) {
      await this.persist(actor.restaurantId, command.entityType, entity, sourceLocale, writes);
    }

    return {
      entityType: command.entityType,
      entityId: entity.id,
      sourceLocale,
      translated,
      skipped,
      failed,
      providerLocaleCount: needsProvider.length,
    };
  }

  private accepts(entityType: CatalogEntityType, value: CatalogTextValue): boolean {
    if (!isCleanText(value.name) || value.name.length > NAME_LIMITS[entityType]) return false;
    if (value.description === null) return true;
    return isCleanText(value.description) && value.description.length <= DESCRIPTION_LIMIT;
  }

  private resolveTargets(
    requested: readonly string[] | undefined,
    sourceLocale: string,
  ): readonly string[] {
    const source = requested ?? SUPPORTED_MENU_LOCALE_CODES;
    const targets = new Set<string>();
    for (const value of source) {
      const locale = supportedMenuLocale(value);
      if (!locale) {
        // An allow-list, not a filter: an unknown code from a client is a bug
        // or an attack, and either way it is not quietly dropped.
        throw new DomainError("VALIDATION_ERROR", "Desteklenmeyen hedef dil.", { httpStatus: 400 });
      }
      if (locale === sourceLocale) continue;
      targets.add(locale);
    }
    if (targets.size === 0) {
      throw new DomainError("VALIDATION_ERROR", "Çevrilecek dil seçin.", { httpStatus: 400 });
    }
    return [...targets];
  }

  private async loadEntity(
    restaurantId: string,
    entityType: CatalogEntityType,
    entityId: string,
  ): Promise<{ entity: SourceEntity; existing: Map<string, CatalogTextValue> }> {
    // ponytail: reads the restaurant's whole catalog and filters in memory,
    // reusing the repository reads the admin panel already performs. One
    // restaurant is ~70 rows plus its translations, and this runs once per
    // button press. Add a by-id repository read if a tenant outgrows that.
    if (entityType === "CATEGORY") {
      const [categories, rows] = await Promise.all([
        this.repository.listCategories(restaurantId),
        this.repository.listCategoryTranslations(restaurantId),
      ]);
      const category = categories.find((row) => row.id === entityId && !row.deletedAt);
      if (!category) {
        throw new DomainError("NOT_FOUND", "Kategori bulunamadı.", { httpStatus: 404 });
      }
      return {
        entity: category,
        existing: translationsFor(rows.filter((row) => row.categoryId === entityId)),
      };
    }

    const [products, rows] = await Promise.all([
      this.repository.listProducts(restaurantId),
      this.repository.listProductTranslations(restaurantId),
    ]);
    const product = products.find((row) => row.id === entityId && !row.deletedAt);
    if (!product) {
      throw new DomainError("PRODUCT_NOT_FOUND", "Ürün bulunamadı.", { httpStatus: 404 });
    }
    return {
      entity: product,
      existing: translationsFor(rows.filter((row) => row.productId === entityId)),
    };
  }

  /**
   * Writes the run's result, but only if it is still an answer to the question
   * that was asked.
   *
   * Translating takes seconds, and in those seconds an administrator can rename
   * the dish or archive it. Without this check the vendor's rendering of
   * "Mercimek Çorbası" would be filed against a row that now reads "Ezogelin
   * Çorbası", and the guest reading English would be told the wrong dish — a
   * defect nobody in the restaurant can see, because nobody there reads the
   * language it is wrong in.
   *
   * The re-read takes the same `FOR UPDATE` lock the ordinary menu save takes,
   * so this races correctly against that save rather than merely narrowing the
   * window. Nothing is written when the source has moved: every locale in the
   * batch came from the same stale text, so none of them is salvageable.
   */
  private async persist(
    restaurantId: string,
    entityType: CatalogEntityType,
    snapshot: SourceEntity,
    sourceLocale: string,
    writes: ReadonlyMap<string, CatalogTextValue>,
  ): Promise<void> {
    const at = this.clock();
    const translations = [...writes].map(([locale, value]) => ({ locale, ...value }));
    // A short transaction, opened only once every network call has finished.
    await this.repository.transaction(async (transaction) => {
      const current =
        entityType === "CATEGORY"
          ? await transaction.findCategoryForUpdate(restaurantId, snapshot.id)
          : await transaction.findProductForUpdate(restaurantId, snapshot.id);
      if (!current || current.deletedAt) {
        throw new DomainError("CONFLICT", "Kayıt çeviri sırasında silindi.", { httpStatus: 409 });
      }
      // Only the default language is mirrored from the core row, so only then
      // does the core row's text tell us whether the source has changed.
      const sourceChanged =
        sourceLocale === DEFAULT_MENU_LANGUAGE &&
        (current.name !== snapshot.name ||
          (current.description ?? null) !== (snapshot.description ?? null));
      if (sourceChanged) {
        throw new DomainError(
          "CONFLICT",
          "Kayıt çeviri sırasında değişti. Lütfen tekrar deneyin.",
          { httpStatus: 409 },
        );
      }

      if (entityType === "CATEGORY") {
        await transaction.upsertCategoryTranslations({
          restaurantId,
          categoryId: snapshot.id,
          translations,
          at,
        });
        return;
      }
      await transaction.upsertProductTranslations({
        restaurantId,
        productId: snapshot.id,
        translations,
        at,
      });
    });
  }

  private async callProvider(
    sourceLocale: string,
    sourceText: CatalogTextValue,
    locales: readonly string[],
  ): Promise<readonly CatalogTranslationOutcome[]> {
    const batches = chunk(locales, this.batchSize);
    const results = await runBounded(
      batches.map((batch) => () => this.callBatch(sourceLocale, sourceText, batch)),
      this.concurrency,
    );
    return results.flat();
  }

  private async callBatch(
    sourceLocale: string,
    sourceText: CatalogTextValue,
    locales: readonly string[],
  ): Promise<readonly CatalogTranslationOutcome[]> {
    const requests: readonly CatalogTranslationRequest[] = locales.map((targetLocale) => ({
      sourceLocale,
      targetLocale,
      name: sourceText.name,
      description: sourceText.description,
    }));

    let lastCode: TranslationErrorCode = "PROVIDER_ERROR";
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const outcomes = await this.provider.translateCatalogBatch(requests, controller.signal);
        // A short answer is not a partial success: the locales the vendor left
        // out are failures, not silently missing rows.
        const byLocale = new Map(outcomes.map((outcome) => [outcome.targetLocale, outcome]));
        return locales.map(
          (locale) =>
            byLocale.get(locale) ?? {
              targetLocale: locale,
              ok: false as const,
              errorCode: "INVALID_OUTPUT" as const,
            },
        );
      } catch {
        lastCode = controller.signal.aborted ? "PROVIDER_TIMEOUT" : "PROVIDER_ERROR";
        // Bounded. The vendor's own error never leaves this frame.
        if (attempt === this.retries) break;
      } finally {
        clearTimeout(timer);
      }
    }
    return locales.map((locale) => ({
      targetLocale: locale,
      ok: false as const,
      errorCode: lastCode,
    }));
  }
}

function translationsFor(
  rows: readonly { locale: string; name: string; description?: string | null }[],
): Map<string, CatalogTextValue> {
  return new Map(
    rows
      .filter((row) => row.name.trim().length > 0)
      .map((row) => [row.locale, { name: row.name, description: row.description ?? null }]),
  );
}
