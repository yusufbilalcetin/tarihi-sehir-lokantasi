import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { DomainError } from "../../lib/api/domain-error";
import type { RestaurantPrincipal } from "../../lib/domain/restaurant-scope";
import {
  UNAVAILABLE_TRANSLATION_PROVIDER,
  resolveTranslationProvider,
  type CatalogTranslationOutcome,
  type CatalogTranslationRequest,
  type TranslationProvider,
} from "../../lib/i18n/translation-provider";
import { SUPPORTED_MENU_LOCALE_CODES } from "../../lib/i18n/supported-locales";
import type {
  AdminCategoryRecord,
  AdminCategoryTranslationRecord,
  AdminMenuAuditInput,
  AdminMenuOutboxInput,
  AdminMenuRepository,
  AdminMenuTransactionRepository,
  AdminProductRecord,
  AdminProductTranslationRecord,
  UpsertCategoryInput,
  UpsertProductInput,
} from "../../lib/repositories/admin-menu-repository";
import {
  MenuAutoTranslateService,
  type CatalogEntityType,
  type CatalogTextValue,
  type MenuAutoTranslateServiceOptions,
  type StaticTranslationLookup,
} from "../../lib/services/menu-auto-translate-service";

/**
 * Automatic catalog translation, tested entirely offline.
 *
 * No test here reaches the network: the provider is a fake whose behaviour the
 * test states outright. That is the point — the property worth protecting is
 * that a restaurant's product survives every way a vendor can misbehave, and a
 * real vendor cannot be asked to misbehave on demand.
 */

const at = new Date("2026-08-31T10:00:00.000Z");

const category: AdminCategoryRecord = {
  id: "category-a",
  name: "Çorbalar",
  slug: "corbalar",
  description: null,
  imageUrl: null,
  sortOrder: 1,
  isActive: true,
  deletedAt: null,
};

const product: AdminProductRecord = {
  id: "product-a",
  categoryId: "category-a",
  name: "Mercimek Çorbası",
  slug: "mercimek",
  description: "Günlük hazırlanan kırmızı mercimek çorbası.",
  price: "120.00",
  imageUrl: null,
  weightLabel: null,
  isActive: true,
  isAvailable: true,
  isFeatured: false,
  isSpicy: false,
  isVegetarian: false,
  allergens: [],
  tags: [],
  sortOrder: 1,
  version: 2,
  deletedAt: null,
};

interface WrittenTranslation {
  readonly locale: string;
  readonly name: string;
  readonly description?: string | null;
}

class FakeTransaction implements AdminMenuTransactionRepository {
  categoryWrites: WrittenTranslation[] = [];
  productWrites: WrittenTranslation[] = [];
  /** What the row-locked re-read sees; a test may move it mid-run. */
  lockedCategory: AdminCategoryRecord | null = category;
  lockedProduct: AdminProductRecord | null = product;

  async findCategoryForUpdate() {
    return this.lockedCategory;
  }
  async findProductForUpdate() {
    return this.lockedProduct;
  }
  async insertCategory(input: UpsertCategoryInput) {
    void input;
    return category;
  }
  async updateCategory(input: UpsertCategoryInput) {
    void input;
    return category;
  }
  async insertProduct(input: UpsertProductInput) {
    void input;
    return product;
  }
  async updateProduct(input: UpsertProductInput) {
    void input;
    return product;
  }
  async upsertCategoryTranslations(
    input: Parameters<AdminMenuTransactionRepository["upsertCategoryTranslations"]>[0],
  ) {
    this.categoryWrites.push(...input.translations);
  }
  async upsertProductTranslations(
    input: Parameters<AdminMenuTransactionRepository["upsertProductTranslations"]>[0],
  ) {
    this.productWrites.push(...input.translations);
  }
  async insertAuditLog(input: AdminMenuAuditInput) {
    void input;
  }
  async insertOutboxEvent(input: AdminMenuOutboxInput) {
    void input;
  }
}

class FakeRepository implements AdminMenuRepository {
  transactionRepository = new FakeTransaction();
  transactionCount = 0;

  constructor(
    private readonly categoryTranslations: readonly AdminCategoryTranslationRecord[] = [],
    private readonly productTranslations: readonly AdminProductTranslationRecord[] = [],
  ) {}

  async listCategories() {
    return [category];
  }
  async listProducts() {
    return [product];
  }
  async listCategoryTranslations() {
    return this.categoryTranslations;
  }
  async listProductTranslations() {
    return this.productTranslations;
  }
  transaction<TResult>(
    work: (repository: AdminMenuTransactionRepository) => Promise<TResult>,
  ): Promise<TResult> {
    this.transactionCount += 1;
    return work(this.transactionRepository);
  }
}

/** Answers exactly as the test says, and records every locale it was asked for. */
class FakeTranslationProvider implements TranslationProvider {
  readonly id = "fake";
  readonly available = true;
  readonly requestedLocales: string[] = [];
  readonly batchSizes: number[] = [];
  /** How many batches were open at the same moment, at the peak. */
  peakConcurrency = 0;
  private live = 0;

  constructor(
    private readonly answer: (
      request: CatalogTranslationRequest,
    ) => CatalogTranslationOutcome | "throw" | "hang" | "omit",
  ) {}

