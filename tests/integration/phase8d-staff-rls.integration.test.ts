import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";

import { readSupabaseIntegrationEnvironment } from "./supabase-test-environment";

/**
 * Phase 8D — a signed-in staff member cannot promote themselves.
 *
 * The role lives in a table the browser can read, which is exactly why the
 * write path matters: if `authenticated` could update its own row, every waiter
 * would be one PATCH away from being an administrator. A real Supabase Auth
 * session tries each of those writes here, and every one must fail.
 */

const PREFIX = "PHASE8D_";
const readiness = readSupabaseIntegrationEnvironment({ requireDatabaseUrl: true });

if (!readiness.ready) {
  test("Phase 8D staff RLS", { skip: readiness.reason }, () => undefined);
} else {
  const environment = readiness.environment;
  const run = randomBytes(6).toString("hex");
  const ids = {
    restaurant: randomUUID(),
    foreignRestaurant: randomUUID(),
    manager: randomUUID(),
    waiter: randomUUID(),
    foreignAdmin: randomUUID(),
  };
  const account = {
    email: `phase8d-rls-${run}-manager@example.com`,
    password: `Pw-${randomBytes(18).toString("base64url")}`,
    authUserId: null as string | null,
  };

  const admin = createClient(environment.url, environment.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const sql = postgres(environment.databaseUrl!, { max: 2, prepare: false, onnotice: () => {} });
  const cleanupErrors: string[] = [];
  let staff: SupabaseClient;
  let assertions = 0;

  function check(condition: boolean, message: string): void {
    assertions += 1;
    assert.ok(condition, message);
  }

  function refused(result: { error: unknown; data: unknown }): boolean {
    return Boolean(result.error) || (Array.isArray(result.data) && result.data.length === 0);
  }

  describe("Phase 8D staff profiles are not writable from a browser", { concurrency: false }, () => {
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
        (${ids.restaurant}, ${`${PREFIX}RLS Tenant`}, ${`phase8d-rls-${run}`}),
        (${ids.foreignRestaurant}, ${`${PREFIX}RLS Other`}, ${`phase8d-rls-b-${run}`})`;
      await sql`insert into restaurant_settings (restaurant_id) values
        (${ids.restaurant}), (${ids.foreignRestaurant})`;
      await sql`insert into staff_profiles (id, restaurant_id, auth_user_id, name,
          login_identifier, role, is_active) values
        (${ids.manager}, ${ids.restaurant}, ${account.authUserId}, ${`${PREFIX}Mudur`},
         ${`p8d-rls-${run}-m`}, 'MANAGER', true),
        (${ids.waiter}, ${ids.restaurant}, null, ${`${PREFIX}Garson`},
         ${`p8d-rls-${run}-w`}, 'WAITER', true),
        (${ids.foreignAdmin}, ${ids.foreignRestaurant}, null, ${`${PREFIX}Yabanci`},
         ${`p8d-rls-${run}-f`}, 'ADMIN', true)`;

      staff = createClient(environment.url, environment.anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const signedIn = await staff.auth.signInWithPassword({
        email: account.email,
        password: account.password,
      });
      if (signedIn.error || !signedIn.data.session) {
        throw new Error(`sign-in failed: ${signedIn.error?.message ?? "no session"}`);
      }
    });

    after(async () => {
      try {
        for (const tenant of [ids.restaurant, ids.foreignRestaurant]) {
          for (const table of ["audit_logs", "staff_profiles", "restaurant_settings"]) {
            await sql.unsafe(`delete from ${table} where restaurant_id = $1::uuid`, [tenant]);
          }
          await sql.unsafe(`delete from restaurants where id = $1::uuid`, [tenant]);
        }
        if (account.authUserId) {
          const removed = await admin.auth.admin.deleteUser(account.authUserId);
          if (removed.error) cleanupErrors.push(`auth user: ${removed.error.message}`);
        }
      } catch (error) {
        cleanupErrors.push((error as Error).message);
      }
      await sql.end({ timeout: 5 });
      if (cleanupErrors.length > 0) {
        console.error("PHASE8D RLS CLEANUP INCOMPLETE:", cleanupErrors.join(" | "));
      }
      console.log(`phase8d rls assertions executed: ${assertions}`);
    });

    test("a signed-in manager cannot promote themselves to administrator", async () => {
      const result = await staff
        .from("staff_profiles")
        .update({ role: "ADMIN" })
        .eq("id", ids.manager)
        .select();
      check(refused(result), `a direct role UPDATE must fail (got ${JSON.stringify(result.data)})`);

      const [row] = await sql`select role::text as role from staff_profiles where id = ${ids.manager}`;
      check(row.role === "MANAGER", `the authoritative role is unchanged (got ${row.role})`);
    });

    test("nor promote a colleague, nor switch one off", async () => {
      const promotion = await staff
        .from("staff_profiles")
        .update({ role: "ADMIN" })
        .eq("id", ids.waiter)
        .select();
      const deactivation = await staff
        .from("staff_profiles")
        .update({ is_active: false })
        .eq("id", ids.waiter)
        .select();
      check(refused(promotion), "a colleague's role cannot be changed from the browser");
      check(refused(deactivation), "nor can a colleague be switched off");

      const [row] = await sql`
        select role::text as role, is_active from staff_profiles where id = ${ids.waiter}`;
      check(row.role === "WAITER" && row.is_active === true, "the colleague is untouched");
    });

    test("a staff profile cannot be created or deleted from the browser", async () => {
      const inserted = await staff
        .from("staff_profiles")
        .insert({
          id: randomUUID(),
          restaurant_id: ids.restaurant,
          name: `${PREFIX}Sahte`,
          role: "ADMIN",
          is_active: true,
        })
        .select();
      check(refused(inserted), "a forged profile cannot be inserted");

      const deleted = await staff
        .from("staff_profiles")
        .delete()
        .eq("id", ids.waiter)
        .select();
      check(refused(deleted), "and an existing one cannot be deleted");

      const [row] = await sql`
        select count(*)::int as total from staff_profiles where restaurant_id = ${ids.restaurant}`;
      check(Number(row.total) === 2, `the fixture is intact (got ${row.total})`);
    });

    test("another restaurant's staff are invisible", async () => {
      const foreign = await staff
        .from("staff_profiles")
        .select("id, role")
        .eq("id", ids.foreignAdmin);
      check((foreign.data?.length ?? 0) === 0, "a foreign profile is not readable");

      const write = await staff
        .from("staff_profiles")
        .update({ is_active: false })
        .eq("id", ids.foreignAdmin)
        .select();
      check(refused(write), "and certainly not writable");
    });

    test("the browser roles hold no write privilege on staff profiles", async () => {
      const grants = await sql`
        select grantee, privilege_type
        from information_schema.role_table_grants
        where table_schema = 'public' and table_name = 'staff_profiles'
          and grantee in ('anon', 'authenticated')`;
      const writes = grants.filter(
        (grant) => !["SELECT"].includes(String(grant.privilege_type)),
      );
      check(
        writes.length === 0,
        `only SELECT may be granted to a browser role (got ${JSON.stringify(writes)})`,
      );

      const [rls] = await sql`
        select c.relrowsecurity as enabled
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = 'staff_profiles'`;
      check(rls.enabled === true, "row-level security is enabled on staff_profiles");
    });

    test("no credential column exists to leak in the first place", async () => {
      const columns = await sql`
        select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'staff_profiles'`;
      const names = columns.map((column) => String(column.column_name));
      check(
        !names.some((name) => /password|pin|secret|token/i.test(name)),
        `staff_profiles has no credential column (got ${names.join(", ")})`,
      );

      // What the browser *can* read carries identity, never a secret.
      const own = await staff.from("staff_profiles").select("*");
      const serialised = JSON.stringify(own.data ?? []);
      check(
        !/password|token|secret/i.test(serialised),
        "and the readable row carries nothing secret",
      );
    });
  });
}
