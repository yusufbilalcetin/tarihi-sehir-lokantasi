import { NextResponse } from "next/server";
import { z } from "zod";

import { auditRequestContext } from "@/lib/api/audit-request";
import { validationError } from "@/lib/api/domain-error";
import { apiFailureFromUnknown, apiSuccess } from "@/lib/api/response";
import { requireCurrentStaffPrincipal } from "@/lib/auth/current-staff";
import { createLogger } from "@/lib/security/logger";
import { assertTrustedMutationOrigin } from "@/lib/security/origin";
import { createTableService } from "@/lib/services/table-service.server";
import { validationIssues } from "@/lib/validation";

export const runtime = "nodejs";

const requestSchema = z.object({
  name: z.string().trim().min(1).max(80),
  tableNumber: z.number().int().min(1).max(100_000),
  seats: z.number().int().min(1).max(100),
}).strict();
const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" } as const;
const logger = createLogger("api.admin.tables");

export async function POST(request: Request): Promise<NextResponse> {
  try {
    assertTrustedMutationOrigin(request);
    const principal = await requireCurrentStaffPrincipal(["ADMIN", "MANAGER"]);
    const parsed = requestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw validationError("Masa bilgileri geçersiz.", {
        issues: validationIssues(parsed.error).map((issue) => ({ ...issue })),
      });
    }
    const created = await createTableService().createTableWithToken(principal, {
      restaurantId: principal.restaurantId,
      ...parsed.data,
      audit: auditRequestContext(request),
    });
    return NextResponse.json(apiSuccess(created), {
      status: 201,
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    const failure = apiFailureFromUnknown(error);
    if (failure.status >= 500) {
      logger.error("create_failed", "Restaurant table could not be created.", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
    return NextResponse.json(failure.body, {
      status: failure.status,
      headers: NO_STORE_HEADERS,
    });
  }
}