  async translateCatalogBatch(
    requests: readonly CatalogTranslationRequest[],
    signal: AbortSignal,
  ): Promise<readonly CatalogTranslationOutcome[]> {
    this.live += 1;
    this.peakConcurrency = Math.max(this.peakConcurrency, this.live);
    this.batchSizes.push(requests.length);
    try {
      const outcomes: CatalogTranslationOutcome[] = [];
      for (const request of requests) {
        this.requestedLocales.push(request.targetLocale);
        const answer = this.answer(request);
        if (answer === "throw") throw new Error("vendor exploded: key sk-secret");
        if (answer === "hang") {
          await new Promise<void>((resolve, reject) => {
            signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
            setTimeout(resolve, 5_000);
          });
          continue;
        }
        if (answer === "omit") continue;
        outcomes.push(answer);
      }
      // Yield once so overlapping batches are observable by `peakConcurrency`.
      await new Promise((resolve) => setImmediate(resolve));
      return outcomes;
    } finally {
      this.live -= 1;
    }
  }
}

function ok(targetLocale: string, name: string, description: string | null = null) {
  return { targetLocale, ok: true as const, name, description };
}

function principal(role: RestaurantPrincipal["role"]): RestaurantPrincipal {
  return { userId: `user-${role}`, restaurantId: "restaurant-a", role, isActive: true };
}

/** No static catalog unless a test asks for one, so provider paths are exercised. */
const noStatic: StaticTranslationLookup = async () => null;

function staticFor(
  entries: Readonly<Record<string, CatalogTextValue>>,
): StaticTranslationLookup {
  return async (locale) => entries[locale] ?? null;
}

function service(
  repository: FakeRepository,
  provider: TranslationProvider,
  options: MenuAutoTranslateServiceOptions = {},
) {
  return new MenuAutoTranslateService(repository, provider, {
    clock: () => at,
    staticTranslation: noStatic,
    ...options,
  });
}

async function rejectsWithCode(work: Promise<unknown>, code: string) {
  await assert.rejects(work, (error: unknown) => {
    assert.ok(error instanceof DomainError, "expected a DomainError");
    assert.equal(error.code, code);
    return true;
  });
}

test("a product is translated into the requested languages without changing the product", async () => {
  const repository = new FakeRepository();
  const provider = new FakeTranslationProvider((request) =>
    request.targetLocale === "en"
      ? ok("en", "Lentil Soup", "Daily red lentil soup.")
      : ok("de", "Linsensuppe", "Täglich zubereitete rote Linsensuppe."),
  );

  const result = await service(repository, provider).autoTranslate(principal("ADMIN"), {
    entityType: "PRODUCT",
    entityId: "product-a",
    targetLocales: ["en", "de"],
  });

  assert.equal(result.entityId, "product-a");
  assert.equal(result.sourceLocale, "tr");
  assert.deepEqual([...result.translated].sort(), ["de", "en"]);
  assert.deepEqual(result.failed, []);

  const written = repository.transactionRepository.productWrites;
  assert.deepEqual(written.map((row) => row.locale).sort(), ["de", "en"]);
  assert.equal(written.find((row) => row.locale === "en")?.name, "Lentil Soup");
  assert.equal(written.find((row) => row.locale === "de")?.name, "Linsensuppe");
  // Turkish is the source and is never rewritten by a translation run.
  assert.ok(!written.some((row) => row.locale === "tr"));
  // Nothing here can touch the product row: only translation upserts happened.
  assert.equal(repository.transactionRepository.productWrites.length, 2);
});

test("a category is translated the same way as a product", async () => {
  const repository = new FakeRepository();
  const provider = new FakeTranslationProvider(() => ok("en", "Soups"));

  const result = await service(repository, provider).autoTranslate(principal("MANAGER"), {
    entityType: "CATEGORY",
    entityId: "category-a",
    targetLocales: ["en"],
  });

  assert.deepEqual(result.translated, ["en"]);
  assert.deepEqual(repository.transactionRepository.categoryWrites, [
    { locale: "en", name: "Soups", description: null },
  ]);
});

test("descriptions are translated alongside names", async () => {
  const repository = new FakeRepository();
  const provider = new FakeTranslationProvider(() =>
    ok("en", "Lentil Soup", "Daily red lentil soup."),
  );

  await service(repository, provider).autoTranslate(principal("ADMIN"), {
    entityType: "PRODUCT",
    entityId: "product-a",
    targetLocales: ["en"],
  });

  assert.equal(
    repository.transactionRepository.productWrites[0]?.description,
    "Daily red lentil soup.",
  );
});

test("one language failing leaves the others persisted", async () => {
  const repository = new FakeRepository();
  const provider = new FakeTranslationProvider((request) =>
    request.targetLocale === "de"
      ? { targetLocale: "de", ok: false, errorCode: "PROVIDER_ERROR" }
      : ok(request.targetLocale, `Name ${request.targetLocale}`),
  );

  const result = await service(repository, provider, { batchSize: 1 }).autoTranslate(
    principal("ADMIN"),
    { entityType: "PRODUCT", entityId: "product-a", targetLocales: ["en", "de", "fr"] },
  );

  assert.deepEqual([...result.translated].sort(), ["en", "fr"]);
  assert.deepEqual(result.failed, [{ locale: "de", code: "PROVIDER_ERROR" }]);
  assert.deepEqual(
    repository.transactionRepository.productWrites.map((row) => row.locale).sort(),
    ["en", "fr"],
  );
});

