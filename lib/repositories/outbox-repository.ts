import type { RepositoryJsonObject } from "./order-repository";

export interface ClaimedOutboxEvent {
  readonly id: string;
  readonly restaurantId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly payload: RepositoryJsonObject;
  readonly attempts: number;
  readonly createdAt: Date;
}

export interface OutboxRepository {
  claimBatch(input: {
    readonly workerId: string;
    readonly limit: number;
    /** Failed deliveries at or above this count remain terminal FAILED rows. */
    readonly maxAttempts: number;
    readonly now: Date;
    readonly staleBefore: Date;
  }): Promise<readonly ClaimedOutboxEvent[]>;
  markPublished(input: {
    readonly eventId: string;
    readonly workerId: string;
    readonly publishedAt: Date;
  }): Promise<boolean>;
  markFailed(input: {
    readonly eventId: string;
    readonly workerId: string;
    readonly failedAt: Date;
    readonly retryAt: Date;
    readonly errorMessage: string;
    /** True once retries are exhausted; the row stops being claimed. */
    readonly deadLettered: boolean;
  }): Promise<boolean>;
  /** Manual recovery: clears the dead-letter marker so the worker retries. */
  requeueDeadLettered(input: {
    readonly restaurantId: string;
    readonly now: Date;
    readonly limit: number;
  }): Promise<number>;
}
