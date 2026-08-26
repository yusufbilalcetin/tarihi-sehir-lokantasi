/**
 * Phase 33 sections 5-7 — what a real restaurant asks of this system.
 *
 * Phase 32's 93 orders/min was a stress figure, not a requirement. This drives
 * the three workloads a twenty-table restaurant actually produces and separates
 * the two gates that matter:
 *
 *   DATA INTEGRITY — 5xx, duplicates, wrong table, double payment, deadlock
 *   USER EXPERIENCE — p50 / p95 / p99 as felt at a table or a till
 *
 * The two sustained workloads are time-compressed: a real 60 orders/hour is one
 * order a minute, which would need an hour to collect a hundred samples and
 * would measure nothing but single-request latency. The composition and the
 * ratios are the real ones; only the clock is accelerated, and the factor is
 * reported so the numbers are read for what they are.
 *
 * usage: node --import tsx scripts/perf/capacity.mjs [normal|busy|burst|all]
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

const [{ name: tenant }] = await sql`select name from restaurants where id = ${fixture.restaurantId}`;
if (!tenant?.startsWith("PERF32_")) throw new Error(`refusing to load-test '${tenant}'`);

const ADDRESSES = ["::1", "127.0.0.1", "::ffff:127.0.0.1", "localhost", "unknown"];
const ACTIONS = ["QR_VALIDATE", "ORDER_CREATE", "WAITER_CALL", "BILL_REQUEST", "STAFF_LOGIN"];
const secret = process.env.RATE_LIMIT_KEY_SECRET ?? process.env.AUTH_SECRET;

async function clearLimits() {
  const keys = new Set();
  const fingerprints = ADDRESSES.map((address) =>
    createHash("sha256").update(address, "utf8").digest("hex").slice(0, 32),
  );
  const actors = [
    ...fixture.tables.map((table) => ({ actorType: "TABLE_SESSION", actorId: table.id })),
    ...Object.values(fixture.staff).map((staff) => ({ actorType: "CLIENT_IP", actorId: staff.email })),
    ...ADDRESSES.map((address) => ({ actorType: "CLIENT_IP", actorId: address })),
    ...fingerprints.map((fingerprint) => ({ actorType: "CLIENT_IP", actorId: fingerprint })),
  ];
  for (const action of ACTIONS) {
    for (const clientFingerprint of [...fingerprints, undefined]) {
      for (const restaurantId of [fixture.restaurantId, undefined]) {
        for (const actor of actors) {
          keys.add(
            createRateLimitKey(
              {
                action,
                ...actor,
                ...(clientFingerprint ? { clientFingerprint } : {}),
                ...(restaurantId ? { restaurantId } : {}),
              },
              secret,
            ),
          );
        }
      }
    }
  }
  await sql`delete from api_rate_limits where key_hash = any(${[...keys]})`;
}

class Session {
  constructor() {
    this.cookies = new Map();
  }
  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  absorb(response) {
    for (const raw of response.headers.getSetCookie()) {
      const [pair] = raw.split(";");
      const index = pair.indexOf("=");
      if (index > 0) this.cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
    }
  }
  async call(method, url, body, headers = {}) {
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
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    this.absorb(response);
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* handled by callers through `text` */
    }
    return { status: response.status, ms, text, json };
  }
}

async function staffSession(role) {
  await clearLimits();
  const session = new Session();
  const credential = fixture.staff[role];
  const response = await session.call("POST", "/api/staff/login", {
    identifier: credential.email,
    password: credential.password,
  });
  if (response.status !== 200) throw new Error(`${role} login ${response.status}`);
  return session;
}

async function tableSessions(count) {
  const opened = [];
  for (const table of fixture.tables.slice(0, count)) {
    if (opened.length % 20 === 0) await clearLimits();
    const session = new Session();
    const response = await session.call("POST", "/api/table-sessions", { tableToken: table.rawToken });
    if (response.status !== 200) throw new Error(`table session ${response.status}: ${response.text.slice(0, 140)}`);
    opened.push({ session, table });
  }
  return opened;
}

function percentiles(values) {
  if (values.length === 0) return { n: 0, p50: 0, p95: 0, p99: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]);
  return { n: sorted.length, p50: at(50), p95: at(95), p99: at(99), max: Math.round(sorted[sorted.length - 1]) };
}

