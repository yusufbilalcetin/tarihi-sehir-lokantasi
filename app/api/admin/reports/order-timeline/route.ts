import { z } from "zod";

import { reportRoute } from "@/lib/api/report-route";
import { validationError } from "@/lib/api/domain-error";
import { ReportDetailService } from "@/lib/services/report-detail-service";
import { validationIssues } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const orderIdSchema = z.string().uuid();

/**
 * One order's full history. The period filter does not apply: an order is
 * shown whole or not at all.
 */
export const GET = reportRoute("order-timeline", ({ principal, searchParams }) => {
  const parsed = orderIdSchema.safeParse(searchParams.get("orderId"));
  if (!parsed.success) {
    throw validationError("Sipariş kimliği geçersiz.", {
      issues: validationIssues(parsed.error).map((issue) => ({ ...issue })),
    });
  }
  return new ReportDetailService().getOrderTimeline(principal, parsed.data);
});
