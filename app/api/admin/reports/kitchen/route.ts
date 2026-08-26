import { reportRoute } from "@/lib/api/report-route";
import { ReportDetailService } from "@/lib/services/report-detail-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Kitchen activity from recorded item status events, never from estimates. */
export const GET = reportRoute("kitchen", ({ principal, range }) =>
  new ReportDetailService().getKitchen(principal, range),
);
