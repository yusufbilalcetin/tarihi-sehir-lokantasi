import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import { ERP_CSV_EXPORTS, erpCsvCell, erpCsvFilename, erpRowsToCsv } from "../../lib/domain/erp-csv";
import { addDays, formatDay, toLocalDay } from "../../lib/domain/report-range";
import { ERP_UI_CONFIG } from "../../lib/domain/erp-ui";
import {
  boundWorkspaceRange,
  erpEnumLabel,
  ERP_EXPORT_MAX_ROWS,
  ERP_PAGE_SIZE_MAX,
  ERP_RANGE_MAX_DAYS,
  ERP_WORKSPACE_MODULES,
  normalizeWorkspacePage,
} from "../../lib/domain/erp-workspaces";
import { ORDER_CHANNELS } from "../../lib/domain/status";

/**
 * Phase 39 — the ERP dashboard, its reports and their exports.
 *
 * These checks are structural on purpose. The rules they defend are properties
 * of the queries and the export definitions, not of any particular row, so they
 * hold without a database and keep holding when the data changes underneath.
 */

/** Every hand-written source file that can render something to a person. */
function sourceFiles(): readonly (readonly [string, string])[] {
  const roots = ["components", "lib", "app"];
  const files: [string, string][] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(new URL(`../../${directory}`, import.meta.url), { withFileTypes: true })) {
      const next = `${directory}/${entry.name}`;
      if (entry.isDirectory()) walk(next);
      else if (/\.tsx?$/.test(entry.name)) files.push([next, readFileSync(new URL(`../../${next}`, import.meta.url), "utf8")]);
    }
  };
  roots.forEach(walk);
  return files;
}

