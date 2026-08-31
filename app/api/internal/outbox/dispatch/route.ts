import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { apiFailure, apiSuccess } from "@/lib/api/response";
import { getServerEnvironment } from "@/lib/env/server";
import { isAuthorizedOutboxDispatch } from "@/lib/realtime/outbox-dispatch-auth";
import { createRealtimeOutboxDispatcher } from "@/lib/realtime/outbox-runtime.server";
import { createLogger } from "@/lib/security/logger";

export const runtime = "nodejs";
export const maxDuration = 30;

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" } as const;
const logger = createLogger("api.internal.outbox.dispatch");
// Sizing has two independent limits, both inside the 30-second budget.
//
// Network: events publish through a pool, so the worst case is
// ceil(BATCH / CONCURRENCY) * TIMEOUT = 20s.
//
// Database: claim and acknowledgement are per event. The earlier figure here
// (~0.72s per event) was measured when the runtime pool was `max: 1` and every
// statement cost two network round trips because statements were never
// prepared; Phase 32 changed both (see db/index.ts). Re-measured end to end
// against the same database: 20 events drained in ~1.7s, i.e. ~85ms per event.
// tests/foundation/phase3-outbox-runtime-budget.test.ts holds both limits and
// carries a conservative per-event figure with several times that headroom.
//
// The cron fires once a minute (Vercel's floor), so BATCH is also the ceiling
// on sustained events per minute — one order create, one status change and one
// collection each produce one event, so a busy service needs more than a few
// dozen. That ceiling, not the publish itself, is what would let the queue grow
// without bound.
const OUTBOX_BATCH_SIZE = 60;
const OUTBOX_PUBLISH_CONCURRENCY = 12;
const OUTBOX_TRANSPORT_TIMEOUT_MS = 4_000;

async function dispatch(request: Request): Promise<NextResponse> {
  try {
    const secret = getServerEnvironment(["outbox-dispatch"]).outboxDispatchSecret!;
    if (!isAuthorizedOutboxDispatch(request.headers.get("authorization"), secret)) {
      return NextResponse.json(
        apiFailure({ code: "AUTHENTICATION_REQUIRED", message: "Kimlik doğrulaması gerekli." }),
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }
    const result = await createRealtimeOutboxDispatcher({
      batchSize: OUTBOX_BATCH_SIZE,
      publishConcurrency: OUTBOX_PUBLISH_CONCURRENCY,
      transportTimeoutMs: OUTBOX_TRANSPORT_TIMEOUT_MS,
    }).dispatch(`worker:${randomUUID()}`);

    /*
     * A dispatch run that reaches here succeeded as an invocation, and until now
     * that was the only thing recorded — a batch in which every event
     * dead-lettered still answered 200 and logged nothing.
     *
     * No dispatch semantics change here and no queue state is invented: the
     * dispatcher already distinguishes a failure that will retry from one whose
     * attempts are spent, and these are those two numbers. A dead letter is an
     * event the floor will never receive, so it is the one that gets `error`;
     * a quiet run stays silent rather than logging once per cron tick.
     */
    if (result.deadLettered > 0) {
      logger.error("outbox_dead_lettered", "Outbox events exhausted their retries and will not be delivered.", {
        claimed: result.claimed,
        published: result.published,
        failed: result.failed,
        deadLettered: result.deadLettered,
      });
    } else if (result.failed > 0) {
      logger.warn("outbox_publish_failed", "Outbox events failed to publish and were rescheduled.", {
        claimed: result.claimed,
        published: result.published,
        failed: result.failed,
      });
    }

    return NextResponse.json(apiSuccess(result), {
      status: 200,
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    logger.error("dispatch_failed", "Outbox dispatch invocation failed.", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json(
      apiFailure({ code: "INTERNAL_ERROR", message: "İşlem tamamlanamadı." }),
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}

export const POST = dispatch;
/**
 * The Supabase cron job POSTs, so GET is only kept for schedulers that can
 * issue nothing else (Vercel Cron among them, were one ever configured). Both
 * verbs run the same authenticated worker; neither is reachable without the
 * secret, so exposing GET adds no surface.
 */
export const GET = dispatch;
