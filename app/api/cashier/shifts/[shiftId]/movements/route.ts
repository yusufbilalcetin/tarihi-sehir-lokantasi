import type { NextResponse } from "next/server";

import { getDb } from "@/db";
import { parseBody, parseParams } from "@/lib/api/admin-route";
import { staffMutation } from "@/lib/api/staff-route";
import { SHIFT_OPERATOR_ROLES } from "@/lib/domain/cashier-shift";
import { DrizzleCashierShiftRepository } from "@/lib/repositories/drizzle-cashier-shift-repository";
import { CashierShiftService } from "@/lib/services/cashier-shift-service";
import { entityIdSchema } from "@/lib/validation/common";
import { cashMovementBodySchema } from "@/lib/validation/cashier-shift";

export const runtime = "nodejs";

/** Append-only: there is deliberately no PATCH or DELETE for a movement. */
export async function POST(
  request: Request,
  context: { params: Promise<{ shiftId: string }> },
): Promise<NextResponse> {
  const { shiftId } = await context.params;
  return staffMutation(
    request,
    SHIFT_OPERATOR_ROLES,
    "api.cashier.shifts.movements",
    async ({ principal, requestId }) => {
      const body = await parseBody(request, cashMovementBodySchema, "Kasa hareketi geçersiz.");
      return new CashierShiftService(
        new DrizzleCashierShiftRepository(getDb()),
      ).recordMovement(principal, {
        shiftId: parseParams(shiftId, entityIdSchema, "Vardiya kimliği geçersiz."),
        type: body.type,
        amount: body.amount,
        reason: body.reason,
        note: body.note,
        requestId,
      });
    },
    201,
  );
}
