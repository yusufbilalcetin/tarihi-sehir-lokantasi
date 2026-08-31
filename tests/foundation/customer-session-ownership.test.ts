import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Who owns a guest's orders, and what keeps that answer honest.
 *
 * A guest's orders used to be owned by `(restaurant, table)` plus "not yet
 * settled". That is a proxy for one sitting, not the sitting itself: an order
 * left unsettled when a party left stayed visible to whoever scanned that
 * table next. The signed table session already mints a per-scan nonce, so the
 * ownership fact existed — it was simply never recorded on the order, and
 * never asked for when reading one back.
 *
 * Migration 0017 added the column; these tests hold the wiring around it. The
 * shape of the guarantee is: the nonce is minted server-side, travels only in
 * the HttpOnly cookie, is stamped onto the order at creation, is required to
 * read one back, and is never sent anywhere a guest or a log can see it.
 */

function read(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

const context = read("lib/auth/customer-table-context.ts");
const schema = read("db/schema.ts");
const migration = read("db/migrations/0017_customer_session_order_ownership.sql");
const journal = read("db/migrations/meta/_journal.json");
const orderRoute = read("app/api/orders/route.ts");
const activeRoute = read("app/api/orders/active/route.ts");
const orderService = read("lib/services/order-service.ts");
const customerRepo = read("lib/repositories/drizzle-customer-order-query-repository.ts");
const queryService = read("lib/services/customer-order-query-service.ts");
const gate = read("proxy.ts");

test("the session nonce comes from the signed cookie and nowhere else", () => {
  assert.match(context, /readonly sessionNonce: string/);
  assert.match(context, /sessionNonce: claims\.nonce/);
  // `claims` is the verified payload of the HttpOnly cookie. Nothing may take
  // this value from anything the caller controls.
  assert.match(context, /readCustomerTableSession\(\s*cookieStore\.get\(/);
  for (const untrusted of ["searchParams", "request.json", "headers.get", "localStorage", "body."]) {
    assert.ok(!context.includes(untrusted), `the session nonce could come from ${untrusted}`);
  }
});

test("the nonce narrows access and never grants it", () => {
  // The restaurant/table/version checks stay ahead of it: the nonce is only
  // ever an extra predicate on an already-authorised row.
  assert.match(context, /eq\(restaurants\.isActive, true\)/);
  assert.match(context, /eq\(restaurantTables\.id, claims\.tableId\)/);
  assert.match(context, /row\.tokenVersion !== claims\.accessVersion/);
  assert.match(context, /invalidCustomerSession\(\)/);
});

test("the ownership column is declared, nullable, and documented as fail-closed", () => {
  assert.match(schema, /customerSessionNonce: varchar\("customer_session_nonce", \{ length: 32 \}\)/);
  // Nullable on purpose: staff orders, takeaway/courier orders and every
  // pre-migration row have no sitting.
  assert.doesNotMatch(
    schema,
    /customerSessionNonce: varchar\("customer_session_nonce", \{ length: 32 \}\)\.notNull\(\)/,
    "a NOT NULL ownership column would reject staff-created orders",
  );
  assert.match(schema, /treat null as "not mine"/);
});

test("the migration is additive only", () => {
  assert.match(migration, /ALTER TABLE "orders" ADD COLUMN "customer_session_nonce" varchar\(32\)/);
  for (const destructive of ["DROP", "NOT NULL", "DELETE", "UPDATE", "TRUNCATE"]) {
    assert.ok(!migration.includes(destructive), `the migration contains ${destructive}`);
  }
  // Journalled, so an authorised `db:migrate` will actually run it — the
  // failure mode of a hand-written file that the migrator never reads.
  assert.match(journal, /0017_customer_session_order_ownership/);
});

test("order creation stamps the sitting from the verified context, never the body", () => {
  // The route reads it off `requireCustomerTableContext`, which is the cookie.
  assert.match(orderRoute, /sessionNonce: context\.sessionNonce/);
  // And the request body has no field that could carry one: the schema is
  // strict, so an extra key is a 400 rather than an override.
  assert.match(orderRoute, /\.strict\(\)/);
  assert.ok(
    !/parsed\.data\.\w*[Nn]once/.test(orderRoute),
    "order creation reads a nonce out of the request body",
  );

  // Only a table sitting owns an order this way; staff and takeaway stay null.
  assert.match(
    orderService,
    /customerSessionNonce:\s*\n?\s*command\.creator\.kind === "CUSTOMER" \? command\.creator\.sessionNonce : null,/,
  );
  // A blank sitting is refused rather than written as an order nobody can read.
  assert.match(orderService, /!command\.creator\.sessionNonce/);
});

test("the customer read requires the sitting and fails closed without one", () => {
  assert.match(activeRoute, /context\.sessionNonce/);
  // Exact equality. `orders.customer_session_nonce = $1` is null for a staff
  // order and for every pre-migration row, and a null comparison is not true,
  // so those rows drop out without a second predicate.
  assert.match(customerRepo, /eq\(orders\.customerSessionNonce, sessionNonce\)/);
  // The service refuses to issue the query at all rather than letting an empty
  // nonce widen it back to the whole table.
  assert.match(queryService, /if \(!sessionNonce\)/);
  assert.match(queryService, /INVALID_TABLE_TOKEN/);
});

test("the customer order query is still tenant and table scoped", () => {
  // The sitting is an addition to these, not a replacement: a nonce guessed or
  // replayed across tenants still meets a restaurant and a table predicate.
  assert.match(customerRepo, /eq\(orders\.restaurantId, restaurantId\)/);
  assert.match(customerRepo, /eq\(orders\.tableId, tableId\)/);
  assert.match(customerRepo, /inArray\(orders\.status, \[\.\.\.ACTIVE_ORDER_STATUSES\]\)/);
});

test("the sitting is part of what makes a request the same request", () => {
  // Two parties at one table share the `CUSTOMER_ORDER:<tableId>` idempotency
  // scope. Without the sitting in the fingerprint, the second party reusing
  // the first party's key would be handed the first party's order back as a
  // successful replay — someone else's order number and total.
  assert.match(
    orderService,
    /sessionNonce:\s*\n?\s*command\.creator\.kind === "CUSTOMER" \? command\.creator\.sessionNonce : null,/,
  );
  assert.match(orderService, /const requestHash = sha256\(requestMaterial\)/);
});

test("the nonce is never sent to the browser and never logged", () => {
  // It is a bearer value for the sitting: anything that echoes it hands the
  // next party at the table the key to the previous party's orders.
  const projected = customerRepo.match(/customerSessionNonce/g) ?? [];
  assert.equal(
    projected.length,
    1,
    "the ownership column appears outside the where clause — it may be projected",
  );
  for (const [name, source] of [
    ["the create route", orderRoute],
    ["the active-order route", activeRoute],
  ] as const) {
    assert.ok(
      !/logger\.\w+\([^)]*[Nn]once/s.test(source),
      `${name} passes the nonce to a log line`,
    );
  }
  // Nothing the guest receives carries it: neither the row the repository
  // hands back nor the shape the route serialises has a field for it.
  assert.doesNotMatch(
    read("lib/repositories/customer-order-query-repository.ts"),
    /readonly (customerSessionNonce|sessionNonce)/,
    "a customer-facing record type carries the sitting nonce",
  );
  assert.doesNotMatch(
    queryService,
    /readonly (customerSessionNonce|sessionNonce)/,
    "the customer-facing result type carries the sitting nonce",
  );
});

test("no query on orders projects every column", () => {
  // A bare `select()` would start returning the ownership column to whichever
  // surface ran it, which is how a bearer value leaks by accident.
  for (const path of [
    "lib/repositories/drizzle-customer-order-query-repository.ts",
    "lib/repositories/drizzle-order-repository.ts",
  ]) {
    const source = read(path);
    assert.doesNotMatch(
      source,
      /\.select\(\)\s*\n?\s*\.from\(orders\)/,
      `${path} selects every order column`,
    );
  }
});

test("a reload keeps the sitting instead of minting a new one", () => {
  // The guest never leaves `/menu/<token>`, so the gate re-runs on every
  // refresh. Re-minting the session there would re-mint the nonce, and the
  // guest would be disowned from the order they had just placed.
  assert.match(gate, /if \(!sessionAlreadyOpen\(request, established\)\) \{/);
  assert.match(gate, /claims\.restaurantId === established\.restaurant\.id/);
  assert.match(gate, /claims\.tableId === established\.table\.id/);
  // A rotated or revoked QR code moves the access version, so the old cookie
  // is not reused: revocation still ends the sitting immediately.
  assert.match(gate, /claims\.accessVersion === established\.table\.accessVersion/);
  // And the QR token itself is still validated first, every time.
  assert.match(gate, /await establishCustomerTableSession\(token\)/);
});
