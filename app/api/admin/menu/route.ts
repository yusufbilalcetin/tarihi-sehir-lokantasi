import type { NextResponse } from "next/server";

import { adminRead, createAdminMenuService } from "@/lib/api/admin-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Promise<NextResponse> {
  return adminRead("api.admin.menu", ({ principal }) =>
    createAdminMenuService().getMenu(principal),
  );
}
