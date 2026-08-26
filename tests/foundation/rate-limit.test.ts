import assert from "node:assert/strict";
import test from "node:test";

import {
  RATE_LIMIT_POLICIES,
  consumeRateLimit,
  createRateLimitKey,
  type RateLimitStoreConsumeInput,
  type SharedRateLimitStore,
} from "../../lib/security/rate-limit";

const keySecret = "r".repeat(48);
const identity = {
  action: "ORDER_CREATE",
  restaurantId: "restaurant-a",
  actorType: "TABLE_SESSION",
  actorId: "private-table-session-id",
  clientFingerprint: "client-fingerprint",
} as const;

test("rate-limit keys are stable, tenant scoped, and hide actor identifiers", () => {
  const key = createRateLimitKey(identity, keySecret);
  assert.equal(key, createRateLimitKey(identity, keySecret));
  assert.notEqual(
    key,
    createRateLimitKey({ ...identity, restaurantId: "restaurant-b" }, keySecret),
  );
  assert.equal(key.includes(identity.actorId), false);
  assert.equal(key.includes(identity.clientFingerprint), false);
});

test("policies cover login, QR, order, waiter call, bill request, the print agent and password reset", () => {
  assert.deepEqual(Object.keys(RATE_LIMIT_POLICIES).sort(), [
    "BILL_REQUEST",
    "ORDER_CREATE",
    "PRINTER_AGENT",
    "QR_VALIDATE",
    "STAFF_LOGIN",
    "STAFF_PASSWORD_RESET",
    "WAITER_CALL",
  ]);
  assert.deepEqual(RATE_LIMIT_POLICIES.STAFF_LOGIN, {
    limit: 5,
    windowMs: 15 * 60_000,
  });
});

test("consume delegates the policy to an atomic shared-store port", async () => {
  const received: RateLimitStoreConsumeInput[] = [];
  const store: SharedRateLimitStore = {
    async consume(input) {
      received.push(input);
      return { allowed: false, remaining: 0, resetAtEpochMs: input.nowEpochMs + 12_500 };
    },
  };
  const decision = await consumeRateLimit(store, identity, keySecret, 10_000);
  assert.equal(received[0]?.limit, RATE_LIMIT_POLICIES.ORDER_CREATE.limit);
  assert.equal(received[0]?.windowMs, RATE_LIMIT_POLICIES.ORDER_CREATE.windowMs);
  assert.equal(decision.allowed, false);
  assert.equal(decision.retryAfterSeconds, 13);
});

test("weak key secrets and invalid store results fail closed", async () => {
  assert.throws(() => createRateLimitKey(identity, "short"), /at least 32 bytes/);
  assert.throws(
    () => createRateLimitKey({ ...identity, restaurantId: "" }, keySecret),
    /Restaurant ID/,
  );
  const invalidStore: SharedRateLimitStore = {
    async consume() {
      return { allowed: true, remaining: 999, resetAtEpochMs: 0 };
    },
  };
  await assert.rejects(
    () => consumeRateLimit(invalidStore, identity, keySecret, 10_000),
    /invalid result/,
  );
});
