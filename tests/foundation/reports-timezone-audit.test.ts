import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  AUDIT_SAFE_FIELDS,
  auditActionLabel,
  auditEntityLabel,
  auditFieldLabel,
  projectAuditChanges,
} from "../../lib/domain/audit-log";
import {
  DEFAULT_RESTAURANT_TIME_ZONE,
  resolveReportRange,
  restaurantToday,
  startOfLocalDay,
  toLocalDay,
} from "../../lib/domain/report-range";
import { auditLogQuerySchema } from "../../lib/validation/audit-log";

/**
 * A day is the day the restaurant worked, and the record of what its people did
 * is written in their words — not in the database's.
 */

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

/** Every TypeScript source under a root, so the scan cannot miss a writer. */
function walk(dir: URL): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) out.push(...walk(new URL(`${entry.name}/`, dir)));
    else if (entry.name.endsWith(".ts")) out.push(readFileSync(new URL(entry.name, dir), "utf8"));
  }
  return out;
}
const dashboard = read("components/admin/dashboard-view.tsx");
const reportRoute = read("lib/api/report-route.ts");
const cashierReport = read("lib/services/cashier-report-service.ts");

// ------------------------------------------------ 5, 6: the restaurant's day

test("today is resolved in the restaurant's own zone, not a fixed offset", () => {
  // 21:30 UTC is already tomorrow in Istanbul, still today in London, and
  // still today in New York. One instant, three different business days.
  const instant = new Date("2026-06-08T21:30:00.000Z");
  assert.equal(restaurantToday("Europe/Istanbul", instant), "2026-06-09");
  assert.equal(restaurantToday("Europe/London", instant), "2026-06-08");
  assert.equal(restaurantToday("America/New_York", instant), "2026-06-08");
});

test("daylight saving is a property of the instant, not a constant", () => {
  // London is +01:00 in June and +00:00 in January. A fixed offset cannot be
  // right in both, which is why the offset is read per instant.
  const summer = new Date("2026-06-08T23:30:00.000Z");
  const winter = new Date("2026-01-08T23:30:00.000Z");
  assert.equal(restaurantToday("Europe/London", summer), "2026-06-09");
  assert.equal(restaurantToday("Europe/London", winter), "2026-01-08");

  // And midnight is the real local midnight on each side of the change.
  const juneMidnight = startOfLocalDay({ year: 2026, month: 6, day: 8 }, "Europe/London");
  const janMidnight = startOfLocalDay({ year: 2026, month: 1, day: 8 }, "Europe/London");
  assert.equal(juneMidnight.toISOString(), "2026-06-07T23:00:00.000Z");
  assert.equal(janMidnight.toISOString(), "2026-01-08T00:00:00.000Z");
});

test("Istanbul keeps behaving exactly as it did", () => {
  // No daylight saving since 2016, so the previous fixed +03:00 and the zone
  // agree — which is what makes this change safe for the restaurant that runs
  // on it today.
  for (const iso of ["2026-06-08T21:30:00.000Z", "2026-01-08T21:30:00.000Z"]) {
    const instant = new Date(iso);
    const legacy = new Date(instant.getTime() + 180 * 60_000).toISOString().slice(0, 10);
    assert.equal(restaurantToday("Europe/Istanbul", instant), legacy);
  }
  assert.equal(DEFAULT_RESTAURANT_TIME_ZONE, "Europe/Istanbul");
});

test("a report period is bounded by the restaurant's midnights", () => {
  const now = new Date("2026-06-08T21:30:00.000Z");
  const istanbul = resolveReportRange({ preset: "TODAY", now, timeZone: "Europe/Istanbul" });
  const london = resolveReportRange({ preset: "TODAY", now, timeZone: "Europe/London" });
  // Same instant, different business day, therefore different window.
  assert.notEqual(istanbul.start.toISOString(), london.start.toISOString());
  assert.deepEqual(istanbul.startDay, { year: 2026, month: 6, day: 9 });
  assert.deepEqual(london.startDay, { year: 2026, month: 6, day: 8 });
  assert.equal(toLocalDay(istanbul.start, "Europe/Istanbul").day, 9);
});

