import { reportRoute } from "@/lib/api/report-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** KPI cards for the selected period, with an optional comparison. */
export const GET = reportRoute("summary", ({ principal, range, service }) =>
  service.getSummary(principal, range),
);
