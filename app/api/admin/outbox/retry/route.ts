import type { NextResponse } from "next/server";

import { getDb } from "@/db";
import { adminMutation } from "@/lib/api/admin-route";
import { DrizzleOutboxRepository } from "@/lib/repositories/drizzle-outbox-repository";

export const runtime = "nodejs";

const MAX_REQUEUE = 100;

/** Manual recovery for events whose retries were exhausted. */
export function POST(request: Request): Promise<NextResponse> {
  return adminMutation(request, "api.admin.outbox.retry", async ({ principal }) => {
    const requeued = await new DrizzleOutboxRepository(getDb()).requeueDeadLettered({
      restaurantId: principal.restaurantId,
      now: new Date(),
      limit: MAX_REQUEUE,
    });
    return { requeued };
  });
}
