/**
 * Phase 33 sections 10-11 — how many realtime events one order actually costs.
 *
 * "60 orders/min" and "60 events/min" are not the same number, and the outbox
 * ceiling is denominated in events. This walks a real order through its whole
 * life (create → confirm → prepare → ready → serve → collect) plus the service
 * requests a table makes on the way, and counts the outbox rows each step left
 * behind. Runs against the disposable PERF32 tenant only.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import nextEnv from "@next/env";
const { loadEnvConfig } = nextEnv;
import postgres from "postgres";
loadEnvConfig(process.cwd());

import { createRateLimitKey } from "../../lib/security/rate-limit.ts";
import { createHash } from "node:crypto";

const BASE = process.env.PERF32_BASE_URL ?? "http://localhost:3100";
const STATE_FILE =
  process.env.PERF32_STATE ?? path.join(process.env.TEMP ?? "/tmp", "perf32", "fixture.json");
const fixture = JSON.parse(readFileSync(STATE_FILE, "utf8"));
const sql = postgres(process.env.DATABASE_URL, { max: 3, prepare: false, onnotice: () => {} });

const [{ name: tenant }] = await sql`select name from restaurants where id = ${fixture.restaurantId}`;
if (!tenant?.startsWith("PERF32_")) throw new Error(`refusing to drive '${tenant}'`);

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
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* non-JSON bodies are reported through `text` */
    }
    return { status: response.status, text, json };
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
  if (response.status !== 200) throw new Error(`${role} login ${response.status}: ${response.text.slice(0, 160)}`);
  return session;
}

async function eventCount() {
  const [row] = await sql`
    select count(*)::int as n from outbox_events where restaurant_id = ${fixture.restaurantId}`;
  return row.n;
}

async function eventTypesSince(mark) {
  return sql`
    select event_type, count(*)::int as n from outbox_events
    where restaurant_id = ${fixture.restaurantId} and created_at >= ${mark}
    group by event_type order by 2 desc`;
}

const steps = [];
async function step(label, work) {
  const before = await eventCount();
  const result = await work();
  const after = await eventCount();
  steps.push({ label, events: after - before, status: result?.status ?? "-" });
  console.log(
    `  ${String(after - before).padStart(2)} event  ${String(result?.status ?? "-").padStart(3)}  ${label}`,
  );
  return result;
}

console.log(`# lifecycle event accounting — ${tenant}`);
const mark = new Date();

const customer = new Session();
await clearLimits();
const table = fixture.tables[0];
const session = await customer.call("POST", "/api/table-sessions", { tableToken: table.rawToken });
if (session.status !== 200) throw new Error(`table session ${session.status}: ${session.text.slice(0, 200)}`);

const waiter = await staffSession("WAITER");
const kitchen = await staffSession("KITCHEN");
const cashier = await staffSession("CASHIER");

console.log("\n## one order, end to end");
const created = await step("customer places order (3 lines)", async () => {
  await clearLimits();
  return customer.call(
    "POST",
    "/api/orders",
    { items: fixture.products.slice(0, 3).map((productId) => ({ productId, quantity: 1 })) },
    { "Idempotency-Key": randomUUID() },
  );
});
const orderId = created.json?.data?.orderId;
if (!orderId) throw new Error(`order create failed: ${created.text.slice(0, 300)}`);

await step("waiter confirms", () =>
  waiter.call("PATCH", `/api/orders/${orderId}/status`, { status: "CONFIRMED" }),
);
await step("kitchen starts preparing", () =>
  kitchen.call("PATCH", `/api/orders/${orderId}/status`, { status: "PREPARING" }),
);
await step("kitchen marks ready", () =>
  kitchen.call("PATCH", `/api/orders/${orderId}/status`, { status: "READY" }),
);
await step("waiter serves", () =>
  waiter.call("PATCH", `/api/orders/${orderId}/status`, { status: "SERVED" }),
);
const [orderRow] = await sql`select total from orders where id = ${orderId}`;
await step("cashier collects", () =>
  cashier.call(
    "POST",
    "/api/payments",
    { orderId, method: "CASH", amount: orderRow.total },
    { "Idempotency-Key": randomUUID() },
  ),
);

console.log("\n## side traffic one table produces");
await step("guest calls the waiter", async () => {
  await clearLimits();
  return customer.call("POST", "/api/calls", { notes: "Su istiyorum" });
});
const [call] = await sql`
  select id from waiter_calls where restaurant_id = ${fixture.restaurantId}
  order by created_at desc limit 1`;
if (call) {
  await step("waiter resolves the call", () =>
    waiter.call("PATCH", `/api/staff/calls/${call.id}`, { status: "RESOLVED" }),
  );
}
await step("guest asks for the bill", async () => {
  await clearLimits();
  return customer.call("POST", "/api/bill-requests", { notes: "Hesap lutfen" });
});

const lifecycle = steps.slice(0, 6).reduce((total, entry) => total + entry.events, 0);
const side = steps.slice(6).reduce((total, entry) => total + entry.events, 0);

console.log("\n## totals");
console.log(`  full order lifecycle (create → collect): ${lifecycle} outbox events`);
console.log(`  optional side traffic per table:         ${side} outbox events`);
console.log("\n## event types produced");
for (const row of await eventTypesSince(mark)) {
  console.log(`  ${String(row.n).padStart(2)}  ${row.event_type}`);
}

console.log("\n## demand model (events/min) from the measured lifecycle");
const perOrder = lifecycle;
for (const [label, ordersPerHour] of [
  ["normal service   30 orders/h", 30],
  ["busy service     60 orders/h", 60],
  ["peak minute      10 orders in 60s", 600],
]) {
  const eventsPerMinute = (ordersPerHour * perOrder) / 60;
  console.log(
    `  ${label.padEnd(34)} ${eventsPerMinute.toFixed(1).padStart(6)} events/min` +
      `   headroom vs 60/min: ${(60 / eventsPerMinute).toFixed(1)}x`,
  );
}

await sql.end({ timeout: 5 });