// ------------------- the zone reaches the buckets, not only the boundaries

test("a resolved period carries the zone it was measured in", () => {
  // Without this the caller has the right window and still has to guess the
  // zone to group by inside it, which is exactly how a fixed offset survived
  // in the report services after the boundaries were already correct.
  const now = new Date("2026-06-08T21:30:00.000Z");
  for (const zone of ["Europe/Istanbul", "Europe/London", "America/New_York"]) {
    assert.equal(resolveReportRange({ preset: "TODAY", now, timeZone: zone }).timeZone, zone);
  }
  // And the default is the restaurant default, never an empty string.
  assert.equal(resolveReportRange({ preset: "TODAY", now }).timeZone, DEFAULT_RESTAURANT_TIME_ZONE);
});

test("one instant falls in three different local buckets", () => {
  // 02:30 UTC is the same moment everywhere. It is already the 9th in Istanbul,
  // the small hours of the 9th in London, and still the evening of the 8th in
  // New York. Grouping by hour, weekday or day must follow the restaurant.
  const instant = new Date("2026-06-09T02:30:00.000Z");
  assert.deepEqual(toLocalDay(instant, "Europe/Istanbul"), { year: 2026, month: 6, day: 9 });
  assert.deepEqual(toLocalDay(instant, "Europe/London"), { year: 2026, month: 6, day: 9 });
  assert.deepEqual(toLocalDay(instant, "America/New_York"), { year: 2026, month: 6, day: 8 });

  // The same three zones on a winter instant, where London and Istanbul part.
  const winter = new Date("2026-01-08T22:30:00.000Z");
  assert.deepEqual(toLocalDay(winter, "Europe/Istanbul"), { year: 2026, month: 1, day: 9 });
  assert.deepEqual(toLocalDay(winter, "Europe/London"), { year: 2026, month: 1, day: 8 });
  assert.deepEqual(toLocalDay(winter, "America/New_York"), { year: 2026, month: 1, day: 8 });
});

test("a New York day is a different length across its clock change", () => {
  // Fixed offsets cannot express this: the March day is 23 hours long.
  const beforeDst = startOfLocalDay({ year: 2026, month: 3, day: 8 }, "America/New_York");
  const afterDst = startOfLocalDay({ year: 2026, month: 3, day: 9 }, "America/New_York");
  assert.equal((afterDst.getTime() - beforeDst.getTime()) / 3_600_000, 23);

  // Istanbul keeps 24 because Türkiye has no daylight saving, which is why the
  // old fixed +03:00 went unnoticed there.
  const istBefore = startOfLocalDay({ year: 2026, month: 3, day: 8 }, "Europe/Istanbul");
  const istAfter = startOfLocalDay({ year: 2026, month: 3, day: 9 }, "Europe/Istanbul");
  assert.equal((istAfter.getTime() - istBefore.getTime()) / 3_600_000, 24);
});

test("no report or date path still carries a hard-coded +03", () => {
  // The four places the final release audit found. A bare `interval '3 hours'`
  // and a bare `180 * 60_000` are the two shapes it took.
  for (const path of [
    "lib/services/report-analytics-service.ts",
    "lib/services/report-detail-service.ts",
    "app/api/cashier/shifts/route.ts",
    "app/api/admin/print-jobs/route.ts",
    "lib/domain/report-range.ts",
    "lib/services/cashier-report-service.ts",
  ]) {
    const source = read(path);
    // The prose in report-analytics-service names the old shape to explain why
    // it is gone, so only executable occurrences are rejected.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(code, /interval '3 hours'/, `${path} still pins a fixed interval`);
    assert.doesNotMatch(code, /180 \* 60_000/, `${path} still pins a fixed offset`);
  }
});

