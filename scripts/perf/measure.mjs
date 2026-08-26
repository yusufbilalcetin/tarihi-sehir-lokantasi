/**
 * Phase 32 surface profiler.
 *
 * Drives one request at a time against a running server and reads the
 * [SQLPERF] rows the server wrote while that request was in flight, so wall
 * clock, statement count and sequential-vs-pipelined shape line up per
 * endpoint. Serial by design: the SQL rows are attributed by log position.
 *
 * usage: node --import tsx scripts/perf/measure.mjs <serverLogPath> <outJsonPath>
 */
import { closeSync, openSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import nextEnv from "@next/env";
const { loadEnvConfig } = nextEnv;
import postgres from "postgres";
loadEnvConfig(process.cwd());

import { fixtureRateLimitKeys } from "../../tests/integration/rate-limit-reset.ts";

const BASE = process.env.PERF32_BASE_URL ?? "http://localhost:3100";
const STATE_FILE =
  process.env.PERF32_STATE ?? path.join(process.env.TEMP ?? "/tmp", "perf32", "fixture.json");
const fixture = JSON.parse(readFileSync(STATE_FILE, "utf8"));
const [serverLog, outFile] = process.argv.slice(2);

const sql = postgres(process.env.DATABASE_URL, { max: 3, prepare: false, onnotice: () => {} });

async function clearLimits() {
  const identifiers = [
    ...Object.values(fixture.staff).map((s) => s.email),
    ...fixture.tables.map((t) => t.id),
  ];
  const keys = fixtureRateLimitKeys(identifiers, [fixture.restaurantId]);
  await sql`delete from api_rate_limits where key_hash = any(${keys})`;
}

function logSize() {
  try {
    return statSync(serverLog).size;
  } catch {
    return 0;
  }
}

function sqlRowsBetween(from, to) {
  if (!serverLog || to <= from) return [];
  const buffer = Buffer.alloc(to - from);
  const fd = openSync(serverLog, "r");
  readSync(fd, buffer, 0, buffer.length, from);
  closeSync(fd);
  return buffer
    .toString("utf8")
    .split(/\r?\n/)
    .filter((line) => line.startsWith("[SQLPERF]"))
    .map((line) => {
      const [, ts, connection, params, shape] = line.split("\t");
      return { ts: BigInt(ts), connection: Number(connection), params: Number(params), shape };
    });
}

class Client {
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
      if (index <= 0) continue;
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (value === "" || /expires=Thu, 01 Jan 1970/i.test(raw)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  async send(method, url, { body, headers = {}, accept = "application/json" } = {}) {
    const before = logSize();
    const started = process.hrtime.bigint();
    const response = await fetch(new URL(url, BASE), {
      method,
      redirect: "manual",
      headers: {
        Cookie: this.header(),
        Origin: BASE,
        Accept: accept,
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    this.absorb(response);
    // Give the server's stdout a moment so the tail of the run is complete.
    await new Promise((resolve) => setTimeout(resolve, 60));
    const rows = sqlRowsBetween(before, logSize());
    return { status: response.status, ms, bytes: Buffer.byteLength(text), text, rows };
  }

  get(url, options) {
    return this.send("GET", url, options);
  }

  post(url, body, headers) {
    return this.send("POST", url, { body, headers });
  }
}

/** Statements whose send timestamps are >20 ms apart are separate round trips. */
function shapeOfQueries(rows) {
  if (rows.length < 2) return { queries: rows.length, sequentialGaps: 0, pipelined: 0 };
  let sequential = 0;
  let pipelined = 0;
  for (let index = 1; index < rows.length; index++) {
    const gapMs = Number(rows[index].ts - rows[index - 1].ts) / 1e6;
    if (gapMs > 20) sequential += 1;
    else pipelined += 1;
  }
  return { queries: rows.length, sequentialGaps: sequential, pipelined };
}

const results = [];

async function measure(label, persona, run, { repeat = 5, warmups = 6 } = {}) {
  // One warm-up per pool connection: postgres.js caches a prepared statement
  // per connection, so a half-warm pool measures the two-round-trip form.
  for (let index = 0; index < warmups; index++) await run();
  const samples = [];
  let last;
  for (let index = 0; index < repeat; index++) {
    last = await run();
    samples.push(last);
  }
  const times = samples.map((sample) => sample.ms).sort((a, b) => a - b);
  const entry = {
    label,
    persona,
    status: last.status,
    p50: Number(times[Math.floor(times.length / 2)].toFixed(1)),
    min: Number(times[0].toFixed(1)),
    max: Number(times[times.length - 1].toFixed(1)),
    bytes: last.bytes,
    ...shapeOfQueries(last.rows),
    statements: last.rows.map((row) => row.shape.slice(0, 70)),
  };
  results.push(entry);
  console.log(
    `${String(entry.p50).padStart(7)}ms  ${String(entry.queries).padStart(3)}q  ` +
      `${String(entry.sequentialGaps).padStart(3)}seq  ${String(entry.bytes).padStart(7)}B  ` +
      `${String(entry.status).padStart(3)}  ${label}`,
  );
  if (last.status >= 400) console.log(`         body: ${last.text.slice(0, 200)}`);
  return entry;
}

async function login(role) {
  await clearLimits();
  const client = new Client();
  const credential = fixture.staff[role];
  const response = await client.send("POST", "/api/staff/login", {
    body: { identifier: credential.email, password: credential.password },
  });
  if (response.status !== 200) {
    throw new Error(`${role} login ${response.status}: ${response.text.slice(0, 200)}`);
  }
  return client;
}

async function main() {
  console.log(`# base ${BASE}  tables=${fixture.tables.length}`);
  console.log("    p50    q   seq    bytes  st  surface");

  const customer = new Client();
  await clearLimits();
  const session = await customer.post("/api/table-sessions", {
    tableToken: fixture.tables[0].rawToken,
  });
  if (session.status !== 200) {
    throw new Error(`table session ${session.status}: ${session.text.slice(0, 300)}`);
  }

  await measure("POST /api/table-sessions", "customer", async () => {
    await clearLimits();
    return customer.post("/api/table-sessions", { tableToken: fixture.tables[0].rawToken });
  });
  await measure("GET /api/menu", "customer", () => customer.get("/api/menu"));
  await measure("GET /api/orders/active", "customer", () => customer.get("/api/orders/active"));
  await measure("GET /menu/{token} (HTML)", "customer", () =>
    customer.get(`/menu/${fixture.tables[0].rawToken}`, { accept: "text/html" }),
  );

  // One real order so the staff/kitchen/cashier surfaces have something to read.
  await clearLimits();
  const created = await customer.post(
    "/api/orders",
    { items: fixture.products.slice(0, 3).map((productId) => ({ productId, quantity: 1 })) },
    { "Idempotency-Key": randomUUID() },
  );
  console.log(
    `         seed order -> ${created.status} (${created.rows.length} statements, ${created.ms.toFixed(0)}ms)`,
  );
  const orderId = created.status < 400 ? JSON.parse(created.text).data.orderId : null;

  await measure(
    "POST /api/orders (create)",
    "customer",
    async () => {
      await clearLimits();
      return customer.post(
        "/api/orders",
        { items: fixture.products.slice(0, 3).map((productId) => ({ productId, quantity: 1 })) },
        { "Idempotency-Key": randomUUID() },
      );
    },
    { repeat: 3 },
  );

  const waiter = await login("WAITER");
  await measure("GET /api/staff/tables", "waiter", () => waiter.get("/api/staff/tables"));
  await measure("GET /api/staff/orders", "waiter", () => waiter.get("/api/staff/orders"));
  await measure("GET /api/staff/calls", "waiter", () => waiter.get("/api/staff/calls"));
  await measure("GET /api/staff/menu", "waiter", () => waiter.get("/api/staff/menu"));
  await measure("GET /staff/tables (HTML)", "waiter", () =>
    waiter.get("/staff/tables", { accept: "text/html" }),
  );
  await measure("GET /staff/orders (HTML)", "waiter", () =>
    waiter.get("/staff/orders", { accept: "text/html" }),
  );

  const kitchen = await login("KITCHEN");
  await measure("GET /kitchen (HTML)", "kitchen", () =>
    kitchen.get("/kitchen", { accept: "text/html" }),
  );
  await measure("GET /api/staff/orders (kitchen)", "kitchen", () => kitchen.get("/api/staff/orders"));

  const cashier = await login("CASHIER");
  await measure("GET /cashier (HTML)", "cashier", () =>
    cashier.get("/cashier", { accept: "text/html" }),
  );
  await measure("GET /api/cashier/shifts/current", "cashier", () =>
    cashier.get("/api/cashier/shifts/current"),
  );

  const admin = await login("ADMIN");
  if (orderId) {
    await measure("GET /api/orders/{id}/ledger", "admin", () =>
      admin.get(`/api/orders/${orderId}/ledger`),
    );
  }
  await measure("GET /admin (HTML)", "admin", () => admin.get("/admin", { accept: "text/html" }));
  await measure("GET /api/admin/menu", "admin", () => admin.get("/api/admin/menu"));
  await measure("GET /api/admin/staff", "admin", () => admin.get("/api/admin/staff"));
  await measure("GET /api/admin/printers", "admin", () => admin.get("/api/admin/printers"));
  await measure("GET /api/admin/settings", "admin", () => admin.get("/api/admin/settings"));
  await measure("GET /admin/reports (HTML)", "admin", () =>
    admin.get("/admin/reports", { accept: "text/html" }),
  );

  const ranges = ["TODAY", "LAST_7_DAYS", "LAST_30_DAYS", "LAST_3_MONTHS", "THIS_YEAR"];
  for (const range of ranges) {
    await measure(
      `GET /api/admin/reports/summary?range=${range}`,
      "admin",
      () => admin.get(`/api/admin/reports/summary?range=${range}`),
      { repeat: 3 },
    );
  }
  const sections = [
    "products",
    "categories",
    "tables",
    "staff",
    "finance",
    "kitchen",
    "busiest",
    "review-alerts",
  ];
  for (const section of sections) {
    await measure(
      `GET /api/admin/reports/${section}?range=LAST_30_DAYS`,
      "admin",
      () => admin.get(`/api/admin/reports/${section}?range=LAST_30_DAYS`),
      { repeat: 3 },
    );
  }
  await measure(
    "GET /api/admin/reports/review-alerts/detail?range=THIS_YEAR",
    "admin",
    () => admin.get("/api/admin/reports/review-alerts/detail?range=THIS_YEAR&page=1&pageSize=50"),
    { repeat: 3 },
  );
  await measure(
    "GET /api/admin/reports?range=LAST_30_DAYS",
    "admin",
    () => admin.get("/api/admin/reports?range=LAST_30_DAYS"),
    { repeat: 3 },
  );

  writeFileSync(outFile, JSON.stringify(results, null, 2), "utf8");
  console.log(`\nwrote ${outFile}`);
  await sql.end({ timeout: 5 });
}

main().catch(async (error) => {
  console.error(error);
  await sql.end({ timeout: 5 });
  process.exitCode = 1;
});
