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
import {
  tableIdParamsSchema,
  tableMoveBodySchema,
  validationIssues,
} from "@/lib/validation";

export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;
const logger = createLogger("api.staff.tables.transfer");

/** Moves a party to an empty table. An occupied target is refused, not merged. */
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

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw validationError("Geçersiz JSON gövdesi.");
    }
    const parsed = tableMoveBodySchema.safeParse(body);
    if (!parsed.success) {
      throw validationError("Hedef masa geçersiz.", {
        issues: validationIssues(parsed.error).map((issue) => ({ ...issue })),
      });
    }

    const service = new TableOperationsService(new DrizzleTableOperationsRepository(getDb()));
    const result = await service.transfer(principal, {
      sourceTableId: parsedParams.data.tableId,
      targetTableId: parsed.data.targetTableId,
      requestId: auditRequestContext(request).requestId,
    });
    return NextResponse.json(apiSuccess(result), { status: 200, headers: NO_STORE_HEADERS });
  } catch (error) {
    const failure = apiFailureFromUnknown(error);
    if (failure.status >= 500) {
      logger.error("transfer_failed", "Table transfer could not be completed.", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
    return NextResponse.json(failure.body, {
      status: failure.status,
      headers: NO_STORE_HEADERS,
    });
  }
}
