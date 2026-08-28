import { NextResponse } from "next/server";

import { apiFailureFromUnknown, apiSuccess } from "@/lib/api/response";
import { requireCurrentStaffPrincipal } from "@/lib/auth/current-staff";
import { resolveAppBaseUrl } from "@/lib/config/app-base-url";
import { createLogger } from "@/lib/security/logger";
import { createTableService } from "@/lib/services/table-service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The response carries live QR credentials, so it never reaches a shared cache.
const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" } as const;
const logger = createLogger("api.admin.tables.qr-codes");

/**
 * The current QR menu address of every table.
 *
 * Read-only on purpose: this is what the admin screen calls to draw, download
 * and print codes, and none of those actions may invalidate a card that is
 * already on a table. Rotation stays behind its own explicit POST.
 *
 * The restaurant comes from the authenticated principal, never from the
 * request, so one restaurant's administrator cannot address another's tables.
 */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const principal = await requireCurrentStaffPrincipal(["ADMIN", "MANAGER"]);
    const { restaurantName, links } = await createTableService().listQrLinks(
      principal,
      principal.restaurantId,
    );
    const baseUrl = resolveAppBaseUrl(request);

    return NextResponse.json(
      apiSuccess({
        restaurantName,
        // accessVersion stays on the server: it is a security counter, not
        // something an administrator should ever read.
        tables: links.map(({ menuPath, accessVersion: _accessVersion, ...table }) => ({
          ...table,
          menuUrl: `${baseUrl}${menuPath}`,
        })),
      }),
      { status: 200, headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    const failure = apiFailureFromUnknown(error);
    if (failure.status >= 500) {
      logger.error("qr_codes_failed", "Table QR links could not be listed.", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
    return NextResponse.json(failure.body, {
      status: failure.status,
      headers: NO_STORE_HEADERS,
    });
  }
}
