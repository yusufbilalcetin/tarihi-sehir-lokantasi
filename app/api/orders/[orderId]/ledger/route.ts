import { NextResponse } from "next/server";

import { getDb } from "@/db";
import { validationError } from "@/lib/api/domain-error";
import { apiFailureFromUnknown, apiSuccess } from "@/lib/api/response";
import { requireCurrentStaffPrincipal } from "@/lib/auth/current-staff";
import { DrizzlePaymentRepository } from "@/lib/repositories/drizzle-payment-repository";
import { createLogger } from "@/lib/security/logger";
import { PaymentService } from "@/lib/services/payment-service";
import { staffOrderIdParamsSchema, validationIssues } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" } as const;
const logger = createLogger("api.orders.ledger");

/** The counter's money view: balance plus every collection and refund. */
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

    const service = new PaymentService(new DrizzlePaymentRepository(getDb()));
    const result = await service.getLedger(principal, parsedParams.data.orderId);
    return NextResponse.json(apiSuccess(result), { status: 200, headers: NO_STORE_HEADERS });
  } catch (error) {
    const failure = apiFailureFromUnknown(error);
    if (failure.status >= 500) {
      logger.error("read_failed", "Order ledger could not be read.", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
    return NextResponse.json(failure.body, {
      status: failure.status,
      headers: NO_STORE_HEADERS,
    });
  }
}
