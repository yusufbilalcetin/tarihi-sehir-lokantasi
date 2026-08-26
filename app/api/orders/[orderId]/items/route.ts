import { NextResponse } from "next/server";

import { getDb } from "@/db";
import { validationError } from "@/lib/api/domain-error";
import { apiFailureFromUnknown, apiSuccess } from "@/lib/api/response";
import { auditRequestContext } from "@/lib/api/audit-request";
import { requireCurrentStaffPrincipal } from "@/lib/auth/current-staff";
import { DrizzleOrderRepository } from "@/lib/repositories/drizzle-order-repository";
import { createLogger } from "@/lib/security/logger";
import { assertTrustedMutationOrigin } from "@/lib/security/origin";
import { OrderService } from "@/lib/services/order-service";
import {
  addOrderItemsBodySchema,
  idempotencyKeySchema,
  staffOrderIdParamsSchema,
  validationIssues,
} from "@/lib/validation";

export const runtime = "nodejs";

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
  Vary: "Cookie, Origin, Idempotency-Key",
} as const;
const logger = createLogger("api.orders.items");

/**
 * Adds a later round to a running order. Prices and totals are derived inside
 * the order transaction from locked product rows; the body carries only
 * product ids, quantities and notes.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ orderId: string }> },
): Promise<NextResponse> {
  try {
    assertTrustedMutationOrigin(request);
    const principal = await requireCurrentStaffPrincipal();

    const parsedParams = staffOrderIdParamsSchema.safeParse(await context.params);
    if (!parsedParams.success) {
      throw validationError("Sipariş kimliği geçersiz.", {
        issues: validationIssues(parsedParams.error).map((issue) => ({ ...issue })),
      });
    }
    const idempotency = idempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
    if (!idempotency.success) {
      throw validationError("Geçerli bir Idempotency-Key başlığı gereklidir.", {
        issues: validationIssues(idempotency.error).map((issue) => ({ ...issue })),
      });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw validationError("Geçersiz JSON gövdesi.");
    }
    const parsed = addOrderItemsBodySchema.safeParse(body);
    if (!parsed.success) {
      throw validationError("Eklenecek ürün bilgileri geçersiz.", {
        issues: validationIssues(parsed.error).map((issue) => ({ ...issue })),
      });
    }

    const service = new OrderService(new DrizzleOrderRepository(getDb()));
    const result = await service.addItems(principal, {
      orderId: parsedParams.data.orderId,
      items: parsed.data.items,
      idempotencyKey: idempotency.data,
      requestId: auditRequestContext(request).requestId,
    });
    return NextResponse.json(apiSuccess(result), {
      status: result.replayed ? 200 : 201,
      headers: RESPONSE_HEADERS,
    });
  } catch (error) {
    const failure = apiFailureFromUnknown(error);
    if (failure.status >= 500) {
      logger.error("add_items_failed", "Order items could not be added.", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
    return NextResponse.json(failure.body, {
      status: failure.status,
      headers: RESPONSE_HEADERS,
    });
  }
}
