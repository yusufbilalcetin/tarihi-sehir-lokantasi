import { randomBytes, randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

import { generateQrToken, hashQrToken } from "../../lib/security/qr-token";
import { readSupabaseIntegrationEnvironment } from "./supabase-test-environment";

/**
 * Phase 7D.3 — the disposable fixture the HTTP E2E suite talks to.
 *
 * Provisioned over the pooler connection (business rows) and the Auth Admin API
 * (staff accounts), then torn down in reverse foreign-key order. The raw QR
 * token is produced by the application's own issuance helper and exists only in
 * this process's memory: the database keeps the hash.
 */

export const PHASE7D3_PREFIX = "PHASE7D3_";

export interface Phase7d3Credential {
  readonly email: string;
  readonly password: string;
  readonly staffId: string;
  authUserId: string | null;
}

export interface Phase7d3Fixture {
  readonly run: string;
  readonly restaurantA: string;
  readonly restaurantB: string;
  readonly categoryId: string;
  readonly productA: string;
  readonly productB: string;
  readonly tableA: string;
  readonly tableB: string;
  readonly tableC: string;
  readonly foreignTable: string;
  readonly foreignProduct: string;
  /** Never written to the database, never logged. */
  readonly rawTableToken: string;
  readonly rawTableTokenC: string;
  readonly cashRegisterIds: Readonly<Record<(typeof PAYMENT_ROLES)[number], string>>;
  /** One open drawer per paying role; the drawer is resolved per staff member. */
  readonly shiftIds: Readonly<Record<(typeof PAYMENT_ROLES)[number], string>>;
  readonly staff: Readonly<Record<string, Phase7d3Credential>>;
}

const ROLES = ["ADMIN", "MANAGER", "WAITER", "KITCHEN", "CASHIER"] as const;

/** Mirrors PAYMENT_ROLES in payment-service: the roles allowed to collect. */
const PAYMENT_ROLES = ["ADMIN", "MANAGER", "CASHIER"] as const;

function newPassword(): string {
  return `P7d3-${randomBytes(24).toString("base64url")}-aA1!`;
}

export function newPhase7d3Fixture(): Phase7d3Fixture {
  const run = randomBytes(5).toString("hex");
  const staff: Record<string, Phase7d3Credential> = {};
  for (const role of ROLES) {
    staff[role] = {
      email: `phase7d3-${run}-${role.toLowerCase()}@example.com`,
      password: newPassword(),
      staffId: randomUUID(),
      authUserId: null,
    };
  }
  staff.FOREIGN = {
    email: `phase7d3-${run}-foreign@example.com`,
    password: newPassword(),
    staffId: randomUUID(),
    authUserId: null,
  };

  const pepper = process.env.QR_TOKEN_PEPPER;
  if (!pepper) throw new Error("QR_TOKEN_PEPPER is required to issue a fixture QR token.");
  const tokenA = generateQrToken(pepper);
  const tokenC = generateQrToken(pepper);

  return {
    run,
    restaurantA: randomUUID(),
    restaurantB: randomUUID(),
    categoryId: randomUUID(),
    productA: randomUUID(),
    productB: randomUUID(),
    tableA: randomUUID(),
    tableB: randomUUID(),
    tableC: randomUUID(),
    foreignTable: randomUUID(),
    foreignProduct: randomUUID(),
    rawTableToken: tokenA.rawToken,
    rawTableTokenC: tokenC.rawToken,
    cashRegisterIds: Object.fromEntries(
      PAYMENT_ROLES.map((role) => [role, randomUUID()]),
    ) as Record<(typeof PAYMENT_ROLES)[number], string>,
    shiftIds: Object.fromEntries(
      PAYMENT_ROLES.map((role) => [role, randomUUID()]),
    ) as Record<(typeof PAYMENT_ROLES)[number], string>,
    staff,
  };
}

type Sql = ReturnType<typeof postgres>;

export async function provisionPhase7d3(fixture: Phase7d3Fixture): Promise<{
  sql: Sql;
  /** Ends the pool without touching the fixture. */
  disconnect: () => Promise<void>;
  /** Removes the fixture, then ends the pool. */
  close: () => Promise<void>;
}> {
  const readiness = readSupabaseIntegrationEnvironment({ requireDatabaseUrl: true });
  if (!readiness.ready) throw new Error(readiness.reason);
  const environment = readiness.environment;

  const admin = createClient(environment.url, environment.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const sql = postgres(environment.databaseUrl!, { max: 4, prepare: false, onnotice: () => {} });
  const pepper = process.env.QR_TOKEN_PEPPER!;

  for (const key of Object.keys(fixture.staff)) {
    const credential = fixture.staff[key];
    const created = await admin.auth.admin.createUser({
      email: credential.email,
      password: credential.password,
      email_confirm: true,
    });
    if (created.error || !created.data.user) {
      throw new Error(`fixture auth user ${key}: ${created.error?.message ?? "missing"}`);
    }
    credential.authUserId = created.data.user.id;
  }

  const { run } = fixture;
  await sql`insert into restaurants (id, name, slug) values
    (${fixture.restaurantA}, ${`${PHASE7D3_PREFIX}Tenant A`}, ${`phase7d3-a-${run}`}),
    (${fixture.restaurantB}, ${`${PHASE7D3_PREFIX}Tenant B`}, ${`phase7d3-b-${run}`})`;
  await sql`insert into restaurant_settings (restaurant_id) values
    (${fixture.restaurantA}), (${fixture.restaurantB})`;

  for (const role of ROLES) {
    const credential = fixture.staff[role];
    await sql`insert into staff_profiles
      (id, auth_user_id, restaurant_id, name, email, login_identifier, role, is_active) values
      (${credential.staffId}, ${credential.authUserId}, ${fixture.restaurantA},
       ${`${PHASE7D3_PREFIX}${role}`}, ${credential.email},
       ${`p7d3-${run}-${role.toLowerCase()}`}, ${role}, true)`;
  }
  const foreign = fixture.staff.FOREIGN;
  // ADMIN on purpose: the cross-tenant assertions are meant to prove tenant
  // isolation, so the foreign account must be able to clear the role gate.
  // A WAITER would stop at 403 and the tenant check would never be reached,
  // which quietly turns every "wrong tenant" test into a "wrong role" test.
  await sql`insert into staff_profiles
    (id, auth_user_id, restaurant_id, name, email, login_identifier, role, is_active) values
    (${foreign.staffId}, ${foreign.authUserId}, ${fixture.restaurantB},
     ${`${PHASE7D3_PREFIX}FOREIGN`}, ${foreign.email}, ${`p7d3-${run}-foreign`}, 'ADMIN', true)`;

  await sql`insert into categories (id, restaurant_id, name, slug) values
    (${fixture.categoryId}, ${fixture.restaurantA}, ${`${PHASE7D3_PREFIX}Kategori`}, ${`p7d3-cat-${run}`})`;
  // Deterministic prices so pricing manipulation is unambiguous.
  await sql`insert into products (id, restaurant_id, category_id, name, slug, price, is_active, is_available) values
    (${fixture.productA}, ${fixture.restaurantA}, ${fixture.categoryId},
     ${`${PHASE7D3_PREFIX}Ana`}, ${`p7d3-ana-${run}`}, '100.00', true, true),
    (${fixture.productB}, ${fixture.restaurantA}, ${fixture.categoryId},
     ${`${PHASE7D3_PREFIX}Yan`}, ${`p7d3-yan-${run}`}, '75.50', true, true)`;

  const foreignCategory = randomUUID();
  await sql`insert into categories (id, restaurant_id, name, slug) values
    (${foreignCategory}, ${fixture.restaurantB}, ${`${PHASE7D3_PREFIX}Kategori B`}, ${`p7d3-catb-${run}`})`;
  await sql`insert into products (id, restaurant_id, category_id, name, slug, price) values
    (${fixture.foreignProduct}, ${fixture.restaurantB}, ${foreignCategory},
     ${`${PHASE7D3_PREFIX}Yabanci`}, ${`p7d3-yabanci-${run}`}, '999.00')`;

  // Phase 8A made an open cash drawer a precondition for taking money, and the
  // drawer is resolved per staff member, not per restaurant. Without a shift of
  // their own every collection in these suites stops at CASHIER_SHIFT_REQUIRED
  // before it can reach the assertion it exists to make.
  // One register per paying role, because a register may hold only one open
  // shift at a time — a physical drawer cannot be two people's responsibility.
  for (const role of PAYMENT_ROLES) {
    const registerName = `${PHASE7D3_PREFIX}Kasa ${role}`;
    await sql`insert into cash_registers (id, restaurant_id, name, code) values
      (${fixture.cashRegisterIds[role]}, ${fixture.restaurantA}, ${registerName},
       ${`P7D3${run.toUpperCase()}${role}`})`;
    await sql`insert into cashier_shifts
      (id, restaurant_id, cash_register_id, register_name_snapshot,
       opened_by_staff_id, opening_cash, status) values
      (${fixture.shiftIds[role]}, ${fixture.restaurantA}, ${fixture.cashRegisterIds[role]},
       ${registerName}, ${fixture.staff[role].staffId}, '0.00', 'OPEN')`;
  }

  await sql`insert into restaurant_tables (id, restaurant_id, name, table_number, qr_token_hash) values
    (${fixture.tableA}, ${fixture.restaurantA}, ${`${PHASE7D3_PREFIX}Masa 1`}, 8401,
     ${generateQrToken(pepper).tokenHash}),
    (${fixture.tableB}, ${fixture.restaurantA}, ${`${PHASE7D3_PREFIX}Masa 2`}, 8402,
     ${generateQrToken(pepper).tokenHash}),
    (${fixture.tableC}, ${fixture.restaurantA}, ${`${PHASE7D3_PREFIX}Masa 3`}, 8403,
     ${generateQrToken(pepper).tokenHash}),
    (${fixture.foreignTable}, ${fixture.restaurantB}, ${`${PHASE7D3_PREFIX}Masa B`}, 8404,
     ${generateQrToken(pepper).tokenHash})`;

  // The two tables the HTTP suite drives get the tokens whose raw values this
  // process holds; every other table keeps a throwaway hash.
  await sql`update restaurant_tables set qr_token_hash = ${hashQrToken(fixture.rawTableToken, pepper)}
    where id = ${fixture.tableA}`;
  await sql`update restaurant_tables set qr_token_hash = ${hashQrToken(fixture.rawTableTokenC, pepper)}
    where id = ${fixture.tableC}`;

  return {
    sql,
    disconnect: async () => {
      await sql.end({ timeout: 5 });
    },
    close: async () => {
      await cleanupPhase7d3(fixture, sql, admin);
      await sql.end({ timeout: 5 });
    },
  };
}

/** The Auth Admin surface this cleanup needs, kept narrow on purpose. */
type AuthAdmin = { auth: { admin: { deleteUser(id: string): Promise<{ error: { message: string } | null }> } } };

export async function cleanupPhase7d3(
  fixture: Phase7d3Fixture,
  sql: Sql,
  admin: AuthAdmin,
): Promise<string[]> {
  const errors: string[] = [];
  const order = [
    "payment_refunds", "payments", "order_check_items", "order_checks",
    "order_events", "audit_logs", "outbox_events", "idempotency_keys",
    "waiter_calls", "order_items", "orders", "restaurant_tables",
    "cash_drawer_movements", "cashier_shifts", "cash_registers",
    "products", "categories", "restaurant_settings", "restaurant_counters",
    "staff_profiles", "restaurants",
  ];
  try {
    for (const table of order) {
      const column = table === "restaurants" ? "id" : "restaurant_id";
      await sql.unsafe(`delete from ${table} where ${column} = any($1::uuid[])`, [
        [fixture.restaurantA, fixture.restaurantB],
      ]);
    }
  } catch (error) {
    errors.push(`rows: ${(error as Error).message}`);
  }
  for (const credential of Object.values(fixture.staff)) {
    if (!credential.authUserId) continue;
    const { error } = await admin.auth.admin.deleteUser(credential.authUserId);
    if (error) errors.push(`auth user: ${error.message}`);
  }
  return errors;
}
