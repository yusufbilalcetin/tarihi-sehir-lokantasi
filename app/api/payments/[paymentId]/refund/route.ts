import { NextResponse } from "next/server";

import { getDb } from "@/db";
import { validationError } from "@/lib/api/domain-error";
import { apiFailureFromUnknown, apiSuccess } from "@/lib/api/response";
import { auditRequestContext } from "@/lib/api/audit-request";
import { requireCurrentStaffPrincipal } from "@/lib/auth/current-staff";
import { DrizzlePaymentRepository } from "@/lib/repositories/drizzle-payment-repository";
import { createLogger } from "@/lib/security/logger";
import { assertTrustedMutationOrigin } from "@/lib/security/origin";
import { PaymentService } from "@/lib/services/payment-service";
import {
  idempotencyKeySchema,
  paymentIdParamsSchema,
  refundBodySchema,
  validationIssues,
} from "@/lib/validation";

export const runtime = "nodejs";

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
  Vary: "Cookie, Origin, Idempotency-Key",
} as const;
const logger = createLogger("api.payments.refund");

/**
 * Returns collected money. The original payment row is never edited: the refund
 * is a second, opposite record, so gross and net stay separately provable.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ paymentId: string }> },
): Promise<NextResponse> {
  try {
    assertTrustedMutationOrigin(request);
    const principal = await requireCurrentStaffPrincipal();

    const parsedParams = paymentIdParamsSchema.safeParse(await context.params);
    if (!parsedParams.success) {
      throw validationError("Ödeme kimliği geçersiz.", {
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
    const parsed = refundBodySchema.safeParse(body);
    if (!parsed.success) {
      throw validationError("İade bilgileri geçersiz.", {
        issues: validationIssues(parsed.error).map((issue) => ({ ...issue })),
      });
    }

    const service = new PaymentService(new DrizzlePaymentRepository(getDb()));
    const result = await service.refund(principal, {
      paymentId: parsedParams.data.paymentId,
      amount: parsed.data.amount,
      reasonCode: parsed.data.reasonCode,
      note: parsed.data.note,
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
      logger.error("refund_failed", "Refund could not be recorded.", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
    return NextResponse.json(failure.body, {
      status: failure.status,
      headers: RESPONSE_HEADERS,
    });
  }
}
