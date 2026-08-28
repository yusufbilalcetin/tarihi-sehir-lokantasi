import type { NextResponse } from "next/server";
import { z } from "zod";

import { auditRequestContext } from "@/lib/api/audit-request";
import { adminMutation, parseParams } from "@/lib/api/admin-route";
import { createTableService } from "@/lib/services/table-service.server";
import { entityIdSchema } from "@/lib/validation/common";

export const runtime = "nodejs";

const paramsSchema = z.object({ tableId: entityIdSchema }).strict();

export function POST(
  request: Request,
  context: { params: Promise<{ tableId: string }> },
): Promise<NextResponse> {
  return adminMutation(request, "api.admin.tables.qr.resume", async ({ principal }) => {
    const { tableId } = parseParams(
      await context.params,
      paramsSchema,
      "Masa kimliği geçersiz.",
    );
    return createTableService().resumeQrAccess(principal, {
      restaurantId: principal.restaurantId,
      tableId,
      audit: auditRequestContext(request),
    });
  });
}
