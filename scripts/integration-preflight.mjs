/**
 * Go/no-go check for the dedicated integration Supabase project.
 *
 * The integration suites answer "skipped" for a dozen different reasons and the
 * reason is buried in test output, so a misconfigured project costs a full
 * round trip to discover. This runs the real guard the suites run — imported,
 * not reimplemented, so it cannot drift from it — and then answers the
 * questions the guard does not: is the target reachable, is the schema
 * migrated, and does the target actually look disposable rather than merely
 * *declared* disposable.
 *
 * Reads only. Prints no secret: every value is reported as configured/absent,
 * a length, or a host suffix.
 *
 * usage: npm run check:integration
 */
import { readdirSync } from "node:fs";
import path from "node:path";

import nextEnv from "@next/env";
const { loadEnvConfig } = nextEnv;
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";

loadEnvConfig(process.cwd());

const { readSupabaseIntegrationEnvironment, SUPABASE_INTEGRATION_CONFIRMATION } = await import(
  "../tests/integration/supabase-test-environment.ts"
);

const problems = [];
const warnings = [];
const notes = [];

function fail(headline, remedy) {
  problems.push({ headline, remedy });
}

function identity(value) {
  if (!value?.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    return `${parsed.username}@${parsed.hostname}`.toLowerCase();
  } catch {
    return null;
  }
}

function hostOf(value) {
  try {
    return new URL(value.trim()).hostname.toLowerCase();
  } catch {
    return null;
  }
}

console.log("# integration project preflight\n");

/* ---------------------------------------------------------- 1. the guard --- */

const readiness = readSupabaseIntegrationEnvironment({ requireDatabaseUrl: true });
console.log(`guard verdict: ${readiness.ready ? "READY" : "NOT READY"}`);
if (!readiness.ready) {
  console.log(`  reason: ${readiness.reason}\n`);
  fail(
    "The suites' own guard refuses this configuration.",
    `Fix the reason above. If it names the confirmation token, set SUPABASE_INTEGRATION_TEST_CONFIRM=${SUPABASE_INTEGRATION_CONFIRMATION}.`,
  );
} else {
  console.log(`  project ref: ${readiness.environment.projectRef}`);
  console.log(`  target host: ${hostOf(readiness.environment.url)}\n`);
}

/* -------------------------------------- 2. separation, checked separately --- */

