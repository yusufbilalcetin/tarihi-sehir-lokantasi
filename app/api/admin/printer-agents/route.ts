import type { NextResponse } from "next/server";

import { adminMutation, adminRead, parseBody } from "@/lib/api/admin-route";
import { PrinterAdminService } from "@/lib/services/printer-admin-service";
import { createAgentBodySchema } from "@/lib/validation/printing";

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  return adminRead("api.admin.printer-agents", async ({ principal }) => ({
    agents: await new PrinterAdminService().listAgents(principal),
  }));
}

/**
 * The response carries the raw agent token exactly once. It is never stored,
 * never logged and never returned again; a lost token is rotated, not recovered.
 */
export async function POST(request: Request): Promise<NextResponse> {
  return adminMutation(
    request,
    "api.admin.printer-agents",
    async ({ principal, requestId }) => {
      const body = await parseBody(request, createAgentBodySchema, "Agent bilgileri geçersiz.");
      return new PrinterAdminService().createAgent(principal, { ...body, requestId });
    },
    201,
  );
}
