import type { NextResponse } from "next/server";

import { adminMutation, adminRead, parseBody, parseParams } from "@/lib/api/admin-route";
import { PrintService } from "@/lib/services/print-service";
import { entityIdSchema } from "@/lib/validation/common";
import { printJobActionBodySchema } from "@/lib/validation/printing";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
): Promise<NextResponse> {
  const { jobId } = await context.params;
  return adminRead("api.admin.print-jobs", async ({ principal }) => ({
    attempts: await new PrintService().attempts(
      principal,
      parseParams(jobId, entityIdSchema, "İş kimliği geçersiz."),
    ),
  }));
}

/**
 * RETRY re-delivers the same job; REPRINT creates a new one carrying the
 * original snapshot and a mandatory reason. The original is never rewritten.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
): Promise<NextResponse> {
  const { jobId } = await context.params;
  return adminMutation(request, "api.admin.print-jobs", async ({ principal }) => {
    const body = await parseBody(request, printJobActionBodySchema, "Yazdırma işlemi geçersiz.");
    const id = parseParams(jobId, entityIdSchema, "İş kimliği geçersiz.");
    const service = new PrintService();
    return body.action === "RETRY"
      ? service.retry(principal, id)
      : service.reprint(principal, id, body.reason);
  });
}
