import type { NextResponse } from "next/server";

import { adminRead, parseParams } from "@/lib/api/admin-route";
import { addDays, startOfLocalDay } from "@/lib/domain/report-range";
import { PrintService } from "@/lib/services/print-service";
import { printJobQuerySchema } from "@/lib/validation/printing";

export const runtime = "nodejs";

/**
 * Local calendar day boundaries, in the restaurant's own zone -- the same
 * contract the rest of the reporting layer is bounded by, rather than a fixed
 * offset that only happened to agree with Istanbul.
 */
function dayStart(
  value: string | undefined,
  timeZone: string,
  plusDays = 0,
): Date | undefined {
  if (!value) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  return startOfLocalDay(addDays({ year, month, day }, plusDays), timeZone);
}

export async function GET(request: Request): Promise<NextResponse> {
  return adminRead("api.admin.print-jobs", async ({ principal }) => {
    const query = parseParams(
      Object.fromEntries(new URL(request.url).searchParams),
      printJobQuerySchema,
      "Yazdırma filtreleri geçersiz.",
    );
    return new PrintService().history(principal, {
      status: query.status,
      printerId: query.printerId,
      documentType: query.documentType,
      from: dayStart(query.dateFrom, principal.restaurant.timezone),
      to: dayStart(query.dateTo, principal.restaurant.timezone, 1),
      page: query.page,
      pageSize: query.pageSize,
    });
  });
}
