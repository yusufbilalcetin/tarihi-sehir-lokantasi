import type { NextResponse } from "next/server";

import { adminMutation, parseBody, parseParams } from "@/lib/api/admin-route";
import { CashRegisterService } from "@/lib/services/cash-register-service";
import { entityIdSchema } from "@/lib/validation/common";
import { updateCashRegisterBodySchema } from "@/lib/validation/cashier-shift";

export const runtime = "nodejs";

/** No DELETE: a register with shift history is deactivated, never removed. */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ registerId: string }> },
): Promise<NextResponse> {
  const { registerId } = await context.params;
  return adminMutation(request, "api.admin.cash-registers", async ({ principal, requestId }) => {
    const body = await parseBody(
      request,
      updateCashRegisterBodySchema,
      "Kasa güncellemesi geçersiz.",
    );
    return new CashRegisterService().update(principal, {
      registerId: parseParams(registerId, entityIdSchema, "Kasa kimliği geçersiz."),
      ...body,
      requestId,
    });
  });
}
