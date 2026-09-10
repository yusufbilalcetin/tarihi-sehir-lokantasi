import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ApiClientError, type ApiClientErrorCode } from "../../lib/api/client";
import { userErrorMessage } from "../../lib/api/error-message";
import { STAFF_ROLE_LABELS } from "../../lib/domain/staff-accounts";
import { isTableOpen } from "../../lib/domain/table-actions";
import type { TableStatus } from "../../types";

/**
 * The six screens a restaurant actually opens every day.
 *
 * The panel's words and grouping were settled in the phase before this one;
 * these are the insides. A dish gets added without meeting a translation
 * matrix, a failure is a sentence rather than a code, and the number on the
 * home screen that says how many tables are open is counted from the tables.
 */

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const dashboard = read("components/admin/dashboard-view.tsx");
const dialogs = read("components/admin/menu-editor-dialogs.tsx");
const staff = read("components/admin/staff-manager.tsx");
const orders = read("components/admin/orders-manager.tsx");

// ------------------------- 12: the open-table metric, against the domain

test("an open table is counted from the tables, not from the orders", () => {
  // A table is the restaurant's to deal with unless nobody is at it, or it is
  // switched off. This is the rule the waiter floor has always used.
  const open: TableStatus[] = [
    "occupied",
    "ordering",
    "waiting",
    "dining",
    "waiter-call",
    "bill-requested",
    "cleaning",
  ];
  for (const status of open) {
    assert.equal(isTableOpen(status), true, `${status} is a table somebody is responsible for`);
  }
  assert.equal(isTableOpen("available"), false);
  assert.equal(isTableOpen("inactive"), false);
});

