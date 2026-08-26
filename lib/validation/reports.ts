import { z } from "zod";

import {
  REPORT_COMPARISONS,
  REPORT_RANGE_PRESETS,
} from "@/lib/domain/report-range";
import { PRODUCT_SORTS } from "@/lib/domain/report-contracts";

/**
 * One query shape for every report section, so a period means the same thing
 * whichever endpoint is asked. The tenant is never accepted from the client.
 */
export const reportRangeQuerySchema = z
  .object({
    range: z.enum(REPORT_RANGE_PRESETS).default("LAST_30_DAYS"),
    from: z.string().trim().optional(),
    to: z.string().trim().optional(),
    comparison: z.enum(REPORT_COMPARISONS).default("NONE"),
  })
  .strict();

export const reportProductQuerySchema = reportRangeQuerySchema.extend({
  search: z.string().trim().max(120).optional(),
  // Allowlisted sort keys; nothing reaches SQL as free text.
  sort: z.enum(PRODUCT_SORTS).default("QUANTITY_DESC"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  // Catalog products with no sales are opt-in; the default report answers
  // "what sold", not "what exists".
  includeZeroSales: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});

export const reportReviewDetailQuerySchema = reportRangeQuerySchema.extend({
  staffId: z.string().uuid().optional(),
  kind: z.enum(["CANCEL", "VOID", "REFUND"]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export type ReportRangeQuery = z.infer<typeof reportRangeQuerySchema>;
export type ReportProductQuery = z.infer<typeof reportProductQuerySchema>;
export type ReportReviewDetailQuery = z.infer<typeof reportReviewDetailQuerySchema>;
