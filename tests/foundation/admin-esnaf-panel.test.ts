import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ADMIN_APPS,
  ADMIN_HOME,
  ADMIN_SEARCHABLE,
  ADMIN_SHELL_ROW_APPS,
} from "../../components/admin/admin-navigation";
import { ERP_SECTIONS } from "../../components/admin/admin-shell";
import { restaurantToday } from "../../lib/domain/report-range";

/**
 * The panel is for whoever owns the restaurant.
 *
 * Nothing was removed to get there — every screen the product had is still
 * reachable. What changed is which of them compete for the eye on the way in,
 * and what they are called when they get there: a restaurateur reads "Ürün
 * Satış Analizi", not "Menü Mühendisliği", and never reads "ERP".
 */

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const navigation = read("components/admin/admin-navigation.ts");
const dashboard = read("components/admin/dashboard-view.tsx");
const todayPanel = read("components/admin/today-panel.tsx");

/** Every href the sidebar and the advanced index between them offer. */
function navHrefs(): readonly string[] {
  return [
    ADMIN_HOME.href,
    ...ADMIN_SEARCHABLE.map((row) => row.destination.href),
    ...ERP_SECTIONS.flatMap((section) => section.items.map((item) => item.href)),
  ];
}

/** The screens a row lists on its own pages. */
function pagesOf(id: string): readonly { label: string; href: string }[] {
  const app = ADMIN_APPS.find((candidate) => candidate.id === id);
  assert.ok(app, `${id} is missing from the launcher`);
  return (app.sections ?? []).map((section) => ({ label: section.label, href: section.href }));
}

// ------------------------------------------------- 3, 4: nothing was lost

test("every admin route still has a way in", () => {
  const hrefs = new Set(navHrefs());
  // The daily screens, reachable from the sidebar itself.
  for (const daily of [
    "/admin/dashboard",
    "/admin/orders",
    "/admin/menu",
    "/admin/tables",
    "/admin/qr-codes",
    "/admin/staff",
    "/admin/cash-registers",
    "/admin/cash-reports",
    "/admin/reports",
    "/admin/settings",
    "/admin/printers",
  ]) {
    assert.ok(hrefs.has(daily), `${daily} left the navigation`);
  }
  // And the advanced ones, still listed, still reachable.
  const advanced = ERP_SECTIONS.flatMap((section) => section.items.map((item) => item.href));
  for (const href of [
    "/admin/inventory",
    "/admin/recipes",
    "/admin/production",
    "/admin/suppliers",
    "/admin/purchasing",
    "/admin/forecast",
    "/admin/costing",
    "/admin/price-history",
    "/admin/reservations",
    "/admin/customers",
    "/admin/loyalty",
  ]) {
    assert.ok(advanced.includes(href), `${href} is no longer reachable from anywhere`);
  }
  assert.equal(advanced.length, new Set(advanced).size, "an advanced screen is listed twice");
});

test("advanced tools and reports are one link away, and never sidebar rows", () => {
  // They used to be a ninth sidebar row. The sidebar is eight business domains
  // now. Operational tools live under Settings; advanced reporting lives under
  // Reports. Neither requires unfolding a sidebar menu.
  const rows = [ADMIN_HOME, ...ADMIN_SHELL_ROW_APPS];
  assert.ok(!rows.some((row) => row.href === "/admin/erp"), "the advanced hub is a sidebar row again");

  assert.ok(pagesOf("reports").some((page) => page.label === "Gelişmiş" && page.href === "/admin/erp-reports"));
  assert.ok(pagesOf("settings").some((page) => page.label === "Gelişmiş" && page.href === "/admin/erp"));

  // And it is still named in full where a label has no context to lean on —
  // the phone title bar and the menu search.
  assert.match(navigation, /label: "Gelişmiş İşletme Araçları", href: "\/admin\/erp"/);
});

// ------------------------------------------------------ 6: esnaf language

