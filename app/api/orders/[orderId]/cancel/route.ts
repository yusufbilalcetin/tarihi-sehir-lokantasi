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
  cancellationBodySchema,
  staffOrderIdParamsSchema,
  validationIssues,
} from "@/lib/validation";

export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;
const logger = createLogger("api.orders.cancel");

/**
 * Cancels a whole order that has not been served or paid. A settled order is a
 * financial record and is refused here; voiding one is a later phase.
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

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw validationError("Geçersiz JSON gövdesi.");
    }
    const parsed = cancellationBodySchema.safeParse(body);
    if (!parsed.success) {
      throw validationError("İptal bilgileri geçersiz.", {
        issues: validationIssues(parsed.error).map((issue) => ({ ...issue })),
      });
    }

    const service = new OrderService(new DrizzleOrderRepository(getDb()));
    const result = await service.cancelOrder(principal, {
      orderId: parsedParams.data.orderId,
      reason: parsed.data.reason,
      reasonNote: parsed.data.reasonNote,
      requestId: auditRequestContext(request).requestId,
    });
    return NextResponse.json(apiSuccess(result), { status: 200, headers: NO_STORE_HEADERS });
  } catch (error) {
    const failure = apiFailureFromUnknown(error);
    if (failure.status >= 500) {
      logger.error("cancel_failed", "Order could not be cancelled.", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
    return NextResponse.json(failure.body, {
      status: failure.status,
      headers: NO_STORE_HEADERS,
    });
  }
}
