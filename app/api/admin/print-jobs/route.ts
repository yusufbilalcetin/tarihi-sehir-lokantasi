import type { NextResponse } from "next/server";

import { adminRead, parseParams } from "@/lib/api/admin-route";
import { PrintService } from "@/lib/services/print-service";
import { printJobQuerySchema } from "@/lib/validation/printing";

export const runtime = "nodejs";

/** Local calendar day boundaries, as the rest of the reporting layer uses. */
function dayStart(value: string | undefined, addDays = 0): Date | undefined {
  if (!value) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + addDays) - 180 * 60_000);
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
      from: dayStart(query.dateFrom),
      to: dayStart(query.dateTo, 1),
      page: query.page,
      pageSize: query.pageSize,
    });
  });
}
