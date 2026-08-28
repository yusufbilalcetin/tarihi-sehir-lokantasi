import type { NextResponse } from "next/server";
import { z } from "zod";

import { auditRequestContext } from "@/lib/api/audit-request";
import { adminMutation, parseBody, parseParams } from "@/lib/api/admin-route";
import { createTableService } from "@/lib/services/table-service.server";
import { entityIdSchema } from "@/lib/validation/common";

export const runtime = "nodejs";

const paramsSchema = z.object({ tableId: entityIdSchema }).strict();
const bodySchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    seats: z.number().int().min(1).max(100).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Güncellenecek alan gönderin.");

export function PATCH(
  request: Request,
  context: { params: Promise<{ tableId: string }> },
): Promise<NextResponse> {
  return adminMutation(request, "api.admin.tables", async ({ principal }) => {
    const params = parseParams(await context.params, paramsSchema, "Masa kimliği geçersiz.");
    const body = await parseBody(request, bodySchema, "Masa bilgileri geçersiz.");
    return createTableService().updateTable(principal, {
      restaurantId: principal.restaurantId,
      tableId: params.tableId,
      ...body,
      audit: auditRequestContext(request),
    });
  });
}
