import type { NextResponse } from "next/server";

import { adminMutation, adminRead, parseBody } from "@/lib/api/admin-route";
import { PrinterAdminService } from "@/lib/services/printer-admin-service";
import { createPrinterBodySchema } from "@/lib/validation/printing";

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  return adminRead("api.admin.printers", async ({ principal }) => ({
    printers: await new PrinterAdminService().listPrinters(principal),
  }));
}

export async function POST(request: Request): Promise<NextResponse> {
  return adminMutation(
    request,
    "api.admin.printers",
    async ({ principal, requestId }) => {
      const body = await parseBody(request, createPrinterBodySchema, "Yazıcı bilgileri geçersiz.");
      return new PrinterAdminService().createPrinter(principal, { ...body, requestId });
    },
    201,
  );
}
