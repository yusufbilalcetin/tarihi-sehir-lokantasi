import { z } from "zod";

import { reportRoute } from "@/lib/api/report-route";
import { validationError } from "@/lib/api/domain-error";
import { ReportDetailService } from "@/lib/services/report-detail-service";
import { validationIssues } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const productIdSchema = z.string().uuid();

/** One product's period detail. Works for products removed from the catalog. */
export const GET = reportRoute("product-detail", ({ principal, range, searchParams }) => {
  const parsed = productIdSchema.safeParse(searchParams.get("productId"));
  if (!parsed.success) {
    throw validationError("Ürün kimliği geçersiz.", {
      issues: validationIssues(parsed.error).map((issue) => ({ ...issue })),
    });
  }
  return new ReportDetailService().getProductDetail(principal, range, parsed.data);
});
