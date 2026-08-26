import { NextResponse } from "next/server";

import { getDb } from "@/db";
import { validationError } from "@/lib/api/domain-error";
import { apiFailureFromUnknown, apiSuccess } from "@/lib/api/response";
import { auditRequestContext } from "@/lib/api/audit-request";
import { requireCurrentStaffPrincipal } from "@/lib/auth/current-staff";
import { DrizzleStaffCallRepository } from "@/lib/repositories/drizzle-staff-call-repository";
import { createLogger } from "@/lib/security/logger";
import { assertTrustedMutationOrigin } from "@/lib/security/origin";
import { StaffCallService } from "@/lib/services/staff-call-service";
import {
  staffCallIdParamsSchema,
  staffCallStatusBodySchema,
  validationIssues,
} from "@/lib/validation";

export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;
const logger = createLogger("api.staff.calls.status");

export async function PATCH(
  request: Request,
  context: { params: Promise<{ callId: string }> },
): Promise<NextResponse> {
  try {
    assertTrustedMutationOrigin(request);
    const principal = await requireCurrentStaffPrincipal();
    const parsedParams = staffCallIdParamsSchema.safeParse(await context.params);
    if (!parsedParams.success) {
      throw validationError("Servis isteği kimliği geçersiz.", {
        issues: validationIssues(parsedParams.error).map((issue) => ({ ...issue })),
      });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw validationError("Geçersiz JSON gövdesi.");
    }
    const parsedBody = staffCallStatusBodySchema.safeParse(body);
    if (!parsedBody.success) {
      throw validationError("Servis isteği durumu geçersiz.", {
        issues: validationIssues(parsedBody.error).map((issue) => ({ ...issue })),
      });
    }

    const service = new StaffCallService(new DrizzleStaffCallRepository(getDb()));
    const call = await service.updateStatus(principal, {
      callId: parsedParams.data.callId,
      nextStatus: parsedBody.data.status,
      requestId: auditRequestContext(request).requestId,
    });
    return NextResponse.json(apiSuccess(call), { status: 200, headers: NO_STORE_HEADERS });
  } catch (error) {
    const failure = apiFailureFromUnknown(error);
    if (failure.status >= 500) {
      logger.error("update_failed", "Service request status could not be updated.", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
    return NextResponse.json(failure.body, {
      status: failure.status,
      headers: NO_STORE_HEADERS,
    });
  }
}
