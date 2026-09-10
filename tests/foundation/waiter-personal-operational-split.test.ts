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
  assert.match(serviceHome, /data-service-home="radical"/);
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
      new RegExp(`view === "${tab}"`),
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

test("the board is a full-width home grid and its cards share one contract", () => {
  // The board no longer lives in a ~380px cockpit column, so the grid is the
  // home screen's own full width: two up on a phone, widening with the page.
  assert.match(cockpit, /board=\{renderBoard\(parts\)\}/);
  assert.match(
    cockpit,
    /grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5/,
    "the table board lost its responsive home grid",
  );
  // The skeleton claims the same shape as the real grid, so the board does not
  // reflow under the waiter's thumb when the first read lands.
  assert.equal(
    (cockpit.match(/grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5/g) ?? []).length,
    2,
    "the loading skeleton and the table grid disagree on their columns",
  );
  const card = read("components/staff/cockpit/service-table-card.tsx");
  // Stretches to the grid row, so a wrapped status cannot make one tile taller.
  assert.match(card, /flex h-full min-h-32 w-full flex-col/);
  // Fixed reading order: number, price, seats, status, elapsed.
  assert.match(card, /min-w-0 truncate text-\[18px\] font-extrabold/);
  assert.match(card, /shrink-0 text-xs font-bold tabular-nums text-burgundy/);
  assert.match(card, /\{table\.seats\} kişilik/);
  assert.match(card, /mt-auto flex flex-wrap items-center justify-between/);
  assert.match(card, /ms-auto shrink-0 text-\[11px\] font-semibold tabular-nums/);
});

test("a table's state reaches the eye three ways, and never by colour alone", () => {
  const card = read("components/staff/cockpit/service-table-card.tsx");
  // The home-screen card carries its tone on the tile itself, so the three
  // carriers are declared together: a surface, a solid icon and a badged word.
  assert.match(card, /const TONE_SURFACE/);
  assert.match(card, /const TONE_ICON_SURFACE/);
  assert.match(card, /const TONE_BADGE/);
  assert.match(card, /const TONE_ICON/);
  // A tinted tile is still a tint: every surface stays translucent over the
  // cream backdrop rather than becoming a solid sheet of status colour.
  const surfaces = card.slice(card.indexOf("const TONE_SURFACE"));
  for (const [, value] of surfaces.slice(0, surfaces.indexOf("};")).matchAll(/bg-\[#[0-9A-Fa-f]{6}\]\/(\d+)/g)) {
    assert.ok(Number(value) <= 82, `a table tone reached ${value}% and floods the tile`);
  }
  // Icon and word travel with every tone.
  assert.match(card, /<span className="truncate">\{label\}<\/span>/);
  assert.equal(
    Object.keys({ neutral: 0, active: 0, ready: 0, waiting: 0, bill: 0, muted: 0 }).every((tone) =>
      new RegExp(`${tone}:`).test(surfaces),
    ),
    true,
    "a tone lost its surface",
  );
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
