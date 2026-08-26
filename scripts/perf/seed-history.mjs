/**
 * Phase 32 sections B4/B5/C3 — a year of history for the disposable PERF32
 * tenant, so long-range reports are measured against a data volume a real
 * restaurant reaches rather than against a hundred rows where PostgreSQL is
 * right to scan the table.
 *
 * Rows are generated server-side from generate_series, so the size of the
 * dataset costs no network round trips. Everything it writes carries the
 * PERF32 restaurant_id and is removed by `fixture.mjs down`.
 *
 * usage: node --import tsx scripts/perf/seed-history.mjs [orders] [days]
 *        node --import tsx scripts/perf/seed-history.mjs clean
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

const [{ name }] = await sql`select name from restaurants where id = ${fixture.restaurantId}`;
if (!name?.startsWith("PERF32_")) {
  throw new Error(`refusing to seed '${name}': not a PERF32 disposable tenant`);
}

const command = process.argv[2];
const orderCount = Number(command === "clean" ? 0 : (command ?? 100_000));
const days = Number(process.argv[3] ?? 400);
const marker = "PERF32_SYNTHETIC";

async function clean() {
  // Synthetic rows are the ones whose notes carry the marker; the rows the
  // load scenarios created through the API are left alone.
  const ids = sql`select id from orders
    where restaurant_id = ${fixture.restaurantId} and notes = ${marker}`;
  await sql`delete from payments where restaurant_id = ${fixture.restaurantId}
    and order_id in (${ids})`;
  await sql`delete from order_items where restaurant_id = ${fixture.restaurantId}
    and order_id in (${ids})`;
  await sql`delete from orders where restaurant_id = ${fixture.restaurantId}
    and notes = ${marker}`;
  console.log("synthetic history removed");
}

async function seed() {
  const started = Date.now();
  const [{ max_sequence: maxSequence }] = await sql`
    select coalesce(max(order_sequence), 0)::bigint as max_sequence
    from orders where restaurant_id = ${fixture.restaurantId}`;
  const base = Number(maxSequence) + 1;

  await sql`
    insert into orders (
      id, restaurant_id, table_id, order_sequence, order_number, status,
      subtotal, service_charge_total, tax_total, total, notes,
      created_by_type, created_at, updated_at, served_at, closed_at
    )
    select
      gen_random_uuid(),
      ${fixture.restaurantId},
      tables.id,
      ${base} + n,
      'ORD-' || lpad((${base} + n)::text, 6, '0'),
      'COMPLETED'::order_status,
      amounts.subtotal,
      round(amounts.subtotal * 0.10, 2),
      round(amounts.subtotal * 1.10 * 0.10, 2),
      round(amounts.subtotal * 1.21, 2),
      ${marker},
      'CUSTOMER'::order_creator_type,
      moment, moment, moment + interval '25 minutes', moment + interval '55 minutes'
    from generate_series(0, ${orderCount - 1}) as n
    cross join lateral (
      select (
        now()
        - (n % ${days}) * interval '1 day'
        + ((n * 37) % 720) * interval '1 minute'
        - interval '11 hours'
      ) as moment
    ) as moments
    cross join lateral (
      select round((90 + (n * 17) % 400)::numeric, 2) as subtotal
    ) as amounts
    cross join lateral (
      select id from restaurant_tables
      where restaurant_id = ${fixture.restaurantId}
      order by table_number offset (n % 20) limit 1
    ) as tables`;
  console.log(`orders inserted in ${((Date.now() - started) / 1000).toFixed(1)}s`);

  const itemsStarted = Date.now();
  await sql`
    insert into order_items (
      id, restaurant_id, order_id, product_id, product_name_snapshot,
      unit_price, quantity, line_total, status, sort_order, created_at, updated_at
    )
    select
      gen_random_uuid(), ${fixture.restaurantId}, o.id, p.id, p.name,
      p.price, 1, p.price, 'SERVED'::order_item_status, line.n, o.created_at, o.created_at
    from orders o
    join lateral generate_series(0, 2) as line(n) on true
    join lateral (
      select id, name, price from products
      where restaurant_id = ${fixture.restaurantId}
      order by slug offset (line.n % 3) limit 1
    ) as p on true
    where o.restaurant_id = ${fixture.restaurantId} and o.notes = ${marker}
      and not exists (select 1 from order_items i where i.order_id = o.id)`;
  console.log(`items inserted in ${((Date.now() - itemsStarted) / 1000).toFixed(1)}s`);

  const paymentsStarted = Date.now();
  await sql`
    insert into payments (
      id, restaurant_id, order_id, amount, method, status,
      created_by_user_id, processed_at, created_at, updated_at, cashier_shift_id
    )
    select
      gen_random_uuid(), ${fixture.restaurantId}, o.id, o.total,
      (array['CASH','CARD','OTHER'])[1 + (o.order_sequence % 3)]::payment_method,
      'COMPLETED'::payment_status,
      ${fixture.staff.CASHIER.staffId},
      o.closed_at, o.closed_at, o.closed_at, ${fixture.shifts.CASHIER}
    from orders o
    where o.restaurant_id = ${fixture.restaurantId} and o.notes = ${marker}
      and not exists (select 1 from payments p where p.order_id = o.id)`;
  console.log(`payments inserted in ${((Date.now() - paymentsStarted) / 1000).toFixed(1)}s`);

  // The synthetic rows consume order sequence numbers directly, so the tenant's
  // counter has to be moved past them; otherwise the next order created through
  // the API allocates a number that already exists and the insert is rejected.
  await sql`
    update restaurant_counters
       set current_value = (
         select max(order_sequence) from orders where restaurant_id = ${fixture.restaurantId}
       )
     where restaurant_id = ${fixture.restaurantId} and counter_name = 'ORDER'`;

  await sql.unsafe("analyze orders");
  await sql.unsafe("analyze order_items");
  await sql.unsafe("analyze payments");

  const [totals] = await sql`
    select
      (select count(*)::int from orders where restaurant_id = ${fixture.restaurantId}) as orders,
      (select count(*)::int from order_items where restaurant_id = ${fixture.restaurantId}) as items,
      (select count(*)::int from payments where restaurant_id = ${fixture.restaurantId}) as payments`;
  console.log(
    `tenant now holds orders=${totals.orders} items=${totals.items} payments=${totals.payments} ` +
      `(${((Date.now() - started) / 1000).toFixed(1)}s total)`,
  );
}

try {
  if (command === "clean") await clean();
  else await seed();
} finally {
  await sql.end({ timeout: 5 });
}
