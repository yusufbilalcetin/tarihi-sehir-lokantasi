import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * The application connects with DATABASE_URL, i.e. as the database owner, so
 * PostgreSQL row-level security does not constrain a single API route. Tenancy
 * is therefore an application invariant: every statement that reads or writes a
 * restaurant-owned table must name restaurantId in its own predicate.
 * `requireRestaurantAccess` says as much and is explicit that it "is not a
 * substitute for query-level tenancy" — this test is what holds that line.
 */

const TENANT_TABLES = new Set([
  "orders", "orderItems", "orderEvents", "orderChecks",
  "payments", "paymentRefunds",
  "staffProfiles", "restaurantTables", "auditLogs",
  "waiterCalls", "staffCalls",
  "cashierShifts", "cashRegisters",
  "categories", "products",
  "printJobs", "printers", "restaurantPrinters",
]);

/**
 * The outbox worker drains every tenant's events in one pass, so its own
 * statements are deliberately not restaurant-scoped. What protects them
 * instead: the endpoint is secret-gated, the claim takes worker ownership, and
 * each event is published to the channel named by its OWN restaurantId
 * (RestaurantEventPublisher), never to a caller-supplied one.
 */
const CROSS_TENANT_BY_DESIGN = new Set(["lib/repositories/drizzle-outbox-repository.ts"]);

const MENTIONS_TENANT = /restaurantId|restaurant_id/;
const STATEMENT = /(?:this\.db|db|transaction|tx)\s*\.(?:select|update|delete|insert)[\s\S]*?;/g;
const TARGET_TABLE = /\.(?:from|update|into|delete)\(\s*([A-Za-z_]+)/;
const WHERE_REFERENCE = /\.where\(\s*(?:this\.)?([A-Za-z_][A-Za-z0-9_]*)/;

/**
 * A predicate is often built once and reused — `.where(where)` or
 * `.where(this.paymentScope(window))`. Resolving one level of indirection is
 * what separates "the filter lives in a variable" from "there is no filter",
 * and only the second is a finding.
 */
function isTenantScoped(chain: string, source: string): boolean {
  if (MENTIONS_TENANT.test(chain)) return true;

  const reference = WHERE_REFERENCE.exec(chain)?.[1];
  if (!reference) return false;

  const declaration = new RegExp(
    String.raw`(?:const|let)\s+${reference}\s*=|${reference}\s*\([^)]*\)\s*\{`,
  ).exec(source);
  if (!declaration) return false;

  // Bounded window: the declaration and what follows it, not the whole file,
  // so an unrelated mention elsewhere cannot vouch for this query.
  return MENTIONS_TENANT.test(source.slice(declaration.index, declaration.index + 1_200));
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.ts$/.test(entry)) out.push(full);
  }
  return out;
}

test("every query on a restaurant-owned table carries a tenant predicate", () => {
  const files = [
    ...walk(path.join(process.cwd(), "lib/repositories")),
    ...walk(path.join(process.cwd(), "lib/services")),
    ...walk(path.join(process.cwd(), "app/api")),
  ];

  const offenders: string[] = [];
  let inspected = 0;

  for (const file of files) {
    const relative = path.relative(process.cwd(), file).split(path.sep).join("/");
    if (CROSS_TENANT_BY_DESIGN.has(relative)) continue;
    const source = readFileSync(file, "utf8");

    for (const chain of source.match(STATEMENT) ?? []) {
      const table = TARGET_TABLE.exec(chain)?.[1];
      if (!table || !TENANT_TABLES.has(table)) continue;
      inspected += 1;
      if (!isTenantScoped(chain, source)) {
        offenders.push(`${relative} [${table}] ${chain.replace(/\s+/g, " ").slice(0, 140)}`);
      }
    }
  }

  assert.ok(inspected > 100, `only ${inspected} tenant-table statements found; the scan broke`);
  assert.deepEqual(offenders, [], "a restaurant-owned table is queried without a tenant filter");
});

test("the outbox publisher addresses the channel of the event's own restaurant", () => {
  const source = readFileSync(
    path.join(process.cwd(), "lib/realtime/restaurant-event-publisher.ts"),
    "utf8",
  );
  assert.match(
    source,
    /restaurantStaffChannelName\(\s*event\.restaurantId\s*\)/,
    "a cross-tenant worker must publish to the event's own restaurant channel",
  );
});

/**
 * BUG-6 specifically: the print-job claim UPDATE used to carry only
 * `inArray(printJobs.id, candidates)`, inheriting its tenancy from the
 * SELECT ... FOR UPDATE above it. That held, but only for as long as nobody
 * changed the query above. The claim now states the tenant itself.
 *
 * The behavioural version of this (agent of tenant A cannot claim a job of
 * tenant B against a live database) lives in the printing RLS integration
 * suite, which needs a separate disposable project.
 */
test("a printer agent's claim names its own restaurant", () => {
  const source = readFileSync(path.join(process.cwd(), "lib/services/print-service.ts"), "utf8");
  const claim = /\.update\(printJobs\)[\s\S]*?\.where\(([\s\S]*?)\)\s*\.returning/.exec(source);
  assert.ok(claim, "the print-job claim UPDATE was not found");
  assert.match(
    claim[1],
    /eq\(\s*printJobs\.restaurantId\s*,\s*agent\.restaurantId\s*\)/,
    "the claim must scope to the agent's own restaurant, not only to candidate ids",
  );
  assert.match(claim[1], /inArray\(\s*printJobs\.id/, "the claim must still target its candidates");
});
