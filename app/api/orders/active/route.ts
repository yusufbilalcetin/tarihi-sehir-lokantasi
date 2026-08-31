import { NextResponse } from "next/server";

import { getDb } from "@/db";
import { apiFailureFromUnknown, apiSuccess } from "@/lib/api/response";
import { requireCustomerTableContext } from "@/lib/auth/customer-table-context";
import { DrizzleCustomerOrderQueryRepository } from "@/lib/repositories/drizzle-customer-order-query-repository";
import { createLogger } from "@/lib/security/logger";
import { CustomerOrderQueryService } from "@/lib/services/customer-order-query-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
} as const;
const logger = createLogger("api.customer.active-orders");

export async function GET(): Promise<NextResponse> {
  try {
    const context = await requireCustomerTableContext();
    const service = new CustomerOrderQueryService(
      new DrizzleCustomerOrderQueryRepository(getDb()),
    );
    const orders = await service.getActiveOrders(
      context.restaurantId,
      context.tableId,
      context.sessionNonce,
    );
    return NextResponse.json(apiSuccess({ orders }), {
      status: 200,
      headers: RESPONSE_HEADERS,
    });
  } catch (error) {
    const failure = apiFailureFromUnknown(error);
    if (failure.status >= 500) {
      logger.error("read_failed", "Active customer orders could not be read.", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
    return NextResponse.json(failure.body, {
      status: failure.status,
      headers: RESPONSE_HEADERS,
    });
  }
}
