import type { NextResponse } from "next/server";

import { adminMutation, adminRead, parseBody } from "@/lib/api/admin-route";
import { PrinterAdminService } from "@/lib/services/printer-admin-service";
import { createRouteBodySchema } from "@/lib/validation/printing";

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  return adminRead("api.admin.printer-routes", async ({ principal }) => ({
    routes: await new PrinterAdminService().listRoutes(principal),
  }));
}

export async function POST(request: Request): Promise<NextResponse> {
  return adminMutation(
    request,
    "api.admin.printer-routes",
    async ({ principal, requestId }) => {
      const body = await parseBody(request, createRouteBodySchema, "Yönlendirme geçersiz.");
      return new PrinterAdminService().createRoute(principal, { ...body, requestId });
    },
    201,
  );
}
