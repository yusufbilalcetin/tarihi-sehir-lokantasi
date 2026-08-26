import type { NextResponse } from "next/server";

import { adminMutation, createAdminMenuService, parseBody } from "@/lib/api/admin-route";
import { createCategoryBodySchema } from "@/lib/validation/admin-menu";

export const runtime = "nodejs";

export function POST(request: Request): Promise<NextResponse> {
  return adminMutation(
    request,
    "api.admin.categories",
    async ({ principal, requestId }) => {
      const body = await parseBody(request, createCategoryBodySchema, "Kategori bilgileri geçersiz.");
      return createAdminMenuService().saveCategory(principal, { ...body, requestId });
    },
    201,
  );
}
