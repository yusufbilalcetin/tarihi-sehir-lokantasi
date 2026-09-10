import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { isSimpleTestLoginEnabled } from "../../lib/auth/simple-test-login";
import { isDemoLauncherEnabled } from "../../lib/config/demo-launcher";
import { TABLE_STATUS_LABELS } from "../../lib/domain/display";
import { TABLE_STATUSES } from "../../lib/domain/status";
import { deriveQrLinkToken } from "../../lib/security/qr-link-token";
import { tableTokenSchema } from "../../lib/validation/common";

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
  assert.match(picker, /retryable: false/);
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

test("a switched-off picker and a misconfigured one do not read the same", () => {
  // The live symptom this separates: a deployment with the picker deliberately
  // ON answered 409 "there is more than one restaurant, name one", and the
  // dialog reported it as a setup switch — which sent the debugging at the
  // feature flag instead of the missing slug.
  assert.match(picker, /error\.status === 404/, "the off case is no longer told apart");
  assert.match(picker, /Masa seçimi bu sitede açık değil\./);
  assert.match(picker, /Masa listesi şu anda hazırlanamıyor\./);
  // Rate limiting is the one 4xx that clears on its own.
  assert.match(picker, /error\.status === 429/);
  assert.match(picker, /Çok fazla istek gönderildi\. Birazdan tekrar deneyin\.", retryable: true/);
  // Still no server wording on a guest's screen.
  assert.doesNotMatch(picker, /DEMO_RESTAURANT_SLUG/);
});

test("the public table listing is metered like the route beside it", () => {
  // It became a production endpoint when the picker was opened there; the POST
  // it feeds has always been rate limited and the GET was not.
  assert.match(tablesRoute, /await enforceRateLimit\(request, "QR_VALIDATE"\)/);
  assert.match(tablesRoute, /export async function GET\(request: Request\)/);
  // The gate still comes first: an off deployment does not admit the route
  // exists, and does not spend a rate-limit slot saying so.
  assert.ok(
    tablesRoute.indexOf("isDemoLauncherEnabled()") < tablesRoute.indexOf("enforceRateLimit(request"),
    "the feature gate must be checked before the limiter",
  );
});

/**
 * The two halves of the picker's own address.
 *
 * The dialog listed every table correctly and each one opened "QR bağlantısı
 * doğrulanamadı", because the build serving the menu accepted only the legacy
 * 43-character token while the launcher was handing out a derived `l1` link.
 * Neither half is wrong on its own, which is why neither half's own test
 * caught it — so the string one produces is checked against the schema the
 * other validates with.
 */
test("the address the picker hands out is one the customer gate accepts", () => {
  const token = deriveQrLinkToken(
    { restaurantSlug: "tarihi-sehir-lokantasi", tableNumber: 12, accessVersion: 25 },
    "p".repeat(48),
  );
  assert.equal(tableTokenSchema.safeParse(token).success, true);
  assert.match(service, /path: `\/menu\/\$\{token}`/);
});

/**
 * Opening a table is a read.
 *
 * An earlier launcher minted a credential whenever this process had not
 * already minted one, which rotated the table's QR on every cold start and
 * quietly voided the card printed on it. Deriving costs nothing and changes
 * nothing, and only the access state — not the operational status a guest is
 * shown — decides whether a table can be opened at all.
 */
test("choosing a table derives its existing QR and rotates nothing", () => {
  assert.match(service, /deriveTableQrLink\(\{/);
  assert.match(service, /accessVersion: table\.qrTokenVersion/);
  for (const mutation of [/rotateToken\(/, /generateTableQrToken/, /\.update\(/, /\.insert\(/]) {
    assert.doesNotMatch(service, mutation, "the launcher must not write");
  }
  // Only `isActive` and the revocation flag gate a table; `currentStatus` is
  // read for display and never filtered on.
  assert.match(service, /isNull\(restaurantTables\.qrTokenRevokedAt\)/);
  assert.doesNotMatch(service, /eq\(restaurantTables\.currentStatus/);
});

/**
 * The admin sidebar's "QR Menüyü Gör".
 *
 * It linked at `/menu/demo-table` in both the tablet rail and the full
 * sidebar, and in the PWA manifest. That string is not a QR token — the token
 * test below asserts the verifier rejects it — so the proxy's menu gate sent
 * every press to `/menu/invalid`: a dead control, and a dead-end screen with
 * no way forward. The panel now opens the same picker the home page uses, and
 * only where the launcher is switched on; where it is off there is no valid
 * link to offer and the entry is absent rather than broken.
 */

const adminShell = readFileSync(new URL("../../components/admin/admin-shell.tsx", import.meta.url), "utf8");
const profileDialog = readFileSync(new URL("../../components/admin/admin-profile-dialog.tsx", import.meta.url), "utf8");
const adminLayout = readFileSync(new URL("../../app/admin/layout.tsx", import.meta.url), "utf8");
const manifest = readFileSync(new URL("../../app/manifest.ts", import.meta.url), "utf8");

test("no admin surface links at the placeholder QR token any more", () => {
  for (const [name, source] of [
    ["admin shell", adminShell],
    ["admin layout", adminLayout],
    ["manifest", manifest],
  ] as const) {
    assert.equal(
      /href[=:]\s*["'{]?\s*\/menu\/demo-table/.test(source),
      false,
      `${name} still links at /menu/demo-table`,
    );
    assert.equal(
      /url:\s*"\/menu\/demo-table"/.test(source),
      false,
      `${name} still lists /menu/demo-table`,
    );
  }
});

test("the account dialog's QR entry opens the picker, and only when the launcher is on", () => {
  // The flag is read on the server and handed down; the shell never guesses.
  assert.match(adminLayout, /isDemoLauncherEnabled/);
  assert.match(adminLayout, /<AdminShell demoLauncherEnabled=\{isDemoLauncherEnabled\(\)\}>/);
  assert.match(adminShell, /demoLauncherEnabled: boolean/);

  // Switched off, there is no control at all rather than one that cannot work.
  assert.match(adminShell, /const onOpenQrMenu = demoLauncherEnabled \? \(\) => setQrMenuOpen\(true\) : null;/);
  assert.match(adminShell, /\{demoLauncherEnabled \? \(\s*<DemoTablePicker open=\{qrMenuOpen\} onOpenChange=\{setQrMenuOpen\} \/>/);

  // The sidebar and rail are gone; the one entry left is in the account
  // dialog, reached from the bar and the dock alike, and it takes the same
  // nullable handler so switched off means absent there too.
  assert.match(adminShell, /<AdminProfileDialog \{\.\.\.dialogProps\("account"\)\} onOpenQrMenu=\{onOpenQrMenu\} \/>/);
  assert.equal(profileDialog.match(/onOpenQrMenu \?/g)?.length, 1);
  assert.match(profileDialog, /onOpenQrMenu: \(\(\) => void\) \| null;/);
  // The account dialog closes itself first, then hands over to the picker.
  assert.match(profileDialog, /onOpenChange\(false\);\s*onOpenQrMenu\(\);/, "the dialog does not close right before opening the picker");
  assert.match(profileDialog, /onOpenQrMenu\(\);[\s\S]{0,800}QR Menüyü Gör/);
  assert.doesNotMatch(profileDialog, /href[=:]\s*["'{]?\s*\/menu\//, "the entry became a link again");
});

test("the placeholder token is still rejected by the verifier itself", () => {
  // The reason the link could never work, asserted where it is decided rather
  // than only in the markup that used to carry it: the shape check rejects the
  // placeholder before any verifier is reached, so the gate can only redirect.
  assert.equal(tableTokenSchema.safeParse("demo-table").success, false);
  const realToken = deriveQrLinkToken(
    { restaurantSlug: "tarihi-sehir-lokantasi", tableNumber: 2, accessVersion: 1 },
    "pepper-for-this-test-at-least-32-bytes-long",
  );
  assert.notEqual(realToken, "demo-table");
});

/**
 * The launcher gate and the test-login gate must agree on what "production" is.
 *
 * They did not. `isSimpleTestLoginEnabled` knew that a self-hosted Node process
 * carries no `VERCEL_ENV` and fell back to `NODE_ENV`; `isDemoLauncherEnabled`
 * tested `VERCEL_ENV === "production"` alone. So on a self-hosted production
 * server a stale `ENABLE_DEMO_LAUNCHER=true` still opened the public table
 * picker — and that picker mints a real, validated guest table session for any
 * table id, which is a way past the QR scan the gate exists to require.
 *
 * The flag being copied from a preview, or left behind by an old configuration,
 * is the exact case both switches are written to survive. Both now derive
 * "production" from `isProductionRuntime`, and this pins the case no test
 * covered: the two gates are asserted together, so they cannot drift apart
 * again without failing here.
 */
test("both public-surface gates close on a self-hosted production server", () => {
  const staleFlags = {
    ENABLE_DEMO_LAUNCHER: "true",
    ENABLE_SIMPLE_TEST_LOGIN: "true",
  } as const;

  // The case that was open: no VERCEL_ENV to read, NODE_ENV says production.
  const selfHosted = { ...staleFlags, NODE_ENV: "production" };
  assert.equal(isDemoLauncherEnabled(selfHosted), false);
  assert.equal(isSimpleTestLoginEnabled(selfHosted), false);

  // Vercel production was already closed; it stays closed.
  const vercel = { ...staleFlags, VERCEL_ENV: "production" };
  assert.equal(isDemoLauncherEnabled(vercel), false);
  assert.equal(isSimpleTestLoginEnabled(vercel), false);

  // Opening it on a live server stays a separate, explicitly named decision.
  assert.equal(
    isDemoLauncherEnabled({ NODE_ENV: "production", ENABLE_PRODUCTION_TABLE_PICKER: "true" }),
    true,
  );
  // ...and that decision does not also hand out staff logins.
  assert.equal(
    isSimpleTestLoginEnabled({ NODE_ENV: "production", ENABLE_PRODUCTION_TABLE_PICKER: "true" }),
    false,
  );

  // A preview is still a preview: NODE_ENV is "production" there too, and
  // VERCEL_ENV must keep winning or demonstrations break.
  const preview = { ...staleFlags, VERCEL_ENV: "preview", NODE_ENV: "production" };
  assert.equal(isDemoLauncherEnabled(preview), true);
  assert.equal(isSimpleTestLoginEnabled(preview), true);
});
