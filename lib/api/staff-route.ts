import { NextResponse } from "next/server";

import { auditRequestContext, currentRequestId } from "@/lib/api/audit-request";
import { apiFailureFromUnknown, apiSuccess } from "@/lib/api/response";
import { requireCurrentStaffPrincipal } from "@/lib/auth/current-staff";
import type { StaffPrincipal } from "@/lib/auth/foundation";
import type { UserRole } from "@/lib/domain/status";
import { createLogger } from "@/lib/security/logger";
import { assertTrustedMutationOrigin } from "@/lib/security/origin";

export const STAFF_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie, Origin",
} as const;

/**
 * The shared envelope for a role-scoped staff endpoint: trusted origin on
 * mutations, an authenticated tenant principal, an audited request id, and a
 * redacted failure body. Route handlers supply only the work.
 */
export async function staffMutation<TResult>(
  request: Request,
  roles: readonly UserRole[],
  loggerScope: string,
  work: (context: {
    principal: StaffPrincipal;
    requestId: string;
  }) => Promise<TResult>,
  successStatus = 200,
): Promise<NextResponse> {
  const logger = createLogger(loggerScope);
  const requestId = auditRequestContext(request).requestId;
  try {
    assertTrustedMutationOrigin(request);
    const principal = await requireCurrentStaffPrincipal(roles);
    const result = await work({ principal, requestId });
    return NextResponse.json(apiSuccess(result), {
      status: successStatus,
      headers: STAFF_NO_STORE_HEADERS,
    });
  } catch (error) {
    const failure = apiFailureFromUnknown(error);
    if (failure.status >= 500) {
      logger.error("mutation_failed", "Staff mutation could not be applied.", {
        requestId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
    return NextResponse.json(failure.body, {
      status: failure.status,
      headers: STAFF_NO_STORE_HEADERS,
    });
  }
}

export async function staffRead<TResult>(
  roles: readonly UserRole[],
  loggerScope: string,
  work: (context: { principal: StaffPrincipal }) => Promise<TResult>,
): Promise<NextResponse> {
  const logger = createLogger(loggerScope);
  const requestId = await currentRequestId();
  try {
    const principal = await requireCurrentStaffPrincipal(roles);
    const result = await work({ principal });
    return NextResponse.json(apiSuccess(result), {
      status: 200,
      headers: STAFF_NO_STORE_HEADERS,
    });
  } catch (error) {
    const failure = apiFailureFromUnknown(error);
    if (failure.status >= 500) {
      logger.error("read_failed", "Staff read could not be served.", {
        requestId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
    return NextResponse.json(failure.body, {
      status: failure.status,
      headers: STAFF_NO_STORE_HEADERS,
    });
  }
}
