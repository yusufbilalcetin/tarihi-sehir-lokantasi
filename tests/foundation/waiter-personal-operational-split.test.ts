import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import test from "node:test";

/**
 * The waiter's home screen used to end with "Mesaiye Başla".
 *
 * `StaffTablesView` rendered the floor plan and then `<StaffAttendanceCard />`
 * directly beneath it, so scrolling past the last table during service landed a
 * waiter on their own timesheet. These tests hold the two apart: operational
 * content on Masalar, personal content behind Profil, and one component never
 * mounted from both.
 */

const ROOT = new URL("../../", import.meta.url);

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, ROOT), "utf8");
}

function sourcesUnder(relativeDir: string): readonly { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(new URL(dir, ROOT))) {
      const child = `${dir}/${entry}`;
      if (statSync(new URL(child, ROOT)).isDirectory()) walk(child);
      else if (entry.endsWith(".tsx") || entry.endsWith(".ts")) {
        out.push({ path: child, text: read(child) });
      }
    }
  };
  walk(relativeDir);
  return out;
}

const cockpit = read("components/staff/cockpit/service-cockpit.tsx");
const serviceHome = read("components/staff/cockpit/service-home.tsx");
const profileView = read("components/staff/cockpit/staff-profile-view.tsx");
const attendanceCard = read("components/staff/staff-attendance-card.tsx");

/* ------------------------------------------- personal content is personal -- */

test("the service home renders no attendance and no shift list", () => {
  for (const forbidden of ["StaffAttendanceCard", "Mesai", "vardiya", "Vardiya", "LogoutButton"]) {
    assert.ok(
      !serviceHome.includes(forbidden),
      `the tables screen brought back ${forbidden}`,
    );
  }
  // It renders the board it is handed and nothing after it.
  assert.match(serviceHome, /\{board\}/);
  assert.match(serviceHome, /data-service-home="operational"/);
});

test("attendance and shifts are mounted from exactly one place, the profile view", () => {
  const holders = sourcesUnder("components")
    .filter(({ path }) => !path.endsWith("staff-attendance-card.tsx"))
    .filter(({ text }) => text.includes("StaffAttendanceCard"))
    .map(({ path }) => path);

  assert.deepEqual(
    holders,
    ["components/staff/cockpit/staff-profile-view.tsx"],
    "attendance is rendered somewhere other than the profile tab",
  );
});

test("the one attendance component still carries both personal cards", () => {
  // Proof the move did not drop half the feature: this single component is
  // where both "Mesai" and "Yaklaşan vardiyalarım" live.
  assert.match(attendanceCard, /Mesai/);
  assert.match(attendanceCard, /Yaklaşan vardiyalarım/);
  assert.match(attendanceCard, /Mesaiye Başla|Mesaiyi Bitir/);
  assert.match(attendanceCard, /\/api\/staff\/attendance/);
  assert.match(attendanceCard, /\/api\/staff\/schedule/);
  assert.match(profileView, /<StaffAttendanceCard \/>/);
});

test("the profile tab gathers the account surfaces too", () => {
  assert.match(profileView, /STAFF_ROLE_LABELS\[role\]/);
  assert.match(profileView, /href="\/staff\/set-password"/);
  assert.match(profileView, /<LogoutButton/);
  // And it never re-renders the floor.
  for (const forbidden of ["ServiceHome", "ServiceTableCard", "renderBoard", "TableGrid"]) {
    assert.ok(!profileView.includes(forbidden), `the profile tab duplicated ${forbidden}`);
  }
});

/* ----------------------------------------------- the bar really navigates -- */

