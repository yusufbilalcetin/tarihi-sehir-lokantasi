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
import { tableMergeBodySchema, validationIssues } from "@/lib/validation";

export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;
const logger = createLogger("api.staff.tables.merge");

/**
 * Folds one running table into another. Orders keep their own ids and numbers,
 * so the merged table carries two rounds rather than one rewritten order.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    assertTrustedMutationOrigin(request);
    const principal = await requireCurrentStaffPrincipal();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw validationError("Geçersiz JSON gövdesi.");
    }
    const parsed = tableMergeBodySchema.safeParse(body);
    if (!parsed.success) {
      throw validationError("Masa birleştirme bilgileri geçersiz.", {
        issues: validationIssues(parsed.error).map((issue) => ({ ...issue })),
      });
    }

    const service = new TableOperationsService(new DrizzleTableOperationsRepository(getDb()));
    const result = await service.merge(principal, {
      sourceTableId: parsed.data.sourceTableId,
      targetTableId: parsed.data.targetTableId,
      requestId: auditRequestContext(request).requestId,
    });
    return NextResponse.json(apiSuccess(result), { status: 200, headers: NO_STORE_HEADERS });
  } catch (error) {
    const failure = apiFailureFromUnknown(error);
    if (failure.status >= 500) {
      logger.error("merge_failed", "Table merge could not be completed.", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
    return NextResponse.json(failure.body, {
      status: failure.status,
      headers: NO_STORE_HEADERS,
    });
  }
}
