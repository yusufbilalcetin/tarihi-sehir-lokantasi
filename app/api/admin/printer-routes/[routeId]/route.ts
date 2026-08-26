import type { NextResponse } from "next/server";

import { adminMutation, parseBody, parseParams } from "@/lib/api/admin-route";
import { PrinterAdminService } from "@/lib/services/printer-admin-service";
import { entityIdSchema } from "@/lib/validation/common";
import { updateRouteBodySchema } from "@/lib/validation/printing";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ routeId: string }> },
): Promise<NextResponse> {
  const { routeId } = await context.params;
  return adminMutation(request, "api.admin.printer-routes", async ({ principal, requestId }) => {
    const body = await parseBody(request, updateRouteBodySchema, "Yönlendirme güncellemesi geçersiz.");
    return new PrinterAdminService().updateRoute(principal, {
      routeId: parseParams(routeId, entityIdSchema, "Yönlendirme kimliği geçersiz."),
      ...body,
      requestId,
    });
  });
}
