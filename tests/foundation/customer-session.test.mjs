import assert from "node:assert/strict";
import test from "node:test";

import {
  createCustomerTableSession,
  verifyCustomerTableSession,
} from "../../lib/security/customer-session.ts";

const secretA = "a".repeat(48);
const secretB = "b".repeat(48);
const now = 1_800_000_000;

test("customer session binds restaurant, table, access version, and expiry", () => {
  const { token, claims } = createCustomerTableSession(
    { restaurantId: "restaurant-1", tableId: "table-3", accessVersion: 4, nowSeconds: now },
    secretA,
  );
  assert.deepEqual(verifyCustomerTableSession(token, secretA, now), claims);
  assert.equal(claims.version, 1);
  assert.equal(claims.restaurantId, "restaurant-1");
  assert.equal(claims.tableId, "table-3");
  assert.equal(claims.accessVersion, 4);
});

test("tampered, wrong-secret, future, and expired sessions fail closed", () => {
  const { token } = createCustomerTableSession(
    { restaurantId: "restaurant-1", tableId: "table-3", accessVersion: 1, nowSeconds: now },
    secretA,
  );
  const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
  assert.equal(verifyCustomerTableSession(tampered, secretA, now), null);
  assert.equal(verifyCustomerTableSession(token, secretB, now), null);
  assert.equal(verifyCustomerTableSession(token, secretA, now + 13 * 60 * 60), null);

  const future = createCustomerTableSession(
    { restaurantId: "restaurant-1", tableId: "table-3", accessVersion: 1, nowSeconds: now + 120 },
    secretA,
  ).token;
  assert.equal(verifyCustomerTableSession(future, secretA, now), null);
});

test("customer session rejects unsafe identifiers, TTLs, and weak secrets", () => {
  assert.throws(
    () => createCustomerTableSession({ restaurantId: "../other", tableId: "3", accessVersion: 1 }, secretA),
    /invalid identifier/,
  );
  assert.throws(
    () => createCustomerTableSession({ restaurantId: "r1", tableId: "t1", accessVersion: 1, ttlSeconds: 30 }, secretA),
    /TTL/,
  );
  assert.throws(
    () => createCustomerTableSession({ restaurantId: "r1", tableId: "t1", accessVersion: 1 }, "short"),
    /at least 32 bytes/,
  );
});