test("the buckets and the filters take the zone from the restaurant", () => {
  const analytics = read("lib/services/report-analytics-service.ts");
  const detail = read("lib/services/report-detail-service.ts");
  // The grouping expression reads the zone off the range that bounded it...
  for (const [name, source] of [["analytics", analytics], ["detail", detail]] as const) {
    assert.match(source, /function localTimeZone\(range: ResolvedReportRange\): SQL/, name);
    assert.match(source, /sql`\$\{range\.timeZone\}`/, name);
    assert.match(source, /at time zone \$\{localTimeZone\(range\)\}/, name);
  }
  // The bucket is grouped by output position. Repeating the expression instead
  // fails at runtime with PostgreSQL 42803: the zone is a bound parameter and
  // each occurrence binds its own placeholder, so the GROUP BY expression is
  // not the SELECT expression any more. The old fixed interval was a literal,
  // which is why it could be repeated -- and why this only broke on the fix.
  for (const [name, source] of [["analytics", analytics], ["detail", detail]] as const) {
    assert.doesNotMatch(source, /groupBy\(sql`extract\(hour from \$\{localTime\}\)`/, name);
    assert.doesNotMatch(source, /groupBy\(sql`to_char\(\$\{[a-zA-Z]+\}, 'YYYY-MM-DD'\)`/, name);
    assert.match(source, /\.groupBy\(sql`1`\)/, name);
  }

  // ...and the two date filters use the shared helper with the restaurant's own
  // zone rather than rolling their own arithmetic.
  for (const path of ["app/api/cashier/shifts/route.ts", "app/api/admin/print-jobs/route.ts"]) {
    const source = read(path);
    assert.match(source, /startOfLocalDay\(addDays\(\{ year, month, day \}, plusDays\), timeZone\)/, path);
    assert.match(source, /dayStart\(query\.dateFrom, principal\.restaurant\.timezone\)/, path);
    assert.match(source, /dayStart\(query\.dateTo, principal\.restaurant\.timezone, 1\)/, path);
  }
});

// ----------------------------------------- 7: one contract, not one per screen

test("every layer takes the zone from the restaurant", () => {
  assert.match(reportRoute, /timeZone: principal\.restaurant\.timezone/);
  assert.match(cashierReport, /restaurant\?\.timezone \?\? DEFAULT_RESTAURANT_TIME_ZONE/);
  assert.match(cashierReport, /startOfLocalDay\(day, timeZone\)/);
  assert.match(dashboard, /restaurantToday\(restaurantTimezone\)/);
  // And the fixed offset is gone from the codebase's date arithmetic.
  const range = read("lib/domain/report-range.ts");
  assert.doesNotMatch(range, /RESTAURANT_UTC_OFFSET_MINUTES/);
  const cashView = read("components/admin/cash-day-report-view.tsx");
  assert.doesNotMatch(cashView, /180 \* 60_000/);
});

// -------------------------------------------- 1, 2: sales is not collection

test("sales and collection stay two different figures from two sources", () => {
  assert.match(dashboard, /overview\.data\.today\.sales/);
  assert.match(dashboard, /collections\.data\.netCollected/);
  assert.match(dashboard, /Satış ve tahsilat aynı şey değildir/);
  // No client-side re-aggregation of money anywhere on the screen.
  assert.doesNotMatch(dashboard, /reduce\([^)]*payment/i);
  assert.doesNotMatch(dashboard, /reduce\([^)]*amount/i);
});

// --------------------------------------------- 11, 13: audit stays safe

test("only allowlisted fields cross the wire, and never a credential", () => {
  const changes = projectAuditChanges(
    { status: "OPEN", password: "hunter2", sessionToken: "abc", apiKey: "k" },
    { status: "CLOSED", password: "hunter3", sessionToken: "def", apiKey: "k2" },
  );
  assert.deepEqual(changes, [{ field: "status", before: "OPEN", after: "CLOSED" }]);

  const serialised = JSON.stringify(changes);
  for (const secret of ["hunter2", "hunter3", "abc", "def", "password", "Token", "apiKey"]) {
    assert.ok(!serialised.includes(secret), `${secret} reached the client`);
  }
  // The allowlist itself carries nothing credential-shaped.
  for (const field of AUDIT_SAFE_FIELDS) {
    assert.doesNotMatch(field, /pass|token|secret|credential|session|key$/i, `${field} is unsafe`);
  }
});

test("a nested value is never rendered raw", () => {
  // Free-form JSON is where an unexpected secret hides. Objects and arrays are
  // dropped rather than stringified into the page.
  const changes = projectAuditChanges(
    { name: "Eski", note: { nested: "gizli" } },
    { name: "Yeni", note: ["a", "b"] },
  );
  assert.deepEqual(changes, [{ field: "name", before: "Eski", after: "Yeni" }]);
});

test("the change list is bounded", () => {
  const wide = Object.fromEntries(AUDIT_SAFE_FIELDS.map((field) => [field, "x"]));
  assert.ok(projectAuditChanges(wide, wide).length <= 12);
});

// ------------------------------------------- 12: business words, not codes

test("the record reads as sentences, not as event names", () => {
  assert.equal(auditActionLabel("order.item.voided"), "Ürünü hesaptan çıkardı");
  assert.equal(auditActionLabel("cashier_shift.closed"), "Kasa vardiyasını kapattı");
  assert.equal(auditEntityLabel("CASHIER_SHIFT"), "Kasa vardiyası");
  assert.equal(auditFieldLabel("cashVariance"), "Kasa farkı");
  // An unknown code is described, never printed.
  assert.equal(auditActionLabel("some.future.action"), "Bir kayıt değiştirdi");
  assert.equal(auditEntityLabel("SOMETHING"), "Kayıt");
  assert.equal(auditFieldLabel("someColumn"), "Değer");
  // Every allowlisted field has a word of its own.
  for (const field of AUDIT_SAFE_FIELDS) {
    assert.notEqual(auditFieldLabel(field), "Değer", `${field} has no label`);
  }
});

// --------------------------------------------- 9, 10, 14: scope and bounds

test("the record is read-only, restaurant-scoped and bounded", () => {
  const route = read("app/api/admin/audit-logs/route.ts");
  // One verb. There is no write path to secure because there is no write path.
  assert.match(route, /export function GET/);
  for (const verb of ["POST", "PATCH", "PUT", "DELETE"]) {
    assert.ok(!route.includes(`export function ${verb}`), `the audit route exposes ${verb}`);
  }
  // The shared admin envelope supplies the roles and the tenant.
  assert.match(route, /adminRead\(/);

  const service = read("lib/services/audit-log-service.ts");
  assert.match(service, /eq\(auditLogs\.restaurantId, principal\.restaurantId\)/);
  // The tenant is never taken from the request.
  assert.doesNotMatch(service, /query\.restaurantId/);
  for (const verb of ["update(", "delete(", "insert("]) {
    assert.ok(!service.includes(verb), `the audit service can ${verb}`);
  }

  // Page size is a cost, so it is capped rather than trusted.
  assert.equal(auditLogQuerySchema.safeParse({ pageSize: "500" }).success, false);
  assert.equal(auditLogQuerySchema.safeParse({ page: "0" }).success, false);
  assert.equal(auditLogQuerySchema.safeParse({ pageSize: "100" }).success, true);
  assert.equal(auditLogQuerySchema.safeParse({ restaurantId: "x" }).success, false);
  const parsed = auditLogQuerySchema.parse({});
  assert.equal(parsed.page, 1);
  assert.equal(parsed.pageSize, 25);
});

// --------------------------------------------------- 15, 16: nothing lost

test("every report screen is still reachable, under the words phase 3 gave them", () => {
  // The menu is a table of its own now; the sidebar draws it rather than
  // holding it, so this is asked of the table.
  const shell = read("components/admin/admin-navigation.ts");
  for (const href of [
    "/admin/reports",
    "/admin/cash-reports",
    "/admin/sales",
    "/admin/popular",
    "/admin/menu-engineering",
    "/admin/erp-reports",
    "/admin/audit",
  ]) {
    assert.ok(shell.includes(`"${href}"`), `${href} is not in the navigation`);
  }
  for (const label of ["Ürün Satış Analizi", "İşletme Raporları", "İşlem Geçmişi"]) {
    assert.ok(shell.includes(label), `the navigation never says "${label}"`);
  }
  // And still no engineer words in the sidebar.
  const labels = [...shell.matchAll(/label: "([^"]+)"/g)].map((match) => match[1]);
  for (const label of labels) {
    assert.ok(!/ERP|Mühendislik|Audit|Log/.test(label), `the sidebar shows "${label}"`);
  }
});

// -------------------------------------------- 3: missing cost is not zero cost

test("a missing cost is reported as missing, never as zero profit", () => {
  const service = read("lib/services/report-analytics-service.ts");
  const view = read("components/admin/advanced-reports-view.tsx");
  // The contract says outright that profit could not be derived...
  assert.match(service, /profitAvailable: false/);
  // ...and the screen says why, rather than printing ₺0,00 or a 100% margin.
  assert.match(view, /maliyet verisi henüz kaydedilmediği için hesaplanmıyor/);
  assert.doesNotMatch(view, /profit[^\n]*\?\?\s*0/i);
});

// ------------------------------------------- 4: popularity is not merchandising

test("what sells and what the owner promotes are two different fields", () => {
  const menuRepo = read("lib/repositories/drizzle-menu-repository.ts");
  // Featured is the restaurant's own choice, stored on the product...
  assert.match(menuRepo, /isFeatured: products\.isFeatured/);
  // ...and popular is derived from what was actually sold.
  assert.match(menuRepo, /isPopular: sql<boolean>`\$\{popularProductSnapshots\.productId\} is not null`/);
  // They are never read off one another.
  assert.doesNotMatch(menuRepo, /isPopular: products\.isFeatured/);
  assert.doesNotMatch(menuRepo, /isFeatured: sql<boolean>`\$\{popularProductSnapshots/);
});

test("every action the code actually records has a sentence of its own", () => {
  // The labels were first written from guesses and the live record disagreed:
  // it stores `TABLE_QR_RESUMED`, not `table.qr_resumed`. These are read from
  // the writes themselves, so a new service cannot add an action that reaches
  // a manager as "Bir kayıt değiştirdi".
  const sources = ["lib", "app"].flatMap((root) => walk(new URL(`../../${root}/`, import.meta.url)));
  const actions = new Set<string>();
  const entities = new Set<string>();
  for (const source of sources) {
    for (const match of source.matchAll(/action: *"([^"]+)"/g)) actions.add(match[1]);
    for (const match of source.matchAll(/entityType: *"([^"]+)"/g)) entities.add(match[1]);
  }
  // Idempotency and print-job states share the word "action"; they are not
  // audit actions and never reach this screen.
  const notAudit = new Set(["CONFLICT", "EXECUTE", "IN_FLIGHT", "REPLAY", "REPRINT", "RETRY"]);

  const unlabelled = [...actions]
    .filter((action) => !notAudit.has(action))
    .filter((action) => auditActionLabel(action) === "Bir kayıt değiştirdi");
  assert.deepEqual(unlabelled, [], `these recorded actions have no wording: ${unlabelled.join(", ")}`);

  const unnamed = [...entities].filter((entity) => auditEntityLabel(entity) === "Kayıt");
  assert.deepEqual(unnamed, [], `these record types have no wording: ${unnamed.join(", ")}`);
  assert.ok(actions.size > 40, "the action scan found too little to be trusted");
});