/** One recorder per workload, so integrity and latency are reported apart. */
function recorder() {
  const byKind = new Map();
  const all = [];
  let fiveXx = 0;
  let conflicts = 0;
  let limited = 0;
  let otherFailures = 0;
  const failureSamples = [];

  return {
    track(kind, result) {
      all.push(result.ms);
      if (!byKind.has(kind)) byKind.set(kind, []);
      byKind.get(kind).push(result.ms);
      if (result.status >= 500) {
        fiveXx += 1;
        if (failureSamples.length < 3) failureSamples.push(`${kind} ${result.status} ${result.text.slice(0, 110)}`);
      } else if (result.status === 409) conflicts += 1;
      else if (result.status === 429) limited += 1;
      else if (result.status >= 400) {
        otherFailures += 1;
        if (failureSamples.length < 3) failureSamples.push(`${kind} ${result.status} ${result.text.slice(0, 110)}`);
      }
      return result;
    },
    report(label, elapsedMs, compression) {
      const overall = percentiles(all);
      console.log(`\n   ${label}`);
      console.log(
        `   requests=${overall.n}  window=${(elapsedMs / 1000).toFixed(0)}s` +
          (compression ? `  (compressed ${compression}x — represents ${((elapsedMs * compression) / 60000).toFixed(0)} min of service)` : ""),
      );
      console.log(
        `   INTEGRITY  5xx=${fiveXx}  other4xx=${otherFailures}  409=${conflicts}  429=${limited}`,
      );
      if (failureSamples.length) console.log(`     ${failureSamples.join("\n     ")}`);
      console.log(`   UX         p50=${overall.p50}  p95=${overall.p95}  p99=${overall.p99}  max=${overall.max}`);
      console.log("   by operation:");
      for (const [kind, values] of [...byKind].sort()) {
        const stats = percentiles(values);
        console.log(
          `     ${kind.padEnd(22)} n=${String(stats.n).padStart(4)}  p50=${String(stats.p50).padStart(5)}  p95=${String(stats.p95).padStart(5)}  p99=${String(stats.p99).padStart(5)}`,
        );
      }
      return { overall, fiveXx, otherFailures, conflicts, limited };
    },
  };
}

async function integrity(label) {
  const [orders] = await sql`
    select count(*)::int as orders, count(distinct order_number)::int as numbers
    from orders where restaurant_id = ${fixture.restaurantId}`;
  const [cross] = await sql`
    select count(*)::int as mismatched
    from order_items i join orders o on o.id = i.order_id
    where i.restaurant_id = ${fixture.restaurantId} and o.restaurant_id <> i.restaurant_id`;
  const [double] = await sql`
    select count(*)::int as over_collected from (
      select p.order_id from payments p
      join orders o on o.id = p.order_id
      where p.restaurant_id = ${fixture.restaurantId} and p.status = 'COMPLETED'
      group by p.order_id, o.total
      having sum(p.amount) > o.total
    ) x`;
  const [outbox] = await sql`
    select count(*)::int as total, count(*) filter (where status = 'PENDING')::int as pending
    from outbox_events where restaurant_id = ${fixture.restaurantId}`;
  console.log(
    `   integrity[${label}] orders=${orders.orders} duplicateNumbers=${orders.orders - orders.numbers} ` +
      `crossTenantItems=${cross.mismatched} overCollectedOrders=${double.over_collected} ` +
      `outbox(total=${outbox.total} pending=${outbox.pending})`,
  );
  return { duplicates: orders.orders - orders.numbers, cross: cross.mismatched, double: double.over_collected };
}

/**
 * A twenty-table service, in the proportions a floor actually produces:
 * every order is confirmed, prepared, made ready, served and collected, and a
 * fifth of the tables asks for something along the way. Panels keep polling
 * throughout, because they do in a real dining room too.
 */