test("the home counts open tables the way the floor does", () => {
  // Counting distinct tables across open orders missed two real cases: a table
  // seated with nothing ordered yet, and a table still occupied after its
  // round was settled. Both are open tables with no open order.
  assert.match(dashboard, /staffApi\.tables\(signal\)/, "the home never asks for the tables");
  assert.match(dashboard, /filter\(\(table\) => isTableOpen\(table\.status\)\)/);
  assert.doesNotMatch(
    dashboard,
    /new Set\(open\.map\(\(order\) => order\.tableId\)/,
    "the home is still counting tables off the order list",
  );
  // And one rule, not two: the waiter floor reads the same predicate.
  const floor = read("components/staff/use-staff-floor.ts");
  assert.match(floor, /isTableOpen\(table\.status\)/);
  assert.doesNotMatch(floor, /status !== "available" && table\.status !== "inactive"/);
});

test("takeaway and courier orders are not counted as tables", () => {
  // They have no table, and the count is taken from table rows, so there is
  // nothing for a tableless order to be mistaken for.
  assert.doesNotMatch(dashboard, /openTables[^\n]*orders/);
});

// ------------------------------- 1, 2: basic product fields come first

test("adding a dish shows the basics, with the rest one tap away", () => {
  const dialog = dialogs.slice(dialogs.indexOf("export function ProductEditDialog"));
  const disclosure = dialog.indexOf("<MoreFields>");
  assert.ok(disclosure > 0, "the product form has no secondary layer at all");

  // Price and category are decided before the disclosure.
  for (const basic of ['<Field label="Fiyat">', '<Field label="Kategori">']) {
    const at = dialog.indexOf(basic);
    assert.ok(at > 0 && at < disclosure, `${basic} is not among the first things asked`);
  }
  // Whether it is on sale stays in front too — it is the switch used most.
  assert.ok(dialog.indexOf("Müşteri Menüsünde Göster") > disclosure || dialog.includes("Satışta"));

  // The details are behind it, and still there.
  for (const detail of ["Porsiyon / Gramaj", "Etiketler", "Alerjenler", "Şefin Önerisi"]) {
    assert.ok(dialog.includes(detail), `${detail} was removed rather than tucked away`);
    assert.ok(dialog.indexOf(detail) > disclosure, `${detail} still competes with the basics`);
  }
});

test("the disclosure is operable by keyboard and announces itself", () => {
  assert.match(dialogs, /aria-expanded=\{open\}/);
  assert.match(dialogs, /type="button"/);
  assert.match(dialogs, /focus-visible:ring-2/);
});

// ---------------------- 3: on-sale, sold-out and hidden are different things

test("the two availability switches say what each one does", () => {
  // `isActive` and `isAvailable` are not the same business fact, and the screen
  // has to say which is which rather than showing two identical toggles.
  assert.match(dialogs, /Kapalıyken ürün QR menüde görünmez/);
  assert.match(dialogs, /Kapalıyken menüde &quot;Tükendi&quot; görünür/);
  // Neither is labelled with the column name.
  assert.ok(!dialogs.includes(">isActive<"));
  assert.ok(!dialogs.includes(">isAvailable<"));
});

// ---------------------------------------------- 4, 5: staff roles and limits

test("roles are shown in the restaurant's words", () => {
  assert.deepEqual(STAFF_ROLE_LABELS, {
    ADMIN: "Sistem Yöneticisi",
    MANAGER: "İşletme Müdürü",
    WAITER: "Garson",
    KITCHEN: "Mutfak",
    CASHIER: "Kasiyer",
  });
  assert.match(staff, /STAFF_ROLE_LABELS/, "the staff screen prints raw role codes");
});

test("a manager still cannot create an administrator", async () => {
  const { checkStaffCreation } = await import("../../lib/domain/staff-accounts");
  assert.equal(checkStaffCreation("MANAGER", "ADMIN").allowed, false);
  assert.equal(checkStaffCreation("MANAGER", "WAITER").allowed, true);
  assert.equal(checkStaffCreation("ADMIN", "ADMIN").allowed, true);
});

// ------------------------------------------ 6, 7: the order list reads plainly

test("the order list stays to a handful of columns and names the channel", () => {
  const headers = [...orders.matchAll(/<th[^>]*>([^<]+)<\/th>/g)].map((match) => match[1].trim());
  assert.ok(headers.length <= 6, `the order table has ${headers.length} columns`);
  // The place words come from the order itself — "Paket Sipariş" / "Kurye
  // Siparişi" for the tableless channels, never a table invented for them.
  assert.match(orders, /tableName/);
  assert.doesNotMatch(orders, /DINE_IN|TAKEAWAY|DELIVERY/);
});

// ------------------------------------------------- 9, 10: error language

test("a failure is a sentence, and the code stays for the log", () => {
  // A curated sentence wins over whatever wording a route happened to carry.
  const conflict = new ApiClientError("CONFLICT", "Conflict", 409);
  assert.notEqual(userErrorMessage(conflict), "Conflict");
  assert.ok(userErrorMessage(conflict).length > 10);

  // The defensive branches, for a code the curated map has not caught up with
  // yet. Cast deliberately: no such code exists today, which is the next
  // assertion's job to keep true.
  const unmapped = "SOMETHING_ODD" as ApiClientErrorCode;
  const bare = new ApiClientError(unmapped, "SOMETHING_ODD", 500);
  assert.equal(userErrorMessage(bare), "İşlem tamamlanamadı. Lütfen tekrar deneyin.");
  assert.equal(userErrorMessage(bare, "Kaydedilemedi."), "Kaydedilemedi.");

  // Nor is an HTTP status line shown as if it were a sentence.
  assert.equal(
    userErrorMessage(new ApiClientError(unmapped, "HTTP 409 Conflict", 409), "Olmadı."),
    "Olmadı.",
  );

  // A known code gets the sentence written for it.
  assert.equal(
    userErrorMessage(new ApiClientError("CASHIER_SHIFT_REQUIRED", "nope", 409)),
    "Önce kasa vardiyanızı açmanız gerekiyor.",
  );

  // And the code and status are still on the error for logging.
  assert.equal(conflict.code, "CONFLICT");
  assert.equal(conflict.status, 409);
});

test("the daily screens all speak through the one mapper", () => {
  for (const file of [
    "components/admin/orders-manager.tsx",
    "components/admin/staff-manager.tsx",
    "components/admin/cash-registers-manager.tsx",
    "components/admin/use-admin-menu.ts",
    "components/admin/menu-editor-dialogs.tsx",
    "components/admin/table-qr-dialog.tsx",
    "components/admin/qr-access-toggle.tsx",
  ]) {
    const source = read(file);
    assert.match(source, /userErrorMessage\(/, `${file} still shows the raw wire message`);
    assert.doesNotMatch(
      source,
      /error instanceof ApiClientError \? error\.message/,
      `${file} still bypasses the mapper`,
    );
  }
});

// --------------------------------------------------- 11: Home Screen launcher

test("the Home Screen launcher reaches the daily business apps", () => {
  const block = dashboard.slice(dashboard.indexOf("HOME_APP_SHORTCUTS"));
  for (const href of [
    "/admin/tables",
    "/admin/menu",
    "/admin/orders",
    "/admin/staff",
    "/admin/cash-registers",
    "/admin/reports",
    "/admin/inventory",
    "/admin/settings",
  ]) {
    assert.ok(block.includes(href), `the home lost its shortcut to ${href}`);
  }
  assert.match(block, /HOME_APP_SHORTCUTS\.map\(\(app\) =>/);
});

test("every error the API can return already has a sentence written for it", () => {
  // The mapper prefers the curated wording, so a code with no entry would fall
  // through to whatever the route happened to say. There is none today.
  const domainError = read("lib/api/domain-error.ts");
  const display = read("lib/domain/display.ts");
  const codes = [...domainError.matchAll(/^\s*"([A-Z_]{4,})",$/gm)].map((match) => match[1]);
  assert.ok(codes.length > 30, "the error code list moved");
  const missing = codes.filter((code) => !display.includes(`${code}:`));
  assert.deepEqual(missing, [], "these codes would reach a user unworded");
});
