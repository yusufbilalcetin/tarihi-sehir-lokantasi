import { NextResponse } from "next/server";

import { getDb } from "@/db";
import { auditRequestContext } from "@/lib/api/audit-request";
import { validationError } from "@/lib/api/domain-error";
import { apiFailureFromUnknown, apiSuccess } from "@/lib/api/response";
import { requireCurrentStaffPrincipal } from "@/lib/auth/current-staff";
import { DrizzlePaymentRepository } from "@/lib/repositories/drizzle-payment-repository";
import { createLogger } from "@/lib/security/logger";
import { assertTrustedMutationOrigin } from "@/lib/security/origin";
import { PaymentService } from "@/lib/services/payment-service";
import { idempotencyKeySchema, validationIssues } from "@/lib/validation/common";
import { createPaymentBodySchema } from "@/lib/validation/payment";

export const runtime = "nodejs";

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie, Origin, Idempotency-Key",
} as const;
const logger = createLogger("api.payments");

export async function POST(request: Request): Promise<NextResponse> {
  try {
    assertTrustedMutationOrigin(request);
    const principal = await requireCurrentStaffPrincipal(["ADMIN", "MANAGER", "CASHIER"]);

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
    const parsed = createPaymentBodySchema.safeParse(body);
    if (!parsed.success) {
      throw validationError("Ödeme bilgileri geçersiz.", {
        issues: validationIssues(parsed.error).map((issue) => ({ ...issue })),
      });
    }

    const service = new PaymentService(new DrizzlePaymentRepository(getDb()));
    const payment = await service.collect(principal, {
      orderId: parsed.data.orderId,
      method: parsed.data.method,
      amount: parsed.data.amount,
      checkId: parsed.data.checkId,
      idempotencyKey: idempotency.data,
      requestId: auditRequestContext(request).requestId,
    });
    return NextResponse.json(apiSuccess(payment), {
      status: payment.replayed ? 200 : 201,
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    const failure = apiFailureFromUnknown(error);
    if (failure.status >= 500) {
      logger.error("create_failed", "Payment could not be recorded.", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
    return NextResponse.json(failure.body, {
      status: failure.status,
      headers: NO_STORE_HEADERS,
    });
  }
}
