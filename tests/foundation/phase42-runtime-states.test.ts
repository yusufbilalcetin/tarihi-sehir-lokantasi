import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { panelState } from "../../components/shared/data-states";

/**
 * Phase 42 — a failed read must never be shown as an empty one.
 *
 * The defect these guard against is a two-branch ternary:
 *
 *   loading ? "Yükleniyor…" : "Kayıt yok."
 *
 * When the request fails, `loading` is false, so the screen reports that there
 * is nothing there. A manager reads an empty sales panel and concludes the day
 * had no sales. The data was never fetched. Emptiness and failure are different
 * answers and cannot share a branch.
 */

function read(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

const dashboard = read("components/admin/dashboard-view.tsx");
const todayPanel = read("components/admin/today-panel.tsx");

/* ------------------------------------------------ the state machine ------ */

test("failure outranks loading, and neither is emptiness", () => {
  assert.equal(panelState({ loading: true, error: null, empty: true }), "loading");
  assert.equal(panelState({ loading: false, error: null, empty: true }), "empty");
  assert.equal(panelState({ loading: false, error: null, empty: false }), "ready");
  assert.equal(panelState({ loading: false, error: new Error("boom"), empty: true }), "error");
  // A resource that failed and is now being refetched is still failed: saying
  // "loading" would hide a failure the user has already been shown.
  assert.equal(panelState({ loading: true, error: new Error("boom"), empty: true }), "error");
  // ...and a failure with stale rows still present is a failure.
  assert.equal(panelState({ loading: false, error: new Error("boom"), empty: false }), "error");
});

/* ------------------------------------------------ dashboard panels ------- */

test("every dashboard widget distinguishes ready, loading and failure", () => {
  const value = dashboard.slice(dashboard.indexOf("function ResourceValue"), dashboard.indexOf("function MobileMetric"));
  assert.match(value, /if \(ready\)/);
  assert.match(value, /error \? "Alınamadı" : "Yükleniyor"/);
  assert.match(value, />—</);
  for (const resource of ["overview", "collections", "tableResource"]) {
    assert.match(dashboard, new RegExp(`error=\\{${resource}\\.error\\}`), `${resource} failure never reaches its widget`);
  }
});

test("no dashboard panel still answers a failure with an empty-state sentence", () => {
  // The exact shapes that were live before this phase.
  const regressions = [
    /reports\.loading \? "Satış verisi yükleniyor…" : "Bu dönemde satış kaydı yok\."/,
    /orderResource\.loading \? "Siparişler yükleniyor…" : "Açık sipariş yok\."/,
    /tables\.loading \? "Salon yükleniyor…" : "Şu anda açık masa yok\."/,
  ];
  for (const shape of regressions) {
    assert.doesNotMatch(dashboard, shape, "a two-branch ternary is reporting a failure as empty again");
  }
});

test("a failing panel does not take the admin shell or its siblings down", () => {
  // The page must not bail before rendering; the notice lives inside the panel.
  assert.doesNotMatch(
    dashboard,
    /if \((?:reports|tables|orderResource|overview)\.error\)\s*return/,
    "a single failed resource returns early and blanks the whole dashboard",
  );
  // The greeting and launcher render independently from every resource.
  assert.match(dashboard, /<h1[^>]*>\{clock\.greeting\}<\/h1>/);
  assert.match(dashboard, /<AppLauncher \/>/);
  assert.doesNotMatch(dashboard, /if \([^)]*\.error\)\s*return/);
});

/* ------------------------------------------------ today panel ------------ */

test("the today panel says a figure failed rather than pretending it is loading", () => {
  // This was the worst case: a 500 left the panel reading "Durum bilgisi
  // yükleniyor…" permanently, so the user waited for something never coming.
  assert.match(todayPanel, /const failed = Boolean\(error\);/);
  assert.match(todayPanel, /const pending = overview === null && !failed;/);
  assert.match(todayPanel, /Bugünün işletme durumu alınamadı\./);
  const failedAt = todayPanel.indexOf("{failed ? (");
  const pendingAt = todayPanel.indexOf(": pending ? (");
  assert.ok(failedAt !== -1 && pendingAt > failedAt, "failure must be checked before the loading branch");
});

test("the Home Screen hands every failure to its local state renderer", () => {
  assert.match(dashboard, /ready=\{overviewReady\} error=\{overview\.error\}/);
  assert.match(dashboard, /ready=\{collectionsReady\} error=\{collections\.error\}/);
  assert.match(dashboard, /ready=\{tablesReady\} error=\{tableResource\.error\}/);
  assert.match(dashboard, /const attentionFailure =/);
});

