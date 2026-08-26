import { NextRequest, NextResponse } from "next/server";

import { getDb } from "@/db";
import { validationError } from "@/lib/api/domain-error";
import { apiFailureFromUnknown, apiSuccess } from "@/lib/api/response";
import { auditRequestContext } from "@/lib/api/audit-request";
import { requireCurrentStaffPrincipal } from "@/lib/auth/current-staff";
import { DrizzleStaffCallRepository } from "@/lib/repositories/drizzle-staff-call-repository";
import { createLogger } from "@/lib/security/logger";
import { assertTrustedMutationOrigin } from "@/lib/security/origin";
import { StaffCallService } from "@/lib/services/staff-call-service";
import {
  staffCallCreateBodySchema,
  staffCallListQuerySchema,
  validationIssues,
} from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" } as const;
const logger = createLogger("api.staff.calls");

/**
 * Opens a service request from a staff device. Repeating the call while one is
 * already active replays that request with 200 instead of creating a duplicate.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    assertTrustedMutationOrigin(request);
    const principal = await requireCurrentStaffPrincipal();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw validationError("Geçersiz JSON gövdesi.");
    }
    const parsed = staffCallCreateBodySchema.safeParse(body);
    if (!parsed.success) {
      throw validationError("Servis isteği bilgileri geçersiz.", {
        issues: validationIssues(parsed.error).map((issue) => ({ ...issue })),
      });
    }

    const service = new StaffCallService(new DrizzleStaffCallRepository(getDb()));
    const created = await service.createCall(principal, {
      ...parsed.data,
      requestId: auditRequestContext(request).requestId,
    });
    return NextResponse.json(apiSuccess(created.call), {
      status: created.created ? 201 : 200,
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    const failure = apiFailureFromUnknown(error);
    if (failure.status >= 500) {
      logger.error("create_failed", "Staff service request could not be created.", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
    return NextResponse.json(failure.body, {
      status: failure.status,
      headers: NO_STORE_HEADERS,
    });
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const principal = await requireCurrentStaffPrincipal();
    const parsed = staffCallListQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams.entries()),
    );
    if (!parsed.success) {
      throw validationError("Servis isteği filtreleri geçersiz.", {
        issues: validationIssues(parsed.error).map((issue) => ({ ...issue })),
      });
    }

    const service = new StaffCallService(new DrizzleStaffCallRepository(getDb()));
    const calls = await service.listCalls(principal, parsed.data);
    return NextResponse.json(apiSuccess({ calls }), {
      status: 200,
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    const failure = apiFailureFromUnknown(error);
    if (failure.status >= 500) {
      logger.error("read_failed", "Staff service requests could not be read.", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
    return NextResponse.json(failure.body, {
      status: failure.status,
      headers: NO_STORE_HEADERS,
    });
  }
}
