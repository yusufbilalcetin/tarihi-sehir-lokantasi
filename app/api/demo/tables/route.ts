import { NextResponse } from "next/server";

import { apiFailureFromUnknown, apiSuccess } from "@/lib/api/response";
import { isDemoLauncherEnabled } from "@/lib/config/demo-launcher";
import { createLogger } from "@/lib/security/logger";
import {
  DemoLauncherService,
  demoLauncherDisabledError,
} from "@/lib/services/demo-launcher-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" } as const;
const logger = createLogger("api.demo.tables");

/**
 * The active tables of the prototype restaurant, for the demo launcher only.
 *
 * Returns identity and operational status — never a QR token, and never
 * anything about another restaurant. Answers 404 when the launcher is off, so
 * a disabled deployment does not even admit the route exists.
 */
export async function GET(): Promise<NextResponse> {
  try {
    if (!isDemoLauncherEnabled()) throw demoLauncherDisabledError();
    const result = await new DemoLauncherService().listTables();
    return NextResponse.json(apiSuccess(result), { status: 200, headers: NO_STORE_HEADERS });
  } catch (error) {
    const failure = apiFailureFromUnknown(error);
    if (failure.status >= 500) {
      logger.error("demo_tables.failed", "Demo table list could not be served.", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
    return NextResponse.json(failure.body, { status: failure.status, headers: NO_STORE_HEADERS });
  }
}
