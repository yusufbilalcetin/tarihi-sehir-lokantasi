import type { NextResponse } from "next/server";

import { adminRead, parseParams } from "@/lib/api/admin-route";
import { AuditLogService } from "@/lib/services/audit-log-service";
import { auditLogQuerySchema } from "@/lib/validation/audit-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The restaurant's own record of what its people did.
 *
 * Read-only by construction: this route has a GET and nothing else. Every entry
 * is written inside the transaction that made the change, so there is no write
 * path here to protect — and no PATCH or DELETE to leave off by accident.
 *
 * Scope and roles come from the shared admin envelope, so the tenant is the
 * signed-in restaurant and never a query parameter.
 */
export function GET(request: Request): Promise<NextResponse> {
  return adminRead("api.admin.audit-logs", async ({ principal }) => {
    const query = parseParams(
      Object.fromEntries(new URL(request.url).searchParams),
      auditLogQuerySchema,
      "İşlem geçmişi filtreleri geçersiz.",
    );
    const service = new AuditLogService();
    const [page, actors] = await Promise.all([
      service.list(principal, query),
      service.actors(principal),
    ]);
    return { ...page, actors };
  });
}
