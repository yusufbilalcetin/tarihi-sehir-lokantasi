import { NextResponse } from "next/server";

import { getDb } from "@/db";
import { apiFailureFromUnknown, apiSuccess } from "@/lib/api/response";
import { requireCurrentStaffPrincipal } from "@/lib/auth/current-staff";
import { DrizzleStaffTableRepository } from "@/lib/repositories/drizzle-staff-table-repository";
import { createLogger } from "@/lib/security/logger";
import { StaffTableService } from "@/lib/services/staff-table-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" } as const;
const logger = createLogger("api.staff.tables");

export async function GET(): Promise<NextResponse> {
  try {
    const principal = await requireCurrentStaffPrincipal();
    const service = new StaffTableService(new DrizzleStaffTableRepository(getDb()));
    const tables = await service.listTables(principal);
    return NextResponse.json(apiSuccess({ tables }), {
      status: 200,
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    const failure = apiFailureFromUnknown(error);
    if (failure.status >= 500) {
      logger.error("read_failed", "Staff table list could not be read.", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
    return NextResponse.json(failure.body, {
      status: failure.status,
      headers: NO_STORE_HEADERS,
    });
  }
}
