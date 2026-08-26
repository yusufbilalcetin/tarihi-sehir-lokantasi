import type { NextResponse } from "next/server";

import { parseBody } from "@/lib/api/admin-route";
import { printerAgentRoute } from "@/lib/api/printer-agent-route";
import { PrintService } from "@/lib/services/print-service";
import { agentHeartbeatBodySchema } from "@/lib/validation/printing";

export const runtime = "nodejs";

/** Presence only. The admin screen reads `last_seen_at` to say online/offline. */
export async function POST(request: Request): Promise<NextResponse> {
  const body = await parseBody(request, agentHeartbeatBodySchema, "Heartbeat geçersiz.").catch(
    () => ({ softwareVersion: undefined }),
  );
  return printerAgentRoute(request, "api.printer-agent.heartbeat", async (agent) => {
    await new PrintService().heartbeat(
      agent.id,
      agent.restaurantId,
      body.softwareVersion ?? null,
    );
    return { agentName: agent.name, acknowledgedAt: new Date().toISOString() };
  });
}
