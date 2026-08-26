import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Re-measured in Phase 32 after the runtime connection stopped being `max: 1`
 * and started preparing its statements: a batch of 20 drained end to end in
 * ~1.7s, i.e. ~85ms per event. This is that measurement with wide headroom.
 */
const PER_EVENT_DATABASE_BUDGET_MS = 300;

const route = readFileSync(
  new URL("../../app/api/internal/outbox/dispatch/route.ts", import.meta.url),
  "utf8",
);

test("outbox dispatch worst-case network time stays inside its route budget", () => {
  const maxDurationSeconds = Number(
    route.match(/export const maxDuration = (\d+);/)?.[1],
  );
  const batchSize = Number(
    route.match(/const OUTBOX_BATCH_SIZE = (\d+);/)?.[1],
  );
  const transportTimeoutMs = Number(
    route.match(/const OUTBOX_TRANSPORT_TIMEOUT_MS = ([\d_]+);/)?.[1]?.replaceAll("_", ""),
  );
  const publishConcurrency = Number(
    route.match(/const OUTBOX_PUBLISH_CONCURRENCY = (\d+);/)?.[1],
  );

  assert.ok(Number.isSafeInteger(maxDurationSeconds));
  assert.ok(Number.isSafeInteger(batchSize));
  assert.ok(Number.isSafeInteger(transportTimeoutMs));
  assert.ok(Number.isSafeInteger(publishConcurrency));
  assert.ok(publishConcurrency >= 1, "publish concurrency must be at least one");

  const budgetMs = (maxDurationSeconds - 8) * 1_000;

  // Network: events publish through a bounded pool, so the worst case is the
  // number of rounds that pool needs, not one attempt per event end to end.
  const networkWorstCaseMs =
    Math.ceil(batchSize / publishConcurrency) * transportTimeoutMs;
  assert.ok(
    networkWorstCaseMs <= budgetMs,
    `publish attempts need ${networkWorstCaseMs}ms of the ${budgetMs}ms budget`,
  );

  // Database: claim and acknowledgement are one statement per event and do not
  // shrink with the publish pool. The original guard modelled only the network
  // and would have waved through a batch that cannot finish its database work
  // in time.
  const databaseWorstCaseMs = batchSize * PER_EVENT_DATABASE_BUDGET_MS;
  assert.ok(
    databaseWorstCaseMs <= budgetMs,
    `serialised database work needs ${databaseWorstCaseMs}ms of the ${budgetMs}ms budget`,
  );
});
