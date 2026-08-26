import assert from "node:assert/strict";
import test from "node:test";

import { consumeFixedWindow } from "../../lib/security/rate-limit-window";

test("fixed window accepts exactly the configured number of attempts", () => {
  let state = null;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const decision = consumeFixedWindow(state, 5, 60_000, 1_000);
    assert.equal(decision.allowed, true);
    assert.equal(decision.next.count, attempt);
    state = decision.next;
  }
  const rejected = consumeFixedWindow(state, 5, 60_000, 1_000);
  assert.equal(rejected.allowed, false);
  assert.equal(rejected.next.count, 5);
  assert.equal(rejected.retryAfterSeconds, 60);
});

test("fixed window resets only after its expiry", () => {
  const state = { count: 5, windowStartedAtMs: 1_000 };
  assert.equal(consumeFixedWindow(state, 5, 60_000, 60_999).allowed, false);
  const reset = consumeFixedWindow(state, 5, 60_000, 61_000);
  assert.equal(reset.allowed, true);
  assert.deepEqual(reset.next, { count: 1, windowStartedAtMs: 61_000 });
});
