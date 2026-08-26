import { NextResponse } from "next/server";

import { getDb } from "@/db";
import { parseParams } from "@/lib/api/admin-route";
import { apiFailureFromUnknown, apiSuccess } from "@/lib/api/response";
import { STAFF_NO_STORE_HEADERS } from "@/lib/api/staff-route";
import { requireCurrentStaffPrincipal } from "@/lib/auth/current-staff";
import { xReportToCsv } from "@/lib/domain/cashier-report-csv";
import { SHIFT_OPERATOR_ROLES } from "@/lib/domain/cashier-shift";
import { DrizzleCashierShiftRepository } from "@/lib/repositories/drizzle-cashier-shift-repository";
import { createLogger } from "@/lib/security/logger";
import { CashierReportService } from "@/lib/services/cashier-report-service";
import { entityIdSchema } from "@/lib/validation/common";
import { shiftReportQuerySchema } from "@/lib/validation/cashier-report";

export const runtime = "nodejs";

const logger = createLogger("api.cashier.x-report");

/**
 * The live X report. A GET, and genuinely side-effect free: nothing is written,
 * the shift stays open and collections keep being accepted.
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
    ).xReport(principal, parseParams(shiftId, entityIdSchema, "Vardiya kimliği geçersiz."));

    if (query.format === "csv") {
      return new NextResponse(xReportToCsv(report), {
        status: 200,
        headers: {
          ...STAFF_NO_STORE_HEADERS,
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="x-raporu-${report.shiftId}.csv"`,
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
      logger.error("x_report_failed", "X report could not be served.", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
    return NextResponse.json(failure.body, {
      status: failure.status,
      headers: STAFF_NO_STORE_HEADERS,
    });
  }
}
