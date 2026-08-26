import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  PANEL_ROLE_ACCESS,
  canAccessPanel,
  isProtectedStaffPath,
  staffHomeForRole,
} from "../../lib/auth/role-access";
import { USER_ROLES, type UserRole } from "../../lib/domain/status";

/**
 * One role owns one panel, and the launcher tile that names a panel has to go
 * to it. Both halves are pinned here: a wrong home mapping and a wrong tile
 * href produce the same symptom — clicking "Garson" and landing on "Kasa" —
 * so neither can be trusted to the other's test.
 */

/** Every `.ts`/`.tsx` file under `directory`, recursively. */
function walkSource(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) walkSource(full, found);
    else if (/\.tsx?$/.test(entry)) found.push(full);
  }
  return found;
}

const PANEL_BY_HOME: Record<string, string> = {
  "/admin/dashboard": "admin",
  "/staff/dashboard": "staff",
  "/kitchen": "kitchen",
  "/cashier": "cashier",
};

test("every role has a home, and it is the panel that role can open", () => {
  for (const role of USER_ROLES) {
    const home = staffHomeForRole(role);
    assert.ok(home.startsWith("/"), `${role} home must be a path`);
    const panel = PANEL_BY_HOME[home];
    assert.ok(panel, `${role} home ${home} is not a known panel`);
    assert.equal(
      canAccessPanel(role, panel as keyof typeof PANEL_ROLE_ACCESS),
      true,
      `${role} is sent to ${home} but cannot open it`,
    );
  }
});

test("each operational role lands on its own panel", () => {
  assert.equal(staffHomeForRole("WAITER"), "/staff/dashboard");
  assert.equal(staffHomeForRole("KITCHEN"), "/kitchen");
  assert.equal(staffHomeForRole("CASHIER"), "/cashier");
  assert.equal(staffHomeForRole("ADMIN"), "/admin/dashboard");
  assert.equal(staffHomeForRole("MANAGER"), "/admin/dashboard");
});

test("the cashier panel is nobody's fallback", () => {
  // The reported symptom was every click ending on the till. No role other
  // than the cashier may be sent there, and there is no default branch that
  // could send an unrecognised role anywhere at all.
  const sentToTill = USER_ROLES.filter((role) => staffHomeForRole(role) === "/cashier");
  assert.deepEqual(sentToTill, ["CASHIER"]);
});

test("an operational role cannot open another role's panel", () => {
  const denied: [UserRole, keyof typeof PANEL_ROLE_ACCESS][] = [
    ["WAITER", "cashier"],
    ["WAITER", "kitchen"],
    ["WAITER", "admin"],
    ["KITCHEN", "cashier"],
    ["KITCHEN", "staff"],
    ["KITCHEN", "admin"],
    ["CASHIER", "kitchen"],
    ["CASHIER", "staff"],
    ["CASHIER", "admin"],
  ];
  for (const [role, panel] of denied) {
    assert.equal(canAccessPanel(role, panel), false, `${role} must not reach ${panel}`);
  }
});

test("supervisors reach every panel, and only supervisors reach admin", () => {
  for (const panel of Object.keys(PANEL_ROLE_ACCESS) as (keyof typeof PANEL_ROLE_ACCESS)[]) {
    assert.equal(canAccessPanel("ADMIN", panel), true);
    assert.equal(canAccessPanel("MANAGER", panel), true);
  }
  for (const role of ["WAITER", "KITCHEN", "CASHIER"] as const) {
    assert.equal(canAccessPanel(role, "admin"), false);
  }
});

test("a denied panel redirects once, never into a loop", () => {
  // The guard sends a denied visitor to their own home; that home must itself
  // be allowed, or the next request would bounce again.
  for (const role of USER_ROLES) {
    const home = staffHomeForRole(role);
    assert.equal(isProtectedStaffPath(home), true, `${home} should be guarded`);
    assert.equal(
      canAccessPanel(role, PANEL_BY_HOME[home] as keyof typeof PANEL_ROLE_ACCESS),
      true,
      `${role} would bounce off its own home`,
    );
  }
});

test("each launcher tile points at the panel it names", () => {
  const source = readFileSync(
    path.join(process.cwd(), "components/shared/prototype-portals.tsx"),
    "utf8",
  );
  const tiles = [...source.matchAll(/href:\s*"([^"]+)"[^}]*?title:\s*"([^"]+)"/g)].map(
    ([, href, title]) => ({ href, title }),
  );
  assert.equal(tiles.length, 4, "expected four staff tiles");

  const expected: Record<string, string> = {
    "Garson Paneli": "/staff/dashboard",
    "Mutfak Ekranı": "/kitchen",
    "Kasa Paneli": "/cashier",
    "Yönetici Paneli": "/admin/dashboard",
  };
  for (const tile of tiles) {
    assert.equal(tile.href, expected[tile.title], `"${tile.title}" points at ${tile.href}`);
  }
  // No tile may quietly route through the login page again.
  assert.equal(tiles.some((tile) => tile.href === "/staff/login"), false);
});

test("no client component navigates to a panel route on its own", () => {
  // The original complaint was a panel that changed under the operator after
  // hydration. The guard is server-side, so any client-side `push`/`replace`/
  // `location` aimed at a panel is by definition a second, unsynchronised
  // authorization decision — the exact shape of the bug. `/staff/login` is
  // allowed: signing out has to go somewhere, and the login form follows the
  // server's own `redirectTo`.
  const panels = ["/kitchen", "/cashier", "/staff/dashboard", "/admin/dashboard"];
  const navigation = new RegExp(
    `(router\\.(push|replace)|location\\.(href|assign|replace))\\s*[(=]\\s*["'\`](${panels.join("|")})`,
  );
  const offenders: string[] = [];
  for (const directory of ["app", "components"]) {
    for (const file of walkSource(path.join(process.cwd(), directory))) {
      const source = readFileSync(file, "utf8");
      if (navigation.test(source)) {
        offenders.push(path.relative(process.cwd(), file));
      }
    }
  }
  assert.deepEqual(offenders, [], "a client component navigates to a panel by itself");
});

test("only the panel guard decides a panel, and it never lands on the till", () => {
  // A server `redirect()` to a panel would repeat the same mistake one layer
  // down: Next resolves it on the client, so the denied panel is painted
  // first. `redirect("/staff/login")` in the guard is the one legitimate case.
  const offenders: string[] = [];
  for (const directory of ["app", "components", "lib"]) {
    for (const file of walkSource(path.join(process.cwd(), directory))) {
      const source = readFileSync(file, "utf8");
      for (const [, target] of source.matchAll(/\bredirect\(\s*["'`]([^"'`]+)/g)) {
        if (["/kitchen", "/cashier", "/staff/dashboard"].includes(target)) {
          offenders.push(`${path.relative(process.cwd(), file)} → ${target}`);
        }
      }
    }
  }
  assert.deepEqual(offenders, [], "a server redirect drops someone into a panel");
});
