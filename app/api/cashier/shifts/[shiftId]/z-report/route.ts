import { NextResponse } from "next/server";

import { getDb } from "@/db";
import { parseParams } from "@/lib/api/admin-route";
import { apiFailureFromUnknown, apiSuccess } from "@/lib/api/response";
import { STAFF_NO_STORE_HEADERS } from "@/lib/api/staff-route";
import { requireCurrentStaffPrincipal } from "@/lib/auth/current-staff";
import { zReportToCsv } from "@/lib/domain/cashier-report-csv";
import { SHIFT_OPERATOR_ROLES } from "@/lib/domain/cashier-shift";
import { DrizzleCashierShiftRepository } from "@/lib/repositories/drizzle-cashier-shift-repository";
import { createLogger } from "@/lib/security/logger";
import { CashierReportService } from "@/lib/services/cashier-report-service";
import { entityIdSchema } from "@/lib/validation/common";
import { shiftReportQuerySchema } from "@/lib/validation/cashier-report";

export const runtime = "nodejs";

const logger = createLogger("api.cashier.z-report");

/**
 * The stored Z report. Read-only by design: there is deliberately no PATCH or
 * DELETE, and repeating this GET returns the identical stored document.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ shiftId: string }> },
): Promise<NextResponse> {
  try {
    const { shiftId } = await context.params;
    const principal = await requireCurrentStaffPrincipal(SHIFT_OPERATOR_ROLES);
    const query = parseParams(
      Object.fromEntries(new URL(request.url).searchParams),
      shiftReportQuerySchema,
      "Rapor biçimi geçersiz.",
    );
    const report = await new CashierReportService(
      new DrizzleCashierShiftRepository(getDb()),
    ).zReport(principal, parseParams(shiftId, entityIdSchema, "Vardiya kimliği geçersiz."));

    if (query.format === "csv") {
      return new NextResponse(zReportToCsv(report), {
        status: 200,
        headers: {
          ...STAFF_NO_STORE_HEADERS,
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="z-raporu-${report.shiftId}.csv"`,
        },
      }) as NextResponse;
    }
    return NextResponse.json(apiSuccess(report), {
      status: 200,
      headers: STAFF_NO_STORE_HEADERS,
    });
  } catch (error) {
    const failure = apiFailureFromUnknown(error);
    if (failure.status >= 500) {
      logger.error("z_report_failed", "Z report could not be served.", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
    return NextResponse.json(failure.body, {
      status: failure.status,
      headers: STAFF_NO_STORE_HEADERS,
    });
  }
}
