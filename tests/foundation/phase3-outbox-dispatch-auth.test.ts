import assert from "node:assert/strict";
import test from "node:test";

import { isAuthorizedOutboxDispatch } from "../../lib/realtime/outbox-dispatch-auth";

const secret = "outbox-test-secret-with-at-least-32-bytes";

test("outbox dispatch bearer authentication fails closed", () => {
  assert.equal(isAuthorizedOutboxDispatch(null, secret), false);
  assert.equal(isAuthorizedOutboxDispatch(`Basic ${secret}`, secret), false);
  assert.equal(isAuthorizedOutboxDispatch("Bearer wrong-but-long-enough-secret-value", secret), false);
  assert.equal(isAuthorizedOutboxDispatch(`Bearer ${secret}`, secret), true);
});
