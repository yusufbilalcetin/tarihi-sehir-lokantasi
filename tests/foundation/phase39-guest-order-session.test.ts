import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createCustomerTableSession } from "../../lib/security/customer-session";
import {
  GUEST_ORDER_SESSION_MAX_TTL_SECONDS,
  createGuestOrderSession,
  verifyGuestOrderSession,
} from "../../lib/security/guest-order-session";

/**
 * The ordering context for a guest with no table.
 *
 * The property that matters most is domain separation. Both session kinds are
 * signed with the same secret, so if the signing context were shared, a
 * takeaway cookie would open a table and a table cookie would order takeaway.
 */

const SECRET = "x".repeat(32);
const RESTAURANT = "11111111-1111-4111-8111-111111111111";
const NOW = 1_800_000_000;

test("a signed ordering context round-trips and names only the restaurant", () => {
  const { token, claims } = createGuestOrderSession({ restaurantId: RESTAURANT, nowSeconds: NOW }, SECRET);
  assert.equal(claims.restaurantId, RESTAURANT);
  // No table, ever: that is the whole point of this session kind.
  assert.equal("tableId" in claims, false);
  const verified = verifyGuestOrderSession(token, SECRET, NOW);
  assert.deepEqual(verified, claims);
});

test("a table session is not an ordering session, and neither opens the other", () => {
  const table = createCustomerTableSession(
    { restaurantId: RESTAURANT, tableId: "22222222-2222-4222-8222-222222222222", accessVersion: 1, nowSeconds: NOW },
    SECRET,
  );
  // Same secret, different signing context: the signature cannot cross over.
  assert.equal(verifyGuestOrderSession(table.token, SECRET, NOW), null);
});

test("a tampered or foreign-signed ordering context is refused", () => {
  const { token } = createGuestOrderSession({ restaurantId: RESTAURANT, nowSeconds: NOW }, SECRET);
  assert.equal(verifyGuestOrderSession(token, "y".repeat(32), NOW), null);
  const [version, payload, signature] = token.split(".");
  const forged = Buffer.from(
    JSON.stringify({ version: 1, restaurantId: "99999999-9999-4999-8999-999999999999", issuedAt: NOW, expiresAt: NOW + 600, nonce: "a".repeat(22) }),
    "utf8",
  ).toString("base64url");
  assert.equal(verifyGuestOrderSession(`${version}.${forged}.${signature}`, SECRET, NOW), null);
  assert.equal(verifyGuestOrderSession(`${version}.${payload}`, SECRET, NOW), null);
  assert.equal(verifyGuestOrderSession(`${version}.${payload}.${signature}.extra`, SECRET, NOW), null);
});

test("an ordering context expires, and cannot be minted to outlive the ceiling", () => {
  const { token } = createGuestOrderSession({ restaurantId: RESTAURANT, nowSeconds: NOW, ttlSeconds: 120 }, SECRET);
  assert.ok(verifyGuestOrderSession(token, SECRET, NOW + 60));
  assert.equal(verifyGuestOrderSession(token, SECRET, NOW + 120 + 61), null);
  assert.throws(() =>
    createGuestOrderSession({ restaurantId: RESTAURANT, nowSeconds: NOW, ttlSeconds: GUEST_ORDER_SESSION_MAX_TTL_SECONDS + 1 }, SECRET),
  );
  assert.throws(() => createGuestOrderSession({ restaurantId: RESTAURANT, nowSeconds: NOW, ttlSeconds: 30 }, SECRET));
});

test("a weak secret and a malformed restaurant id are refused at mint time", () => {
  assert.throws(() => createGuestOrderSession({ restaurantId: RESTAURANT }, "short"));
  assert.throws(() => createGuestOrderSession({ restaurantId: "../etc/passwd" }, SECRET));
  assert.throws(() => createGuestOrderSession({ restaurantId: "" }, SECRET));
});

test("the guest boundary reads the restaurant from the cookie, never from the request", () => {
  const source = readFileSync(new URL("../../lib/auth/guest-order-context.ts", import.meta.url), "utf8");
  // The signed claim names a candidate; the live query decides.
  assert.match(source, /readGuestOrderSession\(cookieStore\.get\(GUEST_ORDER_SESSION_COOKIE\)/);
  assert.match(source, /eq\(restaurants\.id, claims\.restaurantId\)/);
  assert.match(source, /eq\(restaurants\.isActive, true\)/);
  // Assert against the code, not the prose that explains it.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
  assert.doesNotMatch(code, /body|searchParams|request\./);
});