/* ------------------------------------------------ error copy ------------- */

test("a failed module names itself instead of the generic system sentence", () => {
  const workspace = read("components/admin/erp-workspace-manager.tsx");
  // One component renders all 25 ERP modules; without a title they all failed
  // with the same anonymous sentence the user complained about.
  assert.match(workspace, /<ErrorState title=\{`\$\{config\.title\} yüklenemedi`\}/);
  assert.match(read("components/admin/inventory-detail-manager.tsx"), /<ErrorState title="Stok kalemi yüklenemedi"/);
});

test("the generic failure sentence is a fallback, not the normal admin experience", () => {
  // It may still exist as ErrorState's default for genuinely unknown failures,
  // but no admin surface should be reaching for it by omission.
  const generic = "İşlem şu anda tamamlanamadı";
  assert.match(read("components/shared/data-states.tsx"), new RegExp(generic), "the fallback itself disappeared");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(path.join(process.cwd(), dir), { withFileTypes: true })) {
      const next = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(next);
      else if (next.endsWith(".tsx")) files.push(next);
    }
  };
  walk("components");
  for (const file of files) {
    if (file.endsWith("data-states.tsx")) continue;
    const source = readFileSync(path.join(process.cwd(), file), "utf8");
    for (const usage of source.match(/<ErrorState[\s\S]{0,200}?\/>/g) ?? []) {
      assert.match(usage, /title=/, `${file} renders ErrorState without naming what failed`);
    }
  }
});

/* ------------------------------------------------ no fake data ----------- */

test("no admin read turns a failure into an empty array", () => {
  // Part R: a 500 must never be laundered into [] to make a screen look clean.
  for (const file of [
    "components/admin/dashboard-view.tsx",
    "components/admin/today-panel.tsx",
    "components/admin/erp-workspace-manager.tsx",
    "components/admin/use-admin-reports.ts",
  ]) {
    const source = read(file);
    assert.doesNotMatch(source, /catch[\s\S]{0,80}return\s*\[\]/, `${file} swallows a failure into an empty list`);
    assert.doesNotMatch(source, /error[\s\S]{0,40}\?\s*\[\]\s*:/, `${file} substitutes an empty list on error`);
  }
});

/* ------------------------------------------------ round trips ------------ */

/**
 * At this deployment the database is a network hop away: a no-op `select 1`
 * measured 48 ms while the heaviest page query measured 51 ms. Query execution
 * is ~0-3 ms, so page latency is round trips × RTT and nothing else. That makes
 * a serial await of two independent reads the most expensive mistake available,
 * and the cheapest one to make by accident.
 */
