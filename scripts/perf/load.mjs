/**
 * Phase 32 section X — concurrent restaurant load.
 *
 * Runs against the disposable PERF32 tenant only, and refuses to start if the
 * fixture state names any other restaurant. Every scenario reports latency
 * percentiles plus the integrity checks that matter more than the percentiles:
 * duplicate orders, cross-table contamination, double payments, lost updates.
 *
 * usage: node --import tsx scripts/perf/load.mjs [scenario ...]
 *        scenarios: order10 order25 order50 double same-key kitchen mixed
 *                   payment release outbox service
 */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import nextEnv from "@next/env";
const { loadEnvConfig } = nextEnv;
import postgres from "postgres";
loadEnvConfig(process.cwd());

import { createRateLimitKey } from "../../lib/security/rate-limit.ts";

const BASE = process.env.PERF32_BASE_URL ?? "http://localhost:3100";
const STATE_FILE =
  process.env.PERF32_STATE ?? path.join(process.env.TEMP ?? "/tmp", "perf32", "fixture.json");
const fixture = JSON.parse(readFileSync(STATE_FILE, "utf8"));

const sql = postgres(process.env.DATABASE_URL, { max: 4, prepare: false, onnotice: () => {} });

const [{ name: tenantName }] = await sql`
  select name from restaurants where id = ${fixture.restaurantId}`;
if (!tenantName?.startsWith("PERF32_")) {
  throw new Error(`refusing to load-test '${tenantName}': not a PERF32 disposable tenant`);
}

const ADDRESSES = ["::1", "127.0.0.1", "::ffff:127.0.0.1", "localhost", "unknown"];
const ACTIONS = ["QR_VALIDATE", "ORDER_CREATE", "WAITER_CALL", "BILL_REQUEST", "STAFF_LOGIN"];
const secret = process.env.RATE_LIMIT_KEY_SECRET ?? process.env.AUTH_SECRET;

/**
 * The limiter is production policy and stays untouched; only the exact keys
 * this fixture can produce are removed, including the TABLE_SESSION-scoped
 * buckets an order create uses.
 */
async function clearLimits() {
  const keys = new Set();
  const fingerprints = ADDRESSES.map((address) =>
    createHash("sha256").update(address, "utf8").digest("hex").slice(0, 32),
  );
  const actors = [
    ...fixture.tables.map((table) => ({ actorType: "TABLE_SESSION", actorId: table.id })),
    ...Object.values(fixture.staff).map((staff) => ({
      actorType: "CLIENT_IP",
      actorId: staff.email,
    })),
    ...ADDRESSES.map((address) => ({ actorType: "CLIENT_IP", actorId: address })),
    ...fingerprints.map((fingerprint) => ({ actorType: "CLIENT_IP", actorId: fingerprint })),
  ];
  for (const action of ACTIONS) {
    for (const clientFingerprint of [...fingerprints, undefined]) {
      for (const restaurantId of [fixture.restaurantId, undefined]) {
        for (const actor of actors) {
          keys.add(
            createRateLimitKey(
              { action, ...actor, ...(clientFingerprint ? { clientFingerprint } : {}), ...(restaurantId ? { restaurantId } : {}) },
              secret,
            ),
          );
        }
      }
    }
  }
  await sql`delete from api_rate_limits where key_hash = any(${[...keys]})`;
}

function percentiles(values) {
  if (values.length === 0) return { p50: 0, p95: 0, p99: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]);
  return { p50: at(50), p95: at(95), p99: at(99), max: Math.round(sorted[sorted.length - 1]) };
}

class Session {
  constructor() {
    this.cookies = new Map();
  }

