import { NextResponse } from "next/server";

import { getDb } from "@/db";
import { requireCustomerTableContext } from "@/lib/auth/customer-table-context";
import { apiFailureFromUnknown, apiSuccess } from "@/lib/api/response";
import { DrizzleMenuRepository } from "@/lib/repositories/drizzle-menu-repository";
import { createLogger } from "@/lib/security/logger";
import { MenuService } from "@/lib/services/menu-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
} as const;
const logger = createLogger("api.customer.menu");

export async function GET(): Promise<NextResponse> {
  try {
    const context = await requireCustomerTableContext();
    const service = new MenuService(new DrizzleMenuRepository(getDb()));
    const menu = await service.getPublicMenu(context.restaurantId);
    return NextResponse.json(
      apiSuccess({
        table: {
          id: context.tableId,
          name: context.tableName,
          number: context.tableNumber,
        },
        ...menu,
      }),
      { status: 200, headers: RESPONSE_HEADERS },
    );
  } catch (error) {
    const failure = apiFailureFromUnknown(error);
    if (failure.status >= 500) {
      logger.error("read_failed", "Customer menu could not be read.", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
    return NextResponse.json(failure.body, {
      status: failure.status,
      headers: RESPONSE_HEADERS,
    });
  }
}
