import type { NextResponse } from "next/server";

import { adminMutation, parseParams } from "@/lib/api/admin-route";
import { enforceRateLimit } from "@/lib/security/rate-limit.server";
import { AdminStaffService } from "@/lib/services/admin-staff-service";
import { staffIdParamsSchema } from "@/lib/validation/admin-staff";

export const runtime = "nodejs";

/**
 * Asks the provider to send a password-setup link to the staff member's own
 * address. Nothing about the password comes back: not a link, not a token, not
 * a temporary value. Rate limited so the action cannot be used to mail-bomb a
 * colleague.
 */
export function POST(
  request: Request,
  context: { params: Promise<{ staffId: string }> },
): Promise<NextResponse> {
  return adminMutation(request, "api.admin.staff", async ({ principal, requestId }) => {
    const params = parseParams(
      await context.params,
      staffIdParamsSchema,
      "Personel kimliği geçersiz.",
    );
    await enforceRateLimit(request, "STAFF_PASSWORD_RESET", {
      restaurantId: principal.restaurantId,
      identifier: params.staffId,
    });
    return new AdminStaffService().requestPasswordReset(principal, params.staffId, requestId);
  });
}
