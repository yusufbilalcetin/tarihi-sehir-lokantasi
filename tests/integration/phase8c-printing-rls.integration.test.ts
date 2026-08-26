import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";

import { generateAgentToken } from "../../lib/security/printer-agent-token";
import { readSupabaseIntegrationEnvironment } from "./supabase-test-environment";

/**
 * Phase 8C — the printing tables are not reachable from a browser session.
 *
 * The stakes are higher here than for most tables: `printer_agents` holds a
 * credential digest, and a writable `print_jobs` would let a signed-in user
 * queue arbitrary paper. A real Supabase Auth user signs in and tries exactly
 * the writes the server performs; every one must fail.
 */

const PREFIX = "PHASE8C_";
const readiness = readSupabaseIntegrationEnvironment({ requireDatabaseUrl: true });
const PEPPER = process.env.PRINTER_AGENT_TOKEN_PEPPER ?? "";

if (!readiness.ready || PEPPER.length < 32) {
  test("Phase 8C printing RLS", {
    skip: readiness.ready
      ? "PRINTER_AGENT_TOKEN_PEPPER (32+ bytes) is required."
      : (readiness as { reason: string }).reason,
  }, () => undefined);
} else {
  const environment = readiness.environment;
  const run = randomBytes(6).toString("hex");
  const ids = {
    restaurant: randomUUID(),
    manager: randomUUID(),
    agent: randomUUID(),
    printer: randomUUID(),
    route: randomUUID(),
    job: randomUUID(),
  };
  const account = {
    email: `phase8c-${run}-manager@example.com`,
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

  describe("Phase 8C printing tables are server-only", { concurrency: false }, () => {
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
        (${ids.restaurant}, ${`${PREFIX}RLS Tenant`}, ${`phase8c-rls-${run}`})`;
      await sql`insert into restaurant_settings (restaurant_id) values (${ids.restaurant})`;
      await sql`insert into staff_profiles (id, restaurant_id, auth_user_id, name,
          login_identifier, role, is_active) values
        (${ids.manager}, ${ids.restaurant}, ${account.authUserId}, ${`${PREFIX}Mudur`},
         ${`p8c-rls-${run}`}, 'MANAGER', true)`;

      const token = generateAgentToken(PEPPER);
      await sql`insert into printer_agents (id, restaurant_id, name, token_hash, token_version) values
        (${ids.agent}, ${ids.restaurant}, ${`${PREFIX}Salon`}, ${token.tokenHash}, 1)`;
      await sql`insert into restaurant_printers (id, restaurant_id, printer_agent_id, name, code,
          station_type, device_key) values
        (${ids.printer}, ${ids.restaurant}, ${ids.agent}, ${`${PREFIX}Mutfak`},
         ${`P8CX${run.slice(0, 5).toUpperCase()}`}, 'KITCHEN', 'kitchen-main')`;
      await sql`insert into printer_routes (id, restaurant_id, document_type, printer_id) values
        (${ids.route}, ${ids.restaurant}, 'KITCHEN_ORDER', ${ids.printer})`;
      await sql`insert into print_jobs (id, restaurant_id, printer_id, printer_name_snapshot,
          document_type, source_type, payload_version, payload_snapshot) values
        (${ids.job}, ${ids.restaurant}, ${ids.printer}, ${`${PREFIX}Mutfak`}, 'TEST_PRINT',
         'PRINTER', 1, ${JSON.stringify({ type: "TEST_PRINT", version: 1 })}::jsonb)`;

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
        for (const table of [
          "print_job_attempts", "print_jobs", "printer_routes", "restaurant_printers",
          "printer_agents", "restaurant_settings", "staff_profiles",
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
        console.error("PHASE8C RLS CLEANUP INCOMPLETE:", cleanupErrors.join(" | "));
      }
      console.log(`phase8c rls assertions executed: ${assertions}`);
    });

    test("a signed-in manager cannot read any printing table", async () => {
      for (const table of [
        "printer_agents",
        "restaurant_printers",
        "printer_routes",
        "print_jobs",
        "print_job_attempts",
      ]) {
        const result = await staff.from(table).select("*");
        check(
          Boolean(result.error) || (result.data?.length ?? 0) === 0,
          `${table} SELECT must return nothing (got ${JSON.stringify(result.data)})`,
        );
      }
    });

    test("an agent token digest is unreadable from the browser", async () => {
      const result = await staff.from("printer_agents").select("token_hash");
      check(
        Boolean(result.error) || (result.data?.length ?? 0) === 0,
        "a credential digest must never reach a browser session",
      );
    });

    test("a signed-in manager cannot queue paper directly", async () => {
      const result = await staff
        .from("print_jobs")
        .insert({
          restaurant_id: ids.restaurant,
          printer_id: ids.printer,
          printer_name_snapshot: "forged",
          document_type: "TEST_PRINT",
          source_type: "PRINTER",
          payload_version: 1,
          payload_snapshot: { type: "TEST_PRINT", version: 1 },
        })
        .select();
      check(refused(result), `direct print job INSERT must fail (got ${JSON.stringify(result.data)})`);

      const [row] = await sql`
        select count(*)::int as count from print_jobs where restaurant_id = ${ids.restaurant}`;
      check(Number(row.count) === 1, `only the fixture job exists (got ${row.count})`);
    });

    test("a signed-in manager cannot rewrite a job, a printer or a route", async () => {
      const patches: [string, Record<string, unknown>, string][] = [
        ["print_jobs", { status: "PRINTED" }, "id"],
        ["restaurant_printers", { device_key: "forged" }, "id"],
        ["printer_routes", { is_active: false }, "id"],
        ["printer_agents", { is_active: false }, "id"],
      ];
      const targets: Record<string, string> = {
        print_jobs: ids.job,
        restaurant_printers: ids.printer,
        printer_routes: ids.route,
        printer_agents: ids.agent,
      };
      for (const [table, patch] of patches) {
        const result = await staff.from(table).update(patch).eq("id", targets[table]).select();
        check(refused(result), `direct ${table} UPDATE must fail`);
      }

      const [job] = await sql`select status::text as status from print_jobs where id = ${ids.job}`;
      const [printer] = await sql`
        select device_key from restaurant_printers where id = ${ids.printer}`;
      check(job.status === "PENDING", `the job is untouched (got ${job.status})`);
      check(printer.device_key === "kitchen-main", "and so is the device key");
    });

    test("a signed-in manager cannot delete print history", async () => {
      for (const table of ["print_jobs", "print_job_attempts", "printer_agents"]) {
        const result = await staff.from(table).delete().eq("restaurant_id", ids.restaurant).select();
        check(refused(result), `direct ${table} DELETE must fail`);
      }
      const [row] = await sql`
        select count(*)::int as count from print_jobs where restaurant_id = ${ids.restaurant}`;
      check(Number(row.count) === 1, "the history is still there");
    });

    test("the browser roles hold no privilege at all on the printing tables", async () => {
      const grants = await sql`
        select table_name, grantee, privilege_type
        from information_schema.role_table_grants
        where table_schema = 'public'
          and grantee in ('anon', 'authenticated')
          and table_name in ('printer_agents', 'restaurant_printers', 'printer_routes',
                             'print_jobs', 'print_job_attempts')`;
      check(grants.length === 0, `no grant may exist (got ${JSON.stringify(grants)})`);

      const rls = await sql`
        select c.relname as name, c.relrowsecurity as enabled
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname in ('printer_agents', 'restaurant_printers', 'printer_routes',
                            'print_jobs', 'print_job_attempts')`;
      check(rls.length === 5, "all five printing tables were found");
      check(
        rls.every((row) => row.enabled === true),
        `row-level security is enabled on each (got ${JSON.stringify(rls)})`,
      );
    });

    test("no raw agent token is ever stored, only its digest", async () => {
      const rows = await sql`
        select token_hash from printer_agents where restaurant_id = ${ids.restaurant}`;
      check(rows.length === 1, "the fixture agent exists");
      check(
        /^v\d+\.[A-Za-z0-9_-]{43}$/.test(String(rows[0].token_hash)),
        `the column holds a versioned digest (got ${rows[0].token_hash})`,
      );

      // And nothing anywhere in the row set looks like a usable bearer token.
      const audits = await sql`
        select metadata::text as metadata, new_value::text as new_value
        from audit_logs where restaurant_id = ${ids.restaurant}`;
      check(
        audits.every(
          (row) =>
            !/[A-Za-z0-9_-]{43}/.test(`${row.metadata ?? ""}${row.new_value ?? ""}`),
        ),
        "no audit payload carries anything token-shaped",
      );
    });
  });
}
