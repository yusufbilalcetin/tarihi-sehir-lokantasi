import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * The gap these guard, and the half-built state they keep honest.
 *
 * A guest's orders are currently owned by `(restaurant, table)` plus "not yet
 * settled". That is a proxy for one sitting, not the sitting itself: an order
 * left unsettled when a party leaves stays visible to whoever scans that table
 * next. The signed table session already mints a per-scan nonce, so the
 * ownership fact exists — it was simply never recorded on the order.
 *
 * The column and the migration are prepared; the stamping and the query
 * predicate are deliberately NOT wired, because writing or reading a column
 * the database does not have yet would take the ordering flow down. These
 * tests hold both halves of that: what is ready, and what must stay unwired
 * until the migration is authorised and applied.
 */

function read(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

const context = read("lib/auth/customer-table-context.ts");
const schema = read("db/schema.ts");
const migration = read("db/migrations/0017_customer_session_order_ownership.sql");
const journal = read("db/migrations/meta/_journal.json");
const orderRoute = read("app/api/orders/route.ts");
const customerRepo = read("lib/repositories/drizzle-customer-order-query-repository.ts");

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

test("nothing reads or writes the column while the database lacks it", () => {
  // This is the runtime-safety contract. Until the migration is applied, an
  // INSERT naming this column or a SELECT projecting it would throw 42703 and
  // take down ordering or the customer order view.
  assert.ok(
    !orderRoute.includes("customerSessionNonce"),
    "order creation stamps a column the database may not have yet",
  );
  assert.ok(
    !customerRepo.includes("customerSessionNonce"),
    "the customer query selects a column the database may not have yet",
  );
});

test("no query on orders projects every column", () => {
  // The column above is only inert because every read names its columns. A
  // bare `select()` would start returning it and fail before the migration.
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

test("the customer order query is still tenant and table scoped", () => {
  assert.match(customerRepo, /eq\(orders\.restaurantId, restaurantId\)/);
  assert.match(customerRepo, /eq\(orders\.tableId, tableId\)/);
  assert.match(customerRepo, /inArray\(orders\.status, \[\.\.\.ACTIVE_ORDER_STATUSES\]\)/);
});
