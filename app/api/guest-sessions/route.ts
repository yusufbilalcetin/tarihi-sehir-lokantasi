import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/db";
import { restaurants, restaurantSettings } from "@/db/schema";
import { DomainError, isDomainError, validationError } from "@/lib/api/domain-error";
import { apiFailureFromUnknown, apiSuccess } from "@/lib/api/response";
import { createLogger } from "@/lib/security/logger";
import { assertTrustedMutationOrigin } from "@/lib/security/origin";
import { enforceRateLimit } from "@/lib/security/rate-limit.server";
import { retryAfterHeader } from "@/lib/security/rate-limit-response";
import {
  GUEST_ORDER_SESSION_COOKIE,
  GUEST_ORDER_SESSION_TTL_SECONDS,
} from "@/lib/security/guest-order-session";
import { issueGuestOrderSession } from "@/lib/security/guest-order-session.server";
import { validationIssues } from "@/lib/validation/common";

export const runtime = "nodejs";

/**
 * Opens an ordering context for a guest who has no table.
 *
 * The public slug is the only thing the caller supplies, and it is a lookup
 * key, not an authorisation: the server decides which restaurant it names,
 * whether that restaurant is trading, and whether it is taking online orders
 * at all. What comes back to the browser is a signed HttpOnly cookie; from
 * then on the restaurant is read from the signature, never from a request.
 */
const bodySchema = z
  .object({ restaurantSlug: z.string().trim().min(1).max(120) })
  .strict();

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie, Origin",
} as const;
const logger = createLogger("api.guest.sessions");

export async function POST(request: Request): Promise<NextResponse> {
  try {
    assertTrustedMutationOrigin(request);
    // The same budget the table-side entry point spends: this is the other
    // door into an ordering session, and it is the only public endpoint that
    // queries the database before anything has been authenticated. Keyed by
    // client address, because there is no session to key it by yet.
    await enforceRateLimit(request, "QR_VALIDATE");

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw validationError("Geçersiz JSON gövdesi.");
    }
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      throw validationError("Restoran bilgisi geçersiz.", {
        issues: validationIssues(parsed.error).map((issue) => ({
          path: issue.path,
          code: issue.code,
          message: issue.message,
        })),
      });
    }

    const rows = await getDb()
      .select({
        id: restaurants.id,
        name: restaurants.name,
        currency: restaurants.currency,
        orderingEnabled: restaurantSettings.orderingEnabled,
      })
      .from(restaurants)
      .leftJoin(restaurantSettings, eq(restaurantSettings.restaurantId, restaurants.id))
      .where(and(eq(restaurants.slug, parsed.data.restaurantSlug), eq(restaurants.isActive, true)))
      .limit(1);

    const restaurant = rows[0];
    // One message for "no such restaurant" and "not trading": a stranger
    // should not be able to enumerate slugs by reading the difference.
    if (!restaurant || !restaurant.orderingEnabled) {
      throw new DomainError("CONFLICT", "Bu restoran şu anda online sipariş almıyor.", {
        httpStatus: 409,
      });
    }

    const session = issueGuestOrderSession({ restaurantId: restaurant.id });
    const response = NextResponse.json(
      apiSuccess({
        restaurant: { name: restaurant.name, currency: restaurant.currency },
        session: { expiresAt: new Date(session.claims.expiresAt * 1_000).toISOString() },
      }),
      { status: 200, headers: NO_STORE_HEADERS },
    );
    response.cookies.set({
      name: GUEST_ORDER_SESSION_COOKIE,
      value: session.token,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: GUEST_ORDER_SESSION_TTL_SECONDS,
    });
    return response;
  } catch (error) {
    if (!isDomainError(error) || error.httpStatus >= 500) {
      logger.error("session_failed", "Guest ordering session could not be opened.", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
    const failure = apiFailureFromUnknown(error);
    return NextResponse.json(failure.body, {
      status: failure.status,
      headers: { ...NO_STORE_HEADERS, ...retryAfterHeader(error) },
    });
  }
}
