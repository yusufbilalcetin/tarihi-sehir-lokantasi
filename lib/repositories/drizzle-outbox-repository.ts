import "server-only";

import { and, eq, inArray, lt, lte, or, sql } from "drizzle-orm";

import type { Database } from "../../db";
import { outboxEvents } from "../../db/schema";
import type {
  ClaimedOutboxEvent,
  OutboxRepository,
} from "./outbox-repository";

export class DrizzleOutboxRepository implements OutboxRepository {
  constructor(private readonly db: Database) {}

  claimBatch(input: Parameters<OutboxRepository["claimBatch"]>[0]): Promise<readonly ClaimedOutboxEvent[]> {
    return this.db.transaction(async (transaction) => {
      const candidates = await transaction
        .select({ id: outboxEvents.id })
        .from(outboxEvents)
        // Built from the typed operators rather than a raw fragment: a `Date`
        // interpolated into `sql` reaches the driver as an unmapped parameter,
        // and postgres.js rejects it outright — which silently stopped every
        // claim, so nothing was ever published.
        .where(
          and(
            lt(outboxEvents.attempts, input.maxAttempts),
            or(
              and(
                inArray(outboxEvents.status, ["PENDING", "FAILED"]),
                lte(outboxEvents.availableAt, input.now),
              ),
              and(
                eq(outboxEvents.status, "PROCESSING"),
                lt(outboxEvents.lockedAt, input.staleBefore),
              ),
            ),
          ),
        )
        .orderBy(outboxEvents.availableAt, outboxEvents.createdAt)
        .limit(input.limit)
        .for("update", { skipLocked: true });
      if (candidates.length === 0) return [];

      return transaction
        .update(outboxEvents)
        .set({
          status: "PROCESSING",
          lockedAt: input.now,
          lockedBy: input.workerId,
          lastError: null,
          updatedAt: input.now,
        })
        .where(inArray(outboxEvents.id, candidates.map((candidate) => candidate.id)))
        .returning({
          id: outboxEvents.id,
          restaurantId: outboxEvents.restaurantId,
          aggregateType: outboxEvents.aggregateType,
          aggregateId: outboxEvents.aggregateId,
          eventType: outboxEvents.eventType,
          payload: outboxEvents.payload,
          attempts: outboxEvents.attempts,
          createdAt: outboxEvents.createdAt,
        });
    });
  }

  async markPublished(
    input: Parameters<OutboxRepository["markPublished"]>[0],
  ): Promise<boolean> {
    const rows = await this.db
      .update(outboxEvents)
      .set({
        status: "PUBLISHED",
        publishedAt: input.publishedAt,
        lockedAt: null,
        lockedBy: null,
        lastError: null,
        updatedAt: input.publishedAt,
      })
      .where(
        and(
          eq(outboxEvents.id, input.eventId),
          eq(outboxEvents.status, "PROCESSING"),
          eq(outboxEvents.lockedBy, input.workerId),
        ),
      )
      .returning({ id: outboxEvents.id });
    return Boolean(rows[0]);
  }

  async markFailed(input: Parameters<OutboxRepository["markFailed"]>[0]): Promise<boolean> {
    const rows = await this.db
      .update(outboxEvents)
      .set({
        status: "FAILED",
        attempts: sql`${outboxEvents.attempts} + 1`,
        availableAt: input.retryAt,
        lockedAt: null,
        lockedBy: null,
        lastError: input.errorMessage.slice(0, 2_000),
        deadLetteredAt: input.deadLettered ? input.failedAt : null,
        updatedAt: input.failedAt,
      })
      .where(
        and(
          eq(outboxEvents.id, input.eventId),
          eq(outboxEvents.status, "PROCESSING"),
          eq(outboxEvents.lockedBy, input.workerId),
        ),
      )
      .returning({ id: outboxEvents.id });
    return Boolean(rows[0]);
  }

  async requeueDeadLettered(
    input: Parameters<OutboxRepository["requeueDeadLettered"]>[0],
  ): Promise<number> {
    const candidates = await this.db
      .select({ id: outboxEvents.id })
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.restaurantId, input.restaurantId),
          sql`${outboxEvents.deadLetteredAt} is not null`,
        ),
      )
      .orderBy(outboxEvents.createdAt)
      .limit(input.limit);
    if (candidates.length === 0) return 0;

    const rows = await this.db
      .update(outboxEvents)
      .set({
        status: "PENDING",
        attempts: 0,
        availableAt: input.now,
        deadLetteredAt: null,
        lastError: null,
        lockedAt: null,
        lockedBy: null,
        updatedAt: input.now,
      })
      .where(inArray(outboxEvents.id, candidates.map((candidate) => candidate.id)))
      .returning({ id: outboxEvents.id });
    return rows.length;
  }
}