function read(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

const dashboardRepository = read("lib/repositories/drizzle-erp-repository.ts");
const workspaceRepository = read("lib/repositories/drizzle-erp-workspace-repository.ts");
const dashboardRoute = read("app/api/admin/erp/route.ts");
const exportRoute = read("app/api/admin/erp/export/[module]/route.ts");
const workspaceRoute = read("app/api/admin/erp/[module]/route.ts");

/** The body of `async overview(...)`, up to the next method. */
function overviewSource(): string {
  const start = dashboardRepository.indexOf("async overview(restaurantId: string)");
  const end = dashboardRepository.indexOf("  createWarehouse(input:", start);
  assert.ok(start !== -1 && end > start, "the dashboard overview method moved");
  return dashboardRepository.slice(start, end);
}

/** The body of one `case "<module>":` arm of the workspace read switch. */
function moduleQuery(module: string): string {
  const start = workspaceRepository.indexOf(`      case "${module}":`);
  assert.ok(start !== -1, `no read query for ${module}`);
  const end = workspaceRepository.indexOf("        break;", start);
  return workspaceRepository.slice(start, end);
}

/* ------------------------------------------------ dashboard: authority --- */

test("the ERP dashboard reads its tenant from the principal, never from the request", () => {
  assert.match(dashboardRoute, /adminRead/);
  assert.match(dashboardRoute, /principal\.restaurantId/);
  assert.doesNotMatch(dashboardRoute, /searchParams\.get\(\s*["']restaurantId/);
  assert.doesNotMatch(dashboardRoute, /body\.restaurantId|query\.restaurantId/);
});

test("every dashboard aggregate is scoped to one restaurant", () => {
  const source = overviewSource();
  // Each statement in the overview either carries the Drizzle tenant predicate
  // or the SQL one; a statement with neither would read the whole platform.
  const statements = source.split(/this\.db\.(?:select|execute)/).slice(1);
  assert.ok(statements.length >= 8, "the overview lost statements");
  for (const [index, statement] of statements.entries()) {
    const scoped = statement.includes("restaurantId, restaurantId")
      || statement.includes("restaurant_id=${restaurantId}")
      || /eq\(\w+\.restaurantId, restaurantId\)/.test(statement);
    assert.ok(scoped, `dashboard statement ${index} has no tenant predicate`);
  }
});

/* ------------------------------------------------ dashboard: bounded ----- */

test("the dashboard is one round trip, not one request per card", () => {
  const source = overviewSource();
  assert.equal((source.match(/Promise\.all\(\[/g) ?? []).length, 1, "the dashboard must issue its statements together");
  // Nothing may be awaited before the batch: a lone `await` in front of it is
  // exactly how a one-round-trip screen becomes a two-round-trip one.
  assert.equal(source.indexOf("await "), source.indexOf("await Promise.all(["), "the dashboard awaits something before its batch");
});

test("the dashboard never scans an unbounded list", () => {
  const source = overviewSource();
  const criticalQuery = source.slice(source.indexOf("select i.id::text as id"), source.indexOf("this.db.select({ value: count() }).from(warehouses)"));
  assert.match(criticalQuery, /limit \$\{CRITICAL_STOCK_LIMIT\}/, "the critical stock list must be capped");
  assert.match(source, /const CRITICAL_STOCK_LIMIT|CRITICAL_STOCK_LIMIT/);
  assert.match(dashboardRepository, /const CRITICAL_STOCK_LIMIT = \d+;/);
  // The exact total still comes from the database, so capping the list does not
  // turn the warning badge into a lie.
  assert.match(criticalQuery, /count\(\*\) over\(\)::int as full_count/);
});

test("dashboard metrics come from the source each one claims", () => {
  const source = overviewSource();
  // Sales: the finance summary's basis, so the dashboard and the report agree.
  assert.match(source, /sum\(o\.total\) filter \(where o\.status in \('SERVED','COMPLETED'\)\)/);
  // Stock: the ledger, never a stored balance column.
  assert.match(source, /sum\(sm\.quantity_delta\)/);
  assert.doesNotMatch(source, /current_quantity\s*(?:=|as current_quantity\s*from inventory_items)/);
  // Waste: the waste ledger, bounded to today.
  assert.match(source, /from waste_records/);
  assert.match(source, /occurred_at >= \$\{dayStart\} and occurred_at < \$\{dayEnd\}/);
  // Goods receipt: orders actually sent, not drafts sitting in a folder.
  assert.match(source, /filter \(where \$\{purchaseOrders\.status\} in \('SENT','PARTIALLY_RECEIVED'\)\)/);
});

test("the dashboard reports only metrics that have a table behind them", () => {
  const contract = read("lib/repositories/erp-repository.ts");
  const today = contract.slice(contract.indexOf("readonly today: {"), contract.indexOf("readonly counts: {"));
  const source = overviewSource();
  for (const field of ["sales", "orderCount", "openOrders", "production", "incompleteProduction", "wasteCost", "reservations"]) {
    assert.match(today, new RegExp(`readonly ${field}\\b`), `${field} left the today contract`);
    assert.ok(source.includes(`${field}:`), `${field} is declared but never computed`);
  }
});

/* ------------------------------------------------ sales channels --------- */

test("the sales report speaks Turkish, never the database's channel enum", () => {
  const columns = ERP_UI_CONFIG.sales.columns;
  const channel = columns.find((column) => column.key === "channel");
  assert.equal(channel?.kind, "status", "the channel column must go through the vocabulary");
  for (const value of ORDER_CHANNELS) {
    const label = erpEnumLabel(value);
    assert.ok(label, `${value} has no Turkish label`);
    assert.notEqual(label, value);
  }
  assert.equal(erpEnumLabel("DINE_IN"), "Masada");
  assert.equal(erpEnumLabel("TAKEAWAY"), "Paket");
  assert.equal(erpEnumLabel("DELIVERY"), "Kurye");
});

test("Masada + Paket + Kurye reconciles with gross sales by construction", () => {
  const reports = moduleQuery("reports");
  const cte = reports.slice(reports.indexOf("with sales as ("), reports.indexOf("select report_name,"));
  // The four numbers are one aggregate over one scope. A partition of the same
  // sum cannot drift from that sum, which is why there is no second query to
  // reconcile against — only an exhaustive set of filters over it.
  assert.equal((cte.match(/from orders where restaurant_id/g) ?? []).length, 1, "the channel split must not re-query orders");
  assert.equal((cte.match(/status in \('SERVED','COMPLETED'\)/g) ?? []).length, 1);
  for (const channel of ORDER_CHANNELS) {
    assert.equal(
      (cte.match(new RegExp(`filter \\(where channel='${channel}'\\)`, "g")) ?? []).length,
      1,
      `${channel} must appear exactly once in the partition`,
    );
  }
  assert.match(cte, /coalesce\(sum\(total\),0\)::numeric\(14,2\) as gross/);
  // The partition is exhaustive: every channel the database can store has a
  // filter, so the parts add up to the whole with nothing left over.
  const filtered = [...cte.matchAll(/filter \(where channel='(\w+)'\)/g)].map((match) => match[1]);
  assert.deepEqual([...filtered].sort(), [...ORDER_CHANNELS].sort());
});

test("the daily sales module uses the same basis as the summary row", () => {
  const sales = moduleQuery("sales");
  assert.match(sales, /o\.status in \('SERVED','COMPLETED'\)/);
  assert.match(sales, /sum\(o\.total\)/);
  assert.match(sales, /restaurant_id=\$\{restaurantId\}/);
  assert.match(sales, /group by 1, 2/);
});

/* ------------------------------------------------ report sources --------- */

test("inventory balance is the movement ledger, never a stored quantity", () => {
  for (const name of ["inventory", "stock-movements"] as const) {
    const query = moduleQuery(name);
    assert.doesNotMatch(query, /\bcurrent_quantity\b/, `${module} must not read a mutable balance column`);
  }
  assert.match(moduleQuery("inventory"), /sum\(sm\.quantity_delta\)/);
  assert.match(moduleQuery("stock-movements"), /from stock_movements sm/);
});

test("production figures come from the batch record, not an approximation", () => {
  const production = moduleQuery("production");
  for (const column of ["planned_portions", "actual_portions", "sold_portions", "waste_portions"]) {
    assert.ok(production.includes(`pb.${column}`), `${column} must be read from the batch`);
  }
  assert.match(production, /from production_batches pb/);
  // "Remaining" is arithmetic on the batch's own numbers, floored at zero.
  assert.match(production, /greatest\(pb\.actual_portions-pb\.sold_portions-pb\.waste_portions,0\)/);
});

test("stock count variance is the number that was recorded, not one recomputed today", () => {
  const counts = moduleQuery("stock-counts");
  // The three quantities are read straight off the line the confirmation
  // wrote. Recomputing a balance now would answer "what is the variance
  // against today's stock", which is a different and wrong question.
  assert.match(counts, /scl\.expected_quantity::text as system_quantity/);
  assert.match(counts, /scl\.counted_quantity::text as counted_quantity/);
  assert.match(counts, /scl\.variance_quantity::text as variance/);
  assert.doesNotMatch(counts, /sum\(sm\.quantity_delta\)|from stock_movements/, "variance must not be recalculated from the live ledger");

  // ...and the confirmation is what makes that legitimate: it computes the
  // expected quantity from the ledger under a per-item advisory lock and
  // persists all three numbers in the same transaction that posts the
  // correction movement.
  const confirm = workspaceRepository.slice(
    workspaceRepository.indexOf("private confirmStockCount("),
    workspaceRepository.indexOf("private updateInventoryItem("),
  );
  assert.match(confirm, /this\.db\.transaction\(/);
  assert.match(confirm, /pg_advisory_xact_lock/);
  assert.match(confirm, /insert\(stockCountLines\)/);
  assert.match(confirm, /expectedQuantity:\s*formatFixedDecimal/);
  assert.match(confirm, /varianceQuantity:\s*formatFixedDecimal/);
  assert.match(confirm, /movementType:"COUNT_CORRECTION"/);
});

test("purchase price history is what was received, not what was quoted", () => {
  const history = moduleQuery("price-history");
  assert.match(history, /from goods_receipt_items gri/);
  assert.doesNotMatch(history, /purchase_order_items/, "a quoted price is not a paid price");
});

test("supplier payables stay separate from guest payments", () => {
  const payables = moduleQuery("payables");
  assert.match(payables, /from supplier_invoices inv/);
  for (const foreign of ["payments", "payment_refunds", "cash_", "checks"]) {
    assert.ok(!payables.includes(foreign), `supplier payables must not join ${foreign}`);
  }
});

test("attendance reporting exposes the roster, not personal contact details", () => {
  const attendance = moduleQuery("attendance");
  assert.match(attendance, /sp\.name as staff/);
  for (const personal of ["sp.phone", "sp.email", "auth_user_id", "national_id", "sp.address"]) {
    assert.ok(!attendance.includes(personal), `attendance must not select ${personal}`);
  }
});

/* ------------------------------------------------ bounded reads ---------- */

test("every ERP module read is server-paginated", () => {
  for (const name of ERP_WORKSPACE_MODULES) {
    if (name === "loyalty") continue; // Deliberately inert until configured.
    const query = moduleQuery(name);
    assert.match(query, /limit \$\{pageSize\} offset \$\{offset\}/, `${name} is not server-paginated`);
    assert.match(query, /count\(\*\) over\(\)::int as full_count/, `${name} cannot report a total`);
  }
});

test("a page size is clamped, and only an export may raise the ceiling", () => {
  assert.equal(normalizeWorkspacePage(1, 100_000).pageSize, ERP_PAGE_SIZE_MAX);
  assert.equal(normalizeWorkspacePage(1, 1).pageSize, 10);
  assert.equal(normalizeWorkspacePage(-4, 25).page, 1);
  assert.equal(normalizeWorkspacePage(3, 25).offset, 50);
  assert.equal(normalizeWorkspacePage(1, ERP_EXPORT_MAX_ROWS, ERP_EXPORT_MAX_ROWS).pageSize, ERP_EXPORT_MAX_ROWS);
  // The screen's own contract still caps at 100, so the raised ceiling is
  // reachable only from the export route that passes it explicitly.
  const schema = read("lib/validation/erp-workspace.ts");
  assert.match(schema, /pageSize: z\.coerce\.number\(\)\.int\(\)\.min\(10\)\.max\(100\)/);
});

test("a hand-widened date range is clamped at the server, not honoured", () => {
  const wide = boundWorkspaceRange("1970-01-01", "2026-08-31");
  assert.equal(wide.clamped, true);
  assert.equal(wide.to, "2026-08-31");
  const spanDays = (Date.parse(`${wide.to}T00:00:00Z`) - Date.parse(`${wide.from}T00:00:00Z`)) / 86_400_000;
  assert.equal(spanDays, ERP_RANGE_MAX_DAYS);

  const normal = boundWorkspaceRange("2026-08-01", "2026-08-31");
  assert.equal(normal.clamped, false);
  assert.equal(normal.from, "2026-08-01");

  // A nonsense range is passed through rather than silently rewritten; the
  // query's own predicate then returns nothing, which is the honest answer.
  assert.equal(boundWorkspaceRange("not-a-date", "2026-08-31").clamped, false);
  assert.equal(boundWorkspaceRange("2026-08-31", "2026-08-01").clamped, false);
});

test("the workspace repository applies the clamp before it builds a query", () => {
  assert.match(workspaceRepository, /boundWorkspaceRange\(/);
  const read = workspaceRepository.slice(workspaceRepository.indexOf("async read(restaurantId"), workspaceRepository.indexOf("switch (query.module)"));
  assert.match(read, /const from = bounded\.from;/);
  assert.match(read, /const to = bounded\.to;/);
  assert.match(read, /bounded\.clamped \? ERP_RANGE_CLAMPED_NOTICE/, "a clamped range must say so");
});

/* ------------------------------------------------ display quality -------- */

test("no ERP column can put a raw enum in front of a manager", () => {
  const enumValuesByKey: Readonly<Record<string, readonly string[]>> = {
    channel: ["DINE_IN", "TAKEAWAY", "DELIVERY"],
    status: ["DRAFT", "ACTIVE", "RETIRED", "CONFIGURED", "SENT", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED", "OPEN", "PARTIALLY_PAID", "PAID", "PLANNED", "IN_PROGRESS", "COMPLETED", "PENDING", "CONFIRMED", "SEATED", "NO_SHOW", "CORRECTED", "APPROVED", "NEW", "REVIEWED", "HIDDEN", "PLACED", "WAITING_FOR_COURIER", "OUT_FOR_DELIVERY", "DELIVERED", "NOT_CONFIGURED"],
    waste_type: ["SPOILAGE", "SPILL", "PREPARATION_WASTE", "STAFF_MEAL", "COMPLIMENTARY", "OTHER"],
    movement_type: ["PURCHASE_RECEIPT", "PRODUCTION_CONSUMPTION", "MANUAL_ADJUSTMENT", "WASTE", "STAFF_MEAL", "COMPLIMENTARY", "TRANSFER_IN", "TRANSFER_OUT", "COUNT_CORRECTION", "RETURN_TO_SUPPLIER"],
    negative_stock_policy: ["WARN", "BLOCK"],
    kind: ["PAYMENT_TERMINAL", "FISCAL_DOCUMENT", "FISCAL_DEVICE", "ACCOUNTING", "DELIVERY_PROVIDER"],
    order_status: ["NEW", "CONFIRMED", "PREPARING", "READY", "SERVED", "COMPLETED", "CANCELLED"],
    kitchen_link: ["LINKED", "NOT_LINKED"],
  };
  for (const [module, config] of Object.entries(ERP_UI_CONFIG)) {
    for (const column of config.columns) {
      const values = enumValuesByKey[column.key];
      if (!values) continue;
      assert.equal(column.kind, "status", `${module}.${column.key} shows an enum without the vocabulary`);
      for (const value of values) {
        assert.ok(erpEnumLabel(value), `${module}.${column.key} can show ${value}, which has no Turkish label`);
      }
    }
  }
});

test("no ERP column and no export puts an identifier on a screen or in a file", () => {
  const looksLikeAnIdentifier = (key: string) => key === "id" || key.endsWith("_id") || key.endsWith("Id");
  for (const [module, config] of Object.entries(ERP_UI_CONFIG)) {
    for (const column of config.columns) {
      assert.ok(!looksLikeAnIdentifier(column.key), `${module} renders the identifier ${column.key}`);
    }
  }
  for (const [module, definition] of Object.entries(ERP_CSV_EXPORTS)) {
    for (const column of definition!.columns) {
      assert.ok(!looksLikeAnIdentifier(column.key), `the ${module} export carries the identifier ${column.key}`);
    }
  }
});

/* ------------------------------------------------ CSV -------------------- */

test("a CSV exists for every report that is one, and for nothing else", () => {
  const expected = ["sales", "inventory", "stock-movements", "production", "waste", "purchasing", "price-history", "payables", "attendance"];
  assert.deepEqual(Object.keys(ERP_CSV_EXPORTS).sort(), [...expected].sort());
  for (const [module, definition] of Object.entries(ERP_CSV_EXPORTS)) {
    assert.ok(definition!.columns.length > 0, `${module} exports no columns`);
    assert.ok(ERP_WORKSPACE_MODULES.includes(module as never), `${module} is not a real module`);
    const headers = definition!.columns.map((column) => column.header);
    assert.equal(new Set(headers).size, headers.length, `${module} has a duplicate header`);
  }
});

test("an export names its columns; it is never the row as it came out of SQL", () => {
  // Every cell is looked up by an allowlisted key, so a column added to a query
  // for a join cannot reach a spreadsheet by being present in the row.
  const rows = [{ name: "Kuru Fasulye", secret_tenant_id: "11111111-1111-4111-8111-111111111111", available_quantity: "12.500000", unit: "KG", category: "Bakliyat", critical_quantity: "20.000000", critical: true, negative_stock_policy: "WARN", is_active: true }];
  const csv = erpRowsToCsv(ERP_CSV_EXPORTS.inventory!.columns, rows);
  assert.ok(csv.includes("Kuru Fasulye"));
  assert.ok(!csv.includes("11111111-1111-4111-8111-111111111111"), "an unlisted column reached the file");
  assert.ok(!csv.includes("secret_tenant_id"));
});

test("no export carries customer contact details or internal plumbing", () => {
  const forbidden = ["tenantid", "tenant_id", "restaurantid", "restaurant_id", "authuserid", "auth_user_id", "idempotencykey", "idempotency_key", "token", "fingerprint", "session", "secret", "address", "contact", "phone", "email", "customer_name", "customername"];
  for (const [module, definition] of Object.entries(ERP_CSV_EXPORTS)) {
    for (const column of definition!.columns) {
      const key = column.key.toLowerCase();
      for (const banned of forbidden) {
        assert.ok(!key.includes(banned), `the ${module} export carries ${column.key}`);
      }
    }
  }
});

test("a free-text field can never become a spreadsheet formula", () => {
  const hostile = ["=SUM(A1:A9)", "+1+1", "-1+1", "@SUM(1)", "=cmd|'/c calc'!A1", "\t=1+1", "\r=1+1"];
  for (const value of hostile) {
    const csv = erpRowsToCsv(
      [{ key: "name", header: "Tedarikçi", kind: "text" }],
      [{ name: value }],
    );
    const cell = csv.split("\r\n")[1];
    assert.ok(cell.startsWith(`"'`), `${JSON.stringify(value)} was written as an executable cell`);
  }
  // The same guard covers every text column of every real export, because they
  // all go through one writer rather than each building its own file.
  for (const [module, definition] of Object.entries(ERP_CSV_EXPORTS)) {
    const textColumns = definition!.columns.filter((column) => column.kind === "text");
    if (!textColumns.length) continue;
    const row = Object.fromEntries(textColumns.map((column) => [column.key, "=1+1"]));
    const csv = erpRowsToCsv(textColumns, [row]);
    for (const cell of csv.split("\r\n")[1].split(",")) {
      assert.ok(cell.startsWith(`"'`), `${module} wrote an executable cell`);
    }
  }
});

test("Turkish text survives the trip into a spreadsheet", () => {
  const csv = erpRowsToCsv(
    [{ key: "name", header: "Stok Kalemi", kind: "text" }],
    [{ name: "Şeftali Reçeli ve Ğ İ Ö Ü Ç" }],
  );
  assert.equal(csv.charCodeAt(0), 0xfeff, "the byte order mark Excel needs is missing");
  assert.ok(csv.includes("Şeftali Reçeli ve Ğ İ Ö Ü Ç"));
  assert.ok(csv.includes("Stok Kalemi"));
  // One convention, everywhere: the ERP writer is the cashier writer.
  const cashier = read("lib/domain/cashier-report-csv.ts");
  assert.match(cashier, /from "\.\/csv"/);
  assert.match(read("lib/domain/erp-csv.ts"), /from "@\/lib\/domain\/csv"/);
});

test("money and quantities keep the decimal the database produced", () => {
  assert.equal(erpCsvCell("1234.50", "decimal"), "1234.50");
  assert.equal(erpCsvCell("0.10", "decimal"), "0.10");
  assert.equal(erpCsvCell("12.500000", "decimal"), "12.500000");
  assert.equal(erpCsvCell("9007199254740993.01", "decimal"), "9007199254740993.01");
  // Nothing on the decimal path may go through a binary float.
  const source = read("lib/domain/erp-csv.ts");
  const cell = source.slice(source.indexOf("export function erpCsvCell"), source.indexOf("export function erpRowsToCsv"));
  assert.doesNotMatch(cell, /Number\(|parseFloat|toFixed|NumberFormat/);
});

test("an export writes words, never a token or a null", () => {
  assert.equal(erpCsvCell(null, "text"), "");
  assert.equal(erpCsvCell(undefined, "decimal"), "");
  assert.equal(erpCsvCell(true, "boolean"), "Evet");
  assert.equal(erpCsvCell(false, "boolean"), "Hayır");
  assert.equal(erpCsvCell("PREPARATION_WASTE", "enum"), "Hazırlık Firesi");
  assert.equal(erpCsvCell("DINE_IN", "enum"), "Masada");
  assert.equal(erpCsvCell("KG", "enum"), "kg");
  assert.equal(erpCsvCell("SOMETHING_NEW", "enum"), "Tanımsız");
  assert.equal(erpCsvCell("not a date", "date"), "");
  assert.equal(erpCsvCell("2026-08-26T09:30:00.000Z", "date"), "26.08.2026");
  const csv = erpRowsToCsv([{ key: "reason", header: "Neden", kind: "text" }], [{ reason: null }]);
  assert.ok(!csv.includes("null") && !csv.includes("undefined") && !csv.includes("NaN"));
});

test("an export filename is readable, dated and free of identifiers", () => {
  assert.equal(erpCsvFilename("satis", "2026-08-01", "2026-08-31"), "satis-2026-08-01-2026-08-31.csv");
  assert.equal(erpCsvFilename("stok-hareketleri", null, null), "stok-hareketleri.csv");
  const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i;
  for (const definition of Object.values(ERP_CSV_EXPORTS)) {
    const name = erpCsvFilename(definition!.slug, "2026-08-01", "2026-08-31");
    assert.doesNotMatch(name, uuid, `${name} contains an identifier`);
    assert.match(name, /^[a-z0-9-]+\.csv$/, `${name} is not a plain readable filename`);
  }
});

/* ------------------------------------------------ export route ----------- */

test("the export route is tenant scoped, allowlisted and bounded", () => {
  assert.match(exportRoute, /adminRead/);
  assert.match(exportRoute, /principal\.restaurantId/);
  assert.doesNotMatch(exportRoute, /restaurantId:\s*query|query\.restaurantId/);
  // A module with no export DTO has no export, rather than falling back to the
  // row shape.
  assert.match(exportRoute, /const definition = ERP_CSV_EXPORTS\[erpModule\];/);
  assert.match(exportRoute, /if \(!definition\)/);
  assert.match(exportRoute, /definition\.columns/);
  assert.match(exportRoute, /pageSize: ERP_EXPORT_MAX_ROWS/);
  assert.match(exportRoute, /text\/csv; charset=utf-8/);
  assert.match(exportRoute, /erpCsvFilename\(definition\.slug/);
  assert.match(exportRoute, /ADMIN_NO_STORE_HEADERS/);
});

test("the browser no longer writes CSV for itself", () => {
  const manager = read("components/admin/erp-workspace-manager.tsx");
  // A second, client-side writer would be a second, unguarded copy of the
  // column allowlist and the formula escaping.
  assert.doesNotMatch(manager, /new Blob\(/);
  assert.doesNotMatch(manager, /createObjectURL/);
  assert.match(manager, /\/api\/admin\/erp\/export\/\$\{module\}/);
});

test("the module route and the export route validate the same way", () => {
  for (const route of [workspaceRoute, exportRoute]) {
    assert.match(route, /erpWorkspaceModuleSchema/);
    assert.match(route, /erpWorkspaceQuerySchema/);
  }
});

/* ------------------------------------------------ raw leak sweep --------- */

test("no surface falls back to printing the raw value a label was missing for", () => {
  // `LABELS[value] ?? value` is the shape that previously put CLEANING and
  // DINING on a screen: it looks defensive and is in fact the leak. A fallback
  // must be a word, never the token that had no word.
  const files = sourceFiles();
  const rawFallback = /(\w+(?:LABELS|Labels|_LABELS))\s*\[\s*([\w.()]+?)\s*\]\s*\?\?\s*(String\(\s*\2\s*\)|\2)\s*[;,)\n]/;
  for (const [path, source] of files) {
    const match = source.match(rawFallback);
    assert.equal(match, null, `${path} falls back to the raw value: ${match?.[0]}`);
  }
});

test("a printed receipt names the payment method through the shared vocabulary", () => {
  const print = read("lib/services/print-document-service.ts");
  assert.match(print, /paymentMethodLabel\(payment\.method\)/);
  // A local copy of the dictionary is how the receipt drifts from the screen.
  assert.doesNotMatch(print, /CASH:\s*"Nakit"/);
  assert.match(print, /orderPlaceLabel\(order\.channel, order\.tableName\)/);
});

test("an unlabelled unit is named, not printed", () => {
  const manager = read("components/admin/erp-workspace-manager.tsx");
  assert.match(manager, /column\.key==="unit"\)return erpEnumLabel\(String\(value\)\)\?\?"Birimsiz"/);
});

/* ------------------------------------------------ raw SQL tenant scope --- */

/** Every `sql`...`` template in a file, backticks balanced. */
function sqlTemplates(source: string): string[] {
  const templates: string[] = [];
  const opener = "sql`";
  let cursor = source.indexOf(opener);
  while (cursor !== -1) {
    const end = source.indexOf("`", cursor + opener.length);
    templates.push(source.slice(cursor + opener.length, end));
    cursor = source.indexOf(opener, end + 1);
  }
  return templates;
}

test("every raw ERP statement names a tenant, or names no table at all", () => {
  // The repository-wide tenant sweep reads Drizzle chains; the ERP modules are
  // written as raw `sql` templates, which that scan cannot see. A raw statement
  // that reads a restaurant-owned table without a tenant predicate is a
  // cross-tenant read, so it is checked here instead.
  const tenantTable = /\b(?:from|join|update|into)\s+([a-z_]+)/g;
  const tenantless = new Set(["generate_series", "unnest", "sales", "received", "daily", "cost", "baselines", "latest_cost", "recipe_cost", "report"]);
  const offenders: string[] = [];

  for (const [path, source] of [
    ["lib/repositories/drizzle-erp-workspace-repository.ts", workspaceRepository],
    ["lib/repositories/drizzle-erp-repository.ts", dashboardRepository],
  ] as const) {
    for (const template of sqlTemplates(source)) {
      const tables = [...template.matchAll(tenantTable)].map((match) => match[1]).filter((name) => !tenantless.has(name));
      if (!tables.length) continue; // advisory locks, `select 1`, CTE-only reads
      const scoped = /restaurant_id\s*=\s*\$\{(?:restaurantId|input\.restaurantId)\}/.test(template)
        || /restaurant_id\s*=\s*\$\{\w+\.restaurantId\}/.test(template);
      if (!scoped) offenders.push(`${path}: ${template.replace(/\s+/g, " ").slice(0, 120)}`);
    }
  }
  assert.deepEqual(offenders, [], "a raw ERP statement reads a restaurant-owned table without a tenant predicate");
});

test("no ERP read finds a row by a bare identifier", () => {
  // `where id = $1` alone lets a guessed or leaked UUID cross a tenant
  // boundary; the tenant must be part of the key, not an afterthought.
  for (const template of sqlTemplates(workspaceRepository)) {
    if (!/\bwhere\b/i.test(template)) continue;
    if (!/\b\w*\.?id\s*=\s*\$\{/.test(template)) continue;
    assert.match(template, /restaurant_id\s*=\s*\$\{/, `a bare identifier lookup: ${template.replace(/\s+/g, " ").slice(0, 120)}`);
  }
});

/* ------------------------------------------------ transaction gates ------ */

/** The body of one command method, up to the next one. */
function commandBody(source: string, name: string): string {
  const start = source.indexOf(`${name}(input: Parameters`);
  assert.ok(start !== -1, `${name} moved or was renamed`);
  const rest = source.slice(start + name.length);
  const next = rest.search(/\n {2}(?:private )?[a-zA-Z]\w*\(input: Parameters/);
  return next === -1 ? rest : rest.slice(0, next);
}

test("every stock- and money-moving command is atomic, locked and replay-safe", () => {
  // These are the workflows where a retried request or a concurrent one costs
  // real inventory or real money. Each name below is paired with the guarantees
  // its body must still carry; dropping one is how a double-submit becomes a
  // double-consumption.
  const required: Readonly<Record<string, readonly string[]>> = {
    postStockMovement: ["transaction", "lock", "idempotent", "replay", "balance"],
    completeProductionBatch: ["transaction", "lock", "idempotent", "replay", "balance"],
    recordWaste: ["transaction", "lock", "idempotent", "replay", "balance"],
    createProductionBatch: ["transaction", "idempotent", "replay"],
    createFulfillmentRequest: ["transaction", "idempotent", "replay"],
    receiveGoods: ["transaction", "idempotent", "replay"],
    recordSupplierPayment: ["transaction", "idempotent", "replay"],
    transferStock: ["transaction", "lock", "idempotent", "replay"],
    confirmStockCount: ["transaction", "lock", "idempotent", "replay"],
    setRecipeStatus: ["transaction", "lock"],
  };
  const markers: Readonly<Record<string, RegExp>> = {
    transaction: /db\.transaction\(/,
    lock: /pg_advisory_xact_lock/,
    idempotent: /idempotencyKey/,
    replay: /replayed/,
    balance: /evaluateStockBalance/,
  };
  for (const [name, guarantees] of Object.entries(required)) {
    const source = name === "transferStock" || name === "confirmStockCount" || name === "setRecipeStatus"
      ? workspaceRepository
      : dashboardRepository;
    const body = commandBody(source, name);
    for (const guarantee of guarantees) {
      assert.match(body, markers[guarantee], `${name} lost its ${guarantee} guarantee`);
    }
  }
});

test("a two-leg transfer writes both legs or neither", () => {
  const body = commandBody(workspaceRepository, "transferStock");
  assert.match(body, /movementType:"TRANSFER_OUT"/);
  assert.match(body, /movementType:"TRANSFER_IN"/);
  // Both inserts are inside the one transaction opened at the top of the body.
  const transaction = body.slice(body.indexOf("db.transaction("));
  assert.ok(transaction.includes("TRANSFER_OUT") && transaction.includes("TRANSFER_IN"));
  // Both warehouses are locked in a stable order, so two transfers crossing the
  // same pair cannot deadlock against each other.
  assert.match(body, /\.sort\(\)/);
});

test("attendance cannot open a second record for the same person", () => {
  const attendance = read("lib/services/attendance-service.ts");
  assert.match(attendance, /db\.transaction\(/);
  assert.match(attendance, /pg_advisory_xact_lock/);
  assert.match(attendance, /:attendance/, "the lock must be per staff member");
  assert.match(attendance, /clockInAt:\s*new Date\(\)/, "the clock is the server's, never the client's");
});

test("one recipe version is active per product, in the database and not only in code", () => {
  const schema = read("db/erp-schema.ts");
  assert.match(schema, /recipe_versions_one_active_product_key/);
  assert.match(schema, /where\(sql`\$\{t\.status\} = 'ACTIVE'`\)/);
});

/* ------------------------------------------------ index support ---------- */

test("no dated ERP filter is written in a form an index cannot use", () => {
  // `(column at time zone ...)::date = $1` forces a per-row cast over the whole
  // restaurant's history. The half-open window on the raw column reads the same
  // rows through the index instead. The cast is fine in a projection or a GROUP
  // BY — only a WHERE predicate is a problem.
  const nonSargable = /(?:where|and)\s*\(\s*\w*\.?\w+ at time zone '[^']+'\)::date\s*=/i;
  for (const source of [dashboardRepository, workspaceRepository]) {
    for (const template of sqlTemplates(source)) {
      assert.doesNotMatch(template, nonSargable, `a dated filter cannot use an index: ${template.replace(/\s+/g, " ").slice(0, 120)}`);
    }
  }
  assert.match(dashboardRepository, /const restaurantTimezone = sql`[\s\S]*restaurants\.timezone/);
  assert.match(dashboardRepository, /const today = sql`\(now\(\) at time zone \$\{restaurantTimezone\}\)::date`/);
  assert.match(dashboardRepository, /const dayStart = sql`\$\{today\}::timestamp at time zone \$\{restaurantTimezone\}`/);
  assert.match(dashboardRepository, /const dayEnd = sql`\(\$\{today\} \+ 1\)::timestamp at time zone \$\{restaurantTimezone\}`/);
});

test("every new Phase 39 report predicate has an index behind it", () => {
  const schema = read("db/schema.ts") + read("db/erp-schema.ts");
  const migrations = readdirSync(new URL("../../db/migrations", import.meta.url))
    .filter((name) => name.endsWith(".sql"))
    .map((name) => readFileSync(new URL(`../../db/migrations/${name}`, import.meta.url), "utf8"))
    .join("\n");
  const support: Readonly<Record<string, string>> = {
    // sales module + dashboard today-sales: restaurant, status, time
    orders_restaurant_status_created_idx: "sales by channel over a date range",
    // price history: the window partitions by item and orders by time
    goods_receipt_items_restaurant_inventory_created_idx: "purchase price history",
    // waste report and the dashboard's today figure
    waste_records_restaurant_occurred_idx: "waste over a date range",
    // production report
    production_batches_restaurant_date_status_idx: "production by business date",
    // attendance report
    attendance_records_restaurant_date_idx: "attendance by business date",
    // stock count variance
    stock_count_lines_restaurant_count_idx: "stock count lines by count",
    // stock movements report, added for Phase 39's time-ordered ledger read
    stock_movements_restaurant_occurred_idx: "stock movements over a date range",
  };
  for (const [index, why] of Object.entries(support)) {
    assert.ok(schema.includes(index) || migrations.includes(index), `${why} has no index (${index})`);
  }
});

/**
 * The ERP workspace defaults its date window to the restaurant's day, not UTC's.
 *
 * It used to call `new Date().toISOString().slice(0, 10)`. Türkiye is UTC+3, so
 * between 00:00 and 02:59 local — while a late service is still trading — that
 * returns yesterday, and every workspace list (stock, production, purchasing,
 * invoices, payroll) silently defaulted to a window that excluded the current
 * day's rows. The sibling overview repository already carried the fix and the
 * comment explaining it; the workspace repository did not.
 *
 * Asserted two ways: the offset arithmetic actually crosses the boundary, and
 * the repository no longer derives a calendar day from a UTC ISO string.
 */
test("the ERP workspace dates from the restaurant's calendar day, not UTC's", () => {
  // 21:40Z is 00:40 the next day in Istanbul — the window the bug lived in.
  const lateNight = new Date("2026-09-03T21:40:00Z");
  assert.equal(lateNight.toISOString().slice(0, 10), "2026-09-03");
  assert.equal(formatDay(toLocalDay(lateNight)), "2026-09-04");
  assert.equal(formatDay(addDays(toLocalDay(lateNight), -30)), "2026-08-05");

  const workspaceRepository = readFileSync(
    new URL("../../lib/repositories/drizzle-erp-workspace-repository.ts", import.meta.url),
    "utf8",
  );
  assert.equal(
    /toISOString\(\)\.slice\(0,\s*10\)/.test(workspaceRepository),
    false,
    "a calendar day is being taken from a UTC ISO string again",
  );
  assert.match(workspaceRepository, /formatDay\(toLocalDay\(/);
});
