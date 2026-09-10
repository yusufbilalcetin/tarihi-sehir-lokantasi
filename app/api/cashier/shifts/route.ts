import type { NextResponse } from "next/server";

import { getDb } from "@/db";
import { parseBody, parseParams } from "@/lib/api/admin-route";
import { staffMutation, staffRead } from "@/lib/api/staff-route";
import { SHIFT_OPERATOR_ROLES } from "@/lib/domain/cashier-shift";
import { addDays, startOfLocalDay } from "@/lib/domain/report-range";
import { DrizzleCashierShiftRepository } from "@/lib/repositories/drizzle-cashier-shift-repository";
import { CashierShiftService } from "@/lib/services/cashier-shift-service";
import {
  openShiftBodySchema,
  shiftHistoryQuerySchema,
} from "@/lib/validation/cashier-shift";

export const runtime = "nodejs";

function service(): CashierShiftService {
  return new CashierShiftService(new DrizzleCashierShiftRepository(getDb()));
}

/**
 * A local calendar day resolves to the UTC instant it actually starts at, in
 * the restaurant's own zone -- the same contract the reports are bounded by.
 * A fixed offset was wrong for any restaurant that keeps daylight saving, and
 * silently so: the filter simply returned a neighbouring day's shifts.
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
  return staffRead(SHIFT_OPERATOR_ROLES, "api.cashier.shifts", async ({ principal }) => {
    const query = parseParams(
      Object.fromEntries(new URL(request.url).searchParams),
      shiftHistoryQuerySchema,
      "Vardiya filtreleri geçersiz.",
    );
    // The service pins a cashier to their own shifts whatever the query says.
    return service().history(principal, {
      status: query.status,
      cashRegisterId: query.cashRegisterId,
      openedByStaffId: query.openedByStaffId,
      from: dayStart(query.dateFrom, principal.restaurant.timezone),
      to: dayStart(query.dateTo, principal.restaurant.timezone, 1),
      page: query.page,
      pageSize: query.pageSize,
    });
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  return staffMutation(
    request,
    SHIFT_OPERATOR_ROLES,
    "api.cashier.shifts",
    async ({ principal, requestId }) => {
      const body = await parseBody(
        request,
        openShiftBodySchema,
        "Kasa açılış bilgileri geçersiz.",
      );
      return service().open(principal, { ...body, requestId });
    },
    201,
  );
}
