import assert from "node:assert/strict";
import test from "node:test";

import {
  createIdempotencyFingerprint,
  createIdempotencyScopeKey,
  decideIdempotency,
  type IdempotencyIdentity,
  type IdempotencyRecord,
} from "../../lib/domain/idempotency";

const identity: IdempotencyIdentity = {
  restaurantId: "restaurant-a",
  actorId: "table-session-a",
  operation: "CREATE_ORDER",
  key: "order-click-123",
};

test("request fingerprints are stable across object key order", () => {
  const first = createIdempotencyFingerprint({ items: [{ quantity: 1, productId: "p1" }], note: null });
  const second = createIdempotencyFingerprint({ note: null, items: [{ productId: "p1", quantity: 1 }] });

  assert.equal(first, second);
  assert.notEqual(first, createIdempotencyFingerprint({ items: [{ quantity: 2, productId: "p1" }], note: null }));
});

test("fingerprints reject non-JSON and circular payloads", () => {
  const circular: Record<string, unknown> = {};
  circular.self = circular;

  assert.throws(() => createIdempotencyFingerprint(circular), /circular/);
  assert.throws(() => createIdempotencyFingerprint({ value: undefined }), /JSON-serializable/);
  assert.throws(() => createIdempotencyFingerprint({ value: Number.NaN }), /finite/);
});

test("scope key includes restaurant, actor, operation, and client key", () => {
  assert.equal(createIdempotencyScopeKey(identity), JSON.stringify(Object.values(identity)));
  assert.notEqual(
    createIdempotencyScopeKey(identity),
    createIdempotencyScopeKey({ ...identity, restaurantId: "restaurant-b" }),
  );
});

test("idempotency decisions execute, wait, replay, or conflict deterministically", () => {
  const base = {
    identity,
    requestFingerprint: "same-request",
    createdAtEpochMs: 1_000,
    expiresAtEpochMs: 11_000,
  } as const;

  assert.deepEqual(decideIdempotency(null, "same-request", 2_000), { action: "EXECUTE" });

  const inProgress: IdempotencyRecord<{ orderId: string }> = {
    ...base,
    status: "PROCESSING",
  };
  assert.deepEqual(decideIdempotency(inProgress, "same-request", 2_000), {
    action: "IN_FLIGHT",
    retryAfterMs: 9_000,
  });
  assert.deepEqual(decideIdempotency(inProgress, "different-request", 2_000), {
    action: "CONFLICT",
  });

  const completed: IdempotencyRecord<{ orderId: string }> = {
    ...base,
    status: "COMPLETED",
    response: { orderId: "order-1" },
  };
  assert.deepEqual(decideIdempotency(completed, "same-request", 2_000), {
    action: "REPLAY",
    response: { orderId: "order-1" },
  });
  assert.deepEqual(decideIdempotency(completed, "same-request", 11_000), {
    action: "EXECUTE",
  });

  const failed: IdempotencyRecord<{ orderId: string }> = {
    ...base,
    status: "FAILED",
    failureCode: "TRANSIENT_DATABASE_ERROR",
  };
  assert.deepEqual(decideIdempotency(failed, "same-request", 2_000), {
    action: "EXECUTE",
  });
  assert.deepEqual(decideIdempotency(failed, "different-request", 2_000), {
    action: "CONFLICT",
  });
});
