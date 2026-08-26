import { readFileSync, statSync, openSync, readSync, closeSync } from "node:fs";
import path from "node:path";
import nextEnv from "@next/env"; const { loadEnvConfig } = nextEnv;
import postgres from "postgres";
loadEnvConfig(process.cwd());
import { createRateLimitKey } from "../../lib/security/rate-limit.ts";
import { createHash } from "node:crypto";

const BASE = "http://localhost:3100";
const STATE = process.env.PERF32_STATE ?? path.join(process.env.TEMP ?? "/tmp", "perf32", "fixture.json");
const fx = JSON.parse(readFileSync(STATE, "utf8"));
const LOG = process.argv[2];
const sql = postgres(process.env.DATABASE_URL, { max: 2, prepare: false, onnotice: () => {} });
const secret = process.env.RATE_LIMIT_KEY_SECRET ?? process.env.AUTH_SECRET;
const addresses = ["::1", "127.0.0.1", "::ffff:127.0.0.1", "localhost", "unknown"];
const keys = [];
for (const address of addresses) {
  const fingerprint = createHash("sha256").update(address, "utf8").digest("hex").slice(0, 32);
  keys.push(createRateLimitKey({ action: "STAFF_LOGIN", actorType: "CLIENT_IP", actorId: fingerprint }, secret));
  for (const actorId of [...Object.values(fx.staff).map((s) => s.email), address]) {
    keys.push(createRateLimitKey({ action: "STAFF_LOGIN", actorType: "CLIENT_IP", actorId, clientFingerprint: fingerprint }, secret));
  }
}
await sql`delete from api_rate_limits where key_hash = any(${keys})`;

const cookies = new Map();
const jar = () => [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
const size = () => { try { return statSync(LOG).size; } catch { return 0; } };
function slice(a, b) { if (b <= a) return []; const buf = Buffer.alloc(b - a); const fd = openSync(LOG, "r"); readSync(fd, buf, 0, buf.length, a); closeSync(fd); return buf.toString("utf8").split(/\r?\n/).filter((l) => l.startsWith("[SQLPERF]")); }

let response = await fetch(new URL("/api/staff/login", BASE), {
  method: "POST", headers: { Origin: BASE, "Content-Type": "application/json" },
  body: JSON.stringify({ identifier: fx.staff.ADMIN.email, password: fx.staff.ADMIN.password }),
});
for (const raw of response.headers.getSetCookie()) { const [p] = raw.split(";"); const i = p.indexOf("="); if (i > 0) cookies.set(p.slice(0, i).trim(), p.slice(i + 1).trim()); }
if (response.status !== 200) throw new Error(`admin login ${response.status}`);

async function timed(url) {
  const before = size();
  const started = process.hrtime.bigint();
  const res = await fetch(new URL(url, BASE), { headers: { Cookie: jar(), Accept: "application/json" } });
  const text = await res.text();
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  await new Promise((r) => setTimeout(r, 60));
  return { status: res.status, ms, bytes: Buffer.byteLength(text), statements: slice(before, size()).length, text };
}

const ranges = ["TODAY", "LAST_7_DAYS", "LAST_30_DAYS", "LAST_3_MONTHS", "LAST_6_MONTHS", "THIS_YEAR", "SINCE_SYSTEM_START"];
const sections = ["summary", "finance", "products", "categories", "tables", "staff", "kitchen", "busiest", "review-alerts"];

const [counts] = await sql`select
  (select count(*)::int from orders where restaurant_id=${fx.restaurantId}) o,
  (select count(*)::int from order_items where restaurant_id=${fx.restaurantId}) i,
  (select count(*)::int from payments where restaurant_id=${fx.restaurantId}) p`;
console.log(`# dataset: orders=${counts.o} items=${counts.i} payments=${counts.p}`);
console.log("     ms   stmts    bytes  heap(MB)  endpoint");

for (const range of ranges) {
  await timed(`/api/admin/reports/summary?range=${range}`);
  const before = process.memoryUsage().heapUsed;
  const r = await timed(`/api/admin/reports/summary?range=${range}`);
  console.log(`${String(Math.round(r.ms)).padStart(7)}  ${String(r.statements).padStart(5)}  ${String(r.bytes).padStart(7)}  ${((process.memoryUsage().heapUsed - before) / 1e6).toFixed(1).padStart(8)}  summary ${range}${r.status !== 200 ? " STATUS " + r.status : ""}`);
}
for (const section of sections) {
  await timed(`/api/admin/reports/${section}?range=THIS_YEAR`);
  const r = await timed(`/api/admin/reports/${section}?range=THIS_YEAR`);
  console.log(`${String(Math.round(r.ms)).padStart(7)}  ${String(r.statements).padStart(5)}  ${String(r.bytes).padStart(7)}  ${" ".padStart(8)}  ${section} THIS_YEAR${r.status !== 200 ? " STATUS " + r.status + " " + r.text.slice(0, 120) : ""}`);
}
for (const page of [1, 5, 20]) {
  const r = await timed(`/api/admin/reports/review-alerts/detail?range=THIS_YEAR&page=${page}&pageSize=50`);
  console.log(`${String(Math.round(r.ms)).padStart(7)}  ${String(r.statements).padStart(5)}  ${String(r.bytes).padStart(7)}  ${" ".padStart(8)}  review-detail page=${page}`);
}
for (const label of ["products", "tables"]) {
  const r = await timed(`/api/admin/reports/${label}?range=THIS_YEAR&pageSize=200`);
  console.log(`${String(Math.round(r.ms)).padStart(7)}  ${String(r.statements).padStart(5)}  ${String(r.bytes).padStart(7)}  ${" ".padStart(8)}  ${label} pageSize=200`);
}
const staffTables = await timed("/api/staff/tables");
console.log(`${String(Math.round(staffTables.ms)).padStart(7)}  ${String(staffTables.statements).padStart(5)}  ${String(staffTables.bytes).padStart(7)}  ${" ".padStart(8)}  /api/staff/tables (50 tables, 100k orders)`);
const staffOrders = await timed("/api/staff/orders");
console.log(`${String(Math.round(staffOrders.ms)).padStart(7)}  ${String(staffOrders.statements).padStart(5)}  ${String(staffOrders.bytes).padStart(7)}  ${" ".padStart(8)}  /api/staff/orders`);

await sql.end({ timeout: 5 });