test("an ERP module read does not wait for its rows before fetching its filters", () => {
  const source = read("lib/repositories/drizzle-erp-workspace-repository.ts");
  const body = source.slice(source.indexOf("async read(restaurantId"), source.indexOf("execute(input:"));

  // The options query needs the tenant and the module, never the rows.
  assert.match(body, /const optionsPromise = this\.options\(restaurantId, query\.module\);/);
  assert.match(body, /const options = await optionsPromise;/);
  assert.doesNotMatch(
    body,
    /const options = await this\.options\(/,
    "the filter options are awaited after the rows again — that is a second round trip on all 25 ERP screens",
  );

  // Started before the switch that runs the row query, or it is not parallel.
  const started = body.indexOf("const optionsPromise =");
  const switchAt = body.indexOf("switch (query.module)");
  assert.ok(started !== -1 && started < switchAt, "the options query no longer starts alongside the rows");

  // A failing row query must not turn the in-flight options into an unhandled
  // rejection; the handler marks it handled while `await` still throws.
  assert.match(body, /optionsPromise\.catch\(\(\) => undefined\);/);
});

test("the dashboard still issues its ten statements as one round trip", () => {
  const repository = read("lib/repositories/drizzle-erp-repository.ts");
  const overview = repository.slice(
    repository.indexOf("async overview(restaurantId"),
    repository.indexOf("  createWarehouse(input:"),
  );
  assert.equal((overview.match(/Promise\.all\(\[/g) ?? []).length, 1);
  assert.equal(
    overview.indexOf("await "),
    overview.indexOf("await Promise.all(["),
    "something is awaited before the dashboard batch, adding a round trip",
  );
});

/* ------------------------------------------------ raw SQL shapes --------- */

/**
 * Three bugs shipped in raw `sql` templates and stayed invisible because the
 * ERP tables did not exist yet — the queries failed for a different reason
 * first. Once the schema landed they surfaced as 500s on the manager's home,
 * the inventory screen and the reservation screen. None of them is catchable by
 * TypeScript: a `sql` template is just a string to the compiler.
 */
function erpSqlTemplates(): readonly { file: string; sql: string }[] {
  const out: { file: string; sql: string }[] = [];
  for (const file of [
    "lib/repositories/drizzle-erp-repository.ts",
    "lib/repositories/drizzle-erp-workspace-repository.ts",
  ]) {
    const source = read(file);
    let cursor = source.indexOf("sql`");
    while (cursor !== -1) {
      const end = source.indexOf("`", cursor + 4);
      out.push({ file, sql: source.slice(cursor + 4, end) });
      cursor = source.indexOf("sql`", end + 1);
    }
  }
  return out;
}

test("every aggregate FILTER keeps its WHERE keyword", () => {
  // `filter (cond)` is a syntax error (42601); PostgreSQL requires
  // `filter (where cond)`. This broke the whole inventory module.
  for (const { file, sql } of erpSqlTemplates()) {
    // Not a \w class: the real bug was `filter ($1::uuid is null ...)`, and
    // `$` is not a word character, so a \w-based guard never saw it.
    for (const match of sql.matchAll(/filter\s*\(\s*(?!where)(.{0,18})/gi)) {
      assert.fail(`${file}: aggregate FILTER without WHERE — "filter (${match[1]}" is a 42601 syntax error`);
    }
  }
});

test("no raw ERP statement casts an interpolated array", () => {
  // Drizzle renders an interpolated JS array as `($1, $2, ...)` — a row
  // constructor, parentheses included. Casting that to `text[]` fails, and
  // wrapping it in `array[...]` only nests the row. `IN ${values}` is the form
  // that works, because the parentheses drizzle adds are the ones IN wants.
  for (const { file, sql } of erpSqlTemplates()) {
    assert.doesNotMatch(
      sql,
      /any\(\s*(?:array\[)?\$\{[^}]*\}\s*\]?::\w+\[\]/,
      `${file}: an interpolated array is being cast — use "in \${values}" instead`,
    );
  }
  // ...and the two sites that had the bug now use the working form.
  const both = erpSqlTemplates().filter((t) => t.sql.includes("OPEN_ORDER_STATUSES"));
  assert.equal(both.length, 2, "the open-order predicates moved");
  for (const { file, sql } of both) {
    assert.match(sql, /o\.status::text in \$\{\[\.\.\.OPEN_ORDER_STATUSES\]\}/, `${file} no longer uses the IN form`);
  }
});

test("no raw ERP statement reads a column its table does not have", () => {
  // `restaurant_tables` has never had `deleted_at` or `sort_order`; the
  // reservation module's table picker asked for both and returned 42703.
  const missingOnTables = ["deleted_at", "sort_order"];
  const schema = read("db/schema.ts");
  const block = schema.slice(schema.indexOf("export const restaurantTables"), schema.indexOf("export const restaurantTables") + 1_800);
  for (const column of missingOnTables) {
    assert.ok(!block.includes(`"${column}"`), `restaurant_tables now has ${column}; this guard is stale`);
  }
  for (const { file, sql } of erpSqlTemplates()) {
    if (!sql.includes("restaurant_tables")) continue;
    for (const column of missingOnTables) {
      assert.ok(
        !sql.includes(column),
        `${file}: reads restaurant_tables.${column}, which does not exist (42703)`,
      );
    }
  }
});

/* ------------------------------------------------ ERP empty states ------- */

/**
 * An empty ERP screen has to say why it is empty. Several of these are empty
 * for a reason a manager cannot guess: stock items need a warehouse to live in,
 * a purchase order needs someone to buy from. Those cases name the prerequisite
 * and point at it, so nobody is left in front of a table that can never fill.
 */
const noOptions = {} as Readonly<Record<string, readonly Record<string, string>[]>>;
const withOptions = (counts: Readonly<Record<string, number>>) =>
  Object.fromEntries(Object.entries(counts).map(([k, n]) => [k, Array.from({ length: n }, () => ({ value: "x", label: "x" }))])) as Readonly<Record<string, readonly Record<string, string>[]>>;

test("a screen empty because of a missing prerequisite says so and points at it", async () => {
  const { erpEmptyState } = await import("../../lib/domain/erp-ui");
  const cases: readonly [string, Readonly<Record<string, number>>, string, string][] = [
    ["inventory", {}, "depo", "/admin/warehouses"],
    ["recipes", {}, "stok", "/admin/inventory"],
    ["purchasing", {}, "tedarikçi", "/admin/suppliers"],
    ["production", {}, "reçete", "/admin/recipes"],
    ["waste", {}, "stok", "/admin/inventory"],
    ["stock-movements", {}, "stok", "/admin/inventory"],
  ];
  for (const [module, counts, word, href] of cases) {
    const state = erpEmptyState(module as never, withOptions(counts), false);
    assert.equal(state.prerequisite, true, `${module} does not report a prerequisite`);
    assert.ok(state.title.toLowerCase().includes(word), `${module}: "${state.title}" does not name the missing thing`);
    assert.equal(state.actionHref, href, `${module} does not send the user to the screen that must come first`);
    assert.ok(state.actionLabel, `${module} has no action`);
  }
});

test("once the prerequisite exists the screen asks for its own first record", async () => {
  const { erpEmptyState } = await import("../../lib/domain/erp-ui");
  const satisfied: readonly [string, Readonly<Record<string, number>>][] = [
    ["inventory", { warehouses: 1 }],
    ["recipes", { inventoryItems: 1 }],
    ["purchasing", { suppliers: 1 }],
  ];
  for (const [module, counts] of satisfied) {
    const state = erpEmptyState(module as never, withOptions(counts), false);
    assert.equal(state.prerequisite, false, `${module} still claims a prerequisite it has`);
    assert.ok(state.actionLabel, `${module} lost its action once unblocked`);
  }
  // Warehouses is the root of the chain: it can never have a prerequisite.
  assert.equal(erpEmptyState("warehouses" as never, noOptions, false).prerequisite, false);
});

test("a list emptied by a filter never claims the database is empty", async () => {
  const { erpEmptyState } = await import("../../lib/domain/erp-ui");
  for (const name of ["suppliers", "inventory", "waste", "purchasing"]) {
    const filtered = erpEmptyState(name as never, noOptions, true);
    const global = erpEmptyState(name as never, noOptions, false);
    assert.notEqual(filtered.title, global.title, `${name}: a search with no hits reads like an empty database`);
    assert.match(filtered.title + filtered.description, /ara|filtre/i, `${name}: filtered-empty does not mention the search`);
    assert.equal(filtered.prerequisite, false, "a filtered result is not a missing prerequisite");
  }
});

test("no empty state speaks ERP-consultant language", async () => {
  const { erpEmptyState } = await import("../../lib/domain/erp-ui");
  const { ERP_WORKSPACE_MODULES } = await import("../../lib/domain/erp-workspaces");
  const banned = /master data|ledger|posting|snapshot|procurement|transaction|configuration dependency/i;
  for (const name of ERP_WORKSPACE_MODULES) {
    for (const filtered of [true, false]) {
      const state = erpEmptyState(name, noOptions, filtered);
      const text = `${state.title} ${state.description} ${state.actionLabel ?? ""}`;
      assert.doesNotMatch(text, banned, `${name}: "${text.trim().slice(0, 70)}"`);
      assert.ok(state.title.length > 0 && state.description.length > 0, `${name} has an incomplete empty state`);
    }
  }
});

test("the setup checklist is derived from real counts, never from a stored flag", () => {
  const panel = read("components/admin/today-panel.tsx");
  // Each step reads a count off the overview; a boolean column would drift.
  for (const source of ["overview.counts.warehouses > 0", "overview.counts.inventoryItems > 0", "overview.counts.suppliers > 0", "overview.counts.activeRecipes > 0"]) {
    assert.ok(panel.includes(source), `the checklist does not derive "${source}"`);
  }
  assert.doesNotMatch(panel, /setupComplete|onboardingDone|hasCompletedSetup/, "a stored completion flag appeared");
  // It disappears once finished rather than becoming permanent furniture.
  assert.match(panel, /if \(steps\.every\(\(step\) => step\.done\)\) return null;/);
  // Operational tables fill themselves and are not setup steps.
  const block = panel.slice(panel.indexOf("function SetupChecklist"), panel.indexOf("export function TodayPanel"));
  for (const notASetupStep of ["/admin/waste", "/admin/attendance", "/admin/reservations", "/admin/fulfillment", "/admin/payables"]) {
    assert.ok(!block.includes(notASetupStep), `${notASetupStep} is not a manual setup step`);
  }
});

test("the counts behind the checklist ride the existing single round trip", () => {
  const repository = read("lib/repositories/drizzle-erp-repository.ts");
  const overview = repository.slice(repository.indexOf("async overview(restaurantId"), repository.indexOf("  createWarehouse(input:"));
  assert.equal((overview.match(/Promise\.all\(\[/g) ?? []).length, 1, "the overview grew a second batch");
  assert.match(overview, /inventoryItems: inventoryCount\[0\]\?\.value \?\? 0/);
  assert.match(overview, /suppliers: supplierCount\[0\]\?\.value \?\? 0/);
});
