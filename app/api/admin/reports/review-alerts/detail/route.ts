import { reportRoute } from "@/lib/api/report-route";
import { validationError } from "@/lib/api/domain-error";
import { ReportDetailService } from "@/lib/services/report-detail-service";
import { reportReviewDetailQuerySchema, validationIssues } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The individual cancel / void / refund records behind a review prompt. */
export const GET = reportRoute("review-alert-detail", ({ principal, range, searchParams }) => {
  const parsed = reportReviewDetailQuerySchema.safeParse(
    Object.fromEntries(searchParams.entries()),
  );
  if (!parsed.success) {
    throw validationError("İnceleme listesi filtreleri geçersiz.", {
      issues: validationIssues(parsed.error).map((issue) => ({ ...issue })),
    });
  }
  return new ReportDetailService().getReviewDetail(principal, range, {
    staffId: parsed.data.staffId,
    kind: parsed.data.kind,
    page: parsed.data.page,
    pageSize: parsed.data.pageSize,
  });
});
