import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { getDb } from "@/db";
import { validationError } from "@/lib/api/domain-error";
import { apiFailureFromUnknown, apiSuccess } from "@/lib/api/response";
import { requireCurrentStaffPrincipal } from "@/lib/auth/current-staff";
import { USER_ROLES } from "@/lib/domain/status";
import { DrizzleStaffOrderRepository } from "@/lib/repositories/drizzle-staff-order-repository";
import { createLogger } from "@/lib/security/logger";
import { assertTrustedMutationOrigin } from "@/lib/security/origin";
import { StaffOrderService } from "@/lib/services/staff-order-service";
import {
  staffOrderItemIdParamsSchema,
  staffOrderItemStatusBodySchema,
  validationIssues,
} from "@/lib/validation";

export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;
const logger = createLogger("api.order-items.status");

function auditRequestId(request: Request): string {
  const supplied = request.headers.get("x-request-id")?.trim();
  return supplied && /^[A-Za-z0-9._:-]{8,100}$/.test(supplied) ? supplied : randomUUID();
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ orderItemId: string }> },
): Promise<NextResponse> {
  try {
    assertTrustedMutationOrigin(request);
    const principal = await requireCurrentStaffPrincipal(USER_ROLES);
    const parsedParams = staffOrderItemIdParamsSchema.safeParse(await context.params);
    if (!parsedParams.success) {
      throw validationError("Sipariş kalemi kimliği geçersiz.", {
        issues: validationIssues(parsedParams.error).map((issue) => ({ ...issue })),
      });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw validationError("Geçersiz JSON gövdesi.");
    }
    const parsedBody = staffOrderItemStatusBodySchema.safeParse(body);
    if (!parsedBody.success) {
      throw validationError("Sipariş kalemi durumu geçersiz.", {
        issues: validationIssues(parsedBody.error).map((issue) => ({ ...issue })),
      });
    }

    const service = new StaffOrderService(new DrizzleStaffOrderRepository(getDb()));
    const item = await service.updateItemStatus(principal, {
      restaurantId: principal.restaurantId,
      orderItemId: parsedParams.data.orderItemId,
      nextStatus: parsedBody.data.status,
      reasonCode: parsedBody.data.reasonCode,
      reasonNote: parsedBody.data.reasonNote,
      requestId: auditRequestId(request),
    });
    return NextResponse.json(apiSuccess(item), {
      status: 200,
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    const failure = apiFailureFromUnknown(error);
    if (failure.status >= 500) {
      logger.error("update_failed", "Order-item status could not be updated.", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
    return NextResponse.json(failure.body, {
      status: failure.status,
      headers: NO_STORE_HEADERS,
    });
  }
}
