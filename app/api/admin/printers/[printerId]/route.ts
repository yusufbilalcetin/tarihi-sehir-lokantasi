import type { NextResponse } from "next/server";

import { adminMutation, parseBody, parseParams } from "@/lib/api/admin-route";
import { PrinterAdminService } from "@/lib/services/printer-admin-service";
import { entityIdSchema } from "@/lib/validation/common";
import { updatePrinterBodySchema } from "@/lib/validation/printing";

export const runtime = "nodejs";

/** No DELETE: a printer with print history is deactivated, never removed. */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ printerId: string }> },
): Promise<NextResponse> {
  const { printerId } = await context.params;
  return adminMutation(request, "api.admin.printers", async ({ principal, requestId }) => {
    const body = await parseBody(request, updatePrinterBodySchema, "Yazıcı güncellemesi geçersiz.");
    return new PrinterAdminService().updatePrinter(principal, {
      printerId: parseParams(printerId, entityIdSchema, "Yazıcı kimliği geçersiz."),
      ...body,
      requestId,
    });
  });
}
