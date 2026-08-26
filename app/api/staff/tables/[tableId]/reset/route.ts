import { NextResponse } from "next/server";

import { getDb } from "@/db";
import { validationError } from "@/lib/api/domain-error";
import { apiFailureFromUnknown, apiSuccess } from "@/lib/api/response";
import { auditRequestContext } from "@/lib/api/audit-request";
import { requireCurrentStaffPrincipal } from "@/lib/auth/current-staff";
import { DrizzleTableOperationsRepository } from "@/lib/repositories/drizzle-table-operations-repository";
import { createLogger } from "@/lib/security/logger";
import { assertTrustedMutationOrigin } from "@/lib/security/origin";
import { TableOperationsService } from "@/lib/services/table-operations-service";
import { tableIdParamsSchema, validationIssues } from "@/lib/validation";

export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;
const logger = createLogger("api.staff.tables.reset");

/**
 * Clears a settled table. Every open order, unpaid served order, pending
 * payment or open request refuses the reset: this endpoint never makes a
 * financial record disappear.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ tableId: string }> },
): Promise<NextResponse> {
  try {
    assertTrustedMutationOrigin(request);
    const principal = await requireCurrentStaffPrincipal();

    const parsedParams = tableIdParamsSchema.safeParse(await context.params);
    if (!parsedParams.success) {
      throw validationError("Masa kimliği geçersiz.", {
        issues: validationIssues(parsedParams.error).map((issue) => ({ ...issue })),
      });
    }

    const service = new TableOperationsService(new DrizzleTableOperationsRepository(getDb()));
    const result = await service.reset(principal, {
      tableId: parsedParams.data.tableId,
      requestId: auditRequestContext(request).requestId,
    });
    return NextResponse.json(apiSuccess(result), { status: 200, headers: NO_STORE_HEADERS });
  } catch (error) {
    const failure = apiFailureFromUnknown(error);
    if (failure.status >= 500) {
      logger.error("reset_failed", "Table could not be reset.", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
    return NextResponse.json(failure.body, {
      status: failure.status,
      headers: NO_STORE_HEADERS,
    });
  }
}
