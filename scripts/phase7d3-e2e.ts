/**
 * Phase 7D.3 — provisions or removes the disposable HTTP E2E fixture and the
 * environment the existing harness reads.
 *
 * usage: tsx scripts/phase7d3-e2e.ts up <port>
 *        tsx scripts/phase7d3-e2e.ts down
 *
 * Secrets are written only to .env.local (git-ignored) and never printed. The
 * raw QR token lives in that file for the duration of the run and is removed
 * again by `down`.
 */
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

loadEnvConfig(process.cwd());

const STATE_FILE = path.join(process.cwd(), ".phase7d3-fixture.json");
const ENV_FILE = path.join(process.cwd(), ".env.local");
const MANAGED = [
  "RUN_SEHIR_HTTP_E2E_TESTS",
  "SEHIR_HTTP_E2E_CONFIRM",
  "SEHIR_HTTP_E2E_TARGET_CLASS",
  "SEHIR_HTTP_E2E_BASE_URL",
  "SEHIR_HTTP_E2E_ALLOWED_ORIGIN",
  "SEHIR_HTTP_E2E_QR_TOKEN",
  "SEHIR_HTTP_E2E_PRODUCT_ID",
  "SEHIR_HTTP_E2E_WAITER_IDENTIFIER",
  "SEHIR_HTTP_E2E_WAITER_PASSWORD",
  "SEHIR_HTTP_E2E_KITCHEN_IDENTIFIER",
  "SEHIR_HTTP_E2E_KITCHEN_PASSWORD",
  "SEHIR_HTTP_E2E_CASHIER_IDENTIFIER",
  "SEHIR_HTTP_E2E_CASHIER_PASSWORD",
  "SEHIR_HTTP_E2E_ADMIN_IDENTIFIER",
  "SEHIR_HTTP_E2E_ADMIN_PASSWORD",
  "SEHIR_HTTP_E2E_OTHER_TENANT_IDENTIFIER",
  "SEHIR_HTTP_E2E_OTHER_TENANT_PASSWORD",
];

/**
 * The later HTTP suites each carry their own opt-in, confirmation and base URL
 * rather than sharing one switch, so that enabling one suite can never silently
 * enable the rest. That is the right default for a mutating suite, but it also
 * means a full run needs 24 further variables — all of them derivable from the
 * fixture this script already provisions. They are managed here so `up` leaves
 * the suite runnable and `down` takes every one of them back out again.
 */
const E2E_PHASES = ["8A", "8B", "8C", "8D", "8F", "9A", "9B", "9C"] as const;
const PHASE_CONFIRMATION = "I_UNDERSTAND_THIS_MUTATES_A_DISPOSABLE_TEST_FIXTURE";

function phaseVariableNames(): string[] {
  return E2E_PHASES.flatMap((phase) => [
    `RUN_PHASE${phase}_HTTP_E2E`,
    `PHASE${phase}_HTTP_E2E_CONFIRM`,
    `PHASE${phase}_HTTP_E2E_BASE_URL`,
  ]);
}

function phaseVariableEntries(origin: string): Record<string, string> {
  return Object.fromEntries(
    E2E_PHASES.flatMap((phase) => [
      [`RUN_PHASE${phase}_HTTP_E2E`, "true"],
      [`PHASE${phase}_HTTP_E2E_CONFIRM`, PHASE_CONFIRMATION],
      [`PHASE${phase}_HTTP_E2E_BASE_URL`, origin],
    ]),
  );
}

function writeEnv(entries: Record<string, string> | null): void {
  const source = readFileSync(ENV_FILE, "utf8");
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const kept = source
    .split(/\r?\n/)
    .filter((line) => {
      const name = line.split("=")[0].trim();
      return !MANAGED.includes(name) && !phaseVariableNames().includes(name);
    });
  while (kept.length > 0 && kept[kept.length - 1].trim() === "") kept.pop();
  if (entries) {
    kept.push("", "# Phase 7D.3 disposable HTTP E2E fixture — removed by `down`.");
    for (const [name, value] of Object.entries(entries)) kept.push(`${name}="${value}"`);
  }
  kept.push("");
  writeFileSync(ENV_FILE, kept.join(eol), "utf8");
}

