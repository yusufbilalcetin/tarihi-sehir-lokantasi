import type { NextResponse } from "next/server";

import { getDb } from "@/db";
import { parseBody, parseParams } from "@/lib/api/admin-route";
import { validationError } from "@/lib/api/domain-error";
import { staffMutation } from "@/lib/api/staff-route";
import { SHIFT_OPERATOR_ROLES } from "@/lib/domain/cashier-shift";
import { DrizzleCashierShiftRepository } from "@/lib/repositories/drizzle-cashier-shift-repository";
import { CashierShiftService } from "@/lib/services/cashier-shift-service";
import { entityIdSchema, idempotencyKeySchema, validationIssues } from "@/lib/validation/common";
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
      // Required, as on every other money write here. A movement cannot be
      // edited or deleted once written, so a repeated tap — or a retry after a
      // 201 the network swallowed — has to be recognised rather than appended
      // a second time. `requestId` is audit metadata and gates nothing.
      const idempotency = idempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
      if (!idempotency.success) {
        throw validationError("Geçerli bir Idempotency-Key başlığı gereklidir.", {
          issues: validationIssues(idempotency.error).map((issue) => ({ ...issue })),
        });
      }
      const body = await parseBody(request, cashMovementBodySchema, "Kasa hareketi geçersiz.");
      return new CashierShiftService(
        new DrizzleCashierShiftRepository(getDb()),
      ).recordMovement(principal, {
        shiftId: parseParams(shiftId, entityIdSchema, "Vardiya kimliği geçersiz."),
        type: body.type,
        amount: body.amount,
        reason: body.reason,
        note: body.note,
        idempotencyKey: idempotency.data,
        requestId,
      });
    },
    201,
  );
}