test("the navigation never says it in engineer", () => {
  const labels = [...navigation.matchAll(/label: "([^"]+)"/g)].map((match) => match[1]);
  assert.ok(labels.length >= 39, "the navigation table lost its labels");
  for (const label of labels) {
    for (const jargon of ["ERP", "Mühendislik", "Ledger", "Payload", "Workspace", "Enum", "Webhook", "Outbox", "Tenant"]) {
      assert.ok(
        !label.includes(jargon),
        `the sidebar shows "${label}" — "${jargon}" is not a word a restaurateur uses`,
      );
    }
  }
  // And the replacements are the business words, not just different code. The
  // domain row names them in context — "Ürünler" under Raporlar is a product
  // report, "İşletme" under Ayarlar is the business's own settings — so they
  // are shorter than they were as sidebar rows, and still not engineer words.
  for (const word of ["Gelişmiş İşletme Araçları", "Popüler Ürünler", "İşletme Raporları", "Ücret Hesabı"]) {
    assert.ok(navigation.includes(word), `the navigation never says "${word}"`);
  }
});

// -------------------------------- 7: sales and collection are not the same

test("the day's sales and the day's takings are shown as different things", () => {
  assert.match(dashboard, /Bugünkü satış/);
  assert.match(dashboard, /Bugünkü tahsilat/);
  // Two different authoritative sources, never one figure relabelled.
  assert.match(dashboard, /overview\.data\.today\.sales/, "sales must come from the sales basis");
  assert.match(
    dashboard,
    /collections\.data\.netCollected/,
    "takings must come from the day-end report, not from the sales figure",
  );
  // And the screen says out loud that they differ.
  assert.match(dashboard, /Satış ve tahsilat aynı şey değildir/);
  // No second money engine: the dashboard adds up no payments of its own.
  assert.doesNotMatch(dashboard, /reduce\([^)]*payment/i);
});

test("the manager's home answers the questions it is opened for", () => {
  for (const question of [
    "Bugünkü satış",
    "Bugünkü tahsilat",
    "Kasa durumu",
    "Açık sipariş",
    "Açık masa",
    "masa hesap bekliyor",
    "sipariş gecikti",
  ]) {
    assert.ok(dashboard.includes(question), `the home never answers "${question}"`);
  }
});

// ------------------------------------------- 10: absence is not zero

test("a figure that did not arrive is a dash, not a zero", () => {
  const resourceValue = dashboard.slice(dashboard.indexOf("function ResourceValue"), dashboard.indexOf("function MobileMetric"));
  assert.match(resourceValue, /if \(ready\)/);
  assert.match(resourceValue, />—</);
  assert.match(resourceValue, /error \? "Alınamadı" : "Yükleniyor"/);
  assert.doesNotMatch(resourceValue, /\? 0|\? "0"/);
  assert.match(dashboard, /ready=\{overviewReady\}[^\n]*overview\.data\.today\.sales/);
  assert.match(dashboard, /ready=\{collectionsReady\}[^\n]*collections\.data\.netCollected/);
  // The warnings panel keeps its own three states.
  assert.match(todayPanel, /const failed = Boolean\(error\)/);
  assert.match(todayPanel, /const pending = overview === null && !failed/);
});

// ------------------------------------------------- 9: real Home apps

test("every Home app opens a screen that exists", () => {
  const block = dashboard.slice(dashboard.indexOf("HOME_APP_SHORTCUTS"), dashboard.indexOf("export function greetingForHour"));
  const targets = [...block.matchAll(/href: "(\/admin[^"]*)"/g)].map((match) => match[1]);
  assert.equal(targets.length, 8, "the Home Screen must expose exactly eight apps");
  const known = new Set(navHrefs());
  for (const target of targets) {
    assert.ok(known.has(target), `${target} is a shortcut to nowhere`);
  }
  // Daily work, not ERP paperwork.
  for (const erp of ["/admin/purchasing", "/admin/payables", "/admin/waste", "/admin/production"]) {
    assert.ok(!targets.includes(erp), `${erp} is not a daily shortcut for an owner`);
  }
});

