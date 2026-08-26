import type { NextResponse } from "next/server";

import { adminMutation, adminRead, parseBody } from "@/lib/api/admin-route";
import { AdminSettingsService } from "@/lib/services/admin-settings-service";
import { updateSettingsBodySchema } from "@/lib/validation/admin-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Promise<NextResponse> {
  return adminRead("api.admin.settings", ({ principal }) =>
    new AdminSettingsService().get(principal),
  );
}

export function PATCH(request: Request): Promise<NextResponse> {
  return adminMutation(request, "api.admin.settings", async ({ principal, requestId }) => {
    const body = await parseBody(request, updateSettingsBodySchema, "Ayar bilgileri geçersiz.");
    return new AdminSettingsService().update(principal, body, requestId);
  });
}
