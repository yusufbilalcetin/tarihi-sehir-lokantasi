import { reportRoute } from "@/lib/api/report-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Rate-based review prompts. Never a verdict; see lib/domain/report-review. */
export const GET = reportRoute("review-alerts", ({ principal, range, service }) =>
  service.getReviewAlerts(principal, range),
);
