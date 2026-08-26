import { reportRoute } from "@/lib/api/report-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Hourly, weekday, single busiest date and the daily trend series. */
export const GET = reportRoute("busiest", ({ principal, range, service }) =>
  service.getBusiest(principal, range),
);
