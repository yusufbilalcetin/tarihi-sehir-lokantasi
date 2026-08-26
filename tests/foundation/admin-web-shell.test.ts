import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

const adminModule = read("components/admin/admin-module-window.tsx");
const adminShell = read("components/admin/admin-shell.tsx");

test("admin modules render as pages, never as desktop-style windows", () => {
  for (const oldWindowDependency of [
    "@/components/shared/module-window",
    "@/components/shared/app-window",
    "CenteredAppWindow",
    "closeHref",
    "DialogPrimitive",
  ]) {
    assert.ok(!adminModule.includes(oldWindowDependency), `admin still depends on ${oldWindowDependency}`);
  }
  assert.doesNotMatch(adminModule, /<ModuleWindow\b/);
  assert.match(adminModule, /<section[^>]*aria-labelledby="admin-page-title"/);
  assert.match(adminModule, /<header className=/);
  assert.match(adminModule, /<h1 id="admin-page-title"/);
});

test("the admin canvas belongs to the viewport rather than a centered outer frame", () => {
  assert.match(adminShell, /<aside className="fixed inset-y-0 left-0/);
  const main = adminShell.slice(adminShell.indexOf("<main"), adminShell.indexOf("</main>"));
  assert.match(main, /min-w-0/);
  assert.match(main, /w-full/);
  assert.doesNotMatch(main, /mx-auto|max-w-/, "the whole admin app must not float in a centered max-width frame");
});

test("the admin header is a web breadcrumb with an accessible current page", () => {
  assert.match(adminShell, /<nav[^>]*aria-label="İçerik yolu"/);
  assert.match(adminShell, /aria-current="page"/);
  assert.match(adminShell, /href="#admin-content"/);
  assert.match(adminShell, /<main id="admin-content"/);
  assert.doesNotMatch(adminModule, /shadow-\[var\(--shadow-window\)\]/);
});

test("operational role windows remain isolated from the admin refinement", () => {
  for (const path of [
    "components/staff/tables-module.tsx",
    "components/staff/orders-module.tsx",
    "components/staff/calls-module.tsx",
    "components/kitchen/kitchen-module.tsx",
    "components/cashier/cashier-module.tsx",
  ]) {
    assert.match(read(path), /ModuleWindow/, `${path} unexpectedly lost its focused operational window`);
  }
  assert.match(read("components/shared/module-window.tsx"), /CenteredAppWindow/);
});

test("representative admin routes all enter the same page surface", () => {
  for (const path of [
    "components/admin/dashboard-module.tsx",
    "components/admin/menu-module.tsx",
    "components/admin/products-module.tsx",
    "components/admin/tables-module.tsx",
    "components/admin/reports-module.tsx",
    "components/admin/erp-operations-module.tsx",
    "components/admin/erp-workspace-module.tsx",
  ]) {
    assert.match(read(path), /AdminModuleWindow/, `${path} bypasses the integrated admin page surface`);
  }
});
