import type { NextResponse } from "next/server";

import { getDb } from "@/db";
import { adminMutation, parseBody } from "@/lib/api/admin-route";
import { InFlightGuard } from "@/lib/api/in-flight-guard";
import { resolveTranslationProvider } from "@/lib/i18n/translation-provider";
import { DrizzleAdminMenuRepository } from "@/lib/repositories/drizzle-admin-menu-repository";
import { createLogger } from "@/lib/security/logger";
import { enforceRateLimit } from "@/lib/security/rate-limit.server";
import { MenuAutoTranslateService } from "@/lib/services/menu-auto-translate-service";
import { autoTranslateBodySchema } from "@/lib/validation/admin-menu";

export const runtime = "nodejs";

/**
 * Fills in a saved category's or product's other languages.
 *
 * One endpoint for both kinds: the work, the limits and the safety rules are
 * identical, and the entity type is one field. Nothing here can create or
 * change the dish itself — the row must already exist and be committed, which
 * is exactly why a translation vendor's bad day cannot cost a restaurant a
 * product.
 */

/** Keyed per entity, so two different dishes still translate in parallel. */
const inFlight = new InFlightGuard(
  "TRANSLATION_IN_FLIGHT",
  "Bu kayıt için çeviri zaten sürüyor.",
);

export function POST(request: Request): Promise<NextResponse> {
  return adminMutation(request, "api.admin.menu.translations.auto", async ({ principal, requestId }) => {
    const body = await parseBody(request, autoTranslateBodySchema, "Çeviri isteği geçersiz.");
    await enforceRateLimit(request, "MENU_AUTO_TRANSLATE", {
      restaurantId: principal.restaurantId,
      identifier: principal.userId,
      actorType: "AUTH_USER",
    });

    const key = `${principal.restaurantId}:${body.entityType}:${body.entityId}`;
    const startedAt = Date.now();
    return inFlight.run(key, async () => {
      const service = new MenuAutoTranslateService(
        new DrizzleAdminMenuRepository(getDb()),
        resolveTranslationProvider(),
      );
      const result = await service.autoTranslate(principal, { ...body, requestId });

      // Counts and locale codes only. No dish name, no description, no vendor
      // message: a log line is not the place for the restaurant's own words.
      createLogger("api.admin.menu.translations.auto").info(
        "auto_translate_completed",
        "Catalog auto translation finished.",
        {
          requestId,
          entityType: result.entityType,
          entityId: result.entityId,
          sourceLocale: result.sourceLocale,
          targetLocaleCount: result.translated.length + result.skipped.length + result.failed.length,
          translatedCount: result.translated.length,
          skippedCount: result.skipped.length,
          failedCount: result.failed.length,
          providerLocaleCount: result.providerLocaleCount,
          durationMs: Date.now() - startedAt,
        },
      );
      return result;
    });
  });
}
