import { NextResponse } from "next/server";

import { getDb } from "@/db";
import { apiFailure, apiSuccess } from "@/lib/api/response";
import {
  MAINTENANCE_BATCH,
  MAINTENANCE_OPERATIONS,
  type MaintenanceOperation,
} from "@/lib/config/data-retention";
import { getServerEnvironment } from "@/lib/env/server";
import { isAuthorizedBearerSecret } from "@/lib/security/bearer-secret";
import { createLogger } from "@/lib/security/logger";
import { DataMaintenanceService } from "@/lib/services/data-maintenance-service";

/**
 * Server-to-server data maintenance. Not reachable from a browser session and
 * deliberately not wired to any admin button: this is infrastructure, and the
 * only destructive surface in the product.
 *
 * GET  — health/capacity observability (database internals, so it is secret-
 *        protected rather than admin-visible).
 * POST — retention cleanup. `dryRun` defaults to true; deletion has to be
 *        asked for explicitly with `{"dryRun": false}`.
 *
 * Scheduler-agnostic on purpose: any cron that can send an Authorization header
 * (Supabase cron, Vercel cron, an external scheduler) can drive it.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" } as const;
const logger = createLogger("api.internal.maintenance");

function unauthorized(): NextResponse {
  return NextResponse.json(
    apiFailure({ code: "AUTHENTICATION_REQUIRED", message: "Kimlik doğrulaması gerekli." }),
    { status: 401, headers: NO_STORE_HEADERS },
  );
}

function badRequest(message: string): NextResponse {
  return NextResponse.json(apiFailure({ code: "VALIDATION_ERROR", message }), {
    status: 400,
    headers: NO_STORE_HEADERS,
  });
}

function authorize(request: Request): boolean {
  const secret = getServerEnvironment(["maintenance"]).maintenanceSecret!;
  return isAuthorizedBearerSecret(request.headers.get("authorization"), secret);
}

function failure(error: unknown, event: string): NextResponse {
  logger.error(event, "Maintenance invocation failed.", {
    errorName: error instanceof Error ? error.name : "UnknownError",
  });
  return NextResponse.json(
    apiFailure({ code: "INTERNAL_ERROR", message: "İşlem tamamlanamadı." }),
    { status: 500, headers: NO_STORE_HEADERS },
  );
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    if (!authorize(request)) return unauthorized();
    const report = await new DataMaintenanceService(getDb()).health();
    return NextResponse.json(apiSuccess(report), { status: 200, headers: NO_STORE_HEADERS });
  } catch (error) {
    return failure(error, "health_failed");
  }
}

interface MaintenanceRequestBody {
  dryRun?: unknown;
  batchSize?: unknown;
  maxBatches?: unknown;
  operations?: unknown;
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    if (!authorize(request)) return unauthorized();

    const body: MaintenanceRequestBody = await request.json().catch(() => ({}));

    if (body.dryRun !== undefined && typeof body.dryRun !== "boolean") {
      return badRequest("dryRun boolean olmalıdır.");
    }
    // Fail safe: an empty body, or a scheduler that forgot the flag, reports
    // instead of deleting.
    const dryRun = body.dryRun !== false;

    for (const [name, value, maximum] of [
      ["batchSize", body.batchSize, MAINTENANCE_BATCH.maximum],
      ["maxBatches", body.maxBatches, MAINTENANCE_BATCH.maximumMaxBatches],
    ] as const) {
      if (value !== undefined && (!Number.isInteger(value) || (value as number) < 1 || (value as number) > maximum)) {
        return badRequest(`${name} 1 ile ${maximum} arasında bir tam sayı olmalıdır.`);
      }
    }

    let operations: readonly MaintenanceOperation[] | undefined;
    if (body.operations !== undefined) {
      if (
        !Array.isArray(body.operations) ||
        body.operations.length === 0 ||
        !body.operations.every((value): value is MaintenanceOperation =>
          MAINTENANCE_OPERATIONS.includes(value as MaintenanceOperation),
        )
      ) {
        return badRequest(
          `operations yalnızca şunları içerebilir: ${MAINTENANCE_OPERATIONS.join(", ")}.`,
        );
      }
      operations = body.operations;
    }

    const result = await new DataMaintenanceService(getDb()).run({
      dryRun,
      batchSize: body.batchSize as number | undefined,
      maxBatches: body.maxBatches as number | undefined,
      operations,
    });

    logger.info("maintenance_run", "Data maintenance completed.", {
      dryRun: result.dryRun,
      deleted: result.operations.reduce((sum, operation) => sum + operation.deleted, 0),
      errorCount: result.errors.length,
    });

    return NextResponse.json(apiSuccess(result), { status: 200, headers: NO_STORE_HEADERS });
  } catch (error) {
    return failure(error, "maintenance_failed");
  }
}
