import assert from "node:assert/strict";
import test from "node:test";

import { redactLogValue, redactString } from "../../lib/security/redaction.ts";

test("structured redaction removes credential and QR token fields", () => {
  const qrToken = "A".repeat(43);
  const result = redactLogValue({
    restaurantId: "restaurant-1",
    tableToken: qrToken,
    databaseUrl: "postgresql://app:password@localhost/app",
    nested: { password: "secret", count: 2 },
  });
  assert.deepEqual(result, {
    restaurantId: "restaurant-1",
    tableToken: "[REDACTED]",
    databaseUrl: "[REDACTED]",
    nested: { password: "[REDACTED]", count: 2 },
  });
});

test("free-text redaction removes bearer, JWT-like, query, and 43-char tokens", () => {
  const raw = "B".repeat(43);
  const value = redactString(
    `Bearer abc.def token=${raw} database=postgresql://app:password@example.test/db url=https://example.test/?pin=1234 raw=${raw}`,
  );
  assert.ok(!value.includes("abc.def"));
  assert.ok(!value.includes("1234"));
  assert.ok(!value.includes("password"));
  assert.ok(!value.includes(raw));
});
