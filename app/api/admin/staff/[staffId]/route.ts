import type { NextResponse } from "next/server";

import { adminMutation, adminRead, parseBody, parseParams } from "@/lib/api/admin-route";
import { AdminStaffService } from "@/lib/services/admin-staff-service";
import { staffIdParamsSchema, updateStaffBodySchema } from "@/lib/validation/admin-staff";

export const runtime = "nodejs";

export function GET(
  _request: Request,
  context: { params: Promise<{ staffId: string }> },
): Promise<NextResponse> {
  return adminRead("api.admin.staff", async ({ principal }) => {
    const params = parseParams(
      await context.params,
      staffIdParamsSchema,
      "Personel kimliği geçersiz.",
    );
    return new AdminStaffService().detail(principal, params.staffId);
  });
}

/** No DELETE: a staff member with history is deactivated, never removed. */
export function PATCH(
  request: Request,
  context: { params: Promise<{ staffId: string }> },
): Promise<NextResponse> {
  return adminMutation(request, "api.admin.staff", async ({ principal, requestId }) => {
    const params = parseParams(
      await context.params,
      staffIdParamsSchema,
      "Personel kimliği geçersiz.",
    );
    const body = await parseBody(request, updateStaffBodySchema, "Personel bilgileri geçersiz.");
    return new AdminStaffService().update(principal, {
      ...body,
      staffId: params.staffId,
      requestId,
    });
  });
}
