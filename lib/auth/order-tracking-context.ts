import "server-only";

import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";

import { getDb } from "@/db";
import { restaurants } from "@/db/schema";
import { DomainError } from "@/lib/api/domain-error";
import { ORDER_TRACKING_COOKIE } from "@/lib/security/order-tracking-token";
import { readOrderTrackingToken } from "@/lib/security/order-tracking-token.server";

export interface OrderTrackingContext {
  readonly restaurantId: string;
  readonly orderId: string;
}

function invalidTrackingCapability(): DomainError {
  return new DomainError(
    "AUTHENTICATION_REQUIRED",
    "Sipariş takibi süresi doldu. Takip bağlantısını yeniden açın.",
    { httpStatus: 401 },
  );
}

/**
 * The customer boundary for tracking one takeaway or courier order.
 *
 * It authorises on the signature and nothing else. An order number is not
 * accepted here and never will be: ORD-000105 is printed on a receipt and the
 * next guest's is ORD-000106, so a surface that took it would let anyone walk
 * the sequence. Neither is a name, a telephone number or an address, which are
 * equally not secrets. The order the caller may see is the one their own
 * capability names, in the restaurant that capability names, and that
 * restaurant must still be trading.
 */
export async function requireOrderTrackingContext(): Promise<OrderTrackingContext> {
  const cookieStore = await cookies();
  let claims;
  try {
    claims = readOrderTrackingToken(cookieStore.get(ORDER_TRACKING_COOKIE)?.value);
  } catch {
    throw invalidTrackingCapability();
  }
  if (!claims) throw invalidTrackingCapability();

  const rows = await getDb()
    .select({ id: restaurants.id })
    .from(restaurants)
    .where(and(eq(restaurants.id, claims.restaurantId), eq(restaurants.isActive, true)))
    .limit(1);
  if (!rows[0]) throw invalidTrackingCapability();
  return { restaurantId: claims.restaurantId, orderId: claims.orderId };
}
