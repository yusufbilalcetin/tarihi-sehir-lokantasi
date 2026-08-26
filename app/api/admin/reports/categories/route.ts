import { reportRoute } from "@/lib/api/report-route";
import { ReportDetailService } from "@/lib/services/report-detail-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Sales grouped by category. Labels are current; figures are historical. */
export const GET = reportRoute("categories", ({ principal, range }) =>
  new ReportDetailService().getCategories(principal, range),
);