test("a provider timeout fails only its own batch and never the product", async () => {
  const repository = new FakeRepository();
  const provider = new FakeTranslationProvider((request) =>
    request.targetLocale === "de" ? "hang" : ok(request.targetLocale, "Lentil Soup"),
  );

  const result = await service(repository, provider, {
    batchSize: 1,
    timeoutMs: 20,
    retries: 0,
  }).autoTranslate(principal("ADMIN"), {
    entityType: "PRODUCT",
    entityId: "product-a",
    targetLocales: ["en", "de"],
  });

  assert.deepEqual(result.translated, ["en"]);
  assert.deepEqual(result.failed, [{ locale: "de", code: "PROVIDER_TIMEOUT" }]);
});

test("a thrown vendor error is retried a bounded number of times and never leaks", async () => {
  const repository = new FakeRepository();
  let attempts = 0;
  const provider = new FakeTranslationProvider(() => {
    attempts += 1;
    return "throw";
  });

  const result = await service(repository, provider, { retries: 1 }).autoTranslate(
    principal("ADMIN"),
    { entityType: "PRODUCT", entityId: "product-a", targetLocales: ["en"] },
  );

  assert.equal(attempts, 2, "one retry, then it stops");
  assert.deepEqual(result.failed, [{ locale: "en", code: "PROVIDER_ERROR" }]);
  assert.equal(
    JSON.stringify(result).includes("sk-secret"),
    false,
    "the vendor's own message never reaches the result",
  );
});

test("a malformed provider answer is rejected rather than written", async () => {
  const repository = new FakeRepository();
  const provider = new FakeTranslationProvider((request) => {
    if (request.targetLocale === "en") return ok("en", "<b>Lentil Soup</b>");
    if (request.targetLocale === "de") return ok("de", "Linsensuppe", "- erste Zeile\n- zweite");
    if (request.targetLocale === "fr") return ok("fr", "");
    return ok("es", "S".repeat(181));
  });

  const result = await service(repository, provider, { batchSize: 1 }).autoTranslate(
    principal("ADMIN"),
    { entityType: "PRODUCT", entityId: "product-a", targetLocales: ["en", "de", "fr", "es"] },
  );

  assert.deepEqual(result.translated, []);
  assert.deepEqual(
    result.failed.map((failure) => failure.code),
    ["INVALID_OUTPUT", "INVALID_OUTPUT", "INVALID_OUTPUT", "INVALID_OUTPUT"],
  );
  assert.equal(repository.transactionRepository.productWrites.length, 0);
});

test("a locale the provider silently drops is a failure, not a gap", async () => {
  const repository = new FakeRepository();
  const provider = new FakeTranslationProvider((request) =>
    request.targetLocale === "de" ? "omit" : ok(request.targetLocale, "Lentil Soup"),
  );

  const result = await service(repository, provider).autoTranslate(principal("ADMIN"), {
    entityType: "PRODUCT",
    entityId: "product-a",
    targetLocales: ["en", "de"],
  });

  assert.deepEqual(result.translated, ["en"]);
  assert.deepEqual(result.failed, [{ locale: "de", code: "INVALID_OUTPUT" }]);
});

test("an unsupported target locale is rejected before any provider call", async () => {
  const repository = new FakeRepository();
  const provider = new FakeTranslationProvider(() => ok("en", "Lentil Soup"));

  await rejectsWithCode(
    service(repository, provider).autoTranslate(principal("ADMIN"), {
      entityType: "PRODUCT",
      entityId: "product-a",
      targetLocales: ["en", "klingon"],
    }),
    "VALIDATION_ERROR",
  );
  assert.deepEqual(provider.requestedLocales, []);
});

test("a repeated target locale costs exactly one provider call", async () => {
  const repository = new FakeRepository();
  const provider = new FakeTranslationProvider(() => ok("en", "Lentil Soup"));

  const result = await service(repository, provider).autoTranslate(principal("ADMIN"), {
    entityType: "PRODUCT",
    entityId: "product-a",
    targetLocales: ["en", "en", "EN"],
  });

  assert.deepEqual(result.translated, ["en"]);
  assert.deepEqual(provider.requestedLocales, ["en"]);
});

test("a language already in the database is skipped and never sent to the provider", async () => {
  const repository = new FakeRepository(
    [],
    [{ productId: "product-a", locale: "en", name: "Traditional Lentil Soup", description: null }],
  );
  const provider = new FakeTranslationProvider(() => ok("de", "Linsensuppe"));

  const result = await service(repository, provider).autoTranslate(principal("ADMIN"), {
    entityType: "PRODUCT",
    entityId: "product-a",
    targetLocales: ["en", "de"],
  });

  assert.deepEqual(result.skipped, ["en"]);
  assert.deepEqual(result.translated, ["de"]);
  assert.deepEqual(provider.requestedLocales, ["de"]);
  // The administrator's own wording is still the only English on record.
  assert.ok(!repository.transactionRepository.productWrites.some((row) => row.locale === "en"));
});

