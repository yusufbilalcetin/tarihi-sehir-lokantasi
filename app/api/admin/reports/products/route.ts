import { reportRoute } from "@/lib/api/report-route";
import { validationError } from "@/lib/api/domain-error";
import { reportProductQuerySchema, validationIssues } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every product sold in the period, searchable, sortable and paginated. */
export const GET = reportRoute("products", ({ principal, range, service, searchParams }) => {
  const parsed = reportProductQuerySchema.safeParse(
    Object.fromEntries(searchParams.entries()),
  );
  if (!parsed.success) {
    throw validationError("Ürün raporu filtreleri geçersiz.", {
      issues: validationIssues(parsed.error).map((issue) => ({ ...issue })),
    });
  }
  return service.getProducts(principal, range, {
    search: parsed.data.search,
    sort: parsed.data.sort,
    page: parsed.data.page,
    pageSize: parsed.data.pageSize,
    includeZeroSales: parsed.data.includeZeroSales,
  });
});
