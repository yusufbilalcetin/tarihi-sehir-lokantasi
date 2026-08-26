/**
 * Phase 32 sections B4-B7 — real plans for the query shapes the panels and the
 * reports actually issue, against the PERF32 tenant's seeded year of history.
 *
 * Read-only: EXPLAIN ANALYZE runs the SELECT, and nothing here writes.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import nextEnv from "@next/env";
const { loadEnvConfig } = nextEnv;
import postgres from "postgres";
loadEnvConfig(process.cwd());

const STATE_FILE =
  process.env.PERF32_STATE ?? path.join(process.env.TEMP ?? "/tmp", "perf32", "fixture.json");
const fixture = JSON.parse(readFileSync(STATE_FILE, "utf8"));
const sql = postgres(process.env.DATABASE_URL, { max: 2, prepare: false, onnotice: () => {} });
const tenant = fixture.restaurantId;

const QUERIES = [
  [
    "floor: open orders per table (staff/tables)",
    `select t.id, o.id, o.order_number, o.total
       from restaurant_tables t
       left join lateral (
         select id, order_number, total from orders
         where restaurant_id = $1 and table_id = t.id
           and status in ('NEW','CONFIRMED','PREPARING','READY','SERVED')
         order by created_at desc limit 1
       ) o on true
      where t.restaurant_id = $1`,
  ],
  [
    "kitchen/floor: active orders by status, newest first",
    `select id, order_number, total, created_at from orders
      where restaurant_id = $1 and status in ('NEW','CONFIRMED','PREPARING','READY')
      order by created_at desc limit 50`,
  ],
  [
    "report: order totals over a 365-day range",
    `select coalesce(sum(total), 0), count(*)::int from orders
      where restaurant_id = $1 and created_at >= now() - interval '365 days'
        and created_at < now()`,
  ],
  [
    "report: daily revenue series over 365 days",
    `select to_char(created_at, 'YYYY-MM-DD'), coalesce(sum(total), 0), count(*)::int
       from orders
      where restaurant_id = $1 and created_at >= now() - interval '365 days'
      group by 1 order by 1`,
  ],
  [
    "report: best sellers over 365 days (orders x order_items)",
    `select i.product_name_snapshot, sum(i.quantity)::int, coalesce(sum(i.line_total), 0)
       from order_items i
       join orders o on o.id = i.order_id and o.restaurant_id = i.restaurant_id
      where i.restaurant_id = $1 and o.created_at >= now() - interval '365 days'
      group by 1 order by 2 desc limit 20`,
  ],
  [
    "report: collections by method over 365 days",
    `select method, count(*)::int, coalesce(sum(amount), 0) from payments
      where restaurant_id = $1 and status = 'COMPLETED'
        and created_at >= now() - interval '365 days'
      group by method`,
  ],
  [
    "till: one shift's collected total",
    `select coalesce(sum(amount), 0), count(*)::int from payments
      where restaurant_id = $1 and cashier_shift_id = $2 and status = 'COMPLETED'`,
  ],
  [
    "review detail: newest voids, one page",
    `select id, voided_at, line_total from order_items
      where restaurant_id = $1 and status = 'VOIDED'
        and voided_at >= now() - interval '365 days'
      order by voided_at desc limit 50`,
  ],
];

function digest(plan) {
  const text = plan.join("\n");
  const nodes = [...text.matchAll(/->\s{2}(\w[\w ]*?Scan)[a-z ]* on (\w+)/g)].map(
    (match) => `${match[1]} on ${match[2]}`,
  );
  const top = text.match(/^(\w[\w ]*?Scan)[a-z ]* on (\w+)/);
  if (top) nodes.unshift(`${top[1]} on ${top[2]}`);
  const planning = text.match(/Planning Time: ([\d.]+) ms/)?.[1];
  const execution = text.match(/Execution Time: ([\d.]+) ms/)?.[1];
  const buffers = text.match(/Buffers: shared ([^\n]+)/)?.[1];
  const sorts = [...text.matchAll(/Sort Method: ([^\n]+)/g)].map((match) => match[1].trim());
  return { nodes: [...new Set(nodes)], planning, execution, buffers, sorts };
}

console.log(`# plans for PERF32 tenant, ${new Date().toISOString()}`);
for (const [label, text] of QUERIES) {
  const parameters = text.includes("$2") ? [tenant, fixture.shifts.CASHIER] : [tenant];
  const rows = await sql.unsafe(
    `explain (analyze, buffers, verbose false) ${text}`,
    parameters,
  );
  const plan = rows.map((row) => row["QUERY PLAN"]);
  const summary = digest(plan);
  console.log(`\n## ${label}`);
  console.log(`   planning=${summary.planning}ms execution=${summary.execution}ms`);
  console.log(`   access: ${summary.nodes.join(" | ") || "(see plan)"}`);
  if (summary.buffers) console.log(`   buffers: shared ${summary.buffers}`);
  if (summary.sorts.length) console.log(`   sort: ${summary.sorts.join(" | ")}`);
  const seq = summary.nodes.filter((node) => node.startsWith("Seq Scan"));
  if (seq.length) console.log(`   !! sequential scan: ${seq.join(", ")}`);
}

await sql.end({ timeout: 5 });
