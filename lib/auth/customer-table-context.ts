import "server-only";

import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";

import { getDb } from "@/db";
import { restaurants, restaurantTables } from "@/db/schema";
import { DomainError } from "@/lib/api/domain-error";
import { CUSTOMER_TABLE_SESSION_COOKIE } from "@/lib/security/customer-session";
import { readCustomerTableSession } from "@/lib/security/customer-session.server";

export interface CustomerTableContext {
  readonly restaurantId: string;
  readonly tableId: string;
  readonly tokenVersion: number;
  readonly tableName: string;
  readonly tableNumber: number;
}
function invalidCustomerSession(): DomainError {
  return new DomainError(
    "INVALID_TABLE_TOKEN",
    "Masa oturumu geçersiz veya süresi dolmuş. Lütfen QR kodunu yeniden okutun.",
    { httpStatus: 401 },
  );
}

/**
 * Authoritative customer boundary for every table-scoped read or mutation.
 * The signed claims identify the candidate row; the live scoped query enforces
 * restaurant/table activity, token rotation/revocation, and tenant equality.
 */
export async function requireCustomerTableContext(): Promise<CustomerTableContext> {
  const cookieStore = await cookies();
  let claims;
  try {
    claims = readCustomerTableSession(
      cookieStore.get(CUSTOMER_TABLE_SESSION_COOKIE)?.value,
    );
  } catch {
    throw invalidCustomerSession();
  }
  if (!claims) throw invalidCustomerSession();

  const rows = await getDb()
    .select({
      restaurantId: restaurants.id,
      tableId: restaurantTables.id,
      tableName: restaurantTables.name,
      tableNumber: restaurantTables.tableNumber,
      tokenVersion: restaurantTables.qrTokenVersion,
      tokenRevokedAt: restaurantTables.qrTokenRevokedAt,
    })
    .from(restaurantTables)
    .innerJoin(restaurants, eq(restaurants.id, restaurantTables.restaurantId))
    .where(
      and(
        eq(restaurants.id, claims.restaurantId),
        eq(restaurants.isActive, true),
        eq(restaurantTables.restaurantId, claims.restaurantId),
        eq(restaurantTables.id, claims.tableId),
        eq(restaurantTables.isActive, true),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (
    !row ||
    row.tokenRevokedAt ||
    row.tokenVersion !== claims.accessVersion
  ) {
    throw invalidCustomerSession();
  }

  return {
    restaurantId: row.restaurantId,
    tableId: row.tableId,
    tokenVersion: row.tokenVersion,
    tableName: row.tableName,
    tableNumber: row.tableNumber,
  };
}
