import assert from "node:assert/strict";
import test from "node:test";

import { DomainError } from "../../lib/api/domain-error";
import { retryAfterHeader } from "../../lib/security/rate-limit-response";

test("rate-limit errors expose only an integer Retry-After header", () => {
  const error = new DomainError("RATE_LIMITED", "Bekleyin.", {
    httpStatus: 429,
    details: { retryAfterSeconds: 42 },
  });
  assert.deepEqual(retryAfterHeader(error), { "Retry-After": "42" });
  assert.deepEqual(retryAfterHeader(new Error("no")), {});
});