const appSupabaseHost = hostOf(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
const testSupabaseHost = hostOf(process.env.SUPABASE_INTEGRATION_TEST_URL ?? "");
const appDatabase = identity(process.env.DATABASE_URL);
const testDatabase = identity(process.env.SUPABASE_INTEGRATION_TEST_DATABASE_URL);

const sameProject = Boolean(appSupabaseHost && appSupabaseHost === testSupabaseHost);
const sameDatabase = Boolean(appDatabase && appDatabase === testDatabase);

console.log("separation from the application target:");
console.log(`  same project:  ${sameProject ? "YES" : "NO"}`);
console.log(`  same database: ${sameDatabase ? "YES" : "NO"}`);

if (sameProject || sameDatabase) {
  fail(
    "The integration variables still point at the application's own project/database.",
    "Create a second Supabase project and set SUPABASE_INTEGRATION_TEST_URL / _ANON_KEY / _SERVICE_ROLE_KEY / _DATABASE_URL / _PROJECT_REF to that project.",
  );
}

// The escape hatch exists for a developer whose *application* points at the
// disposable project. Set while the application points at a remote project it
// would silence the one check that protects real orders and payments.
if (process.env.SUPABASE_INTEGRATION_TEST_TARGET_CLASS?.trim() === "DISPOSABLE_TEST") {
  if (sameProject || sameDatabase) {
    fail(
      "SUPABASE_INTEGRATION_TEST_TARGET_CLASS=DISPOSABLE_TEST is set while the test target IS the application target.",
      "Unset it. That variable declares 'the app itself runs on the throwaway project'; it is not a way to run the suites against the live one.",
    );
  } else {
    warnings.push(
      "SUPABASE_INTEGRATION_TEST_TARGET_CLASS=DISPOSABLE_TEST is set. It disables the collision check; keep it only while the application also points at the disposable project.",
    );
  }
}
console.log();

/* ------------------------------------------------- 3. keys and reachability --- */

const anonKey = process.env.SUPABASE_INTEGRATION_TEST_ANON_KEY?.trim();
const serviceKey = process.env.SUPABASE_INTEGRATION_TEST_SERVICE_ROLE_KEY?.trim();
console.log("credentials (values never printed):");
console.log(`  anon key:         ${anonKey ? `configured (len ${anonKey.length})` : "ABSENT"}`);
console.log(`  service-role key: ${serviceKey ? `configured (len ${serviceKey.length})` : "ABSENT"}`);
console.log(`  keys differ:      ${anonKey && serviceKey ? (anonKey !== serviceKey ? "YES" : "NO") : "n/a"}`);

if (serviceKey && testSupabaseHost && !sameProject) {
  const admin = createClient(process.env.SUPABASE_INTEGRATION_TEST_URL.trim(), serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (error) {
    fail(
      `The service-role key cannot reach the integration project's Auth admin API (${error.message}).`,
      "Re-copy the service_role key from the integration project's API settings.",
    );
    console.log(`  auth admin reachable: NO`);
  } else {
    console.log(`  auth admin reachable: YES (${data.users.length === 0 ? "no users yet" : "users present"})`);
  }
}
console.log();

/* ------------------------------------------- 4. schema, migrations, safety --- */

const databaseUrl = process.env.SUPABASE_INTEGRATION_TEST_DATABASE_URL?.trim();
if (!databaseUrl) {
  fail(
    "SUPABASE_INTEGRATION_TEST_DATABASE_URL is not configured.",
    "Copy the integration project's pooler connection string into it.",
  );
} else if (sameDatabase) {
  notes.push("Schema and emptiness checks skipped: the target is the application database.");
} else {
  const expected = readdirSync(path.join(process.cwd(), "db/migrations")).filter((name) =>
    name.endsWith(".sql"),
  ).length;
  let sql;
  try {
    sql = postgres(databaseUrl, { max: 2, prepare: false, onnotice: () => {}, connect_timeout: 10 });
    const [{ now }] = await sql`select now()`;
    console.log(`database reachable: YES (server time ${new Date(now).toISOString()})`);

    const applied = await sql`select count(*)::int as n from drizzle.__drizzle_migrations`.catch(
      () => null,
    );
    const appliedCount = applied ? applied[0].n : 0;
    console.log(`migrations: ${appliedCount} applied / ${expected} in db/migrations`);
    if (appliedCount < expected) {
      fail(
        `The integration database is behind: ${appliedCount} of ${expected} migrations applied.`,
        'Run the migrator against the integration database explicitly — DATABASE_URL="<integration url>" npm run db:migrate. Plain `npm run db:migrate` targets the APPLICATION database.',
      );
    }

    // The guard proves the target is a different database. It cannot prove the
    // different database is empty — and these suites write orders and payments.
    const business = ["orders", "payments", "payment_refunds", "restaurants", "staff_profiles"];
    const counts = {};
    let populated = 0;
    for (const table of business) {
      const row = await sql
        .unsafe(`select count(*)::int as n from public.${table}`)
        .catch(() => [{ n: null }]);
      counts[table] = row[0].n;
      if (typeof row[0].n === "number" && row[0].n > 0) populated += 1;
    }
    console.log(
      "existing rows: " +
        business.map((t) => `${t}=${counts[t] === null ? "n/a" : counts[t]}`).join("  "),
    );
    if ((counts.orders ?? 0) > 100 || (counts.payments ?? 0) > 50) {
      fail(
        "The integration database already holds a substantial amount of business data.",
        "Confirm this really is the throwaway project. The suites create and delete orders, payments and audit history here.",
      );
    } else if (populated > 0) {
      warnings.push(
        "The integration database is not empty. Leftover fixtures are normal; anything you care about is not.",
      );
    }

    const [rls] = await sql`
      select count(*) filter (where c.relrowsecurity)::int as enabled,
             count(*)::int as total
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'`;
    console.log(`RLS enabled on ${rls.enabled}/${rls.total} public tables`);
    if (rls.total > 0 && rls.enabled < rls.total) {
      warnings.push(
        `RLS is off on ${rls.total - rls.enabled} public table(s) in the integration project; the RLS suites will report that as a finding.`,
      );
    }
  } catch (error) {
    fail(
      `Cannot reach the integration database (${error.message}).`,
      "Check the connection string, and that the integration project is not paused.",
    );
  } finally {
    await sql?.end({ timeout: 5 }).catch(() => {});
  }
}

/* --------------------------------------------------------------- verdict --- */

console.log("\n" + "-".repeat(64));
for (const note of notes) console.log(`note:    ${note}`);
for (const warning of warnings) console.log(`warning: ${warning}`);

if (problems.length === 0) {
  console.log("\nVERDICT: GO");
  console.log("  npm run test:integration        # expect failed 0, skipped 0");
  console.log("  HTTP E2E suites additionally need a running disposable server:");
  console.log("  npx tsx scripts/phase7d3-e2e.ts up 3100   → npm run build && npx next start -p 3100");
} else {
  console.log(`\nVERDICT: NO-GO — ${problems.length} blocker(s)\n`);
  problems.forEach((problem, index) => {
    console.log(`  ${index + 1}. ${problem.headline}`);
    console.log(`     → ${problem.remedy}\n`);
  });
  process.exitCode = 1;
}
