import assert from "node:assert/strict";
import test from "node:test";

import type {
  ClaimedOutboxEvent,
  OutboxRepository,
} from "../../lib/repositories/outbox-repository";
import {
  OutboxDispatcher,
  type OutboxEventPublisher,
} from "../../lib/services/outbox-dispatcher";

/**
 * The measured problem: the dispatch route published four events per
 * invocation and the cron fires once a minute, so the system consumed four
 * events a minute while ordinary service produced far more — the backlog grew
 * and realtime fell behind. The fix raises the batch and publishes it through a
 * bounded pool, which must not weaken any of the guarantees the serial loop
 * had.
 */

class FakeOutboxRepository implements OutboxRepository {
  published: Parameters<OutboxRepository["markPublished"]>[0][] = [];
  failed: Parameters<OutboxRepository["markFailed"]>[0][] = [];

  constructor(readonly events: readonly ClaimedOutboxEvent[]) {}

  async claimBatch() {
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

const clock = () => new Date("2026-08-13T13:00:00.000Z");

/** Publisher that reports the highest number of simultaneous publishes. */
function trackingPublisher() {
  const state = { inFlight: 0, peak: 0, delivered: [] as string[] };
  const publisher: OutboxEventPublisher = {
    async publish(value) {
      state.inFlight += 1;
      state.peak = Math.max(state.peak, state.inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      state.delivered.push(value.id);
      state.inFlight -= 1;
    },
  };
  return { publisher, state };
}

test("publish concurrency is bounded by its setting", async () => {
  const events = Array.from({ length: 24 }, (_, index) => event(`event-${index}`));
  const repository = new FakeOutboxRepository(events);
  const { publisher, state } = trackingPublisher();

  const result = await new OutboxDispatcher(repository, publisher, {
    clock,
    publishConcurrency: 6,
  }).dispatch("worker-1234");

  assert.equal(result.claimed, 24);
  assert.equal(result.published, 24);
  assert.ok(state.peak <= 6, `peak in-flight was ${state.peak}, above the pool size`);
  assert.ok(state.peak > 1, "the pool never actually ran in parallel");
});

test("every claimed event is delivered exactly once under a pool", async () => {
  const events = Array.from({ length: 17 }, (_, index) => event(`event-${index}`));
  const repository = new FakeOutboxRepository(events);
  const { publisher, state } = trackingPublisher();

  await new OutboxDispatcher(repository, publisher, { clock, publishConcurrency: 5 }).dispatch(
    "worker-1234",
  );

  assert.deepEqual(
    [...state.delivered].sort(),
    [...events.map((e) => e.id)].sort(),
    "an event was dropped or delivered twice",
  );
  assert.equal(new Set(state.delivered).size, 17, "an event was published more than once");
  assert.equal(repository.published.length, 17);
  // Ownership still travels with every acknowledgement.
  assert.ok(repository.published.every((row) => row.workerId === "worker-1234"));
});

test("a pool still retries and dead-letters the failures it hits", async () => {
  const events = [event("ok-1"), event("boom", 49), event("ok-2")];
  const repository = new FakeOutboxRepository(events);
  const publisher: OutboxEventPublisher = {
    async publish(value) {
      if (value.id === "boom") throw new Error("transport down");
    },
  };

  const result = await new OutboxDispatcher(repository, publisher, {
    clock,
    publishConcurrency: 3,
    maxAttempts: 50,
  }).dispatch("worker-1234");

  assert.deepEqual(result, { claimed: 3, published: 2, failed: 1, deadLettered: 1 });
  assert.equal(repository.failed[0]?.deadLettered, true);
  // The message never carries the transport's own text.
  assert.doesNotMatch(String(repository.failed[0]?.errorMessage), /transport down/);
});

test("concurrency stays inside the range the pool allows", () => {
  const repository = new FakeOutboxRepository([]);
  const publisher: OutboxEventPublisher = { async publish() {} };
  for (const bad of [0, -1, 17, 1.5]) {
    assert.throws(
      () => new OutboxDispatcher(repository, publisher, { publishConcurrency: bad }),
      TypeError,
      `publishConcurrency ${bad} was accepted`,
    );
  }
});

test("the default is the serial loop, so nothing changes for existing callers", async () => {
  const events = Array.from({ length: 5 }, (_, index) => event(`event-${index}`));
  const { publisher, state } = trackingPublisher();

  await new OutboxDispatcher(new FakeOutboxRepository(events), publisher, { clock }).dispatch(
    "worker-1234",
  );

  assert.equal(state.peak, 1, "the default must publish one event at a time");
});
