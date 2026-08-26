import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * Phase 33, sections 14-15 — the round-trip budget, guarded structurally.
 *
 * An endpoint's latency here is very close to `round trips × RTT`, so the
 * number worth protecting is the round-trip count, not a millisecond figure.
 * Milliseconds belong to the machine and the region the test happens to run in;
 * asserting them would make this suite fail on a fast laptop and pass on a slow
 * one while the actual regression — a `Promise.all` quietly unwound back into a
 * sequence of `await`s — went unnoticed either way.
 *
 * Measured budget these assertions defend (Phase 32, warm pool):
 *
 *   GET  /api/menu                      5 statements   2 round trips
 *   POST /api/orders                   14 statements   7 round trips
 *   GET  /api/staff/tables              2 statements   2 round trips
 *   GET  /api/staff/orders              3 statements   3 round trips
 *   GET  /api/cashier/shifts/current    8 statements   3 round trips
 *   GET  /api/admin/staff               4 statements   2 round trips
 *   GET  /api/admin/reports/summary     4 statements   2 round trips
 *   GET  /api/admin/reports/finance    10 statements   2 round trips
 *
 * Each check below is the structural reason one of those round-trip numbers is
 * what it is. If a check fails, the corresponding endpoint has grown a round
 * trip.
 */

function read(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

/** Every `Promise.all([...])` argument list in the source, brackets balanced. */
function parallelBlocks(source: string): string[] {
  const blocks: string[] = [];
  const opener = "Promise.all([";
  let cursor = source.indexOf(opener);
  while (cursor !== -1) {
    let depth = 1;
    let index = cursor + opener.length;
    while (index < source.length && depth > 0) {
      const character = source[index];
      if (character === "[" || character === "(") depth += 1;
      else if (character === "]" || character === ")") depth -= 1;
      index += 1;
    }
    blocks.push(source.slice(cursor + opener.length, index - 1));
    cursor = source.indexOf(opener, index);
  }
  return blocks;
}

/** Asserts one `Promise.all` carries all of these calls, i.e. one round trip. */
function assertIssuedTogether(
  relativePath: string,
  calls: readonly string[],
  why: string,
): void {
  const blocks = parallelBlocks(read(relativePath));
  const matching = blocks.find((block) => calls.every((call) => block.includes(call)));
  assert.ok(
    matching,
    `${relativePath}: ${calls.join(", ")} are no longer issued together — ${why}`,
  );
}

test("the runtime connection prepares its statements and holds more than one", () => {
  const source = read("db/index.ts");

  // Unprepared parameterised statements cost two round trips each, and the
  // Sync that follows the Describe also stops anything else pipelining behind
  // them — so this single default sets the floor for every budget above.
  assert.match(
    source,
    /process\.env\.DATABASE_PREPARED_STATEMENTS !== "0"/,
    "prepared statements must stay on unless explicitly disabled",
  );
  assert.match(source, /prepare: prepared/, "the pool must take the prepared flag");
  assert.match(
    source,
    /property === "unsafe"[\s\S]{0,220}prepare: true/,
    "drizzle issues everything through unsafe(), which needs the per-call opt-in",
  );

  // A single connection serialises transactions: ten concurrent orders queued
  // behind each other for 2.8s when this was 1.
  const fallback = source.match(/Number\.isInteger\(configured\) && configured > 0 \? configured : (\d+)/);
  assert.ok(fallback, "the pool size default must stay readable");
  assert.ok(
    Number(fallback![1]) > 1,
    `default pool size is ${fallback![1]}; one connection serialises every transaction`,
  );
});

test("order create keeps its two parallel groups", () => {
  assertIssuedTogether(
    "lib/services/order-service.ts",
    ["findOrderContext", "findOrderProducts"],
    "the table/settings lookup and the product lookup do not depend on each other",
  );
  assertIssuedTogether(
    "lib/services/order-service.ts",
    [
      "insertOrderItems",
      "markTableWaiting",
      "insertOrderEvent",
      "insertOutboxEvent",
      "completeIdempotency",
    ],
    "every write below the order row hangs off it and none reads another",
  );
});

test("collecting money writes its three trailing records in one trip", () => {
  // Shortening this also shortens how long the transaction holds the order and
  // table rows while a second cashier waits on them.
  assertIssuedTogether(
    "lib/services/payment-service.ts",
    ["insertOrderEvent", "insertOutboxEvent", "insertAuditLog"],
    "they are append-only records of a decision already written",
  );
});

test("the drawer view asks its four questions at once", () => {
  const source = read("lib/repositories/drizzle-cashier-shift-repository.ts");
  const blocks = parallelBlocks(source);
  const ledger = blocks.find(
    (block) => block.includes("cashDrawerMovements") && block.includes("paymentRefunds"),
  );
  assert.ok(ledger, "ledgerTotalsFor must issue its aggregates together");
  assert.equal(
    (ledger!.match(/\.from\(/g) ?? []).length,
    4,
    "the four independent shift aggregates must stay in one round trip",
  );
});

test("the staff page, its total and the admin headcount travel together", () => {
  assertIssuedTogether(
    "lib/services/admin-staff-service.ts",
    ["count()", "countActiveAdmins"],
    "they answer three independent questions about the same filter",
  );
});

test("the table and review reports stay parallel", () => {
  const source = read("lib/services/report-analytics-service.ts");
  const blocks = parallelBlocks(source);
  assert.ok(
    blocks.some((block) => block.includes("waiterCalls") && block.includes("restaurantTables")),
    "getTables must fetch the per-table totals and the call counts together",
  );
  assert.ok(
    blocks.some((block) => block.includes("this.getStaff(") && block.includes("paymentRefunds")),
    "getReviewAlerts must fetch staff activity, refunds and voids together",
  );
});

test("review detail is paginated by the database, not by the array", () => {
  const source = read("lib/services/report-detail-service.ts");
  const detail = source.slice(source.indexOf("async getReviewDetail("));
  assert.ok(detail.length > 0, "getReviewDetail must exist");

  // Three sources, each bounded in SQL before anything reaches memory.
  assert.equal(
    (detail.match(/\.limit\(window\)/g) ?? []).length,
    3,
    "each of the void, refund and cancel queries must carry its own LIMIT",
  );
  assert.match(
    detail,
    /const window = offset \+ pageSize/,
    "the bound must be derived from the requested page, not a constant",
  );
  // The reported total has to come from counts; `rows.length` would only ever
  // describe the fetched window and would silently break the pager.
  assert.match(detail, /total \+= Number\(/, "totals must come from count queries");
  assert.doesNotMatch(
    detail.slice(0, detail.indexOf("async getOrderTimeline")),
    /total: rows\.length/,
    "the total must not be the length of the fetched page",
  );
});

test("the outbox worker stays inside a bounded batch and a bounded pool", () => {
  const route = read("app/api/internal/outbox/dispatch/route.ts");
  const batch = Number(route.match(/const OUTBOX_BATCH_SIZE = (\d+);/)?.[1]);
  const concurrency = Number(route.match(/const OUTBOX_PUBLISH_CONCURRENCY = (\d+);/)?.[1]);
  assert.ok(Number.isSafeInteger(batch) && batch > 0);
  assert.ok(Number.isSafeInteger(concurrency) && concurrency > 0);

  // The dispatcher refuses anything wider; keeping the route inside its own
  // guard means a raised ceiling fails here rather than at 3am in production.
  const dispatcher = read("lib/services/outbox-dispatcher.ts");
  assert.match(dispatcher, /this\.publishConcurrency > 16/, "publish concurrency must stay capped");
  assert.match(dispatcher, /this\.batchSize > 100/, "batch size must stay capped");
  assert.ok(concurrency <= 16, `publish concurrency ${concurrency} exceeds the dispatcher's cap`);
  assert.ok(batch <= 100, `batch size ${batch} exceeds the dispatcher's cap`);

  // One measured order costs six realtime events end to end, so the per-minute
  // ceiling this batch sets has to be read in events, not orders.
  assert.ok(
    batch >= 60,
    `batch ${batch} leaves under 10 orders/minute of realtime headroom at six events per order`,
  );
});

test("panel refreshes stay coalesced", () => {
  const source = read("lib/hooks/use-api-resource.ts");
  assert.match(source, /export function createCoalescer/, "the coalescer must stay exported and testable");
  assert.match(
    source,
    /coalescerRef\.current \?\?= createCoalescer/,
    "the hook must route every refetch through the coalescer",
  );
  // Ten realtime events during a burst must not become ten server-side runs.
  assert.doesNotMatch(
    source,
    /const refetch = useCallback\(async \(\) => \{\s*if \(!enabled\) return;\s*controllerRef/,
    "refetch must not go straight to a fetch again",
  );
});
