import type { NextResponse } from "next/server";

import { adminRead } from "@/lib/api/admin-route";
import { AdminReportsService } from "@/lib/services/admin-reports-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Promise<NextResponse> {
  return adminRead("api.admin.reports", ({ principal }) =>
    new AdminReportsService().getReports(principal),
  );
}
