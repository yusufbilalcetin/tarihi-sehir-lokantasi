import { NextResponse } from "next/server";

import { getDb } from "@/db";
import { apiFailureFromUnknown, apiSuccess } from "@/lib/api/response";
import { requireCurrentStaffPrincipal } from "@/lib/auth/current-staff";
import { DrizzleMenuRepository } from "@/lib/repositories/drizzle-menu-repository";
import { createLogger } from "@/lib/security/logger";
import { MenuService } from "@/lib/services/menu-service";
import { normalizeMenuLocale } from "@/lib/i18n/catalog-localization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
} as const;
const logger = createLogger("api.staff.menu");

/**
 * The same catalog the guest sees, resolved from the staff principal's tenant
 * instead of a table session, so a waiter can build an order at the table.
 */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const principal = await requireCurrentStaffPrincipal();
    const service = new MenuService(new DrizzleMenuRepository(getDb()));
    const locale = normalizeMenuLocale(new URL(request.url).searchParams.get("locale"));
    const menu = await service.getPublicMenu(principal.restaurantId, locale);
    return NextResponse.json(apiSuccess(menu), { status: 200, headers: RESPONSE_HEADERS });
  } catch (error) {
    const failure = apiFailureFromUnknown(error);
    if (failure.status >= 500) {
      logger.error("read_failed", "Staff menu could not be read.", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
    return NextResponse.json(failure.body, {
      status: failure.status,
      headers: RESPONSE_HEADERS,
    });
  }
}
