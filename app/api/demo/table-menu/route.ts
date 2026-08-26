import { NextResponse } from "next/server";
import { z } from "zod";

import { validationError } from "@/lib/api/domain-error";
import { apiFailureFromUnknown, apiSuccess } from "@/lib/api/response";
import { isDemoLauncherEnabled } from "@/lib/config/demo-launcher";
import { createLogger } from "@/lib/security/logger";
import { assertTrustedMutationOrigin } from "@/lib/security/origin";
import { enforceRateLimit } from "@/lib/security/rate-limit.server";
import {
  DemoLauncherService,
  demoLauncherDisabledError,
} from "@/lib/services/demo-launcher-service";
import { uuidSchema, validationIssues } from "@/lib/validation/common";

export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" } as const;
const logger = createLogger("api.demo.table-menu");

/**
 * A table id and nothing else: the restaurant is the server's to decide.
 *
 * The id is checked as a UUID rather than as a loose identifier, so a malformed
 * value is a validation error here instead of a database type error later.
 */
const requestSchema = z.object({ tableId: uuidSchema }).strict();

/**
 * Hands the demo launcher a real `/menu/<token>` path for one active table.
 *
 * The path it returns goes through the ordinary QR gate: the token is
 * validated there, the signed session is issued there, and an invalid or
 * revoked token still lands on the invalid-QR screen. Nothing here shortcuts
 * that, and no raw token is stored.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    if (!isDemoLauncherEnabled()) throw demoLauncherDisabledError();
    assertTrustedMutationOrigin(request);
    await enforceRateLimit(request, "QR_VALIDATE");

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw validationError("Geçersiz JSON gövdesi.");
    }
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      throw validationError("Masa seçimi geçersiz.", {
        issues: validationIssues(parsed.error).map((issue) => ({ ...issue })),
      });
    }

    const result = await new DemoLauncherService().menuPathForTable(parsed.data.tableId);
    return NextResponse.json(
      apiSuccess({
        path: result.path,
        table: { name: result.table.name, tableNumber: result.table.tableNumber },
      }),
      { status: 200, headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    const failure = apiFailureFromUnknown(error);
    if (failure.status >= 500) {
      logger.error("demo_table_menu.failed", "Demo menu link could not be issued.", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
    return NextResponse.json(failure.body, { status: failure.status, headers: NO_STORE_HEADERS });
  }
}
