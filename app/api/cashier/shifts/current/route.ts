import type { NextResponse } from "next/server";

import { getDb } from "@/db";
import { staffRead } from "@/lib/api/staff-route";
import { SHIFT_OPERATOR_ROLES } from "@/lib/domain/cashier-shift";
import { DrizzleCashierShiftRepository } from "@/lib/repositories/drizzle-cashier-shift-repository";
import { CashierShiftService } from "@/lib/services/cashier-shift-service";

export const runtime = "nodejs";

/**
 * Everything the till screen needs on load: the caller's own open shift with
 * its live money position, or the registers they could open one on.
 */
export async function GET(): Promise<NextResponse> {
  return staffRead(
    SHIFT_OPERATOR_ROLES,
    "api.cashier.shifts.current",
    ({ principal }) =>
      new CashierShiftService(new DrizzleCashierShiftRepository(getDb())).current(principal),
  );
}
