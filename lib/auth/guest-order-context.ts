import "server-only";

import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";

import { getDb } from "@/db";
import { restaurants } from "@/db/schema";
import { DomainError } from "@/lib/api/domain-error";
import { GUEST_ORDER_SESSION_COOKIE } from "@/lib/security/guest-order-session";
import { readGuestOrderSession } from "@/lib/security/guest-order-session.server";

export interface GuestOrderContext {
  readonly restaurantId: string;
  readonly restaurantName: string;
}

function invalidGuestSession(): DomainError {
  return new DomainError(
    "INVALID_TABLE_TOKEN",
    "Sipariş oturumunuz sona ermiş. Lütfen sipariş sayfasını yeniden açın.",
    { httpStatus: 401 },
  );
}

/**
 * The customer boundary for takeaway and courier orders.
 *
 * Same shape as the table boundary it sits beside: the signed cookie names a
 * candidate restaurant, and a live scoped query decides whether that
 * restaurant is still real and still trading. Nothing is taken from the
 * request body — a single-restaurant deployment is not a reason to trust a
 * caller-supplied tenant id, because the code outlives the deployment.
 */
export async function requireGuestOrderContext(): Promise<GuestOrderContext> {
  const cookieStore = await cookies();
  let claims;
  try {
    claims = readGuestOrderSession(cookieStore.get(GUEST_ORDER_SESSION_COOKIE)?.value);
  } catch {
    throw invalidGuestSession();
  }
  if (!claims) throw invalidGuestSession();

  const rows = await getDb()
    .select({ id: restaurants.id, name: restaurants.name })
    .from(restaurants)
    .where(and(eq(restaurants.id, claims.restaurantId), eq(restaurants.isActive, true)))
    .limit(1);

  const row = rows[0];
  if (!row) throw invalidGuestSession();
  return { restaurantId: row.id, restaurantName: row.name };
}
