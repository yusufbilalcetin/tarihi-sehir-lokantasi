import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * The reported bug: every waiter saw "Ahmet Yılmaz / Garson" in the panel
 * header, whoever they actually were and whichever restaurant they belonged
 * to. It was a prototype placeholder that survived into the shell, and the
 * header is the only "who am I signed in as" indicator these screens have —
 * so shift attribution read as someone else's on every staff route.
 *
 * The guard is deliberately wider than the one component: any seed person's
 * name printed by a component is the same mistake, wherever it turns up.
 */

const SEED_PEOPLE = [
  "Ahmet Yılmaz",
  "Mehmet Kaya",
  "Ayşe Demir",
  "Kemal Arslan",
  "Sedat Çetinkaya",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

test("no runtime code hardcodes a seed staff member's identity", () => {
  const offenders: string[] = [];
  // components/ renders it, but lib/ and app/ can hand it to them just as well
  // — the legacy compatibility identity used to name a real seed person.
  const roots = ["components", "lib", "app"].map((dir) => path.join(process.cwd(), dir));
  for (const file of roots.flatMap((root) => walk(root))) {
    const source = readFileSync(file, "utf8");
    for (const person of SEED_PEOPLE) {
      if (source.includes(person)) {
        offenders.push(`${path.relative(process.cwd(), file)}: ${person}`);
      }
    }
  }
  assert.deepEqual(offenders, [], "a seed person's name is rendered as the signed-in user");
});

test("the staff shell header reads the signed-in session", () => {
  const source = readFileSync(
    path.join(process.cwd(), "components/staff/staff-shell.tsx"),
    "utf8",
  );
  assert.match(source, /useStaffSession\(\)/, "header must read the session");
  assert.match(source, /\{name\}/, "header must print the session's name");
  assert.match(source, /STAFF_ROLE_LABELS/, "header must label the session's real role");
  // The old chip announced a shift window nothing in the session knows about.
  assert.doesNotMatch(source, /10:00 - 18:00/, "invented shift window is back");
});

/**
 * The kitchen ran without any "who am I" indicator at all, which is the same
 * gap the staff shell had — a cook could not tell whose shift the board was
 * being worked under, and had no way out of the panel from the screen they
 * spend the service on.
 *
 * Structure is asserted, never class strings: this must keep passing when the
 * header is restyled.
 */
test("the kitchen header reads the signed-in session rather than assuming one", () => {
  const source = readFileSync(
    path.join(process.cwd(), "components/kitchen/kitchen-board.tsx"),
    "utf8",
  );
  assert.match(source, /useStaffSession\(\)/, "the board must read the real session");
  assert.match(source, /\{\s*role,\s*name\s*\}/, "the board must take its identity from the session");
  assert.match(source, /\{name\}/, "the header must print the session's own name");
  assert.match(source, /getInitials\(name\)/, "initials must come from the shared helper");
  // The same route is opened by managers and admins; the label follows the
  // session's role instead of announcing the kitchen to whoever shows up.
  assert.match(source, /STAFF_ROLE_LABELS\[role\]/, "the role label must follow the real role");
  assert.doesNotMatch(source, /"Mutfak Şefi"/, "a role was invented for the header");
});

test("the kitchen logs out through the shared control, not its own fetch", () => {
  const source = readFileSync(
    path.join(process.cwd(), "components/kitchen/kitchen-board.tsx"),
    "utf8",
  );
  assert.match(source, /import \{ LogoutButton \}/, "logout must reuse the shared component");
  assert.match(source, /<LogoutButton\b/);
  // Re-implementing the call here would drop the busy state and the
  // repeat-click guard that the shared button already carries.
  assert.doesNotMatch(source, /api\/staff\/logout/, "the board re-implemented the logout call");
});

test("the shared logout control keeps its repeat-click guard", () => {
  const source = readFileSync(
    path.join(process.cwd(), "components/staff/logout-button.tsx"),
    "utf8",
  );
  assert.match(source, /if \(isLoggingOut\) return;/, "repeated clicks can fire logout twice");
  assert.match(source, /aria-busy=\{isLoggingOut\}/);
  assert.match(source, /"\/api\/staff\/logout"/);
  assert.match(source, /replace\("\/staff\/login"\)/);
});

test("the kitchen stays a full page and never becomes a window", () => {
  const source = readFileSync(
    path.join(process.cwd(), "components/kitchen/kitchen-board.tsx"),
    "utf8",
  );
  assert.match(source, /<main\b/, "the board must remain a page-level surface");
  for (const windowDependency of ["CenteredAppWindow", "ModuleWindow", "closeHref"]) {
    assert.ok(!source.includes(windowDependency), `the board pulled in ${windowDependency}`);
  }
});
