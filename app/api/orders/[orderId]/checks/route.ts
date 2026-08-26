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
  createChecksBodySchema,
  staffOrderIdParamsSchema,
  validationIssues,
} from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" } as const;
const logger = createLogger("api.orders.checks");

function service() {
  return new OrderCheckService(new DrizzleOrderCheckRepository(getDb()));
}

/** The split state, so a browser refresh never loses it. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ orderId: string }> },
): Promise<NextResponse> {
  try {
    const principal = await requireCurrentStaffPrincipal();
    const parsedParams = staffOrderIdParamsSchema.safeParse(await context.params);
    if (!parsedParams.success) {
      throw validationError("Sipariş kimliği geçersiz.", {
        issues: validationIssues(parsedParams.error).map((issue) => ({ ...issue })),
      });
    }

    const result = await service().listChecks(principal, parsedParams.data.orderId);
    return NextResponse.json(apiSuccess(result), { status: 200, headers: NO_STORE_HEADERS });
  } catch (error) {
    const failure = apiFailureFromUnknown(error);
    if (failure.status >= 500) {
      logger.error("read_failed", "Order checks could not be read.", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
    return NextResponse.json(failure.body, {
      status: failure.status,
      headers: NO_STORE_HEADERS,
    });
  }
}

/**
 * Splits a bill. `ITEMS` hands named quantities to each check, `EQUAL` cuts the
 * payable total into equal shares. The order and its lines are never rewritten.
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
    const parsed = createChecksBodySchema.safeParse(body);
    if (!parsed.success) {
      throw validationError("Hesap bölme bilgileri geçersiz.", {
        issues: validationIssues(parsed.error).map((issue) => ({ ...issue })),
      });
    }

    const requestId = auditRequestContext(request).requestId;
    const result = await service().createChecks(
      principal,
      parsed.data.mode === "EQUAL"
        ? {
            orderId: parsedParams.data.orderId,
            mode: "EQUAL",
            shares: parsed.data.shares,
            requestId,
          }
        : {
            orderId: parsedParams.data.orderId,
            mode: "ITEMS",
            checks: parsed.data.checks,
            requestId,
          },
    );
    return NextResponse.json(apiSuccess(result), { status: 201, headers: NO_STORE_HEADERS });
  } catch (error) {
    const failure = apiFailureFromUnknown(error);
    if (failure.status >= 500) {
      logger.error("split_failed", "Order could not be split.", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
    return NextResponse.json(failure.body, {
      status: failure.status,
      headers: NO_STORE_HEADERS,
    });
  }
}
