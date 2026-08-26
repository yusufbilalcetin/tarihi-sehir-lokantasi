import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * The reported bug: opening the kitchen as a cashier painted the Kitchen
 * screen, then silently became the till — "Hesaplar yükleniyor…" and all.
 *
 * The cause was the wrong-role guard calling `redirect()`. Next resolves a
 * server redirect on the client, so the denied page was streamed, parsed and
 * painted before the navigation ran. These cases pin the shape of the fix:
 * a refusal is *rendered*, never navigated to, and no panel's copy can appear
 * in another panel's tree.
 */

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

/** The two strings the operator actually saw on the kitchen route. */
const CASHIER_ONLY_TEXT = ["Hesaplar yükleniyor", "Servis edilen bir sipariş oluştuğunda"];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

test("the cashier's own copy lives only in the cashier feature", () => {
  const offenders: string[] = [];
  for (const file of walk(path.join(process.cwd(), "components"))) {
    if (file.includes(`${path.sep}cashier${path.sep}`)) continue;
    const source = readFileSync(file, "utf8");
    for (const text of CASHIER_ONLY_TEXT) {
      if (source.includes(text)) offenders.push(`${path.relative(process.cwd(), file)}: ${text}`);
    }
  }
  assert.deepEqual(offenders, [], "cashier copy leaked outside the cashier feature");
});

test("no panel imports another panel's dashboard", () => {
  const panels: [string, RegExp][] = [
    ["components/kitchen", /cashier-dashboard|staff-dashboard-view|admin-shell/],
    ["components/cashier", /kitchen-board|staff-dashboard-view|admin-shell/],
    ["components/staff", /cashier-dashboard|kitchen-board/],
  ];
  for (const [dir, forbidden] of panels) {
    for (const file of walk(path.join(process.cwd(), dir))) {
      const source = readFileSync(file, "utf8");
      const imports = [...source.matchAll(/^import[^;]*from\s+"([^"]+)";/gm)].map((m) => m[1]);
      for (const specifier of imports) {
        assert.doesNotMatch(
          specifier,
          forbidden,
          `${path.relative(process.cwd(), file)} imports ${specifier}`,
        );
      }
    }
  }
});

test("a wrong-role visitor is refused in place, never redirected", () => {
  const guard = read("lib/auth/current-staff.ts");
  const body = guard.slice(guard.indexOf("export async function resolvePanelAccess"));

  // No session is still a redirect to login; that one is correct.
  assert.match(body, /if \(!context\) redirect\("\/staff\/login"\)/);
  // The wrong-role branch must return, not navigate.
  assert.match(body, /return \{ allowed: false/);
  assert.doesNotMatch(
    body.slice(body.indexOf("canAccessPanel")),
    /redirect\(/,
    "the wrong-role branch must not redirect",
  );
});

test("every panel entry point renders the refusal instead of its panel", () => {
  for (const file of [
    "app/kitchen/page.tsx",
    "app/cashier/page.tsx",
    "app/staff/layout.tsx",
    "app/admin/layout.tsx",
  ]) {
    const source = read(file);
    assert.match(source, /resolvePanelAccess\("(kitchen|cashier|staff|admin)"\)/, `${file}`);
    // The refusal has to return before the panel is built, so the protected
    // markup is never streamed.
    const guardIndex = source.indexOf("if (!access.allowed)");
    assert.ok(guardIndex > 0, `${file} must handle a refusal`);
    assert.ok(
      guardIndex < source.indexOf("<StaffSessionProvider"),
      `${file} must refuse before rendering the panel`,
    );
    assert.match(source, /<PanelAccessDenied/, `${file} must render the refusal`);
  }
});

test("the refusal screen is not a panel and offers a way out", () => {
  const source = read("components/staff/panel-access-denied.tsx");
  assert.match(source, /Bu panele erişim yetkiniz yok/);
  // It must not pull in any panel dashboard as a fallback.
  assert.doesNotMatch(source, /cashier-dashboard|kitchen-board|staff-dashboard-view/);
  assert.match(source, /href=\{home\}/);
});

test("the till's loading state does not assert an empty till", () => {
  // "Hesaplar yükleniyor…" paired with "Servis edilen bir sipariş oluştuğunda
  // burada görünecek." told the operator the till was empty before the first
  // read had returned. Loading and empty are different facts.
  const source = read("components/cashier/cashier-dashboard.tsx");
  const block = source.slice(source.indexOf("Hesaplar yükleniyor"));
  const loadingBranch = block.indexOf("resource.loading");
  const emptyClaim = block.indexOf("Servis edilen bir sipariş oluştuğunda");
  assert.ok(loadingBranch > 0, "the description must branch on the loading state");
  assert.ok(
    loadingBranch < emptyClaim,
    "the empty-state sentence must sit behind the loading check",
  );
});

test("the refusal screen cannot navigate on its own", () => {
  // The whole point of refusing in place is that nothing moves until the
  // operator decides to move. A timer, an effect or a router call here would
  // recreate the original complaint: the refusal appears, then the till opens.
  const source = read("components/staff/panel-access-denied.tsx");
  for (const forbidden of [
    /"use client"/,
    /useRouter/,
    /router\.(push|replace)/,
    /useEffect/,
    /useLayoutEffect/,
    /setTimeout/,
    /setInterval/,
    /window\.location/,
    /history\.(push|replace)State/,
  ]) {
    assert.doesNotMatch(source, forbidden, `refusal screen must not contain ${forbidden}`);
  }
  // The only way out is a link the operator clicks.
  assert.match(source, /<Link href=\{home\}/);
});

test("nothing outside login navigates to a role's home", () => {
  // `staffHomeForRole` is data for the refusal screen and the login response;
  // it must never become an automatic client-side navigation.
  for (const file of ["components/staff/panel-access-denied.tsx", "lib/auth/current-staff.ts"]) {
    const source = read(file);
    assert.doesNotMatch(source, /router\.(push|replace)/, `${file} must not navigate`);
  }
});
