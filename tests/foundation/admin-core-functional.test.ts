import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { adminOrderProgressAction } from "../../lib/domain/admin-order-actions";
import { panelState } from "../../components/shared/data-states";
import {
  createProductBodySchema,
  updateProductBodySchema,
} from "../../lib/validation/admin-menu";

function read(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

test("admin order actions expose every real forward transition and no fake terminal action", () => {
  const expected = [
    ["NEW", "CONFIRMED"],
    ["CONFIRMED", "PREPARING"],
    ["PREPARING", "READY"],
    ["READY", "SERVED"],
    ["SERVED", "COMPLETED"],
  ] as const;
  for (const [current, next] of expected) {
    assert.equal(adminOrderProgressAction("ADMIN", current, [])?.status, next);
    assert.equal(adminOrderProgressAction("MANAGER", current, [])?.status, next);
  }
  assert.equal(adminOrderProgressAction("ADMIN", "COMPLETED", []), null);
  assert.equal(adminOrderProgressAction("ADMIN", "CANCELLED", []), null);
  assert.equal(adminOrderProgressAction("CASHIER", "NEW", []), null);
  assert.equal(adminOrderProgressAction("CASHIER", "SERVED", [])?.status, "COMPLETED");
});

test("loading, failure, real emptiness and success remain distinct states", () => {
  assert.equal(panelState({ loading: true, error: null, empty: true }), "loading");
  assert.equal(panelState({ loading: false, error: new Error("offline"), empty: true }), "error");
  assert.equal(panelState({ loading: false, error: null, empty: true }), "empty");
  assert.equal(panelState({ loading: false, error: null, empty: false }), "ready");
});

test("dashboard asks the server for open orders and derives today in the restaurant timezone", () => {
  const dashboard = read("components/admin/dashboard-view.tsx");
  assert.match(dashboard, /staffApi\.orders\(\{ open: true \}, signal\)/);
  assert.match(dashboard, /href="\/admin\/reports"/);
  assert.match(dashboard, /href="\/admin\/orders"/);
  assert.match(dashboard, /href="\/admin\/cash-registers"/);
  assert.doesNotMatch(dashboard, /Ã|Å|â€¦/);

  const repository = read("lib/repositories/drizzle-erp-repository.ts");
  const overview = repository.slice(repository.indexOf("async overview("), repository.indexOf("createWarehouse("));
  assert.match(overview, /restaurants\.timezone/);
  assert.match(overview, /now\(\) at time zone/);
  assert.doesNotMatch(overview, /toISOString\(\)\.slice\(0, 10\)/);
});

test("orders never render a failed initial request as zero or an empty list", () => {
  const source = read("components/admin/orders-manager.tsx");
  assert.match(source, /figuresAvailable \? openCount : "—"/);
  assert.match(source, /resource\.loading \? \(/);
  assert.match(source, /resource\.error && orders\.length === 0/);
  assert.match(source, /<ErrorState title="Siparişler yüklenemedi"/);
  assert.match(source, /<EmptyState/);
  assert.match(source, /pendingRef\.current/);
  assert.match(source, /adminOrderProgressAction/);
  assert.doesNotMatch(source, /canApply\(selected, "preparing"\)/);
});

test("menu mutations have in-flight guards, explicit data states and archive confirmation", () => {
  const hook = read("components/admin/use-admin-menu.ts");
  assert.match(hook, /savingRef\.current/);
  assert.match(hook, /if \(savingRef\.current\) return null/);

  const editor = read("components/admin/customer-menu-editor.tsx");
  assert.match(editor, /menu\.loading && draft\.categories\.length === 0/);
  assert.match(editor, /<ErrorState/);
  assert.match(editor, /archiveTarget/);
  assert.match(editor, /<Dialog open=\{archiveTarget !== null\}/);
  assert.match(editor, /if \(!result\) return/);
  assert.match(editor, /Kayıtlı içeriğe dokunulmadı/);
  assert.match(editor, /top-1\.5 z-10 flex items-center/);
});

test("menu price contracts reject zero, negative, empty, letters and excess precision", () => {
  const base = { categoryId: "category-1", name: "QA Product" };
  for (const price of ["0", "-1", "", "abc", "1.234", "1000000000.00"]) {
    assert.equal(createProductBodySchema.safeParse({ ...base, price }).success, false, price);
  }
  for (const price of ["0.01", "12", "12.5", "99999999.99"]) {
    assert.equal(createProductBodySchema.safeParse({ ...base, price }).success, true, price);
    assert.equal(updateProductBodySchema.safeParse({ price }).success, true, price);
  }
  // The UI does not promise locale comma parsing; the API contract is a
  // canonical decimal string and rejects ambiguous input explicitly.
  assert.equal(createProductBodySchema.safeParse({ ...base, price: "12,50" }).success, false);
});

test("the three core sidebar destinations are real links with active-path support", () => {
  const shell = read("components/admin/admin-shell.tsx");
  const navigation = read("components/admin/admin-navigation.ts");
  for (const [label, href] of [
    ["Genel Bakış", "/admin/dashboard"],
    ["Siparişler", "/admin/orders"],
    ["Menü", "/admin/menu"],
  ]) {
    assert.match(navigation, new RegExp(`label: "${label}",\\s*\\n?\\s*href: "${href.replaceAll("/", "\\/")}"`));
  }
  assert.match(shell, /aria-current=\{active \? "page" : undefined\}/);
  // One boundary-aware matcher, shared, so a row and a title cannot disagree
  // about which screen is open.
  assert.match(navigation, /export function isAdminRouteMatch\(/);
  assert.match(shell, /isAdminRouteMatch\(/);
});

test("a manager override cannot skip past food nobody has started", () => {
  // The server refuses it, so offering the button would hand a manager a 409.
  // The sheet says which lines are holding the ticket instead.
  assert.equal(
    adminOrderProgressAction("ADMIN", "PREPARING", [
      { status: "PREPARING" },
      { status: "PENDING" },
    ]),
    null,
  );
  assert.equal(
    adminOrderProgressAction("ADMIN", "PREPARING", [
      { status: "PREPARING" },
      // Off the bill, so not the kitchen's work and not a blocker.
      { status: "CANCELLED" },
    ])?.status,
    "READY",
  );
  assert.equal(
    adminOrderProgressAction("MANAGER", "READY", [{ status: "PREPARING" }]),
    null,
  );
  // Settling is not a kitchen step, so the lines never block it.
  assert.equal(
    adminOrderProgressAction("CASHIER", "SERVED", [{ status: "SERVED" }])?.status,
    "COMPLETED",
  );
});

test("the manager sheet shows where each line is and why a ticket is stuck", () => {
  const orders = readFileSync(
    new URL("../../components/admin/orders-manager.tsx", import.meta.url),
    "utf8",
  );
  assert.match(orders, /<StatusBadge status=\{item\.status/);
  assert.match(orders, /henüz hazırlanmadı/);
});