test("each bottom-bar tab switches the view instead of decorating it", () => {
  const tabs = ["tables", "orders", "ready", "profile"] as const;
  for (const tab of tabs) {
    assert.match(
      cockpit,
      new RegExp(`mobileTab === "${tab}"`),
      `${tab} has no branch of its own`,
    );
  }
  assert.equal(
    (cockpit.match(/\{ id: "(?:tables|orders|ready|profile)"/g) ?? []).length,
    4,
    "the bar is not exactly the four destinations",
  );
  // Exactly one view per tab, so nothing is appended under the active one.
  assert.equal((cockpit.match(/<ServiceHome/g) ?? []).length, 1);
  assert.equal((cockpit.match(/<StaffProfileView/g) ?? []).length, 1);
  assert.equal((cockpit.match(/<OrdersList \/>/g) ?? []).length, 1);
});

test("the bar stays above the fold and the content clears it", () => {
  assert.match(cockpit, /fixed inset-x-0 bottom-0 z-30/);
  assert.match(cockpit, /pb-\[max\(0\.5rem,env\(safe-area-inset-bottom\)\)\]/);
  // Content reserves the bar's height plus the home indicator, once.
  assert.match(cockpit, /pb-\[calc\(4\.5rem\+env\(safe-area-inset-bottom\)\)\]/);
  assert.doesNotMatch(cockpit, /className="pb-20"/, "the reserve went back to a guess");
});

/* ------------------------------------------------------- board and cards -- */

test("the phone board is two columns and its cards share one contract", () => {
  assert.match(cockpit, /board=\{renderBoard\(parts, "grid-cols-2 sm:grid-cols-3"\)\}/);
  // The cockpit column is ~380px, so it stays at two until xl.
  assert.match(cockpit, /renderBoard\(parts, "grid-cols-2 xl:grid-cols-3"\)/);
  assert.doesNotMatch(cockpit, /lg:grid-cols-4/, "four table cards do not fit the cockpit column");
  const card = read("components/staff/cockpit/service-table-card.tsx");
  // Stretches to the grid row, so a wrapped status cannot make one tile taller.
  assert.match(card, /flex h-full min-h-\[5\.25rem\] w-full flex-col/);
  // Fixed reading order: number, price, seats, status, elapsed.
  assert.match(card, /min-w-0 truncate text-\[17px\] font-extrabold/);
  assert.match(card, /shrink-0 text-xs font-bold tabular-nums text-burgundy/);
  assert.match(card, /\{table\.seats\} kişilik/);
  assert.match(card, /mt-auto flex flex-wrap items-center justify-between/);
  assert.match(card, /ms-auto shrink-0 text-\[11px\] font-semibold tabular-nums/);
});

test("a table that wants the bill gets a rail and a badge, not a whole orange tile", () => {
  const card = read("components/staff/cockpit/service-table-card.tsx");
  assert.match(card, /const TONE_RAIL/);
  assert.match(card, /const TONE_BADGE/);
  assert.match(card, /bg-surface-raised/, "the card lost its neutral surface");
  assert.doesNotMatch(
    card,
    /bg-status-warning-tint\/\d+"|bg-order-new-tint\/\d+"/,
    "a status floods the whole tile again",
  );
  // Icon and word travel with every tone.
  assert.match(card, /const TONE_ICON/);
  assert.match(card, /<span className="truncate">\{label\}<\/span>/);
});

test("touch targets on the waiter's personal tab clear 44px too", () => {
  assert.match(profileView, /min-h-12 w-full items-center/);
  assert.match(profileView, /min-h-12 w-full justify-center/);
  assert.doesNotMatch(profileView, /min-h-(?:8|9|10)\b/);
  assert.match(serviceHome, /min-h-11 shrink-0 rounded-full/);
});

/* ------------------------------------------------------------ untouched -- */

test("role routing and the panel guard are exactly as they were", () => {
  const layout = read("app/staff/layout.tsx");
  assert.match(layout, /resolvePanelAccess\("staff"\)/);
  assert.match(layout, /<PanelAccessDenied/);
  assert.match(layout, /<StaffSessionProvider/);
  // Both waiter entry points still land on the same screen — no redirect added.
  for (const page of ["app/staff/tables/page.tsx", "app/staff/dashboard/page.tsx"]) {
    assert.match(read(page), /<TablesModule \/>/, `${page} stopped rendering the cockpit`);
    assert.doesNotMatch(read(page), /redirect\(/, `${page} grew a redirect`);
  }
});

test("the split moved markup only; no personal or floor API call changed", () => {
  // The profile view calls nothing itself — it composes the components that do.
  assert.doesNotMatch(profileView, /fetch\(|apiRequest|staffApi\./);
  assert.doesNotMatch(serviceHome, /fetch\(|apiRequest|staffApi\./);
});

test("a tablet without a bottom bar can still reach the timesheet", () => {
  // The bar is md:hidden, so removing the personal cards from the tables screen
  // would otherwise leave a waiter on a stand with no way to clock in.
  const shell = read("components/staff/staff-shell.tsx");
  assert.match(shell, /href: "\/staff\/profile", label: "Profil"/);
  const page = read("app/staff/profile/page.tsx");
  assert.match(page, /<StaffProfileView/);
  // One view, two entry points — the tab and the route render the same thing.
  assert.match(cockpit, /<StaffProfileView \/>/);
});
