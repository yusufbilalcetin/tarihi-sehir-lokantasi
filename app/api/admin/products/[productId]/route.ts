import type { NextResponse } from "next/server";

import {
  adminMutation,
  createAdminMenuService,
  parseBody,
  parseParams,
} from "@/lib/api/admin-route";
import { productIdParamsSchema, updateProductBodySchema } from "@/lib/validation/admin-menu";

export const runtime = "nodejs";

export function PATCH(
  request: Request,
  context: { params: Promise<{ productId: string }> },
): Promise<NextResponse> {
  return adminMutation(request, "api.admin.products", async ({ principal, requestId }) => {
    const params = parseParams(await context.params, productIdParamsSchema, "Ürün kimliği geçersiz.");
    const body = await parseBody(request, updateProductBodySchema, "Ürün bilgileri geçersiz.");
    return createAdminMenuService().saveProduct(principal, {
      ...body,
      productId: params.productId,
      requestId,
    });
  });
}
