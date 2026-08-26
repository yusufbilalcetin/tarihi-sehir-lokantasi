import type { NextResponse } from "next/server";

import { getDb } from "@/db";
import { parseParams } from "@/lib/api/admin-route";
import { staffRead } from "@/lib/api/staff-route";
import { SHIFT_OPERATOR_ROLES } from "@/lib/domain/cashier-shift";
import { DrizzleCashierShiftRepository } from "@/lib/repositories/drizzle-cashier-shift-repository";
import { CashierShiftService } from "@/lib/services/cashier-shift-service";
import { entityIdSchema } from "@/lib/validation/common";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ shiftId: string }> },
): Promise<NextResponse> {
  const { shiftId } = await context.params;
  return staffRead(
    SHIFT_OPERATOR_ROLES,
    "api.cashier.shifts.detail",
    ({ principal }) =>
      new CashierShiftService(new DrizzleCashierShiftRepository(getDb())).detail(
        principal,
        parseParams(shiftId, entityIdSchema, "Vardiya kimliği geçersiz."),
      ),
  );
}
