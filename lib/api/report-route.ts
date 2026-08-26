import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { DomainError, validationError } from "@/lib/api/domain-error";
import { apiFailureFromUnknown, apiSuccess } from "@/lib/api/response";
import { auditRequestContext } from "@/lib/api/audit-request";
import { requireCurrentStaffPrincipal } from "@/lib/auth/current-staff";
import type { StaffPrincipal } from "@/lib/auth/foundation";
import { REPORT_ROLES } from "@/lib/domain/report-contracts";
import {
  ReportRangeError,
  resolveReportRange,
  type ResolvedReportRange,
} from "@/lib/domain/report-range";
import { createLogger } from "@/lib/security/logger";
import { ReportAnalyticsService } from "@/lib/services/report-analytics-service";
import { reportRangeQuerySchema, validationIssues } from "@/lib/validation";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" } as const;

export interface ReportRequestContext {
  readonly principal: StaffPrincipal;
  readonly range: ResolvedReportRange;
  readonly service: ReportAnalyticsService;
  readonly searchParams: URLSearchParams;
}

/**
 * Shared envelope for every report section: management role, tenant from the
 * session, one resolved period, and a consistent failure shape.
 */
export function reportRoute(
  name: string,
  handler: (context: ReportRequestContext) => Promise<unknown>,
) {
  const logger = createLogger(`api.admin.reports.${name}`);

  return async function GET(request: NextRequest): Promise<NextResponse> {
    const requestId = auditRequestContext(request).requestId;
    try {
      const principal = await requireCurrentStaffPrincipal(REPORT_ROLES);
      const searchParams = request.nextUrl.searchParams;
      const parsed = reportRangeQuerySchema.safeParse({
        ...(searchParams.get("range") ? { range: searchParams.get("range") } : {}),
        ...(searchParams.get("from") ? { from: searchParams.get("from") } : {}),
        ...(searchParams.get("to") ? { to: searchParams.get("to") } : {}),
        ...(searchParams.get("comparison")
          ? { comparison: searchParams.get("comparison") }
          : {}),
      });
      if (!parsed.success) {
        throw validationError("Rapor dönemi geçersiz.", {
          issues: validationIssues(parsed.error).map((issue) => ({ ...issue })),
        });
      }

      const service = new ReportAnalyticsService();
      // Resolved from the first real operation, never a hard-coded epoch.
      const systemStart =
        parsed.data.range === "SINCE_SYSTEM_START"
          ? await service.findSystemStart(principal.restaurantId)
          : null;

      let range: ResolvedReportRange;
      try {
        range = resolveReportRange({
          preset: parsed.data.range,
          now: new Date(),
          from: parsed.data.from,
          to: parsed.data.to,
          systemStart,
          comparison: parsed.data.comparison,
        });
      } catch (error) {
        if (error instanceof ReportRangeError) {
          throw new DomainError("VALIDATION_ERROR", error.message, { httpStatus: 400 });
        }
        throw error;
      }

      const data = await handler({ principal, range, service, searchParams });
      return NextResponse.json(apiSuccess(data), { status: 200, headers: NO_STORE_HEADERS });
    } catch (error) {
      const failure = apiFailureFromUnknown(error);
      if (failure.status >= 500) {
        logger.error("read_failed", `Report section ${name} could not be read.`, {
          requestId,
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
      }
      return NextResponse.json(failure.body, {
        status: failure.status,
        headers: NO_STORE_HEADERS,
      });
    }
  };
}
