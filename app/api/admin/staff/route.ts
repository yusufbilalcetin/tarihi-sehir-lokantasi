import type { NextResponse } from "next/server";

import { adminMutation, adminRead, parseBody, parseParams } from "@/lib/api/admin-route";
import { AdminStaffService } from "@/lib/services/admin-staff-service";
import { createStaffBodySchema, staffListQuerySchema } from "@/lib/validation/admin-staff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request): Promise<NextResponse> {
  return adminRead("api.admin.staff", async ({ principal }) => {
    const query = parseParams(
      Object.fromEntries(new URL(request.url).searchParams),
      staffListQuerySchema,
      "Personel filtreleri geçersiz.",
    );
    return new AdminStaffService().list(principal, query);
  });
}

/**
 * Creates the Supabase login and the staff profile together. The body carries a
 * name, an address and a role — never a password, and never a restaurant.
 */
export function POST(request: Request): Promise<NextResponse> {
  return adminMutation(
    request,
    "api.admin.staff",
    async ({ principal, requestId }) => {
      const body = await parseBody(request, createStaffBodySchema, "Personel bilgileri geçersiz.");
      return new AdminStaffService().create(principal, { ...body, requestId });
    },
    201,
  );
}
