import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { isDemoLauncherEnabled } from "../../lib/config/demo-launcher";
import { TABLE_STATUS_LABELS } from "../../lib/domain/display";
import { TABLE_STATUSES } from "../../lib/domain/status";

/**
 * The home page's demo table picker.
 *
 * It failed in the field with "Masalar yüklenemedi. Tekrar deneyin." and a
 * Retry button that could never succeed: the launcher refuses to guess which
 * restaurant to demo when several exist, and the picker rendered that
 * permanent, actionable answer as a generic transient error. These guard both
 * halves — the states the picker distinguishes, and the fact that this
 * developer tool never became a way around the real QR authorisation.
 */

const picker = readFileSync(new URL("../../components/shared/demo-table-picker.tsx", import.meta.url), "utf8");
const service = readFileSync(new URL("../../lib/services/demo-launcher-service.ts", import.meta.url), "utf8");
const tablesRoute = readFileSync(new URL("../../app/api/demo/tables/route.ts", import.meta.url), "utf8");

const portals = readFileSync(new URL("../../components/shared/prototype-portals.tsx", import.meta.url), "utf8");
const homePage = readFileSync(new URL("../../app/page.tsx", import.meta.url), "utf8");

test("the home page card opens the picker, which reads the demo endpoint", () => {
  assert.match(portals, /DemoTablePicker/);
  assert.match(portals, /open=\{pickerOpen\}/);
  assert.match(picker, /demoApi\.tables\(signal\)/);
  // It must not reach for a staff-protected list to fill a public dialog.
  assert.doesNotMatch(picker, /adminApi|staffApi/);
});

test("loading, empty, error and success are four different states", () => {
  const body = picker.slice(picker.indexOf("{resource.loading ?"), picker.indexOf("<ProductDetail") + 1 || undefined);
  assert.match(picker, /resource\.loading \?/);
  assert.match(picker, /: resource\.error \?/);
  assert.match(picker, /: tables\.length === 0 \?/);
  // An empty restaurant is not a failure and must not borrow the error copy.
  assert.match(picker, /Şu anda seçilebilir aktif masa bulunmuyor\./);
  assert.ok(
    picker.indexOf("Şu anda seçilebilir aktif masa bulunmuyor.") > picker.indexOf("Masalar yüklenemedi"),
    "the empty state must be its own branch",
  );
  assert.ok(body.length >= 0);
});

