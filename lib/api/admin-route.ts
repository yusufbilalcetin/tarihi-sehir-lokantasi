import { NextResponse } from "next/server";
import type { ZodType } from "zod";

import { getDb } from "@/db";
import { auditRequestContext, currentRequestId } from "@/lib/api/audit-request";
import { validationError } from "@/lib/api/domain-error";
import { apiFailureFromUnknown, apiSuccess } from "@/lib/api/response";
import { requireCurrentStaffPrincipal } from "@/lib/auth/current-staff";
import { DrizzleAdminMenuRepository } from "@/lib/repositories/drizzle-admin-menu-repository";
import { createLogger } from "@/lib/security/logger";
import { assertTrustedMutationOrigin } from "@/lib/security/origin";
import { AdminMenuService } from "@/lib/services/admin-menu-service";
import { validationIssues } from "@/lib/validation";

export const ADMIN_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie, Origin",
} as const;

export const ADMIN_ROLES = ["ADMIN", "MANAGER"] as const;

export function createAdminMenuService(): AdminMenuService {
  return new AdminMenuService(new DrizzleAdminMenuRepository(getDb()));
}

export async function parseBody<TValue>(
  request: Request,
  schema: ZodType<TValue>,
  message: string,
): Promise<TValue> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw validationError("Geçersiz JSON gövdesi.");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw validationError(message, {
      issues: validationIssues(parsed.error).map((issue) => ({ ...issue })),
    });
  }
  return parsed.data;
}

export function parseParams<TValue>(
  value: unknown,
  schema: ZodType<TValue>,
  message: string,
): TValue {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw validationError(message, {
      issues: validationIssues(parsed.error).map((issue) => ({ ...issue })),
    });
  }
  return parsed.data;
}

/**
 * Every admin mutation shares the same envelope: trusted origin, ADMIN/MANAGER
 * principal, audited request id, and a redacted failure response.
 */
export async function adminMutation<TResult>(
  request: Request,
  loggerScope: string,
  work: (context: {
    principal: Awaited<ReturnType<typeof requireCurrentStaffPrincipal>>;
    requestId: string;
  }) => Promise<TResult>,
  successStatus = 200,
): Promise<NextResponse> {
  const logger = createLogger(loggerScope);
  // Derived here rather than inside the try: a 5xx is exactly when the id is
  // needed, and a value scoped to the try block is gone by the time it fails.
  const requestId = auditRequestContext(request).requestId;
  try {
    assertTrustedMutationOrigin(request);
    const principal = await requireCurrentStaffPrincipal(ADMIN_ROLES);
    const result = await work({ principal, requestId });
    return NextResponse.json(apiSuccess(result), {
      status: successStatus,
      headers: ADMIN_NO_STORE_HEADERS,
    });
  } catch (error) {
    const failure = apiFailureFromUnknown(error);
    if (failure.status >= 500) {
      logger.error("mutation_failed", "Admin mutation could not be applied.", {
        requestId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
    return NextResponse.json(failure.body, {
      status: failure.status,
      headers: ADMIN_NO_STORE_HEADERS,
    });
  }
}

export async function adminRead<TResult>(
  loggerScope: string,
  work: (context: {
    principal: Awaited<ReturnType<typeof requireCurrentStaffPrincipal>>;
  }) => Promise<TResult>,
): Promise<NextResponse> {
  const logger = createLogger(loggerScope);
  const requestId = await currentRequestId();
  try {
    const principal = await requireCurrentStaffPrincipal(ADMIN_ROLES);
    const result = await work({ principal });
    // A handler that needs a non-JSON body (a CSV download, say) may return a
    // response itself; it still passes through this envelope's role check.
    if (result instanceof Response) return result as unknown as NextResponse;
    return NextResponse.json(apiSuccess(result), {
      status: 200,
      headers: ADMIN_NO_STORE_HEADERS,
    });
  } catch (error) {
    const failure = apiFailureFromUnknown(error);
    if (failure.status >= 500) {
      logger.error("read_failed", "Admin read could not be served.", {
        requestId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
    return NextResponse.json(failure.body, {
      status: failure.status,
      headers: ADMIN_NO_STORE_HEADERS,
    });
  }
}