test("an explicit single-language retranslate is the only thing that overwrites", async () => {
  const repository = new FakeRepository(
    [],
    [{ productId: "product-a", locale: "en", name: "Traditional Lentil Soup", description: null }],
  );
  const provider = new FakeTranslationProvider(() => ok("en", "Lentil Soup"));

  const result = await service(repository, provider).autoTranslate(principal("ADMIN"), {
    entityType: "PRODUCT",
    entityId: "product-a",
    targetLocales: ["en"],
    overwrite: true,
  });

  assert.deepEqual(result.translated, ["en"]);
  assert.equal(repository.transactionRepository.productWrites[0]?.name, "Lentil Soup");
});

test("a real static translation is used instead of paying the provider", async () => {
  const repository = new FakeRepository();
  const provider = new FakeTranslationProvider(() => ok("de", "Linsensuppe"));

  const result = await service(repository, provider, {
    staticTranslation: staticFor({
      en: { name: "Lentil Soup", description: "Daily red lentil soup." },
    }),
  }).autoTranslate(principal("ADMIN"), {
    entityType: "PRODUCT",
    entityId: "product-a",
    targetLocales: ["en", "de"],
  });

  assert.deepEqual([...result.translated].sort(), ["de", "en"]);
  assert.deepEqual(provider.requestedLocales, ["de"], "English cost nothing");
  assert.equal(result.providerLocaleCount, 1);
  assert.equal(
    repository.transactionRepository.productWrites.find((row) => row.locale === "en")?.name,
    "Lentil Soup",
  );
});

test("the shipped locale catalogs really do carry the core menu, so the provider is rarely needed", async () => {
  // Guards the assumption the whole cost model rests on: the 109 generated
  // catalogs hold real translations for the seeded catalog, not placeholders.
  const german = JSON.parse(
    await readFile(path.join(process.cwd(), "lib", "i18n", "locales", "de.json"), "utf8"),
  ) as { categories: Record<string, string>; products: Record<string, { name: string }> };

  assert.equal(german.categories.soups, "Suppen");
  assert.equal(german.products.mercimek?.name, "Linsensuppe");
});

test("the whole supported set is processed in bounded batches, not 108 parallel calls", async () => {
  const repository = new FakeRepository();
  const provider = new FakeTranslationProvider((request) =>
    ok(request.targetLocale, `Soup ${request.targetLocale}`),
  );

  const result = await service(repository, provider, {
    batchSize: 8,
    concurrency: 3,
  }).autoTranslate(principal("ADMIN"), { entityType: "PRODUCT", entityId: "product-a" });

  const expected = SUPPORTED_MENU_LOCALE_CODES.length - 1;
  assert.equal(result.translated.length, expected, "every non-source locale is covered");
  assert.equal(provider.requestedLocales.length, expected);
  assert.ok(
    provider.batchSizes.every((size) => size <= 8),
    "no batch exceeds the configured size",
  );
  assert.ok(provider.batchSizes.length >= 13, "the work really was split up");
  assert.ok(
    provider.peakConcurrency <= 3,
    `at most three batches in flight, saw ${provider.peakConcurrency}`,
  );
  // One transaction for the whole run, opened after the network work is done.
  assert.equal(repository.transactionCount, 1);
});

test("Chinese stays two separate languages", async () => {
  const repository = new FakeRepository();
  const provider = new FakeTranslationProvider((request) =>
    ok(request.targetLocale, request.targetLocale === "zh-CN" ? "扁豆汤" : "扁豆湯"),
  );

  const result = await service(repository, provider).autoTranslate(principal("ADMIN"), {
    entityType: "PRODUCT",
    entityId: "product-a",
    targetLocales: ["zh-CN", "zh-TW"],
  });

  assert.deepEqual([...result.translated].sort(), ["zh-CN", "zh-TW"]);
  const written = repository.transactionRepository.productWrites;
  assert.equal(written.find((row) => row.locale === "zh-CN")?.name, "扁豆汤");
  assert.equal(written.find((row) => row.locale === "zh-TW")?.name, "扁豆湯");
});

test("a non-default source language translates from that language's saved text", async () => {
  const repository = new FakeRepository(
    [],
    [{ productId: "product-a", locale: "en", name: "Lentil Soup", description: "Daily soup." }],
  );
  const sent: CatalogTranslationRequest[] = [];
  const provider = new FakeTranslationProvider((request) => {
    sent.push(request);
    return ok(request.targetLocale, "Linsensuppe");
  });

  const result = await service(repository, provider).autoTranslate(principal("ADMIN"), {
    entityType: "PRODUCT",
    entityId: "product-a",
    sourceLocale: "en",
    targetLocales: ["de"],
  });

  assert.equal(result.sourceLocale, "en");
  assert.equal(sent[0]?.name, "Lentil Soup", "not the Turkish core row");
  assert.equal(sent[0]?.description, "Daily soup.");
});

test("an unconfigured provider is a named 503, never a crash", async () => {
  const repository = new FakeRepository();
  await rejectsWithCode(
    new MenuAutoTranslateService(repository, UNAVAILABLE_TRANSLATION_PROVIDER).autoTranslate(
      principal("ADMIN"),
      { entityType: "PRODUCT", entityId: "product-a", targetLocales: ["en"] },
    ),
    "TRANSLATION_PROVIDER_UNAVAILABLE",
  );
  assert.equal(repository.transactionCount, 0, "nothing is written");
});

