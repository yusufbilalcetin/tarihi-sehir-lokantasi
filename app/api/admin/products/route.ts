import type { NextResponse } from "next/server";

import { adminMutation, createAdminMenuService, parseBody } from "@/lib/api/admin-route";
import { createProductBodySchema } from "@/lib/validation/admin-menu";

export const runtime = "nodejs";

export function POST(request: Request): Promise<NextResponse> {
  return adminMutation(
    request,
    "api.admin.products",
    async ({ principal, requestId }) => {
      const body = await parseBody(request, createProductBodySchema, "Ürün bilgileri geçersiz.");
      return createAdminMenuService().saveProduct(principal, { ...body, requestId });
    },
    201,
  );
}
