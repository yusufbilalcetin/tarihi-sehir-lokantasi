import { reportRoute } from "@/lib/api/report-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Payment methods, cashiers, and the cancel / void / refund breakdown. */
export const GET = reportRoute("finance", ({ principal, range, service }) =>
  service.getFinance(principal, range),
);
