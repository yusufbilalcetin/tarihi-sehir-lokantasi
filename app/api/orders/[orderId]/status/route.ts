import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { getDb } from "@/db";
import { validationError } from "@/lib/api/domain-error";
import { apiFailureFromUnknown, apiSuccess } from "@/lib/api/response";
import { requireCurrentStaffPrincipal } from "@/lib/auth/current-staff";
import { USER_ROLES } from "@/lib/domain/status";
import { DrizzleOrderRepository } from "@/lib/repositories/drizzle-order-repository";
import { createLogger } from "@/lib/security/logger";
import { assertTrustedMutationOrigin } from "@/lib/security/origin";
import { OrderService } from "@/lib/services/order-service";
import {
  staffOrderIdParamsSchema,
  staffOrderStatusBodySchema,
  validationIssues,
} from "@/lib/validation";

export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;
const logger = createLogger("api.orders.status");

function auditRequestId(request: Request): string {
  const supplied = request.headers.get("x-request-id")?.trim();
  return supplied && /^[A-Za-z0-9._:-]{8,100}$/.test(supplied) ? supplied : randomUUID();
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ orderId: string }> },
): Promise<NextResponse> {
  try {
    assertTrustedMutationOrigin(request);
    const principal = await requireCurrentStaffPrincipal(USER_ROLES);
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
    const parsedBody = staffOrderStatusBodySchema.safeParse(body);
    if (!parsedBody.success) {
      throw validationError("Sipariş durumu geçersiz.", {
        issues: validationIssues(parsedBody.error).map((issue) => ({ ...issue })),
      });
    }

    const service = new OrderService(new DrizzleOrderRepository(getDb()));
    const order = await service.updateStatus(principal, {
      restaurantId: principal.restaurantId,
      orderId: parsedParams.data.orderId,
      nextStatus: parsedBody.data.status,
      requestId: auditRequestId(request),
    });
    return NextResponse.json(apiSuccess(order), {
      status: 200,
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    const failure = apiFailureFromUnknown(error);
    if (failure.status >= 500) {
      logger.error("update_failed", "Order status could not be updated.", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
    return NextResponse.json(failure.body, {
      status: failure.status,
      headers: NO_STORE_HEADERS,
    });
  }
}
