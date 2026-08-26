/**
 * Phase 32 disposable load/profiling tenant.
 *
 * Creates one clearly namespaced PERF32_ restaurant with its own tables, menu,
 * staff and open cash drawers, so profiling and concurrency runs never touch a
 * live restaurant's rows. `down` removes every row it created plus the auth
 * users it provisioned.
 *
 * State (raw QR tokens, generated staff passwords) is written OUTSIDE the
 * repository, to PERF32_STATE, and is never printed.
 *
 * usage: node --import tsx scripts/perf/fixture.mjs up [tableCount]
 *        node --import tsx scripts/perf/fixture.mjs down
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import nextEnv from "@next/env";
const { loadEnvConfig } = nextEnv;
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

loadEnvConfig(process.cwd());

import { generateQrToken } from "../../lib/security/qr-token.ts";

const PREFIX = "PERF32_";
const STATE_FILE =
  process.env.PERF32_STATE ??
  path.join(process.env.TEMP ?? "/tmp", "perf32", "fixture.json");
const ROLES = ["WAITER", "KITCHEN", "CASHIER", "ADMIN"];
const DRAWER_ROLES = ["WAITER", "CASHIER", "ADMIN"];

function connect() {
  return postgres(process.env.DATABASE_URL, { max: 4, prepare: false, onnotice: () => {} });
}

function adminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function password() {
  return `Perf32!${randomUUID().replaceAll("-", "").slice(0, 20)}`;
}

async function up(tableCount) {
  const pepper = process.env.QR_TOKEN_PEPPER;
  if (!pepper) throw new Error("QR_TOKEN_PEPPER is required.");
  const run = randomUUID().replaceAll("-", "").slice(0, 10);
  const sql = connect();
  const admin = adminClient();

  const fixture = {
    run,
    restaurantId: randomUUID(),
    categoryId: randomUUID(),
    products: Array.from({ length: 3 }, () => randomUUID()),
    tables: [],
    staff: {},
    registers: {},
    shifts: {},
  };

  for (const role of ROLES) {
    const credential = {
      staffId: randomUUID(),
      email: `perf32-${run}-${role.toLowerCase()}@example.invalid`,
      password: password(),
      authUserId: null,
    };
    const created = await admin.auth.admin.createUser({
      email: credential.email,
      password: credential.password,
      email_confirm: true,
    });
    if (created.error || !created.data.user) {
      throw new Error(`auth user ${role}: ${created.error?.message ?? "missing"}`);
    }
    credential.authUserId = created.data.user.id;
    fixture.staff[role] = credential;
  }

  await sql`insert into restaurants (id, name, slug) values
    (${fixture.restaurantId}, ${`${PREFIX}Yuk Testi`}, ${`perf32-${run}`})`;
  await sql`insert into restaurant_settings (restaurant_id) values (${fixture.restaurantId})`;

  for (const role of ROLES) {
    const credential = fixture.staff[role];
    await sql`insert into staff_profiles
      (id, auth_user_id, restaurant_id, name, email, login_identifier, role, is_active) values
      (${credential.staffId}, ${credential.authUserId}, ${fixture.restaurantId},
       ${`${PREFIX}${role}`}, ${credential.email}, ${`perf32-${run}-${role.toLowerCase()}`},
       ${role}, true)`;
  }

  await sql`insert into categories (id, restaurant_id, name, slug) values
    (${fixture.categoryId}, ${fixture.restaurantId}, ${`${PREFIX}Kategori`}, ${`perf32-cat-${run}`})`;
  for (const [index, productId] of fixture.products.entries()) {
    await sql`insert into products
      (id, restaurant_id, category_id, name, slug, price, is_active, is_available) values
      (${productId}, ${fixture.restaurantId}, ${fixture.categoryId},
       ${`${PREFIX}Urun ${index + 1}`}, ${`perf32-u${index + 1}-${run}`},
       ${(50 + index * 25).toFixed(2)}, true, true)`;
  }

  for (const role of DRAWER_ROLES) {
    const registerId = randomUUID();
    const shiftId = randomUUID();
    const name = `${PREFIX}Kasa ${role}`;
    await sql`insert into cash_registers (id, restaurant_id, name, code) values
      (${registerId}, ${fixture.restaurantId}, ${name}, ${`P32${run.toUpperCase().slice(0, 6)}${role.slice(0, 3)}`})`;
    await sql`insert into cashier_shifts
      (id, restaurant_id, cash_register_id, register_name_snapshot,
       opened_by_staff_id, opening_cash, status) values
      (${shiftId}, ${fixture.restaurantId}, ${registerId}, ${name},
       ${fixture.staff[role].staffId}, '0.00', 'OPEN')`;
    fixture.registers[role] = registerId;
    fixture.shifts[role] = shiftId;
  }

  for (let index = 0; index < tableCount; index++) {
    const token = generateQrToken(pepper);
    const table = {
      id: randomUUID(),
      number: 9000 + index,
      rawToken: token.rawToken,
    };
    await sql`insert into restaurant_tables
      (id, restaurant_id, name, table_number, seats, qr_token_hash) values
      (${table.id}, ${fixture.restaurantId}, ${`${PREFIX}Masa ${index + 1}`},
       ${table.number}, 4, ${token.tokenHash})`;
    fixture.tables.push(table);
  }

  mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(fixture, null, 2), "utf8");
  await sql.end({ timeout: 5 });

  console.log(`PERF32 fixture ready: restaurant ${fixture.restaurantId}`);
  console.log(`tables=${fixture.tables.length} products=${fixture.products.length}`);
  console.log(`state written to ${STATE_FILE} (outside the repository)`);
}

async function down() {
  if (!existsSync(STATE_FILE)) {
    console.log("no PERF32 state file; nothing to remove");
    return;
  }
  const fixture = JSON.parse(readFileSync(STATE_FILE, "utf8"));
  const sql = connect();
  const admin = adminClient();
  const ids = [fixture.restaurantId];
  const ordered = [
    "payment_refunds", "payments", "order_check_items", "order_checks",
    "print_job_attempts", "print_jobs", "printer_routes", "restaurant_printers", "printer_agents",
    "order_events", "audit_logs", "outbox_events", "idempotency_keys",
    "waiter_calls", "order_items", "orders",
    "cash_drawer_movements", "cashier_shifts", "cash_registers",
    "restaurant_tables", "products", "categories",
    "staff_profiles", "restaurant_settings", "restaurant_counters",
  ];
  const failures = [];
  for (const table of ordered) {
    await sql
      .unsafe(`delete from ${table} where restaurant_id = any($1::uuid[])`, [ids])
      .catch((error) => failures.push(`${table}: ${error.message}`));
  }
  await sql`delete from restaurants where id = any(${ids})`.catch((error) =>
    failures.push(`restaurants: ${error.message}`),
  );
  for (const credential of Object.values(fixture.staff)) {
    if (!credential.authUserId) continue;
    const { error } = await admin.auth.admin.deleteUser(credential.authUserId);
    if (error) failures.push(`auth ${credential.staffId}: ${error.message}`);
  }
  await sql.end({ timeout: 5 });
  rmSync(STATE_FILE, { force: true });
  if (failures.length > 0) {
    console.error("PERF32 cleanup incomplete:", failures.join(" | "));
    process.exitCode = 1;
  } else {
    console.log("PERF32 fixture removed");
  }
}

const [command, count] = process.argv.slice(2);
if (command === "up") await up(Number(count ?? 50));
else if (command === "down") await down();
else {
  console.error("usage: fixture.mjs up [tableCount] | down");
  process.exitCode = 2;
}