async function main(): Promise<void> {
  const [command, portArgument] = process.argv.slice(2);

  if (command === "down") {
    if (!existsSync(STATE_FILE)) {
      writeEnv(null);
      console.log("no fixture state; environment cleaned");
      return;
    }
    const fixture = JSON.parse(readFileSync(STATE_FILE, "utf8"));
    const { cleanupPhase7d3 } = await import("../tests/integration/phase7d3-fixture");
    const sql = postgres(process.env.SUPABASE_INTEGRATION_TEST_DATABASE_URL!, {
      max: 2, prepare: false, onnotice: () => {},
    });
    const admin = createClient(
      process.env.SUPABASE_INTEGRATION_TEST_URL!,
      process.env.SUPABASE_INTEGRATION_TEST_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const errors = await cleanupPhase7d3(fixture, sql, admin);
    await sql.end({ timeout: 5 });
    writeEnv(null);
    unlinkSync(STATE_FILE);
    if (errors.length > 0) {
      console.error("PHASE7D3 FIXTURE CLEANUP INCOMPLETE:", errors.join(" | "));
      process.exitCode = 1;
    } else {
      console.log("fixture removed and environment cleaned");
    }
    return;
  }

  if (command !== "up") {
    console.error("usage: phase7d3-e2e.ts up <port> | down");
    process.exitCode = 2;
    return;
  }

  const port = Number(portArgument ?? 3100);
  const origin = `http://localhost:${port}`;
  const { newPhase7d3Fixture, provisionPhase7d3 } = await import(
    "../tests/integration/phase7d3-fixture"
  );
  const fixture = newPhase7d3Fixture();
  const { disconnect } = await provisionPhase7d3(fixture);
  // The suite opens its own connection; this one has done its job.
  await disconnect();

  writeFileSync(STATE_FILE, JSON.stringify(fixture, null, 2), "utf8");
  writeEnv({
    RUN_SEHIR_HTTP_E2E_TESTS: "true",
    SEHIR_HTTP_E2E_CONFIRM: "I_UNDERSTAND_THIS_MUTATES_A_DISPOSABLE_TEST_FIXTURE",
    SEHIR_HTTP_E2E_TARGET_CLASS: "DISPOSABLE_TEST",
    SEHIR_HTTP_E2E_BASE_URL: origin,
    SEHIR_HTTP_E2E_ALLOWED_ORIGIN: origin,
    SEHIR_HTTP_E2E_QR_TOKEN: fixture.rawTableToken,
    SEHIR_HTTP_E2E_PRODUCT_ID: fixture.productA,
    SEHIR_HTTP_E2E_WAITER_IDENTIFIER: fixture.staff.WAITER.email,
    SEHIR_HTTP_E2E_WAITER_PASSWORD: fixture.staff.WAITER.password,
    SEHIR_HTTP_E2E_KITCHEN_IDENTIFIER: fixture.staff.KITCHEN.email,
    SEHIR_HTTP_E2E_KITCHEN_PASSWORD: fixture.staff.KITCHEN.password,
    SEHIR_HTTP_E2E_CASHIER_IDENTIFIER: fixture.staff.CASHIER.email,
    SEHIR_HTTP_E2E_CASHIER_PASSWORD: fixture.staff.CASHIER.password,
    SEHIR_HTTP_E2E_ADMIN_IDENTIFIER: fixture.staff.ADMIN.email,
    SEHIR_HTTP_E2E_ADMIN_PASSWORD: fixture.staff.ADMIN.password,
    SEHIR_HTTP_E2E_OTHER_TENANT_IDENTIFIER: fixture.staff.FOREIGN.email,
    SEHIR_HTTP_E2E_OTHER_TENANT_PASSWORD: fixture.staff.FOREIGN.password,
    ...phaseVariableEntries(origin),
  });
  console.log(`fixture provisioned for ${origin}`);
  console.log(`restaurant A: ${fixture.restaurantA}`);
  console.log(`table A: ${fixture.tableA} | product A: ${fixture.productA}`);
}

void main();