// ------------------------------------------- 8: warnings lead somewhere real

test("each warning names what happened and opens where it is fixed", () => {
  const start = todayPanel.indexOf("function warningsFor");
  const block = todayPanel.slice(start, todayPanel.indexOf("return warnings;", start));
  // Deep links carry a fragment for the form inside the screen; the screen is
  // what has to exist.
  const hrefs = [...block.matchAll(/href: "(\/admin[^"#]*)/g)].map((match) => match[1]);
  assert.ok(hrefs.length >= 5);
  const known = new Set(navHrefs());
  for (const href of hrefs) {
    assert.ok(known.has(href), `a warning points at ${href}, which the navigation does not have`);
  }
  // Each carries a sentence and an action, not a bare red number.
  assert.match(block, /text: `\$\{/);
  assert.match(block, /action: "/);
});

// ---------------------------------------------- one definition of "today"

test("the home and the day-end report mean the same day", () => {
  const cashReport = read("components/admin/cash-day-report-view.tsx");
  assert.match(cashReport, /const localToday = \(timeZone: string\) => restaurantToday\(timeZone\)/);
  // Now with the restaurant's own zone, rather than a fixed +03:00.
  assert.match(dashboard, /restaurantToday\(restaurantTimezone\)/);
  // Two copies of this were two ways to disagree about which day a payment
  // belongs to; there is one now.
  assert.doesNotMatch(cashReport, /Date\.now\(\) \+ 180 \* 60_000/);
  assert.equal(
    restaurantToday("Europe/Istanbul", new Date("2026-09-08T21:30:00.000Z")),
    "2026-09-09",
  );
  assert.equal(
    restaurantToday("Europe/Istanbul", new Date("2026-09-08T20:30:00.000Z")),
    "2026-09-08",
  );
});

// --------------------------------------------------- 12: nothing regressed

test("the routes earlier phases settled are untouched", () => {
  const hrefs = new Set(navHrefs());
  for (const href of ["/admin/settings", "/admin/cash-registers", "/admin/cash-reports"]) {
    assert.ok(hrefs.has(href));
  }
  // Products and categories still redirect into the menu editor rather than
  // reappearing as separate sidebar entries.
  assert.ok(!hrefs.has("/admin/products"));
  assert.ok(!hrefs.has("/admin/categories"));
});

test("a renamed screen is renamed where it is opened, not only in the sidebar", () => {
  // Phase 3 renamed the sidebar entry and stopped there, so the page it opens
  // still announced itself as "ERP / Gelişmiş" in its window title and its
  // browser tab, and its failure line still said "ERP verileri okunamadı".
  // Found at a real viewport; this keeps every surface of a screen agreeing.
  for (const file of [
    "app/admin/erp/page.tsx",
    "components/admin/erp-operations-module.tsx",
    "components/admin/erp-operations-manager.tsx",
    "components/admin/today-panel.tsx",
  ]) {
    const source = read(file);
    // Titles and sentences shown to a person. Identifiers such as
    // `ERP_UNIT_LABELS` and comments are not shown and may keep the old word.
    const shown = [
      ...source.matchAll(/title: "([^"]*)"/g),
      ...source.matchAll(/title="([^"]*)"/g),
      ...source.matchAll(/"([^"]*(?:okunamadı|alınamadı)[^"]*)"/g),
    ].map((match) => match[1]);
    for (const text of shown) {
      assert.ok(!text.includes("ERP"), `${file} still shows "${text}" to a user`);
    }
  }
  assert.match(read("app/admin/erp/page.tsx"), /Gelişmiş İşletme Araçları/);
  assert.match(read("components/admin/erp-operations-module.tsx"), /Gelişmiş İşletme Araçları/);
});
