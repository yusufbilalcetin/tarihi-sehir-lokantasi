import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import type {
  ClaimedOutboxEvent,
  OutboxRepository,
} from "../../lib/repositories/outbox-repository";
import {
  OutboxDispatcher,
  type OutboxEventPublisher,
} from "../../lib/services/outbox-dispatcher";

class FakeOutboxRepository implements OutboxRepository {
  published: Parameters<OutboxRepository["markPublished"]>[0][] = [];
  failed: Parameters<OutboxRepository["markFailed"]>[0][] = [];

  constructor(readonly events: readonly ClaimedOutboxEvent[]) {}

  async claimBatch(input: Parameters<OutboxRepository["claimBatch"]>[0]) {
    void input;
    return this.events;
  }

  async markPublished(input: Parameters<OutboxRepository["markPublished"]>[0]) {
    this.published.push(input);
    return true;
  }

  async markFailed(input: Parameters<OutboxRepository["markFailed"]>[0]) {
    this.failed.push(input);
    return true;
  }

  async requeueDeadLettered() {
    return 0;
  }
}

function event(id: string, attempts = 1): ClaimedOutboxEvent {
  return {
    id,
    restaurantId: "restaurant-a",
    aggregateType: "ORDER",
    aggregateId: "order-1",
    eventType: "ORDER_READY",
    payload: { orderId: "order-1" },
    attempts,
    createdAt: new Date("2026-08-13T12:00:00.000Z"),
  };
}

test("outbox dispatcher marks successful delivery with worker ownership", async () => {
  const repository = new FakeOutboxRepository([event("event-1")]);
  const delivered: string[] = [];
  const publisher: OutboxEventPublisher = {
    async publish(value) {
      delivered.push(value.id);
    },
  };
  const dispatcher = new OutboxDispatcher(repository, publisher, {
    clock: () => new Date("2026-08-13T13:00:00.000Z"),
  });
  const result = await dispatcher.dispatch("worker-1234");

  assert.deepEqual(result, { claimed: 1, published: 1, failed: 0, deadLettered: 0 });
  assert.deepEqual(delivered, ["event-1"]);
  assert.equal(repository.published[0]?.workerId, "worker-1234");
  assert.equal(repository.failed.length, 0);
});

test("outbox dispatcher records a sanitized exponential retry without losing the event", async () => {
  const repository = new FakeOutboxRepository([event("event-2", 2)]);
  const publisher: OutboxEventPublisher = {
    async publish() {
      throw new Error("secret payload and credential details");
    },
  };
  const dispatcher = new OutboxDispatcher(repository, publisher, {
    clock: () => new Date("2026-08-13T13:00:00.000Z"),
    retryBaseMs: 1_000,
  });
  const result = await dispatcher.dispatch("worker-1234");

  assert.deepEqual(result, { claimed: 1, published: 0, failed: 1, deadLettered: 0 });
  assert.equal(repository.failed[0]?.errorMessage, "Realtime publish failed (Error).");
  assert.equal(repository.failed[0]?.retryAt.toISOString(), "2026-08-13T13:00:04.000Z");
  assert.equal(repository.published.length, 0);
});

test("outbox dispatcher passes the terminal retry limit to the atomic claim", async () => {
  let claimInput: Parameters<OutboxRepository["claimBatch"]>[0] | undefined;
  const repository = new FakeOutboxRepository([]);
  repository.claimBatch = async (input) => {
    claimInput = input;
    return [];
  };
  const dispatcher = new OutboxDispatcher(repository, { publish: async () => undefined }, {
    clock: () => new Date("2026-08-13T13:00:00.000Z"),
    maxAttempts: 7,
  });

  await dispatcher.dispatch("worker-1234");
  assert.equal(claimInput?.maxAttempts, 7);
});

test("outbox dispatcher rejects limits outside the database constraint", () => {
  const repository = new FakeOutboxRepository([]);
  assert.throws(
    () => new OutboxDispatcher(repository, { publish: async () => undefined }, { maxAttempts: 51 }),
    /between 1 and 50/,
  );
});

test("an event that exhausts its retries is dead-lettered instead of retried forever", async () => {
  const repository = new FakeOutboxRepository([event("event-3", 2)]);
  const publisher: OutboxEventPublisher = {
    async publish() {
      throw new Error("transport down");
    },
  };
  const dispatcher = new OutboxDispatcher(repository, publisher, {
    clock: () => new Date("2026-08-13T13:00:00.000Z"),
    maxAttempts: 3,
  });

  const result = await dispatcher.dispatch("worker-1234");
  assert.deepEqual(result, { claimed: 1, published: 0, failed: 1, deadLettered: 1 });
  assert.equal(repository.failed[0]?.deadLettered, true);
});

test("an event with retries left is not dead-lettered", async () => {
  const repository = new FakeOutboxRepository([event("event-4", 0)]);
  const dispatcher = new OutboxDispatcher(repository, {
    async publish() {
      throw new Error("transport down");
    },
  }, {
    clock: () => new Date("2026-08-13T13:00:00.000Z"),
    maxAttempts: 3,
  });

  const result = await dispatcher.dispatch("worker-1234");
  assert.equal(result.deadLettered, 0);
  assert.equal(repository.failed[0]?.deadLettered, false);
});

test("the claim query hands its timestamps to drizzle, not to a raw fragment", () => {
  // Every case above runs against a fake repository, which is exactly how the
  // real defect hid: the claim query interpolated `Date` values into a raw
  // `sql` template, postgres.js refused the unmapped parameter, and the
  // dispatcher threw before it ever claimed a row. Nothing was published for as
  // long as that shape survived, and no unit test could see it. This one reads
  // the query itself.
  const source = readFileSync(
    path.join(process.cwd(), "lib/repositories/drizzle-outbox-repository.ts"),
    "utf8",
  );
  const claim = source.slice(source.indexOf("claimBatch"), source.indexOf("markPublished"));
  const rawFragments = [...claim.matchAll(/sql`[^`]*`/g)].map((match) => match[0]);
  for (const fragment of rawFragments) {
    assert.doesNotMatch(
      fragment,
      /\$\{input\.(now|staleBefore)\}/,
      `a timestamp is interpolated into a raw fragment: ${fragment}`,
    );
  }
  // And the typed comparisons are still there, so the predicate was not simply
  // deleted to make this pass.
  for (const operator of ["lte(outboxEvents.availableAt", "lt(outboxEvents.lockedAt"]) {
    assert.ok(claim.includes(operator), `the claim must still compare with ${operator}`);
  }
});
