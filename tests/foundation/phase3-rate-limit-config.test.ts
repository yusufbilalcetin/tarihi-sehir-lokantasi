import assert from "node:assert/strict";
import test from "node:test";

import { validateServerEnvironment } from "../../lib/env/validation";

test("rate-limit secrets remain optional for credential-free builds", () => {
  const result = validateServerEnvironment({});
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.rateLimitKeySecret, undefined);
  }
});

test("configured rate-limit key must be at least 32 bytes", () => {
  const invalid = validateServerEnvironment({ RATE_LIMIT_KEY_SECRET: "short" });
  assert.equal(invalid.success, false);
  if (!invalid.success) {
    assert.equal(invalid.issues.some((issue) => issue.name === "RATE_LIMIT_KEY_SECRET"), true);
  }
});