test("no translation provider is configured in this repository", () => {
  assert.equal(resolveTranslationProvider({}).available, false);
  assert.equal(resolveTranslationProvider({ MENU_TRANSLATION_PROVIDER: "none" }).available, false);
  // Even a hopeful value resolves to the fail-closed provider: no adapter ships.
  assert.equal(resolveTranslationProvider({ MENU_TRANSLATION_PROVIDER: "bing" }).available, false);
  assert.equal(UNAVAILABLE_TRANSLATION_PROVIDER.available, false);
});

test("the unavailable provider reports every locale as a named failure", async () => {
  const outcomes = await UNAVAILABLE_TRANSLATION_PROVIDER.translateCatalogBatch(
    [{ sourceLocale: "tr", targetLocale: "en", name: "Mercimek Çorbası", description: null }],
    new AbortController().signal,
  );
  assert.deepEqual(outcomes, [
    { targetLocale: "en", ok: false, errorCode: "PROVIDER_UNAVAILABLE" },
  ]);
});

test("only menu editors may auto translate", async () => {
  const repository = new FakeRepository();
  const provider = new FakeTranslationProvider(() => ok("en", "Lentil Soup"));
  const command = {
    entityType: "PRODUCT" as CatalogEntityType,
    entityId: "product-a",
    targetLocales: ["en"],
  };

  await rejectsWithCode(
    service(repository, provider).autoTranslate(null, command),
    "AUTHENTICATION_REQUIRED",
  );
  await rejectsWithCode(
    service(repository, provider).autoTranslate(principal("WAITER"), command),
    "FORBIDDEN",
  );
  await rejectsWithCode(
    service(repository, provider).autoTranslate(principal("CASHIER"), command),
    "FORBIDDEN",
  );
  assert.deepEqual(provider.requestedLocales, [], "an unauthorised call costs nothing");

  const allowed = await service(repository, provider).autoTranslate(principal("ADMIN"), command);
  assert.deepEqual(allowed.translated, ["en"]);
});

test("an unknown entity is a 404 before any provider call", async () => {
  const repository = new FakeRepository();
  const provider = new FakeTranslationProvider(() => ok("en", "Lentil Soup"));

  await rejectsWithCode(
    service(repository, provider).autoTranslate(principal("ADMIN"), {
      entityType: "PRODUCT",
      entityId: "product-missing",
      targetLocales: ["en"],
    }),
    "PRODUCT_NOT_FOUND",
  );
  assert.deepEqual(provider.requestedLocales, []);
});

