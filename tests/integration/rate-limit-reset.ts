import { createHash } from "node:crypto";

import postgres from "postgres";

import { createRateLimitKey, type RateLimitAction } from "../../lib/security/rate-limit";

/**
 * Targeted rate-limit reset for HTTP E2E fixtures.
 *
 * The staff-login limiter is deliberately strict — 5 attempts per 15 minutes,
 * counted both per client IP and per identifier — so a suite that signs in as
 * five fixture accounts exhausts the IP bucket long before it finishes. That is
 * the limiter working correctly, not a defect, so nothing here weakens it:
 * instead the exact keys the fixture produced are recomputed and only those
 * rows are removed. The production policy, the limits and the shared store are
 * untouched, and no other row is deleted.
 */

/**
 * How the server sees a local caller depends on which forwarding header the
 * runtime sets, so every plausible loopback spelling is covered rather than
 * guessed. `next start` reports `::1` here; the others are cheap insurance.
 */
const LOOPBACK_ADDRESSES = ["::1", "127.0.0.1", "::ffff:127.0.0.1", "localhost", "unknown"] as const;

/** Mirrors `privacyFingerprint` in rate-limit.server. */
function privacyFingerprint(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 32);
}

function keySecret(): string {
  const secret = process.env.RATE_LIMIT_KEY_SECRET ?? process.env.AUTH_SECRET;
  if (!secret) throw new Error("RATE_LIMIT_KEY_SECRET or AUTH_SECRET is required.");
  return secret;
}

/**
 * Every key `enforceRateLimit` can produce for the given fixture identifiers,
 * for the actions the HTTP suites drive.
 */
export function fixtureRateLimitKeys(
  identifiers: readonly string[],
  restaurantIds: readonly string[] = [],
): string[] {
  const secret = keySecret();
  const keys = new Set<string>();
  const actions: readonly RateLimitAction[] = [
    "STAFF_LOGIN", "QR_VALIDATE", "ORDER_CREATE", "WAITER_CALL", "BILL_REQUEST",
    "STAFF_PASSWORD_RESET", "PRINTER_AGENT",
  ];
  // Some actions scope the bucket to a restaurant, so the tenant is part of the
  // key. Passing none simply produces no tenant-scoped keys.
  const tenants: readonly (string | undefined)[] = [undefined, ...restaurantIds];

  for (const address of LOOPBACK_ADDRESSES) {
    const fingerprint = privacyFingerprint(address);
    // The identifier-independent client-IP bucket staff login consumes first.
    keys.add(
      createRateLimitKey(
        { action: "STAFF_LOGIN", actorType: "CLIENT_IP", actorId: fingerprint },
        secret,
      ),
    );
    for (const action of actions) {
      // The per-actor bucket, whose actorId falls back to the client address
      // when no identifier or table is in scope.
      for (const actorId of [...identifiers, address]) {
        for (const restaurantId of tenants) {
          keys.add(
            createRateLimitKey(
              {
                action,
                actorType: "CLIENT_IP",
                actorId,
                clientFingerprint: fingerprint,
                ...(restaurantId ? { restaurantId } : {}),
              },
              secret,
            ),
          );
        }
      }
    }
  }
  return [...keys];
}

export async function resetFixtureRateLimits(
  sql: ReturnType<typeof postgres>,
  identifiers: readonly string[],
  restaurantIds: readonly string[] = [],
): Promise<number> {
  const keys = fixtureRateLimitKeys(identifiers, restaurantIds);
  // postgres.js binds a JS array as a PostgreSQL array directly.
  const removed = await sql`
    delete from api_rate_limits where key_hash = any(${keys}) returning 1`;
  return removed.length;
}

/**
 * Returns the shared HTTP fixture to its pristine state between suites.
 *
 * The five HTTP suites drive one disposable restaurant, so orders, checks,
 * payments and service requests left by an earlier suite would otherwise be
 * read as the next suite's starting state. Only transactional rows are removed;
 * the catalog, tables and staff the suites depend on are kept.
 */
export async function resetFixtureTransactions(
  sql: ReturnType<typeof postgres>,
  restaurantIds: readonly string[],
): Promise<void> {
  if (restaurantIds.length === 0) return;
  const order = [
    "payment_refunds", "payments", "order_check_items", "order_checks",
    "order_events", "audit_logs", "outbox_events", "idempotency_keys",
    "waiter_calls", "order_items", "orders",
  ];
  for (const table of order) {
    await sql.unsafe(`delete from ${table} where restaurant_id = any($1::uuid[])`, [
      [...restaurantIds],
    ]);
  }
  // Tables carry the live order association, so the badge state resets with it.
  await sql.unsafe(
    `update restaurant_tables set current_status = 'AVAILABLE' where restaurant_id = any($1::uuid[])`,
    [[...restaurantIds]],
  );
}
