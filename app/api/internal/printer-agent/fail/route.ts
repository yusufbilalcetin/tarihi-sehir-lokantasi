import type { NextResponse } from "next/server";

import { parseBody } from "@/lib/api/admin-route";
import { printerAgentRoute } from "@/lib/api/printer-agent-route";
import { createLogger } from "@/lib/security/logger";
import { PrintService } from "@/lib/services/print-service";
import { agentFailBodySchema } from "@/lib/validation/printing";

export const runtime = "nodejs";

const logger = createLogger("api.printer-agent.fail");

/** A transient failure returns the job to the queue behind a bounded backoff. */
export async function POST(request: Request): Promise<NextResponse> {
  const body = await parseBody(request, agentFailBodySchema, "Hata bildirimi geçersiz.");
  return printerAgentRoute(request, "api.printer-agent.fail", async (agent) => {
    const outcome = await new PrintService().fail(
      agent,
      body.jobId,
      body.errorCode,
      body.errorSummary,
    );

    /*
     * Retry semantics are untouched; only the signal is new.
     *
     * A job that is going to try again is ordinary — a printer out of paper for
     * ninety seconds is not an incident. A job that has stopped retrying is a
     * ticket nobody in the kitchen will ever see, and it is the only one worth
     * waking someone for, so the two get different levels.
     *
     * `errorSummary` is deliberately absent: it is free text supplied by the
     * agent, and the error code already carries the category.
     */
    const exhausted = outcome.status === "FAILED";
    const event = exhausted ? "print_job_retries_exhausted" : "print_job_retry_scheduled";
    const message = exhausted
      ? "A print job stopped retrying and will not print."
      : "A print job failed and was returned to the queue.";

    logger[exhausted ? "error" : "warn"](event, message, {
      jobId: body.jobId,
      errorCode: body.errorCode,
      jobStatus: outcome.status,
      retryAtIso: outcome.retryAtIso,
    });

    return outcome;
  });
}