async function service(label, ordersPerHour, minutes, compression) {
  console.log(`\n== ${label}: 20 tables, ${ordersPerHour} orders/hour ==`);
  const tables = await tableSessions(20);
  const waiter = await staffSession("WAITER");
  const kitchen = await staffSession("KITCHEN");
  const cashier = await staffSession("CASHIER");
  const admin = await staffSession("ADMIN");
  const track = recorder();

  const ordersPerMinuteReal = ordersPerHour / 60;
  const ordersPerMinute = ordersPerMinuteReal * compression;
  const tickSeconds = 5;
  const ticks = Math.round((minutes * 60) / tickSeconds);
  const ordersPerTick = (ordersPerMinute * tickSeconds) / 60;

  // Orders that have been placed and still owe the floor their remaining steps.
  const pipeline = [];
  let placed = 0;
  let carry = 0;
  const started = Date.now();

  for (let tick = 0; tick < ticks; tick++) {
    const tickStarted = Date.now();
    const work = [];

    carry += ordersPerTick;
    const toPlace = Math.floor(carry);
    carry -= toPlace;

    if (toPlace > 0) await clearLimits();
    for (let index = 0; index < toPlace; index++) {
      const seat = tables[(placed + index) % tables.length];
      work.push(
        seat.session
          .call(
            "POST",
            "/api/orders",
            { items: fixture.products.slice(0, 2 + (index % 2)).map((productId) => ({ productId, quantity: 1 })) },
            { "Idempotency-Key": randomUUID() },
          )
          .then((result) => {
            track.track("order create", result);
            if (result.status === 201) pipeline.push({ id: result.json.data.orderId, stage: 0, tableId: seat.table.id });
            return result;
          }),
      );
    }
    placed += toPlace;

    // Each in-flight order advances one stage per tick, by whoever owns it.
    const lifecycle = [
      ["CONFIRMED", waiter, "waiter confirm"],
      ["PREPARING", kitchen, "kitchen start"],
      ["READY", kitchen, "kitchen ready"],
      ["SERVED", waiter, "waiter serve"],
    ];
    for (const order of [...pipeline]) {
      if (order.stage < lifecycle.length) {
        const [status, actor, kind] = lifecycle[order.stage];
        order.stage += 1;
        work.push(
          actor
            .call("PATCH", `/api/orders/${order.id}/status`, { status })
            .then((result) => track.track(kind, result)),
        );
      } else {
        pipeline.splice(pipeline.indexOf(order), 1);
        work.push(
          sql`select total from orders where id = ${order.id}`.then(([row]) =>
            cashier
              .call(
                "POST",
                "/api/payments",
                { orderId: order.id, method: order.stage % 2 ? "CASH" : "CARD", amount: row.total },
                { "Idempotency-Key": randomUUID() },
              )
              .then((result) => track.track("cashier collect", result)),
          ),
        );
      }
    }

    // Service requests: 20 an hour across the floor, on the same clock.
    if (tick % Math.max(1, Math.round(ticks / (minutes * compression * (20 / 60)))) === 0) {
      const seat = tables[tick % tables.length];
      await clearLimits();
      work.push(
        seat.session
          .call("POST", "/api/calls", { notes: "Su istiyorum" })
          .then((result) => track.track("guest calls waiter", result)),
      );
    }

    // Panels are open the whole service and keep polling.
    work.push(waiter.call("GET", "/api/staff/tables").then((r) => track.track("floor read", r)));
    work.push(kitchen.call("GET", "/api/staff/orders").then((r) => track.track("kitchen read", r)));
    if (tick % 3 === 0) {
      work.push(cashier.call("GET", "/api/cashier/shifts/current").then((r) => track.track("till read", r)));
    }
    if (tick % 12 === 0) {
      work.push(
        admin.call("GET", "/api/admin/reports/summary?range=TODAY").then((r) => track.track("admin report", r)),
      );
    }

    await Promise.all(work);
    const spent = Date.now() - tickStarted;
    if (spent < tickSeconds * 1000) await new Promise((r) => setTimeout(r, tickSeconds * 1000 - spent));
  }

  const elapsed = Date.now() - started;
  const summary = track.report(label, elapsed, compression);
  await integrity(label);
  console.log(
    `   orders placed=${placed} over ${(elapsed / 1000).toFixed(0)}s` +
      `  → real-service equivalent ${(placed / ((elapsed * compression) / 3_600_000)).toFixed(0)} orders/hour`,
  );
  return summary;
}

/** Ten tables scanning and ordering inside ten seconds — the true worst case. */
async function burst() {
  console.log("\n== extreme burst: 10 tables order within 10 seconds ==");
  const tables = await tableSessions(10);
  await clearLimits();
  const track = recorder();
  const started = Date.now();

  const work = tables.map(({ session, table }, index) =>
    new Promise((resolve) => setTimeout(resolve, Math.round((index / tables.length) * 10_000))).then(() =>
      session
        .call(
          "POST",
          "/api/orders",
          { items: fixture.products.slice(0, 3).map((productId) => ({ productId, quantity: 1 })) },
          { "Idempotency-Key": randomUUID() },
        )
        .then((result) => ({ ...track.track("order create", result), tableId: table.id })),
    ),
  );
  const results = await Promise.all(work);
  const elapsed = Date.now() - started;
  track.report("burst (arrivals spread over 10s)", elapsed, null);

  const created = results.filter((r) => r.status === 201).map((r) => ({ orderId: r.json.data.orderId, tableId: r.tableId }));
  let wrongTable = 0;
  if (created.length) {
    const rows = await sql`select id, table_id from orders where id = any(${created.map((c) => c.orderId)})`;
    const byId = new Map(rows.map((row) => [row.id, row.table_id]));
    wrongTable = created.filter((c) => byId.get(c.orderId) !== c.tableId).length;
  }
  console.log(`   wrong-table orders=${wrongTable}`);
  await integrity("burst");
  return { wrongTable };
}

const which = process.argv[2] ?? "all";
const COMPRESSION = Number(process.env.PERF33_COMPRESSION ?? 10);
const MINUTES = Number(process.env.PERF33_MINUTES ?? 3);

try {
  console.log(`# capacity model — ${tenant} @ ${BASE}`);
  await integrity("start");
  if (which === "all" || which === "normal") await service("normal service", 30, MINUTES, COMPRESSION);
  if (which === "all" || which === "busy") await service("busy service", 60, MINUTES, COMPRESSION);
  if (which === "all" || which === "burst") await burst();
} finally {
  await sql.end({ timeout: 5 });
}
