import { NextResponse } from "next/server";

import { getDb } from "@/db";
import { apiFailureFromUnknown, apiSuccess } from "@/lib/api/response";
import { requireOrderTrackingContext } from "@/lib/auth/order-tracking-context";
import { DrizzleCustomerOrderQueryRepository } from "@/lib/repositories/drizzle-customer-order-query-repository";
import { createLogger } from "@/lib/security/logger";
import { CustomerOrderQueryService } from "@/lib/services/customer-order-query-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
} as const;
const logger = createLogger("api.guest.order-tracking");

/**
 * Where a takeaway or courier guest watches their own order.
 *
 * The capability in the cookie decides which order that is; the request itself
 * carries no order number, no identifier and no name, so there is nothing here
 * to enumerate and nothing to guess.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const context = await requireOrderTrackingContext();
    const service = new CustomerOrderQueryService(
      new DrizzleCustomerOrderQueryRepository(getDb()),
    );
    const order = await service.getTrackedOrder(context.restaurantId, context.orderId);
    return NextResponse.json(apiSuccess({ order }), {
      status: 200,
      headers: RESPONSE_HEADERS,
    });
  } catch (error) {
    const failure = apiFailureFromUnknown(error);
    if (failure.status >= 500) {
      logger.error("read_failed", "Tracked guest order could not be read.", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
    return NextResponse.json(failure.body, {
      status: failure.status,
      headers: RESPONSE_HEADERS,
    });
  }
}
