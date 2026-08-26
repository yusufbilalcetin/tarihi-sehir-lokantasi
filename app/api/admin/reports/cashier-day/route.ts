import { NextResponse } from "next/server";

import { getDb } from "@/db";
import { ADMIN_NO_STORE_HEADERS, adminRead, parseParams } from "@/lib/api/admin-route";
import { dailyReportToCsv } from "@/lib/domain/cashier-report-csv";
import { DrizzleCashierShiftRepository } from "@/lib/repositories/drizzle-cashier-shift-repository";
import { CashierReportService } from "@/lib/services/cashier-report-service";
import { dailyCashReportQuerySchema } from "@/lib/validation/cashier-report";

export const runtime = "nodejs";

/**
 * End-of-day cash report for one restaurant-local calendar day.
 *
 * The tenant comes from the authenticated principal through the shared admin
 * envelope, and the query schema is `.strict()`, so any attempt to name a
 * different tenant in the query string is rejected rather than ignored.
 */
export async function GET(request: Request): Promise<NextResponse> {
  return adminRead("api.admin.reports.cashier-day", async ({ principal }) => {
    const query = parseParams(
      Object.fromEntries(new URL(request.url).searchParams),
      dailyCashReportQuerySchema,
      "Gün sonu raporu filtreleri geçersiz.",
    );
    const report = await new CashierReportService(
      new DrizzleCashierShiftRepository(getDb()),
    ).dailyReport(principal, {
      date: query.date,
      registerId: query.registerId,
      cashierId: query.cashierId,
    });

    if (query.format !== "csv") return report;
    return new NextResponse(dailyReportToCsv(report), {
      status: 200,
      headers: {
        ...ADMIN_NO_STORE_HEADERS,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="gun-sonu-${report.businessDate}.csv"`,
      },
    });
  });
}