test("the admin translation editor offers auto translate and states when it cannot", async () => {
  const source = await readFile(
    path.join(process.cwd(), "components", "admin", "catalog-translation-editor.tsx"),
    "utf8",
  );

  assert.match(source, /Diğer Dillere Otomatik Çevir/);
  assert.match(source, /Otomatik çeviri sağlayıcısı yapılandırılmamış/);
  assert.match(source, /disabled=\{!autoTranslateAvailable/);
  // One editor for the active language, not 109 stacked textareas.
  assert.equal(source.match(/<Textarea/g)?.length, 1);
  assert.match(source, /adminApi\.autoTranslate/);
});

test("admin translation inputs follow the language's writing direction", async () => {
  const source = await readFile(
    path.join(process.cwd(), "components", "admin", "catalog-translation-editor.tsx"),
    "utf8",
  );
  // Arabic, Persian, Urdu and the rest come back rtl from the language registry;
  // both fields carry it themselves rather than relying on an ancestor.
  assert.equal(source.match(/dir=\{activeLanguage\.direction\}/g)?.length, 3);

  const { getMenuLanguage } = await import("../../lib/i18n/languages");
  for (const locale of ["ar", "fa", "ur"]) {
    assert.equal(getMenuLanguage(locale)?.direction, "rtl", `${locale} is right-to-left`);
  }
  for (const locale of ["tr", "en", "de"]) {
    assert.equal(getMenuLanguage(locale)?.direction, "ltr", `${locale} is left-to-right`);
  }
});

test("the auto translate endpoint reuses the shared rate limit and guards double clicks", async () => {
  const source = await readFile(
    path.join(process.cwd(), "app", "api", "admin", "menu", "translations", "auto", "route.ts"),
    "utf8",
  );

  assert.match(source, /adminMutation\(/, "admin origin, role and audit envelope");
  assert.match(source, /enforceRateLimit\(request, "MENU_AUTO_TRANSLATE"/);
  assert.match(source, /TRANSLATION_IN_FLIGHT/);
  // Names and descriptions are the restaurant's own words. The log carries
  // counts, locale codes and a duration — never a line of menu text.
  const logged = source.slice(source.indexOf("auto_translate_completed"));
  assert.ok(!/\b(name|description|text)\s*:/.test(logged), "no menu text is logged");
  assert.match(logged, /translatedCount|failedCount/);

  const { RATE_LIMIT_POLICIES } = await import("../../lib/security/rate-limit");
  assert.ok(RATE_LIMIT_POLICIES.MENU_AUTO_TRANSLATE.limit > 0);
});

/* ------------------------------------------------------------------ *
 * Final QA round: races, draft safety and the guards around them.
 * ------------------------------------------------------------------ */

test("QA: a rename during the run refuses the whole stale batch", async () => {
  const repository = new FakeRepository();
  const provider = new FakeTranslationProvider((request) => {
    // The administrator renames the dish while the vendor is thinking.
    repository.transactionRepository.lockedProduct = {
      ...product,
      name: "Ezogelin Çorbası",
      slug: "ezogelin-corbasi",
    };
    return ok(request.targetLocale, "Lentil Soup");
  });

  await rejectsWithCode(
    service(repository, provider).autoTranslate(principal("ADMIN"), {
      entityType: "PRODUCT",
      entityId: "product-a",
      targetLocales: ["en", "de"],
    }),
    "CONFLICT",
  );
  assert.deepEqual(
    repository.transactionRepository.productWrites,
    [],
    "a lentil translation must never be filed against Ezogelin",
  );
});

test("QA: a description edit during the run is caught too", async () => {
  const repository = new FakeRepository();
  const provider = new FakeTranslationProvider((request) => {
    repository.transactionRepository.lockedProduct = { ...product, description: "Yeni açıklama." };
    return ok(request.targetLocale, "Lentil Soup", "Daily red lentil soup.");
  });

  await rejectsWithCode(
    service(repository, provider).autoTranslate(principal("ADMIN"), {
      entityType: "PRODUCT",
      entityId: "product-a",
      targetLocales: ["en"],
    }),
    "CONFLICT",
  );
  assert.deepEqual(repository.transactionRepository.productWrites, []);
});

test("QA: a dish archived mid-run is not written to, and is not resurrected", async () => {
  const repository = new FakeRepository();
  const provider = new FakeTranslationProvider((request) => {
    repository.transactionRepository.lockedProduct = { ...product, deletedAt: at, isActive: false };
    return ok(request.targetLocale, "Lentil Soup");
  });

  await rejectsWithCode(
    service(repository, provider).autoTranslate(principal("ADMIN"), {
      entityType: "PRODUCT",
      entityId: "product-a",
      targetLocales: ["en"],
    }),
    "CONFLICT",
  );
  assert.deepEqual(repository.transactionRepository.productWrites, []);
});

test("QA: a category renamed mid-run is refused the same way", async () => {
  const repository = new FakeRepository();
  const provider = new FakeTranslationProvider((request) => {
    repository.transactionRepository.lockedCategory = { ...category, name: "Tatlılar" };
    return ok(request.targetLocale, "Soups");
  });

  await rejectsWithCode(
    service(repository, provider).autoTranslate(principal("ADMIN"), {
      entityType: "CATEGORY",
      entityId: "category-a",
      targetLocales: ["en"],
    }),
    "CONFLICT",
  );
  assert.deepEqual(repository.transactionRepository.categoryWrites, []);
});

test("QA: an untouched entity still writes normally after the guard", async () => {
  const repository = new FakeRepository();
  const provider = new FakeTranslationProvider((request) => ok(request.targetLocale, "Lentil Soup"));

  const result = await service(repository, provider).autoTranslate(principal("ADMIN"), {
    entityType: "PRODUCT",
    entityId: "product-a",
    targetLocales: ["en"],
  });

  assert.deepEqual(result.translated, ["en"]);
  assert.equal(repository.transactionRepository.productWrites.length, 1);
});

test("QA: auto translate never touches price, ids, slug, availability or ordering", async () => {
  const repository = new FakeRepository();
  const provider = new FakeTranslationProvider((request) => ok(request.targetLocale, "Lentil Soup"));

  await service(repository, provider).autoTranslate(principal("ADMIN"), {
    entityType: "PRODUCT",
    entityId: "product-a",
    targetLocales: ["en", "de"],
  });

  // The only writes the service can reach are translation upserts; the core row
  // is read under a lock and put back untouched.
  const written = repository.transactionRepository.productWrites;
  assert.equal(written.length, 2);
  for (const row of written) {
    assert.deepEqual(Object.keys(row).sort(), ["description", "locale", "name"]);
  }
  assert.equal(product.price, "120.00");
  assert.equal(product.isAvailable, true);
  assert.equal(product.isFeatured, false);
  assert.equal(product.sortOrder, 1);
  assert.equal(product.slug, "mercimek");
  assert.equal(product.version, 2);
});

test("QA: a retry does not persist a locale twice", async () => {
  const repository = new FakeRepository();
  let attempt = 0;
  const provider = new FakeTranslationProvider((request) => {
    attempt += 1;
    // First attempt explodes, second succeeds — the classic transient failure.
    return attempt === 1 ? "throw" : ok(request.targetLocale, "Lentil Soup");
  });

  const result = await service(repository, provider, { retries: 1 }).autoTranslate(
    principal("ADMIN"),
    { entityType: "PRODUCT", entityId: "product-a", targetLocales: ["en"] },
  );

  assert.deepEqual(result.translated, ["en"]);
  assert.deepEqual(result.failed, []);
  assert.equal(repository.transactionRepository.productWrites.length, 1, "written exactly once");
});

test("QA: a timeout on the first attempt still succeeds on the retry", async () => {
  const repository = new FakeRepository();
  let attempt = 0;
  const provider = new FakeTranslationProvider((request) => {
    attempt += 1;
    return attempt === 1 ? "hang" : ok(request.targetLocale, "Lentil Soup");
  });

  const result = await service(repository, provider, {
    retries: 1,
    timeoutMs: 20,
  }).autoTranslate(principal("ADMIN"), {
    entityType: "PRODUCT",
    entityId: "product-a",
    targetLocales: ["en"],
  });

  assert.deepEqual(result.translated, ["en"]);
});

test("QA: cross-tenant ids reach neither the provider nor the database", async () => {
  const repository = new FakeRepository();
  const provider = new FakeTranslationProvider(() => ok("en", "Lentil Soup"));
  // `product-a` belongs to restaurant-a; this principal is somewhere else, and
  // the repository read is already scoped by the principal's own restaurant.
  const foreign: RestaurantPrincipal = {
    userId: "user-b",
    restaurantId: "restaurant-b",
    role: "ADMIN",
    isActive: true,
  };

  class ScopedRepository extends FakeRepository {
    override async listProducts() {
      return [];
    }
    override async listCategories() {
      return [];
    }
  }
  const scoped = new ScopedRepository();

  await rejectsWithCode(
    service(scoped, provider).autoTranslate(foreign, {
      entityType: "PRODUCT",
      entityId: "product-a",
      targetLocales: ["en"],
    }),
    "PRODUCT_NOT_FOUND",
  );
  assert.deepEqual(provider.requestedLocales, []);
  assert.equal(scoped.transactionCount, 0);
  void repository;
});

test("QA: the in-flight guard refuses a second run of the same entity", async () => {
  const { InFlightGuard } = await import("../../lib/api/in-flight-guard");
  const guard = new InFlightGuard("TRANSLATION_IN_FLIGHT", "Bu kayıt için çeviri zaten sürüyor.");
  let release: () => void = () => {};
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });

  const first = guard.run("restaurant-a:PRODUCT:product-a", async () => {
    await blocked;
    return "first";
  });
  await rejectsWithCode(
    guard.run("restaurant-a:PRODUCT:product-a", async () => "second"),
    "TRANSLATION_IN_FLIGHT",
  );

  release();
  assert.equal(await first, "first");
  assert.equal(guard.size, 0, "the key is free once the run finishes");
});

test("QA: a failed run releases its key instead of locking the dish out forever", async () => {
  const { InFlightGuard } = await import("../../lib/api/in-flight-guard");
  const guard = new InFlightGuard("TRANSLATION_IN_FLIGHT", "sürüyor");

  await assert.rejects(
    guard.run("key", async () => {
      throw new Error("provider exploded");
    }),
    /provider exploded/,
  );
  assert.equal(guard.size, 0);
  // The very next attempt must be allowed through.
  assert.equal(await guard.run("key", async () => "recovered"), "recovered");
});

test("QA: two different dishes translate at the same time", async () => {
  const { InFlightGuard } = await import("../../lib/api/in-flight-guard");
  const guard = new InFlightGuard("TRANSLATION_IN_FLIGHT", "sürüyor");
  let bothInside = false;
  let firstInside = false;

  const a = guard.run("restaurant-a:PRODUCT:product-a", async () => {
    firstInside = true;
    await new Promise((resolve) => setTimeout(resolve, 15));
    return "a";
  });
  const b = guard.run("restaurant-a:PRODUCT:product-b", async () => {
    // Reached while A is still running: the guard is per entity, not global.
    bothInside = firstInside;
    return "b";
  });

  assert.deepEqual(await Promise.all([a, b]), ["a", "b"]);
  assert.equal(bothInside, true, "a per-entity guard must not serialise the whole menu");
  assert.equal(guard.size, 0);
});

test("QA: the same dish in two different restaurants is two different jobs", async () => {
  const { InFlightGuard } = await import("../../lib/api/in-flight-guard");
  const guard = new InFlightGuard("TRANSLATION_IN_FLIGHT", "sürüyor");
  let release: () => void = () => {};
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });

  const first = guard.run("restaurant-a:PRODUCT:product-a", () => blocked);
  const second = await guard.run("restaurant-b:PRODUCT:product-a", async () => "other tenant");
  assert.equal(second, "other tenant");
  release();
  await first;
});

