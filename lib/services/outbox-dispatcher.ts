import type {
  ClaimedOutboxEvent,
  OutboxRepository,
} from "../repositories/outbox-repository";

export interface OutboxEventPublisher {
  publish(event: ClaimedOutboxEvent): Promise<void>;
}

export interface OutboxDispatcherOptions {
  readonly clock?: () => Date;
  readonly batchSize?: number;
  readonly staleLockMs?: number;
  readonly retryBaseMs?: number;
  readonly retryMaximumMs?: number;
  readonly maxAttempts?: number;
  /**
   * How many claimed events may be in flight at once. Publishing is a network
   * round trip per event and the events of one batch are independent
   * broadcasts, so a small pool multiplies throughput without touching the
   * claim, the ownership check or the at-least-once acknowledgement — each
   * event is still marked on its own. Defaults to 1, i.e. the serial loop.
   */
  readonly publishConcurrency?: number;
}

export interface OutboxDispatchResult {
  readonly claimed: number;
  readonly published: number;
  readonly failed: number;
  readonly deadLettered: number;
}

function safeErrorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : "UnknownError";
  return `Realtime publish failed (${name}).`;
}

export class OutboxDispatcher {
  private readonly clock: () => Date;
  private readonly batchSize: number;
  private readonly staleLockMs: number;
  private readonly retryBaseMs: number;
  private readonly retryMaximumMs: number;
  private readonly maxAttempts: number;
  private readonly publishConcurrency: number;

  constructor(
    private readonly repository: OutboxRepository,
    private readonly publisher: OutboxEventPublisher,
    options: OutboxDispatcherOptions = {},
  ) {
    this.clock = options.clock ?? (() => new Date());
    this.batchSize = options.batchSize ?? 50;
    this.staleLockMs = options.staleLockMs ?? 60_000;
    this.retryBaseMs = options.retryBaseMs ?? 5_000;
    this.retryMaximumMs = options.retryMaximumMs ?? 15 * 60_000;
    this.maxAttempts = options.maxAttempts ?? 50;
    this.publishConcurrency = options.publishConcurrency ?? 1;

    if (
      !Number.isInteger(this.publishConcurrency) ||
      this.publishConcurrency < 1 ||
      this.publishConcurrency > 16
    ) {
      throw new TypeError("Outbox publish concurrency must be an integer between 1 and 16.");
    }
    if (!Number.isInteger(this.batchSize) || this.batchSize < 1 || this.batchSize > 100) {
      throw new TypeError("Outbox batch size must be an integer between 1 and 100.");
    }
    if (!Number.isInteger(this.maxAttempts) || this.maxAttempts < 1 || this.maxAttempts > 50) {
      throw new TypeError("Outbox maximum attempts must be an integer between 1 and 50.");
    }
    if (this.staleLockMs < 1_000 || this.retryBaseMs < 100 || this.retryMaximumMs < this.retryBaseMs) {
      throw new TypeError("Outbox timing configuration is invalid.");
    }
  }

  async dispatch(workerId: string): Promise<OutboxDispatchResult> {
    if (!/^[A-Za-z0-9._:-]{8,120}$/.test(workerId)) {
      throw new TypeError("Outbox worker id is invalid.");
    }
    const now = this.clock();
    const events = await this.repository.claimBatch({
      workerId,
      limit: this.batchSize,
      maxAttempts: this.maxAttempts,
      now,
      staleBefore: new Date(now.getTime() - this.staleLockMs),
    });
    let published = 0;
    let failed = 0;
    let deadLettered = 0;

    // A shared cursor rather than chunking: a slow event holds up only its own
    // worker, so the pool keeps every slot busy.
    let next = 0;
    const workerCount = Math.min(this.publishConcurrency, events.length);
    const runOne = async (event: ClaimedOutboxEvent): Promise<void> => {
      try {
        await this.publisher.publish(event);
        const marked = await this.repository.markPublished({
          eventId: event.id,
          workerId,
          publishedAt: this.clock(),
        });
        if (marked) published += 1;
      } catch (error) {
        const failedAt = this.clock();
        // attempts counts completed delivery failures; this failure is the
        // next retry step. Capping prevents unsafe numeric growth.
        const exponent = Math.max(0, Math.min(event.attempts, 10));
        const retryDelay = Math.min(this.retryBaseMs * (2 ** exponent), this.retryMaximumMs);
        // This failure is the attempt that gets recorded, so exhaustion is
        // decided on the incremented count.
        const exhausted = event.attempts + 1 >= this.maxAttempts;
        const marked = await this.repository.markFailed({
          eventId: event.id,
          workerId,
          failedAt,
          retryAt: new Date(failedAt.getTime() + retryDelay),
          errorMessage: safeErrorMessage(error),
          deadLettered: exhausted,
        });
        if (marked) {
          failed += 1;
          if (exhausted) deadLettered += 1;
        }
      }
    };
    // Bounded on purpose: never Promise.all over the whole batch, or a large
    // batch would open as many sockets as it has events.
    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        for (let index = next++; index < events.length; index = next++) {
          await runOne(events[index]);
        }
      }),
    );

    return { claimed: events.length, published, failed, deadLettered };
  }
}
