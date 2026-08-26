import type { NextResponse } from "next/server";

import { parseBody } from "@/lib/api/admin-route";
import { printerAgentRoute } from "@/lib/api/printer-agent-route";
import { PrintService } from "@/lib/services/print-service";
import { agentCompleteBodySchema } from "@/lib/validation/printing";

export const runtime = "nodejs";

/**
 * `PRINTED` records that the bytes reached the configured transport. A dumb
 * ESC/POS printer never acknowledges paper, so this is not a claim that a
 * ticket physically exists — see docs/printing.md.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body = await parseBody(request, agentCompleteBodySchema, "Tamamlama isteği geçersiz.");
  return printerAgentRoute(request, "api.printer-agent.complete", (agent) =>
    new PrintService().complete(agent, body.jobId, body.bytesWritten ?? null),
  );
}
