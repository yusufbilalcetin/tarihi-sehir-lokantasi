import type { NextResponse } from "next/server";

import { getDb } from "@/db";
import { parseBody, parseParams } from "@/lib/api/admin-route";
import { staffMutation } from "@/lib/api/staff-route";
import { SHIFT_OPERATOR_ROLES } from "@/lib/domain/cashier-shift";
import { DrizzleCashierShiftRepository } from "@/lib/repositories/drizzle-cashier-shift-repository";
import { CashierShiftService } from "@/lib/services/cashier-shift-service";
import { entityIdSchema } from "@/lib/validation/common";
import { closeShiftBodySchema } from "@/lib/validation/cashier-shift";

export const runtime = "nodejs";

/**
 * The expected cash is never accepted from the client: only the counted figure
 * is, and the server derives the expectation and the variance itself.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ shiftId: string }> },
): Promise<NextResponse> {
  const { shiftId } = await context.params;
  return staffMutation(
    request,
    SHIFT_OPERATOR_ROLES,
    "api.cashier.shifts.close",
    async ({ principal, requestId }) => {
      const body = await parseBody(request, closeShiftBodySchema, "Kasa kapanış bilgileri geçersiz.");
      return new CashierShiftService(new DrizzleCashierShiftRepository(getDb())).close(
        principal,
        {
          shiftId: parseParams(shiftId, entityIdSchema, "Vardiya kimliği geçersiz."),
          countedCash: body.countedCash,
          note: body.note,
          requestId,
        },
      );
    },
  );
}
