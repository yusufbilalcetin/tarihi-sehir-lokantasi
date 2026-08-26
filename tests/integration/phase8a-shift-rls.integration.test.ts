import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";

import { readSupabaseIntegrationEnvironment } from "./supabase-test-environment";

/**
 * Phase 8A — the cash tables are not reachable from a browser session.
 *
 * A real Supabase Auth cashier signs in and then tries, through the Data API,
 * exactly the writes the application performs server-side. Every one of them
 * must fail. This is the check that keeps "the service enforces it" from being
 * the only thing standing between a signed-in cashier and their own drawer
 * figures.
 */

const PREFIX = "PHASE8A_";
const readiness = readSupabaseIntegrationEnvironment({ requireDatabaseUrl: true });

if (!readiness.ready) {
  test("Phase 8A cash-table RLS", { skip: readiness.reason }, () => undefined);
} else {
  const environment = readiness.environment;
  const run = randomBytes(6).toString("hex");
  const ids = {
    restaurant: randomUUID(),
    cashier: randomUUID(),
    register: randomUUID(),
    shift: randomUUID(),
  };
  const account = {
    email: `phase8a-${run}-cashier@example.com`,
    password: `Pw-${randomBytes(18).toString("base64url")}`,
    authUserId: null as string | null,
  };

  const admin = createClient(environment.url, environment.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const sql = postgres(environment.databaseUrl!, { max: 2, prepare: false, onnotice: () => {} });
  const cleanupErrors: string[] = [];
  let cashier: SupabaseClient;
  let assertions = 0;

  function check(condition: boolean, message: string): void {
    assertions += 1;
    assert.ok(condition, message);
  }

  /** A blocked write is either an explicit error or zero affected rows. */
  function refused(result: { error: unknown; data: unknown }): boolean {
    return Boolean(result.error) || (Array.isArray(result.data) && result.data.length === 0);
  }

  describe("Phase 8A cash tables are server-only", { concurrency: false }, () => {
    before(async () => {
      const created = await admin.auth.admin.createUser({
        email: account.email,
        password: account.password,
        email_confirm: true,
      });
      if (created.error || !created.data.user) {
        throw new Error(`auth user: ${created.error?.message ?? "missing"}`);
      }
      account.authUserId = created.data.user.id;

      await sql`insert into restaurants (id, name, slug) values
        (${ids.restaurant}, ${`${PREFIX}RLS Tenant`}, ${`phase8a-rls-${run}`})`;
      await sql`insert into restaurant_settings (restaurant_id) values (${ids.restaurant})`;
      await sql`insert into staff_profiles (id, restaurant_id, auth_user_id, name,
          login_identifier, role, is_active) values
        (${ids.cashier}, ${ids.restaurant}, ${account.authUserId}, ${`${PREFIX}Kasiyer`},
         ${`p8a-rls-${run}`}, 'CASHIER', true)`;
      await sql`insert into cash_registers (id, restaurant_id, name, code) values
        (${ids.register}, ${ids.restaurant}, ${`${PREFIX}Kasa`}, ${`P8AR${run.slice(0, 6).toUpperCase()}`})`;
      await sql`insert into cashier_shifts (id, restaurant_id, cash_register_id,
          register_name_snapshot, opened_by_staff_id, opening_cash) values
        (${ids.shift}, ${ids.restaurant}, ${ids.register}, ${`${PREFIX}Kasa`},
         ${ids.cashier}, '500.00')`;

      cashier = createClient(environment.url, environment.anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const signedIn = await cashier.auth.signInWithPassword({
        email: account.email,
        password: account.password,
      });
      if (signedIn.error || !signedIn.data.session) {
        throw new Error(`sign-in failed: ${signedIn.error?.message ?? "no session"}`);
      }
    });

    after(async () => {
      try {
        for (const table of [
          "cash_drawer_movements", "cashier_shifts", "cash_registers",
          "restaurant_settings", "staff_profiles",
        ]) {
          await sql.unsafe(`delete from ${table} where restaurant_id = $1::uuid`, [ids.restaurant]);
        }
        await sql`delete from restaurants where id = ${ids.restaurant}`;
        if (account.authUserId) {
          const removed = await admin.auth.admin.deleteUser(account.authUserId);
          if (removed.error) cleanupErrors.push(`auth user: ${removed.error.message}`);
        }
      } catch (error) {
        cleanupErrors.push((error as Error).message);
      }
      await sql.end({ timeout: 5 });
      if (cleanupErrors.length > 0) {
        console.error("PHASE8A RLS CLEANUP INCOMPLETE:", cleanupErrors.join(" | "));
      }
      console.log(`phase8a rls assertions executed: ${assertions}`);
    });

    test("a signed-in cashier cannot read the cash tables directly", async () => {
      for (const table of ["cash_registers", "cashier_shifts", "cash_drawer_movements"]) {
        const result = await cashier.from(table).select("*");
        check(
          Boolean(result.error) || (result.data?.length ?? 0) === 0,
          `${table} SELECT must not return rows (got ${JSON.stringify(result.data)})`,
        );
      }
    });

    test("a signed-in cashier cannot open a shift through the Data API", async () => {
      const result = await cashier
        .from("cashier_shifts")
        .insert({
          restaurant_id: ids.restaurant,
          cash_register_id: ids.register,
          register_name_snapshot: "forged",
          opened_by_staff_id: ids.cashier,
          opening_cash: "999999.00",
        })
        .select();
      check(refused(result), `direct shift INSERT must fail (got ${JSON.stringify(result.data)})`);

      const [row] = await sql`
        select count(*)::int as count from cashier_shifts where restaurant_id = ${ids.restaurant}`;
      check(Number(row.count) === 1, `only the fixture shift exists (got ${row.count})`);
    });

    test("a signed-in cashier cannot record a drawer movement through the Data API", async () => {
      const result = await cashier
        .from("cash_drawer_movements")
        .insert({
          restaurant_id: ids.restaurant,
          cashier_shift_id: ids.shift,
          type: "CASH_OUT",
          amount: "500.00",
          reason: "forged",
          created_by_staff_id: ids.cashier,
        })
        .select();
      check(refused(result), `direct movement INSERT must fail (got ${JSON.stringify(result.data)})`);

      const [row] = await sql`
        select count(*)::int as count from cash_drawer_movements
        where restaurant_id = ${ids.restaurant}`;
      check(Number(row.count) === 0, `no movement row was created (got ${row.count})`);
    });

    test("a signed-in cashier cannot edit a shift's money or close it", async () => {
      for (const patch of [
        { opening_cash: "0.01" },
        { status: "CLOSED" },
        { counted_cash_at_close: "1.00" },
      ]) {
        const result = await cashier
          .from("cashier_shifts")
          .update(patch)
          .eq("id", ids.shift)
          .select();
        check(refused(result), `direct UPDATE ${JSON.stringify(patch)} must fail`);
      }

      const [row] = await sql`
        select status::text as status, opening_cash from cashier_shifts where id = ${ids.shift}`;
      check(
        row.status === "OPEN" && row.opening_cash === "500.00",
        `the shift is untouched (got ${row.status} / ${row.opening_cash})`,
      );
    });

    test("a signed-in cashier cannot create or deactivate a register", async () => {
      const inserted = await cashier
        .from("cash_registers")
        .insert({ restaurant_id: ids.restaurant, name: "forged", code: "FORGED" })
        .select();
      check(refused(inserted), "direct register INSERT must fail");

      const updated = await cashier
        .from("cash_registers")
        .update({ is_active: false })
        .eq("id", ids.register)
        .select();
      check(refused(updated), "direct register UPDATE must fail");

      const [row] = await sql`
        select count(*)::int as count from cash_registers where restaurant_id = ${ids.restaurant}`;
      check(Number(row.count) === 1, `only the fixture register exists (got ${row.count})`);
    });

    test("payments cannot be re-attributed to another shift from the browser", async () => {
      const result = await cashier
        .from("payments")
        .update({ cashier_shift_id: ids.shift })
        .eq("restaurant_id", ids.restaurant)
        .select();
      check(refused(result), "direct payment attribution UPDATE must fail");
    });

    test("the browser roles hold no privileges at all on the cash tables", async () => {
      const grants = await sql`
        select table_name, grantee, privilege_type
        from information_schema.role_table_grants
        where table_schema = 'public'
          and grantee in ('anon', 'authenticated')
          and table_name in ('cash_registers', 'cashier_shifts', 'cash_drawer_movements')`;
      check(
        grants.length === 0,
        `no grant may exist on a cash table (got ${JSON.stringify(grants)})`,
      );

      const rls = await sql`
        select c.relname as name, c.relrowsecurity as enabled
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname in ('cash_registers', 'cashier_shifts', 'cash_drawer_movements')`;
      check(rls.length === 3, "all three cash tables were found");
      check(
        rls.every((row) => row.enabled === true),
        `row-level security is enabled on each (got ${JSON.stringify(rls)})`,
      );
    });
  });
}
