import { NextResponse } from "next/server";

import { auditRequestContext } from "@/lib/api/audit-request";
import { validationError } from "@/lib/api/domain-error";
import { apiFailureFromUnknown, apiSuccess } from "@/lib/api/response";
import { requireCurrentStaffPrincipal } from "@/lib/auth/current-staff";
import { createLogger } from "@/lib/security/logger";
import { assertTrustedMutationOrigin } from "@/lib/security/origin";
import { createTableService } from "@/lib/services/table-service.server";
import { uuidSchema, validationIssues } from "@/lib/validation";

export const runtime = "nodejs";
const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" } as const;
const logger = createLogger("api.admin.tables.qr.rotate");

export async function POST(
  request: Request,
  context: { params: Promise<{ tableId: string }> },
): Promise<NextResponse> {
  try {
    assertTrustedMutationOrigin(request);
    const principal = await requireCurrentStaffPrincipal(["ADMIN", "MANAGER"]);
    const parsed = uuidSchema.safeParse((await context.params).tableId);
    if (!parsed.success) {
      throw validationError("Masa kimliği geçersiz.", {
        issues: validationIssues(parsed.error).map((issue) => ({ ...issue })),
      });
    }
    const rotated = await createTableService().rotateToken(principal, {
      restaurantId: principal.restaurantId,
      tableId: parsed.data,
      audit: auditRequestContext(request),
    });
    return NextResponse.json(apiSuccess(rotated), {
      status: 200,
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    const failure = apiFailureFromUnknown(error);
    if (failure.status >= 500) {
      logger.error("rotate_failed", "Restaurant table QR could not be rotated.", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
    return NextResponse.json(failure.body, {
      status: failure.status,
      headers: NO_STORE_HEADERS,
    });
  }
}