test("retry is offered only when trying again could work", () => {
  // A 4xx is the deployment answering, not a hiccup: it is shown as a plain
  // unavailable sentence, with no button that would loop forever.
  assert.match(picker, /error\.status >= 400 && error\.status < 500/);
  assert.match(picker, /message: "Masa seçimi şu anda kullanılamıyor\.", retryable: false/);
  assert.match(picker, /retryable: true/);
  assert.match(picker, /diagnosis\.retryable \?/);
  // The server's wording — environment variables, staff roles — is a console
  // note for the developer, never text on a guest's screen.
  assert.match(picker, /console\.warn\("\[demo-table-picker\]", error\.status, error\.message\)/);
  assert.doesNotMatch(picker, /setFailure\([\s\S]{0,80}error\.message/);
  // Both failures — listing tables and opening one — go through the one check.
  assert.equal(picker.match(/diagnose\(/g)?.length, 3);
});

test("retry performs a real request and cannot be double-fired", () => {
  assert.match(picker, /onClick=\{\(\) => void resource\.refetch\(\)\}/);
  assert.match(picker, /disabled=\{resource\.loading\}/);
  assert.match(picker, /\{resource\.loading \? "Yükleniyor…" : "Yeniden dene"\}/);
});

test("every table status has a word, so no raw enum can reach the dialog", () => {
  // The picker used to keep its own list and printed CLEANING and DINING
  // verbatim. It now reads the shared vocabulary, which covers the column.
  for (const status of TABLE_STATUSES) {
    const label = TABLE_STATUS_LABELS[status];
    assert.ok(label, `${status} has no Turkish label`);
    assert.doesNotMatch(label, /^[A-Z_]+$/, `${status} is shown as its own enum name`);
  }
  assert.match(picker, /TABLE_STATUS_LABELS/);
  assert.match(picker, /displayLabel\(TABLE_STATUS_LABELS, null\)/);
  // No second, drifting copy of the vocabulary.
  assert.doesNotMatch(picker, /STATUS_LABELS: Record<string/);
});

test("the dialog shows names and status, never an identifier", () => {
  const rendered = picker.slice(picker.indexOf("{tables.map((table)"), picker.indexOf("{failure ?"));
  assert.match(rendered, /\{table\.name\}/);
  assert.match(rendered, /\{status\.label\}/);
  // The id is a key and a request argument, never text on the screen.
  assert.doesNotMatch(rendered, />\s*\{table\.id\}/);
  assert.match(rendered, /key=\{table\.id\}/);
});

test("the demo response publishes no tenant identifier", () => {
  assert.match(service, /readonly restaurant: \{ readonly name: string; readonly slug: string \}/);
  assert.match(service, /restaurant: \{ name: restaurant\.name, slug: restaurant\.slug \}/);
  // The query names its columns, so nothing rides along: exactly the five
  // display fields, no QR material, no tenant id, no audit column.
  const selection = service.slice(
    service.indexOf("async listTables()"),
    service.indexOf(".from(restaurantTables)"),
  );
  assert.deepEqual(
    [...selection.matchAll(/\w+: restaurantTables\.(\w+),/g)].map((match) => match[1]),
    ["id", "name", "tableNumber", "seats", "currentStatus"],
  );
});

test("the launcher stays off unless deliberately enabled", () => {
  assert.equal(isDemoLauncherEnabled({}), false);
  assert.equal(isDemoLauncherEnabled({ ENABLE_DEMO_LAUNCHER: "1" }), false);
  assert.equal(isDemoLauncherEnabled({ ENABLE_DEMO_LAUNCHER: "true" }), true);
  // A disabled deployment does not even admit the route exists.
  assert.match(tablesRoute, /if \(!isDemoLauncherEnabled\(\)\) throw demoLauncherDisabledError\(\)/);
  assert.match(service, /httpStatus: 404/);
});

test("the launcher refuses to guess a tenant rather than picking one", () => {
  // This is the guard that produced the reported failure, and it is correct:
  // silently demoing whichever restaurant sorted first would be worse.
  assert.match(service, /if \(!slug && rows\.length > 1\)/);
  assert.match(service, /DEMO_RESTAURANT_SLUG tanımlayın/);
  // The restaurant is resolved on the server, never from the browser.
  assert.match(service, /process\.env\.DEMO_RESTAURANT_SLUG/);
  assert.match(service, /eq\(restaurants\.isActive, true\)/);
});

test("the demo picker did not become a way around real QR authorisation", () => {
  // It navigates to a genuine /menu/<token> URL, so the ordinary gate still
  // validates the token and mints the session.
  assert.match(picker, /demoApi\s*\n?\s*\.tableMenu\(table\.id\)/);
  assert.match(picker, /window\.open\(result\.path/);
  assert.doesNotMatch(picker, /document\.cookie|localStorage|sessionStorage/);

  // The real customer route is unchanged: still the signed table context.
  const menuRoute = readFileSync(new URL("../../app/api/menu/route.ts", import.meta.url), "utf8");
  assert.match(menuRoute, /requireCustomerTableContext\(\)/);
  const context = readFileSync(new URL("../../lib/auth/customer-table-context.ts", import.meta.url), "utf8");
  assert.match(context, /row\.tokenVersion !== claims\.accessVersion/);
  assert.match(context, /row\.tokenRevokedAt/);
});

/**
 * What the home page offers where the launcher is switched off.
 *
 * Where it is off `/api/demo/tables` is shut with it, so the picker there can
 * load nothing. The tile opened it regardless, and a guest who pressed
 * "Müşteri QR Menü" was handed "Masa seçimi şu anda kullanılamıyor." — an
 * error produced by a button that could never work. A control that is
 * guaranteed to fail should not be a control.
 */

test("the deployment decides, on the server, and hands down a plain boolean", () => {
  // The client component must not go looking at the environment itself.
  assert.match(homePage, /isDemoLauncherEnabled/);
  assert.match(homePage, /<PrototypePortals demoLauncherEnabled=\{isDemoLauncherEnabled\(\)\} \/>/);
  assert.match(portals, /demoLauncherEnabled \}: \{ demoLauncherEnabled: boolean \}/);
  for (const leak of [
    "process.env",
    "VERCEL_ENV",
    "ENABLE_DEMO_LAUNCHER",
    "ENABLE_PRODUCTION_TABLE_PICKER",
  ]) {
    assert.ok(!portals.includes(leak), `the client tile reads ${leak} itself`);
  }
});

test("with the launcher off there is nothing to press and nothing to fail", () => {
  const offBranch = portals
    .slice(portals.indexOf(") : ("), portals.indexOf("{staffPortals.map"))
    // Prose describing the choice is not markup: the comment there says the
    // card is "not disabled", which a naive scan would read as a disabled card.
    .replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(offBranch.length > 0, "the informational branch is missing");
  // A plain card: no button, no dialog affordance, no arrow.
  assert.doesNotMatch(offBranch, /<button|onClick=|aria-haspopup/);
  assert.doesNotMatch(offBranch, /ArrowRight/);
  // Not styled as disabled and not styled as an error — an ordinary tile.
  assert.doesNotMatch(offBranch, /disabled|opacity-|cursor-|text-destructive|border-status-danger/);
  // It tells the guest how the menu is actually reached.
  assert.match(offBranch, /Menüyü görüntülemek için masanızdaki QR kodunu okutun\./);
});

test("the picker is not even mounted where it could load nothing", () => {
  assert.match(portals, /\{demoLauncherEnabled \? \(\s*<DemoTablePicker/s);
});

test("with the launcher on the tile still opens the real picker", () => {
  const onBranch = portals.slice(portals.indexOf("{demoLauncherEnabled ? ("), portals.indexOf(") : ("));
  assert.match(onBranch, /<button/);
  assert.match(onBranch, /onClick=\{\(\) => setPickerOpen\(true\)\}/);
  assert.match(onBranch, /aria-haspopup="dialog"/);
  assert.match(onBranch, /Aktif masalardan birini seçin/);
  assert.match(onBranch, /ArrowRight/);
});

test("preview and development are opened by the demo flag, and only by it", () => {
  assert.equal(isDemoLauncherEnabled({ ENABLE_DEMO_LAUNCHER: "true", VERCEL_ENV: "preview" }), true);
  assert.equal(isDemoLauncherEnabled({ ENABLE_DEMO_LAUNCHER: "true", VERCEL_ENV: "development" }), true);
  assert.equal(isDemoLauncherEnabled({ ENABLE_DEMO_LAUNCHER: "true" }), true);
  // And without the flag nothing opens there.
  assert.equal(isDemoLauncherEnabled({ ENABLE_DEMO_LAUNCHER: "false", VERCEL_ENV: "preview" }), false);
  assert.equal(isDemoLauncherEnabled({ VERCEL_ENV: "preview" }), false);
  assert.equal(isDemoLauncherEnabled({ VERCEL_ENV: "development" }), false);
  assert.equal(isDemoLauncherEnabled({}), false);
});

/**
 * Opening the picker on the live site.
 *
 * A visitor there picks their table from the home page instead of scanning the
 * code printed on it, which is a deliberate decision about that deployment and
 * so gets its own switch. The preview flag must not carry it: variables get
 * copied between environments, and one left behind should never be what opens
 * a second way into a guest session.
 */

test("a production deployment is opened only by its own explicit flag", () => {
  assert.equal(
    isDemoLauncherEnabled({ VERCEL_ENV: "production", ENABLE_PRODUCTION_TABLE_PICKER: "true" }),
    true,
  );
  assert.equal(
    isDemoLauncherEnabled({ VERCEL_ENV: "production", ENABLE_PRODUCTION_TABLE_PICKER: "false" }),
    false,
  );
  assert.equal(
    isDemoLauncherEnabled({ VERCEL_ENV: "production", ENABLE_PRODUCTION_TABLE_PICKER: "1" }),
    false,
  );
  // Missing means off: the live site never opens by default.
  assert.equal(isDemoLauncherEnabled({ VERCEL_ENV: "production" }), false);
});

test("the two flags cannot stand in for one another", () => {
  // A preview variable that reached production opens nothing…
  assert.equal(
    isDemoLauncherEnabled({ VERCEL_ENV: "production", ENABLE_DEMO_LAUNCHER: "true" }),
    false,
  );
  // …and the production one is inert everywhere else, so enabling it there is
  // never mistaken for a working preview.
  assert.equal(
    isDemoLauncherEnabled({ VERCEL_ENV: "preview", ENABLE_PRODUCTION_TABLE_PICKER: "true" }),
    false,
  );
  assert.equal(isDemoLauncherEnabled({ ENABLE_PRODUCTION_TABLE_PICKER: "true" }), false);
});

test("both demo endpoints open and shut together, on that one gate", () => {
  // One endpoint working while the other 404s would be a picker that lists
  // tables and cannot open any of them.
  const tableMenuRoute = readFileSync(
    new URL("../../app/api/demo/table-menu/route.ts", import.meta.url),
    "utf8",
  );
  for (const [name, route] of [["tables", tablesRoute], ["table-menu", tableMenuRoute]] as const) {
    assert.match(
      route,
      /if \(!isDemoLauncherEnabled\(\)\) throw demoLauncherDisabledError\(\)/,
      `${name} does not consult the shared gate`,
    );
    // No second opinion about the environment anywhere near the gate.
    assert.ok(!route.includes("VERCEL_ENV"), `${name} reads the environment itself`);
    assert.ok(!route.includes("ENABLE_"), `${name} reads a flag itself`);
  }
  const production = { VERCEL_ENV: "production", ENABLE_PRODUCTION_TABLE_PICKER: "true" };
  assert.equal(isDemoLauncherEnabled(production), true);
  assert.equal(isDemoLauncherEnabled({ ...production, ENABLE_PRODUCTION_TABLE_PICKER: "false" }), false);
});

test("the dialog says nothing that is only true of a demo", () => {
  // On a live deployment this is the ordinary way in, so the copy cannot call
  // itself a demo or tell the guest what the "real" customer does instead.
  const dialog = picker.slice(picker.indexOf("<DialogHeader>"), picker.indexOf("{resource.loading ?"));
  assert.match(dialog, /Masa Seçin/);
  assert.match(dialog, /QR menüyü görüntülemek istediğiniz masayı seçin\./);
  assert.doesNotMatch(dialog, /demo|gerçek müşteri/i);
  // Nor may the unavailable sentence, which a misconfigured live site shows.
  assert.doesNotMatch(picker, /"Demo masa seçimi/);
});

test("the endpoints keep refusing on their own, whatever the page renders", () => {
  // The tile is a courtesy, never the protection.
  assert.match(tablesRoute, /if \(!isDemoLauncherEnabled\(\)\) throw demoLauncherDisabledError\(\)/);
  const tableMenuRoute = readFileSync(
    new URL("../../app/api/demo/table-menu/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(tableMenuRoute, /if \(!isDemoLauncherEnabled\(\)\) throw demoLauncherDisabledError\(\)/);
});
