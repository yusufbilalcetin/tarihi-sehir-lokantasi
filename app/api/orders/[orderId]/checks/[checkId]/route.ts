import { NextResponse } from "next/server";

import { getDb } from "@/db";
import { validationError } from "@/lib/api/domain-error";
import { apiFailureFromUnknown, apiSuccess } from "@/lib/api/response";
import { auditRequestContext } from "@/lib/api/audit-request";
import { requireCurrentStaffPrincipal } from "@/lib/auth/current-staff";
import { DrizzleOrderCheckRepository } from "@/lib/repositories/drizzle-order-check-repository";
import { createLogger } from "@/lib/security/logger";
import { assertTrustedMutationOrigin } from "@/lib/security/origin";
import { OrderCheckService } from "@/lib/services/order-check-service";
import {
  checkIdParamsSchema,
  updateCheckBodySchema,
  validationIssues,
} from "@/lib/validation";

export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;
const logger = createLogger("api.orders.checks.mutate");

function service() {
  return new OrderCheckService(new DrizzleOrderCheckRepository(getDb()));
}

async function params(context: { params: Promise<{ orderId: string; checkId: string }> }) {
  const parsed = checkIdParamsSchema.safeParse(await context.params);
  if (!parsed.success) {
    throw validationError("Hesap kimliği geçersiz.", {
      issues: validationIssues(parsed.error).map((issue) => ({ ...issue })),
    });
  }
  return parsed.data;
}

/** Rewrites an untouched check. A check that has taken money is immutable. */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ orderId: string; checkId: string }> },
): Promise<NextResponse> {
  try {
    assertTrustedMutationOrigin(request);
    const principal = await requireCurrentStaffPrincipal();
    const { orderId, checkId } = await params(context);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw validationError("Geçersiz JSON gövdesi.");
    }
    const parsed = updateCheckBodySchema.safeParse(body);
    if (!parsed.success) {
      throw validationError("Hesap düzenleme bilgileri geçersiz.", {
        issues: validationIssues(parsed.error).map((issue) => ({ ...issue })),
      });
    }

    const result = await service().updateCheck(principal, {
      orderId,
      checkId,
      label: parsed.data.label,
      allocations: parsed.data.allocations,
      requestId: auditRequestContext(request).requestId,
    });
    return NextResponse.json(apiSuccess(result), { status: 200, headers: NO_STORE_HEADERS });
  } catch (error) {
    const failure = apiFailureFromUnknown(error);
    if (failure.status >= 500) {
      logger.error("update_failed", "Check could not be updated.", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
    return NextResponse.json(failure.body, {
      status: failure.status,
      headers: NO_STORE_HEADERS,
    });
  }
}

/** Cancels an unused check; its allocations stay for history but stop counting. */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ orderId: string; checkId: string }> },
): Promise<NextResponse> {
  try {
    assertTrustedMutationOrigin(request);
    const principal = await requireCurrentStaffPrincipal();
    const { orderId, checkId } = await params(context);

    const result = await service().cancelCheck(principal, {
      orderId,
      checkId,
      requestId: auditRequestContext(request).requestId,
    });
    return NextResponse.json(apiSuccess(result), { status: 200, headers: NO_STORE_HEADERS });
  } catch (error) {
    const failure = apiFailureFromUnknown(error);
    if (failure.status >= 500) {
      logger.error("cancel_failed", "Check could not be cancelled.", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
    return NextResponse.json(failure.body, {
      status: failure.status,
      headers: NO_STORE_HEADERS,
    });
  }
}
