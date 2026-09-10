import type { NextResponse } from "next/server";

import { adminMutation, createAdminMenuService, parseBody } from "@/lib/api/admin-route";
import { reorderMenuBodySchema } from "@/lib/validation/admin-menu";

export const runtime = "nodejs";

/**
 * The menu's running order, written in one go.
 *
 * Order is the part of the menu a guest feels first — soups before dessert,
 * the house's own dish at the top of its section — so it is saved as a single
 * transactional statement of the whole list rather than as a stream of
 * pairwise swaps that can stop halfway.
 */
export function PATCH(request: Request): Promise<NextResponse> {
  return adminMutation(request, "api.admin.menu.order", async ({ principal, requestId }) => {
    const body = await parseBody(request, reorderMenuBodySchema, "Sıralama bilgileri geçersiz.");
    return createAdminMenuService().reorderMenu(principal, { ...body, requestId });
  });
}
