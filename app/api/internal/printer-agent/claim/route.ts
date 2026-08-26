import type { NextResponse } from "next/server";

import { parseBody } from "@/lib/api/admin-route";
import { printerAgentRoute } from "@/lib/api/printer-agent-route";
import { PrintService } from "@/lib/services/print-service";
import { agentClaimBodySchema } from "@/lib/validation/printing";

export const runtime = "nodejs";

/**
 * Hands the agent work for its own printers, in its own restaurant, and
 * nothing else. The response carries the rendered bytes and the device key —
 * never the restaurant's wider data.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body = await parseBody(request, agentClaimBodySchema, "Claim isteği geçersiz.").catch(
    () => ({ limit: 5 }),
  );
  return printerAgentRoute(request, "api.printer-agent.claim", async (agent) => ({
    jobs: await new PrintService().claim(agent, body.limit),
  }));
}