  header() {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  absorb(response) {
    for (const raw of response.headers.getSetCookie()) {
      const [pair] = raw.split(";");
      const index = pair.indexOf("=");
      if (index <= 0) continue;
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (value === "" || /expires=Thu, 01 Jan 1970/i.test(raw)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  async call(method, url, { body, headers = {} } = {}) {
    const started = process.hrtime.bigint();
    const response = await fetch(new URL(url, BASE), {
      method,
      redirect: "manual",
      headers: {
        Cookie: this.header(),
        Origin: BASE,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    this.absorb(response);
    return {
      status: response.status,
      ms: Number(process.hrtime.bigint() - started) / 1e6,
      body: text,
      json: (() => {
        try {
          return JSON.parse(text);
        } catch {
          return null;
        }
      })(),
    };
  }
}

async function tableSessions(count) {
  const sessions = [];
  for (const table of fixture.tables.slice(0, count)) {
    // Serial on purpose: opening the sessions is setup, not the measurement,
    // and QR validation is rate limited per client address.
    if (sessions.length % 20 === 0) await clearLimits();
    const session = new Session();
    const response = await session.call("POST", "/api/table-sessions", {
      body: { tableToken: table.rawToken },
    });
    if (response.status !== 200) throw new Error(`table session ${response.status}: ${response.body.slice(0, 160)}`);
    sessions.push({ session, table });
  }
  return sessions;
}

async function staffSession(role) {
  await clearLimits();
  const session = new Session();
  const credential = fixture.staff[role];
  const response = await session.call("POST", "/api/staff/login", {
    body: { identifier: credential.email, password: credential.password },
  });
  if (response.status !== 200) throw new Error(`${role} login ${response.status}: ${response.body.slice(0, 160)}`);
  return session;
}

function orderBody(itemCount) {
  return {
    items: fixture.products.slice(0, itemCount).map((productId, index) => ({
      productId,
      quantity: 1 + (index % 2),
    })),
  };
}

async function poolStats() {
  const [row] = await sql`
    select count(*)::int as total,
           count(*) filter (where state = 'active')::int as active,
           count(*) filter (where wait_event_type = 'Lock')::int as lock_waits
    from pg_stat_activity where datname = current_database()`;
  return row;
}

async function integrity(label) {
  const [orders] = await sql`
    select count(*)::int as orders,
           count(distinct order_number)::int as distinct_numbers,
           count(*) filter (where restaurant_id <> ${fixture.restaurantId})::int as foreign_rows
    from orders where restaurant_id = ${fixture.restaurantId}`;
  const [items] = await sql`
    select count(*)::int as items,
           count(*) filter (where o.restaurant_id <> i.restaurant_id)::int as tenant_mismatch
    from order_items i join orders o on o.id = i.order_id
    where i.restaurant_id = ${fixture.restaurantId}`;
  const [totals] = await sql`
    select count(*)::int as wrong_totals from (
      select o.id from orders o
      join order_items i on i.order_id = o.id and i.restaurant_id = o.restaurant_id
      where o.restaurant_id = ${fixture.restaurantId}
      group by o.id, o.subtotal
      having round(sum(i.line_total), 2) <> round(o.subtotal, 2)
    ) mismatched`;
  const [outbox] = await sql`
    select count(*)::int as total,
           count(*) filter (where status = 'PENDING')::int as pending,
           count(*) filter (where status = 'FAILED')::int as failed,
           min(created_at) filter (where status = 'PENDING') as oldest_pending
    from outbox_events where restaurant_id = ${fixture.restaurantId}`;
  console.log(
    `   integrity[${label}] orders=${orders.orders} distinctNumbers=${orders.distinct_numbers} ` +
      `duplicateNumbers=${orders.orders - orders.distinct_numbers} items=${items.items} ` +
      `tenantMismatch=${items.tenant_mismatch} wrongTotals=${totals.wrong_totals} ` +
      `outbox(total=${outbox.total} pending=${outbox.pending} failed=${outbox.failed})`,
  );
  return { orders, items, totals, outbox };
}

function report(label, concurrency, results) {
  const ok = results.filter((r) => r.status >= 200 && r.status < 300);
  const conflicts = results.filter((r) => r.status === 409);
  const limited = results.filter((r) => r.status === 429);
  const failed = results.filter((r) => r.status >= 500);
  const other = results.filter(
    (r) => r.status >= 400 && r.status < 500 && r.status !== 409 && r.status !== 429,
  );
  const stats = percentiles(results.map((r) => r.ms));
  console.log(
    `   ${label} concurrency=${concurrency} ok=${ok.length} conflict409=${conflicts.length} ` +
      `limited429=${limited.length} other4xx=${other.length} 5xx=${failed.length} ` +
      `p50=${stats.p50} p95=${stats.p95} p99=${stats.p99} max=${stats.max}`,
  );
  if (other.length > 0) console.log(`     first other4xx: ${other[0].status} ${other[0].body.slice(0, 160)}`);
  if (failed.length > 0) console.log(`     first 5xx: ${failed[0].body.slice(0, 160)}`);
  return { ok, conflicts, limited, failed, other, stats };
}

async function orderBurst(concurrency, itemCount) {
  console.log(`\n== X: ${concurrency} tables ordering at once (${itemCount} products each) ==`);
  const sessions = await tableSessions(concurrency);
  await clearLimits();
  const before = await poolStats();
  const started = process.hrtime.bigint();
  const results = await Promise.all(
    sessions.map(({ session, table }) =>
      session
        .call("POST", "/api/orders", {
          body: orderBody(itemCount),
          headers: { "Idempotency-Key": randomUUID() },
        })
        .then((response) => ({ ...response, tableId: table.id })),
    ),
  );
  const wall = Number(process.hrtime.bigint() - started) / 1e6;
  const during = await poolStats();
  const summary = report("order create", concurrency, results);
  console.log(
    `   wall=${Math.round(wall)}ms throughput=${(concurrency / (wall / 1000)).toFixed(1)} orders/s ` +
      `pg backends before=${before.total} after=${during.total} lockWaits=${during.lock_waits}`,
  );

  // X5: every created order must belong to the table that asked for it.
  const created = results
    .filter((r) => r.status === 201 && r.json?.data?.orderId)
    .map((r) => ({ orderId: r.json.data.orderId, tableId: r.tableId }));
  let contamination = 0;
  if (created.length > 0) {
    const rows = await sql`
      select id, table_id from orders where id = any(${created.map((c) => c.orderId)})`;
    const byId = new Map(rows.map((row) => [row.id, row.table_id]));
    contamination = created.filter((c) => byId.get(c.orderId) !== c.tableId).length;
  }
  console.log(`   cross-table contamination=${contamination}`);
  await integrity(`order${concurrency}`);
  return { results, summary, contamination, wall };
}

async function doubleSubmit() {
  console.log("\n== X4: same table, same idempotency key, two simultaneous submits ==");
  const [{ session }] = await tableSessions(1);
  await clearLimits();
  const key = randomUUID();
  const body = orderBody(2);
  const [a, b] = await Promise.all([
    session.call("POST", "/api/orders", { body, headers: { "Idempotency-Key": key } }),
    session.call("POST", "/api/orders", { body, headers: { "Idempotency-Key": key } }),
  ]);
  const ids = [a, b].map((r) => r.json?.data?.orderId).filter(Boolean);
  const distinct = new Set(ids).size;
  console.log(`   statuses=${a.status}/${b.status} distinctOrderIds=${distinct} (expected 1)`);

  console.log("   same key, different payload:");
  await clearLimits();
  const conflict = await session.call("POST", "/api/orders", {
    body: orderBody(3),
    headers: { "Idempotency-Key": key },
  });
  console.log(`   status=${conflict.status} code=${conflict.json?.error?.code ?? "-"}`);
  return { distinct, conflictStatus: conflict.status };
}

async function kitchenFanIn(expectedOrders) {
  console.log("\n== X6/X7: kitchen fan-in and concurrent status changes ==");
  const kitchen = await staffSession("KITCHEN");
  const listed = await kitchen.call("GET", "/api/staff/orders");
  const orders = listed.json?.data?.orders ?? [];
  const ids = orders.map((order) => order.id);
  console.log(
    `   kitchen sees ${ids.length} orders (distinct=${new Set(ids).size}, expected at least ${expectedOrders}) in ${Math.round(listed.ms)}ms`,
  );

  const targets = orders.filter((order) => order.status === "NEW").slice(0, 10);
  if (targets.length === 0) {
    console.log("   no NEW orders to transition");
    return { duplicates: ids.length - new Set(ids).size };
  }
  // NEW -> CONFIRMED -> PREPARING -> READY is the real ticket lifecycle; each
  // step is driven concurrently across the whole batch. Confirming is the
  // floor's call, not the kitchen's, so the waiter drives that hop.
  const waiter = await staffSession("WAITER");
  const toConfirmed = await Promise.all(
    targets.map((order) =>
      waiter.call("PATCH", `/api/orders/${order.id}/status`, { body: { status: "CONFIRMED" } }),
    ),
  );
  report("-> CONFIRMED", targets.length, toConfirmed);
  const toPreparing = await Promise.all(
    targets.map((order) =>
      kitchen.call("PATCH", `/api/orders/${order.id}/status`, { body: { status: "PREPARING" } }),
    ),
  );
  report("-> PREPARING", targets.length, toPreparing);
  const toReady = await Promise.all(
    targets.map((order) =>
      kitchen.call("PATCH", `/api/orders/${order.id}/status`, { body: { status: "READY" } }),
    ),
  );
  report("-> READY", targets.length, toReady);

  const [states] = await sql`
    select count(*) filter (where status = 'READY')::int as ready,
           count(*)::int as total
    from orders where id = any(${targets.map((order) => order.id)})`;
  console.log(`   final: ${states.ready}/${states.total} READY (lost updates = ${states.total - states.ready})`);
  return { duplicates: ids.length - new Set(ids).size, lostUpdates: states.total - states.ready };
}

async function paymentConcurrency() {
  console.log("\n== X9: payment concurrency ==");
  const cashier = await staffSession("CASHIER");

  // Only a SERVED order may be collected, so unpaid orders are walked through
  // the real lifecycle first. That setup is not part of the measurement.
  const candidates = await sql`
    select o.id, o.total, o.status from orders o
    where o.restaurant_id = ${fixture.restaurantId}
      and o.status <> 'COMPLETED' and o.status <> 'CANCELLED'
      and not exists (select 1 from payments p where p.order_id = o.id and p.status = 'COMPLETED')
    order by o.created_at desc limit 11`;
  // Each hop belongs to a different role: the floor confirms and serves, the
  // kitchen prepares. An admin session drives them all in one pass.
  const admin = await staffSession("ADMIN");
  const lifecycle = ["CONFIRMED", "PREPARING", "READY", "SERVED"];
  for (const order of candidates) {
    const from = lifecycle.indexOf(order.status);
    for (const next of lifecycle.slice(from + 1)) {
      const hop = await admin.call("PATCH", `/api/orders/${order.id}/status`, { body: { status: next } });
      if (hop.status >= 400) break;
    }
  }
  const rows = await sql`
    select o.id, o.total from orders o
    where o.restaurant_id = ${fixture.restaurantId} and o.status = 'SERVED'
      and not exists (select 1 from payments p where p.order_id = o.id and p.status = 'COMPLETED')
    order by o.created_at desc limit 11`;
  if (rows.length === 0) {
    console.log("   no payable orders; skipped");
    return null;
  }

  const [target] = rows;
  const key = randomUUID();
  const [a, b] = await Promise.all([
    cashier.call("POST", "/api/payments", {
      body: { orderId: target.id, method: "CASH", amount: target.total },
      headers: { "Idempotency-Key": key },
    }),
    cashier.call("POST", "/api/payments", {
      body: { orderId: target.id, method: "CASH", amount: target.total },
      headers: { "Idempotency-Key": key },
    }),
  ]);
  const [paid] = await sql`
    select count(*)::int as payments, coalesce(sum(amount), 0)::text as total
    from payments where order_id = ${target.id} and status = 'COMPLETED'`;
  console.log(
    `   same order twice: statuses=${a.status}/${b.status} completedPaymentRows=${paid.payments} ` +
      `collected=${paid.total} orderTotal=${target.total} (double charge = ${paid.payments > 1 ? "YES" : "NO"})`,
  );
  if (a.status >= 400 && b.status >= 400) console.log(`     bodies: ${a.body.slice(0, 120)} | ${b.body.slice(0, 120)}`);

  const others = rows.slice(1, 11);
  const results = await Promise.all(
    others.map((order) =>
      cashier.call("POST", "/api/payments", {
        body: { orderId: order.id, method: "CARD", amount: order.total },
        headers: { "Idempotency-Key": randomUUID() },
      }),
    ),
  );
  report("10 independent payments", others.length, results);
  const misrouted = await sql`
    select count(*)::int as wrong from payments p
    join orders o on o.id = p.order_id
    where p.restaurant_id = ${fixture.restaurantId} and p.restaurant_id <> o.restaurant_id`;
  console.log(`   misrouted payments=${misrouted[0].wrong}`);
  return { doubleCharge: paid.payments > 1 };
}

async function mixedLoad() {
  console.log("\n== X8: mixed waiter + kitchen + cashier + admin load ==");
  const sessions = await tableSessions(5);
  const waiter = await staffSession("WAITER");
  const cashier = await staffSession("CASHIER");
  const admin = await staffSession("ADMIN");
  await clearLimits();

  const openOrders = await sql`
    select id from orders where restaurant_id = ${fixture.restaurantId}
      and status = 'NEW' order by created_at desc limit 8`;

  const started = process.hrtime.bigint();
  const work = [
    ...sessions.map(({ session }) =>
      session.call("POST", "/api/orders", {
        body: orderBody(3),
        headers: { "Idempotency-Key": randomUUID() },
      }),
    ),
    ...openOrders.slice(0, 5).map((order) =>
      waiter.call("PATCH", `/api/orders/${order.id}/status`, { body: { status: "CONFIRMED" } }),
    ),
    waiter.call("GET", "/api/staff/tables"),
    waiter.call("GET", "/api/staff/orders"),
    waiter.call("GET", "/api/staff/calls"),
    cashier.call("GET", "/api/cashier/shifts/current"),
    cashier.call("GET", "/api/staff/orders"),
    cashier.call("GET", "/api/staff/tables"),
    admin.call("GET", "/api/admin/reports/summary?range=TODAY"),
    admin.call("GET", "/api/admin/reports/finance?range=LAST_7_DAYS"),
  ];
  const results = await Promise.all(work);
  const wall = Number(process.hrtime.bigint() - started) / 1e6;
  const during = await poolStats();
  report("mixed", work.length, results);
  console.log(
    `   wall=${Math.round(wall)}ms requests/s=${(work.length / (wall / 1000)).toFixed(1)} ` +
      `pgBackends=${during.total} active=${during.active} lockWaits=${during.lock_waits}`,
  );
  await integrity("mixed");
  return results;
}

async function outboxPressure() {
  console.log("\n== X11: outbox pressure ==");
  const [row] = await sql`
    select count(*)::int as produced,
           count(*) filter (where status = 'PUBLISHED')::int as published,
           count(*) filter (where status = 'PENDING')::int as pending,
           count(*) filter (where status = 'FAILED')::int as failed,
           min(created_at) filter (where status = 'PENDING') as oldest_pending
    from outbox_events where restaurant_id = ${fixture.restaurantId}`;
  console.log(
    `   produced=${row.produced} published=${row.published} pending=${row.pending} ` +
      `failed=${row.failed} oldestPending=${row.oldest_pending ? row.oldest_pending.toISOString() : "-"}`,
  );
  return row;
}

async function serviceSimulation(minutes) {
  console.log(`\n== X14: ${minutes}-minute service simulation ==`);
  const sessions = await tableSessions(20);
  const waiter = await staffSession("WAITER");
  const kitchen = await staffSession("KITCHEN");
  const admin = await staffSession("ADMIN");
  const deadline = Date.now() + minutes * 60_000;
  const latencies = [];
  let requests = 0;
  let orders = 0;
  let errors = 0;
  let conflicts = 0;
  let limited = 0;

  const track = (result) => {
    requests += 1;
    latencies.push(result.ms);
    if (result.status >= 500) errors += 1;
    else if (result.status === 409) conflicts += 1;
    else if (result.status === 429) limited += 1;
    return result;
  };

  let round = 0;
  while (Date.now() < deadline) {
    round += 1;
    await clearLimits();
    const batch = sessions.slice((round * 4) % 20, ((round * 4) % 20) + 4);
    const results = await Promise.all([
      ...batch.map(({ session }) =>
        session
          .call("POST", "/api/orders", {
            body: orderBody(2 + (round % 2)),
            headers: { "Idempotency-Key": randomUUID() },
          })
          .then(track),
      ),
      waiter.call("GET", "/api/staff/tables").then(track),
      waiter.call("GET", "/api/staff/orders").then(track),
      kitchen.call("GET", "/api/staff/orders").then(track),
      admin.call("GET", "/api/admin/reports/summary?range=TODAY").then(track),
    ]);
    orders += results.filter((r) => r.status === 201).length;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }

  const stats = percentiles(latencies);
  const elapsed = minutes;
  console.log(
    `   requests=${requests} (${Math.round(requests / elapsed)}/min) orders=${orders} ` +
      `(${Math.round(orders / elapsed)}/min) 5xx=${errors} 409=${conflicts} 429=${limited}`,
  );
  console.log(`   p50=${stats.p50} p95=${stats.p95} p99=${stats.p99} max=${stats.max}`);
  await integrity("service");
  await outboxPressure();
  return { requests, orders, stats, errors };
}

/**
 * X10 — two open orders on one table, one of them paid under concurrency. The
 * table must stay occupied while the second bill is still owed.
 */
async function tableReleaseConcurrency() {
  console.log("\n== X10: table release with a second bill still open ==");
  const [{ session, table }] = await tableSessions(1);
  const waiter = await staffSession("WAITER");
  const cashier = await staffSession("CASHIER");

  const created = [];
  for (let index = 0; index < 2; index++) {
    await clearLimits();
    const response = await session.call("POST", "/api/orders", {
      body: orderBody(2),
      headers: { "Idempotency-Key": randomUUID() },
    });
    if (response.status !== 201) {
      console.log(`   could not open order ${index + 1}: ${response.status} ${response.body.slice(0, 120)}`);
      return null;
    }
    created.push(response.json.data);
  }

  const [first] = created;
  for (const next of ["CONFIRMED", "PREPARING", "READY", "SERVED"]) {
    await waiter.call("PATCH", `/api/orders/${first.orderId}/status`, { body: { status: next } });
  }
  // The floor may confirm and serve but not prepare; an admin closes the gaps.
  const supervisor = await staffSession("ADMIN");
  for (const next of ["CONFIRMED", "PREPARING", "READY", "SERVED"]) {
    await supervisor.call("PATCH", `/api/orders/${first.orderId}/status`, { body: { status: next } });
  }
  const paid = await cashier.call("POST", "/api/payments", {
    body: { orderId: first.orderId, method: "CASH", amount: first.total },
    headers: { "Idempotency-Key": randomUUID() },
  });
  const [row] = await sql`
    select current_status from restaurant_tables where id = ${table.id}`;
  const [open] = await sql`
    select count(*)::int as open_orders from orders
    where table_id = ${table.id} and status not in ('COMPLETED','CANCELLED')`;
  console.log(
    `   payment=${paid.status} openOrdersLeft=${open.open_orders} tableStatus=${row.current_status} ` +
      `(wrongly released = ${open.open_orders > 0 && row.current_status === "AVAILABLE" ? "YES" : "NO"})`,
  );
  return row.current_status;
}

const scenarios = process.argv.slice(2);
const want = (name) => scenarios.length === 0 || scenarios.includes(name);

try {
  console.log(`# load target: ${tenantName} (${fixture.restaurantId}) at ${BASE}`);
  await integrity("start");
  if (want("order10")) await orderBurst(10, 3);
  if (want("order25")) await orderBurst(25, 3);
  if (want("order50")) await orderBurst(50, 3);
  if (want("double")) await doubleSubmit();
  if (want("kitchen")) await kitchenFanIn(10);
  if (want("payment")) await paymentConcurrency();
  if (want("release")) await tableReleaseConcurrency();
  if (want("mixed")) await mixedLoad();
  if (want("outbox")) await outboxPressure();
  if (want("service")) await serviceSimulation(Number(process.env.PERF32_SERVICE_MINUTES ?? 5));
} finally {
  await sql.end({ timeout: 5 });
}