test("QA: the client button cannot fire twice before its state has landed", async () => {
  const source = await readFile(
    path.join(process.cwd(), "components", "admin", "catalog-translation-editor.tsx"),
    "utf8",
  );
  // `disabled` follows a state update a render later; a ref is checked in the
  // same tick the second click arrives.
  assert.match(source, /const running = useRef\(false\)/);
  assert.match(source, /if \(running\.current\) return;/);
  assert.match(source, /running\.current = true;/);
  assert.match(source, /finally \{\s*running\.current = false;/);
});

test("QA: an unsaved translation the administrator typed survives an auto translate run", async () => {
  const { mergeAutoTranslatedDraft } = await import("../../lib/i18n/catalog-localization");

  // The administrator typed an English name but has not saved yet, so the
  // server does not know about it and translates English too.
  const local = {
    en: { name: "Grandmother's Lentil Soup", description: null },
    de: { name: "", description: null },
  };
  const saved = {
    en: { name: "Lentil Soup", description: null },
    de: { name: "Linsensuppe", description: null },
    fr: { name: "Soupe de lentilles", description: null },
  };

  const merged = mergeAutoTranslatedDraft(local, saved, ["en", "de", "fr"]);

  assert.equal(merged.en?.name, "Grandmother's Lentil Soup", "their words are not replaced");
  assert.equal(merged.de?.name, "Linsensuppe", "an empty draft slot is filled");
  assert.equal(merged.fr?.name, "Soupe de lentilles", "a language they never opened is filled");
});

test("QA: the merge fills nothing the run did not report, and tolerates a missing row", async () => {
  const { mergeAutoTranslatedDraft } = await import("../../lib/i18n/catalog-localization");
  const local = { en: { name: "Kept", description: null } };

  assert.deepEqual(mergeAutoTranslatedDraft(local, undefined, ["de"]), local);
  assert.deepEqual(mergeAutoTranslatedDraft(local, { de: { name: "  ", description: null } }, ["de"]), local);
  assert.deepEqual(mergeAutoTranslatedDraft({}, undefined, []), {});
});

test("QA: the editor uses the shared merge rather than overwriting the draft itself", async () => {
  const source = await readFile(
    path.join(process.cwd(), "components", "admin", "catalog-translation-editor.tsx"),
    "utf8",
  );
  assert.match(source, /mergeAutoTranslatedDraft\(translations, saved, result\.translated\)/);
  // The old blind loop must be gone.
  assert.doesNotMatch(source, /merged\[locale\] = value/);
});

test("QA: the unconfigured-provider answer reaches the administrator intact", async () => {
  const { apiFailureFromUnknown } = await import("../../lib/api/response");
  const repository = new FakeRepository();

  const error = await new MenuAutoTranslateService(repository, UNAVAILABLE_TRANSLATION_PROVIDER)
    .autoTranslate(principal("ADMIN"), {
      entityType: "PRODUCT",
      entityId: "product-a",
      targetLocales: ["en"],
    })
    .then(() => null, (caught: unknown) => caught);

  // A 5xx is redacted by default. This one is a stated configuration, not a
  // fault, so the administrator must get the real sentence rather than
  // "unexpected server error" — and must not be sent hunting for a bug.
  const failure = apiFailureFromUnknown(error);
  assert.equal(failure.status, 503);
  assert.equal(failure.body.error.code, "TRANSLATION_PROVIDER_UNAVAILABLE");
  assert.match(failure.body.error.message, /sağlayıcısı yapılandırılmamış/);
  // Still nothing about which vendor, which variable, or how it is wired.
  assert.doesNotMatch(failure.body.error.message, /MENU_TRANSLATION_PROVIDER|env|key/i);
});

test("QA: every failure an administrator can trigger carries a Turkish sentence", async () => {
  const { ERROR_CODE_MESSAGES } = await import("../../lib/domain/display");
  for (const code of [
    "TRANSLATION_PROVIDER_UNAVAILABLE",
    "TRANSLATION_IN_FLIGHT",
    "CONFLICT",
    "RATE_LIMITED",
    "PRODUCT_NOT_FOUND",
    "FORBIDDEN",
  ]) {
    const message = ERROR_CODE_MESSAGES[code];
    assert.ok(message && message.trim().length > 0, `${code} needs a human label`);
    assert.doesNotMatch(message, /^[A-Z_]+$/, `${code} must not display as a raw code`);
  }
});

test("QA: locale query parameters cannot break the guest or staff menu routes", async () => {
  const { normalizeMenuLocale } = await import("../../lib/i18n/catalog-localization");
  const guest = await readFile(path.join(process.cwd(), "app", "api", "guest-menu", "route.ts"), "utf8");
  const staff = await readFile(path.join(process.cwd(), "app", "api", "staff", "menu", "route.ts"), "utf8");

  // Both routes launder the parameter before it reaches the service, and both
  // refuse to cache, so one language's answer cannot be served for another.
  for (const source of [guest, staff]) {
    assert.match(source, /normalizeMenuLocale\(/);
    assert.match(source, /force-dynamic/);
    assert.match(source, /"private, no-store, max-age=0"/);
  }

  // Whatever arrives on the query string, a supported locale comes out.
  for (const hostile of ["", "   ", "bitcoin", "../en", "en; drop table", "%2e%2e%2fen", "zh"]) {
    const resolved = normalizeMenuLocale(hostile);
    assert.ok(
      SUPPORTED_MENU_LOCALE_CODES.includes(resolved as (typeof SUPPORTED_MENU_LOCALE_CODES)[number]),
      `"${hostile}" resolved to an unsupported ${resolved}`,
    );
  }
});

test("QA: the translation editor stays reachable and stays inside a 320px screen", async () => {
  const source = await readFile(
    path.join(process.cwd(), "components", "admin", "catalog-translation-editor.tsx"),
    "utf8",
  );

  // Every control a thumb has to hit clears 44px.
  assert.equal((source.match(/min-h-11/g) ?? []).length, 2, "quick tabs and the auto button");
  // The language list is a labelled native control, not 109 stacked fields.
  assert.match(source, /<Field label="Tüm desteklenen diller">/);
  assert.match(source, /aria-selected=\{activeLanguage\.code === locale\}/);
  assert.match(source, /role="tablist"/);
  assert.match(source, /aria-busy=\{auto\.kind === "running"\}/);
  assert.match(source, /role="status"/);
  assert.match(source, /role="alert"/);

  // The one row that can exceed a narrow screen scrolls itself; nothing else
  // is given a fixed width, so the panel reflows rather than overflowing.
  assert.match(source, /flex gap-2 overflow-x-auto/);
  assert.match(source, /shrink-0/);
  assert.doesNotMatch(source, /\bw-\[\d|min-w-\[\d|\bw-96\b|\bw-80\b/);
});
