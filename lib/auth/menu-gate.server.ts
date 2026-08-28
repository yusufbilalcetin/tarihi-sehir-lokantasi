import "server-only";

import { DomainError } from "@/lib/api/domain-error";
import {
  CUSTOMER_TABLE_SESSION_TTL_SECONDS,
} from "@/lib/security/customer-session";
import { issueCustomerTableSession } from "@/lib/security/customer-session.server";
import { createTableService } from "@/lib/services/table-service.server";
import { tableTokenSchema } from "@/lib/validation/common";

export interface EstablishedCustomerTableSession {
  readonly restaurant: {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
    readonly currency: string;
    readonly timezone: string;
  };
  readonly table: {
    readonly id: string;
    readonly name: string;
    readonly tableNumber: number;
    readonly seats: number;
    readonly accessVersion: number;
  };
  readonly sessionToken: string;
  readonly expiresAt: string;
}

function invalidQrToken(): DomainError {
  return new DomainError(
    "INVALID_TABLE_TOKEN",
    "Bu QR kodu geçerli değil veya kullanım dışı.",
    { httpStatus: 404 },
  );
}

/**
 * Validates the one-time URL credential and exchanges it for the shorter-lived
 * signed table session. The raw token is deliberately absent from the return
 * value and must never be logged by callers.
 */
export async function establishCustomerTableSession(
  rawToken: unknown,
): Promise<EstablishedCustomerTableSession> {
  const parsedToken = tableTokenSchema.safeParse(rawToken);
  if (!parsedToken.success) throw invalidQrToken();

  const tableSession = await createTableService().validateToken(parsedToken.data);
  const signedSession = issueCustomerTableSession({
    restaurantId: tableSession.restaurant.id,
    tableId: tableSession.table.id,
    accessVersion: tableSession.table.accessVersion,
    ttlSeconds: CUSTOMER_TABLE_SESSION_TTL_SECONDS,
  });

  return {
    restaurant: tableSession.restaurant,
    table: tableSession.table,
    sessionToken: signedSession.token,
    expiresAt: new Date(signedSession.claims.expiresAt * 1_000).toISOString(),
  };
}
