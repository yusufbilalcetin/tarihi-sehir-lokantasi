import { NextResponse } from "next/server";

import { getDb } from "@/db";
import { requireGuestOrderContext } from "@/lib/auth/guest-order-context";
import { apiFailureFromUnknown, apiSuccess } from "@/lib/api/response";
import { DrizzleMenuRepository } from "@/lib/repositories/drizzle-menu-repository";
import { createLogger } from "@/lib/security/logger";
import { MenuService } from "@/lib/services/menu-service";
import { normalizeMenuLocale } from "@/lib/i18n/catalog-localization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The same menu a guest at a table sees, for a guest who is not at one.
 *
 * It is the identical service call on the identical restaurant: one menu, one
 * price list. What it lacks is the table block, because there is no table —
 * and the restaurant still comes from the signed session rather than from
 * anything the caller sent.
 */

const RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
} as const;
const logger = createLogger("api.guest.menu");

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const context = await requireGuestOrderContext();
    const service = new MenuService(new DrizzleMenuRepository(getDb()));
    const localeParam = new URL(request.url).searchParams.get("locale");
    const menu = localeParam
      ? await service.getPublicMenu(context.restaurantId, normalizeMenuLocale(localeParam))
      : await service.getPublicMenu(context.restaurantId);
    return NextResponse.json(apiSuccess(menu), { status: 200, headers: RESPONSE_HEADERS });
  } catch (error) {
    const failure = apiFailureFromUnknown(error);
    if (failure.status >= 500) {
      logger.error("read_failed", "Guest menu could not be read.", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
    return NextResponse.json(failure.body, {
      status: failure.status,
      headers: RESPONSE_HEADERS,
    });
  }
}
