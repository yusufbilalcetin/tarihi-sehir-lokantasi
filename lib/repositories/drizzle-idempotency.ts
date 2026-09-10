import { and, eq } from "drizzle-orm";

import { idempotencyKeys } from "@/db/schema";
import type { Database } from "@/db";
import type {
  ClaimIdempotencyInput,
  IdempotencyClaim,
  RepositoryJsonValue,
  RestartIdempotencyInput,
  StoredIdempotencyRecord,
} from "./order-repository";

/**
 * Claiming an idempotency key, written once.
 *
 * The order path had this as three private methods on its own transaction
 * repository. The cash drawer needs exactly the same three — a movement is a
 * money write, and a double-tap or a retry after a swallowed 201 used to append
 * a second `CASH_OUT` that no endpoint can take back. Copying the block would
 * have put the same subtle protocol (claim, restart an expired row, reject a
 * different payload, replay a completed one) in two places, and money paths are
 * the last place two divergent copies belong.
 *
 * These take the transaction handle rather than living on a class, so any
 * repository can delegate to them from inside its own transaction. Every write
 * therefore lands on the same connection as the work it guards.
 */

export type IdempotencyDatabase = Parameters<Parameters<Database["transaction"]>[0]>[0];

const IDEMPOTENCY_SELECTION = {
  id: idempotencyKeys.id,
  requestHash: idempotencyKeys.requestHash,
  status: idempotencyKeys.status,
  responseStatus: idempotencyKeys.responseStatus,
  responseBody: idempotencyKeys.responseBody,
  lockedUntil: idempotencyKeys.lockedUntil,
  expiresAt: idempotencyKeys.expiresAt,
} as const;

export interface CompleteIdempotencyInput {
  readonly id: string;
  readonly restaurantId: string;
  readonly scope: string;
  readonly responseStatus: number;
  readonly responseBody: RepositoryJsonValue;
  readonly resourceType?: string;
  readonly resourceId?: string;
  readonly completedAt: Date;
}

/**
 * Insert-or-lock. The unique index on (restaurant, scope, key hash) is what
 * makes two concurrent identical requests resolve to one winner: the loser's
 * insert conflicts, and it then reads the winner's row `for update`, so it
 * waits rather than racing.
 */
export async function claimIdempotencyRow(
  db: IdempotencyDatabase,
  input: ClaimIdempotencyInput,
): Promise<IdempotencyClaim> {
  const inserted = await db
    .insert(idempotencyKeys)
    .values({
      restaurantId: input.restaurantId,
      scope: input.scope,
      keyHash: input.keyHash,
      requestHash: input.requestHash,
      status: "PROCESSING",
      lockedUntil: input.lockedUntil,
      expiresAt: input.expiresAt,
    })
    .onConflictDoNothing({
      target: [idempotencyKeys.restaurantId, idempotencyKeys.scope, idempotencyKeys.keyHash],
    })
    .returning({ id: idempotencyKeys.id });
  if (inserted[0]) return { acquired: true, id: inserted[0].id };

  const rows = await db
    .select(IDEMPOTENCY_SELECTION)
    .from(idempotencyKeys)
    .where(
      and(
        eq(idempotencyKeys.restaurantId, input.restaurantId),
        eq(idempotencyKeys.scope, input.scope),
        eq(idempotencyKeys.keyHash, input.keyHash),
      ),
    )
    .for("update")
    .limit(1);
  const existing = rows[0] as StoredIdempotencyRecord | undefined;
  if (!existing) throw new Error("Idempotency conflict row disappeared.");
  return { acquired: false, record: existing };
}

/** Re-arms a row whose TTL lapsed, or whose previous attempt never completed. */
export async function restartIdempotencyRow(
  db: IdempotencyDatabase,
  input: RestartIdempotencyInput,
): Promise<void> {
  const rows = await db
    .update(idempotencyKeys)
    .set({
      requestHash: input.requestHash,
      status: "PROCESSING",
      responseStatus: null,
      responseBody: null,
      lockedUntil: input.lockedUntil,
      expiresAt: input.expiresAt,
      updatedAt: input.now,
    })
    .where(and(eq(idempotencyKeys.id, input.id), eq(idempotencyKeys.restaurantId, input.restaurantId)))
    .returning({ id: idempotencyKeys.id });
  if (!rows[0]) throw new Error("Idempotency record could not be restarted.");
}

/** Stores the response so a replay is answered without repeating the write. */
export async function completeIdempotencyRow(
  db: IdempotencyDatabase,
  input: CompleteIdempotencyInput,
): Promise<void> {
  const rows = await db
    .update(idempotencyKeys)
    .set({
      status: "COMPLETED",
      responseStatus: input.responseStatus,
      responseBody: input.responseBody,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      lockedUntil: null,
      updatedAt: input.completedAt,
    })
    .where(
      and(
        eq(idempotencyKeys.id, input.id),
        eq(idempotencyKeys.restaurantId, input.restaurantId),
        eq(idempotencyKeys.scope, input.scope),
      ),
    )
    .returning({ id: idempotencyKeys.id });
  if (!rows[0]) throw new Error("Idempotency record could not be completed.");
}
