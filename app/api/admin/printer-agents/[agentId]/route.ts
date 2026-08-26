import type { NextResponse } from "next/server";

import { adminMutation, parseBody, parseParams } from "@/lib/api/admin-route";
import { PrinterAdminService } from "@/lib/services/printer-admin-service";
import { entityIdSchema } from "@/lib/validation/common";
import { updateAgentBodySchema } from "@/lib/validation/printing";

export const runtime = "nodejs";

/** Rotation returns a new raw token once; revocation returns none. */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ agentId: string }> },
): Promise<NextResponse> {
  const { agentId } = await context.params;
  return adminMutation(request, "api.admin.printer-agents", async ({ principal, requestId }) => {
    const body = await parseBody(request, updateAgentBodySchema, "Agent güncellemesi geçersiz.");
    return new PrinterAdminService().updateAgent(principal, {
      agentId: parseParams(agentId, entityIdSchema, "Agent kimliği geçersiz."),
      ...body,
      requestId,
    });
  });
}
