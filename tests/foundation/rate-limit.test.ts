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

test("policies cover login, QR, order, waiter call, bill request, the print agent, password reset and auto translation", () => {
  assert.deepEqual(Object.keys(RATE_LIMIT_POLICIES).sort(), [
    "BILL_REQUEST",
    "MENU_AUTO_TRANSLATE",
    "ORDER_CREATE",
    "PRINTER_AGENT",
    "QR_VALIDATE",
    "STAFF_LOGIN",
    "STAFF_LOGIN_IP",
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

/**
 * A restaurant is one public address.
 *
 * Every phone, till and tablet behind the counter shares it, and a shift change
 * is a burst of perfectly correct logins from that one address within a couple
 * of minutes. The address-scoped sweep and the account-scoped one therefore
 * answer different questions and must not share a limit: sizing the sweep like
 * a single account locked the sixth member of staff out of their own till.
 */
test("a shift change does not lock staff out of their own restaurant", async () => {
  const counters = new Map<string, number>();
  const store: SharedRateLimitStore = {
    async consume({ key, limit, windowMs, nowEpochMs }) {
      const count = (counters.get(key) ?? 0) + 1;
      counters.set(key, count);
      return {
        allowed: count <= limit,
        remaining: Math.max(0, limit - count),
        resetAtEpochMs: nowEpochMs + windowMs,
      };
    },
  };
  const secret = "a".repeat(32);
  const addressFingerprint = "one-restaurant-wifi";

  // Exactly the pair of identities the login route consumes per attempt.
  async function attemptLogin(identifier: string): Promise<boolean> {
    const sweep = await consumeRateLimit(
      store,
      { action: "STAFF_LOGIN_IP", actorType: "CLIENT_IP", actorId: addressFingerprint },
      secret,
    );
    const account = await consumeRateLimit(
      store,
      {
        action: "STAFF_LOGIN",
        actorType: "CLIENT_IP",
        actorId: identifier,
        clientFingerprint: addressFingerprint,
      },
      secret,
    );
    return sweep.allowed && account.allowed;
  }

  const shift = ["admin", "mudur", "garson", "garson2", "garson3", "mutfak", "mutfak2", "kasa"];
  for (const identifier of shift) {
    assert.equal(await attemptLogin(identifier), true, `${identifier} was locked out by a colleague`);
  }

  // The sweep is a real ceiling, not a formality: someone working through a
  // list of usernames from one machine still runs into it.
  let sprayBlocked = false;
  for (let attempt = 0; attempt < 40 && !sprayBlocked; attempt += 1) {
    sprayBlocked = !(await attemptLogin(`guess-${attempt}`));
  }
  assert.equal(sprayBlocked, true, "username spraying from one address must still be stopped");

  // And one account is still guessed at only five times, whatever the address.
  counters.clear();
  const perAccount: boolean[] = [];
  for (let attempt = 0; attempt < 6; attempt += 1) {
    perAccount.push(await attemptLogin("admin"));
  }
  assert.deepEqual(perAccount, [true, true, true, true, true, false]);
});
