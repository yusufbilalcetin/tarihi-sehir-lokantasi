import type { NextResponse } from "next/server";

import {
  adminMutation,
  createAdminMenuService,
  parseBody,
  parseParams,
} from "@/lib/api/admin-route";
import { categoryIdParamsSchema, updateCategoryBodySchema } from "@/lib/validation/admin-menu";

export const runtime = "nodejs";

export function PATCH(
  request: Request,
  context: { params: Promise<{ categoryId: string }> },
): Promise<NextResponse> {
  return adminMutation(request, "api.admin.categories", async ({ principal, requestId }) => {
    const params = parseParams(await context.params, categoryIdParamsSchema, "Kategori kimliği geçersiz.");
    const body = await parseBody(request, updateCategoryBodySchema, "Kategori bilgileri geçersiz.");
    return createAdminMenuService().saveCategory(principal, {
      ...body,
      categoryId: params.categoryId,
      requestId,
    });
  });
}
