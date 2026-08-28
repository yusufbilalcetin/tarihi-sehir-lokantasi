import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

test("the admin shell owns phone overflow and swaps the permanent sidebar for a drawer", () => {
  const shell = read("components/admin/admin-shell.tsx");
  assert.match(shell, /data-admin-shell/);
  assert.match(shell, /overflow-x-clip/);
  assert.match(shell, /hidden w-\[264px\][^\"]*lg:block/);
  assert.match(shell, /w-\[min\(88vw,320px\)\]/);
  assert.match(shell, /p-3 min-\[430px\]:p-4 sm:p-6/);
  assert.match(shell, /aria-label="Yönetim menüsünü aç"/);
});

test("shared admin headers and toolbars stack before they run out of room", () => {
  const ui = read("components/admin/admin-ui.tsx");
  assert.match(ui, /w-full flex-col items-stretch[^\"]*min-\[430px\]:flex-row/);
  assert.match(ui, /flex flex-col gap-3[^\"]*min-\[430px\]:flex-row/);
  assert.match(ui, /\[&>\*\]:min-w-0/);
});

test("admin phone controls keep thumb-sized targets without changing public surfaces", () => {
  const css = read("app/globals.css");
  const mobileAdmin = css.slice(css.indexOf("@media (max-width: 639px) {", css.indexOf("data-admin-shell") - 80));
  assert.match(mobileAdmin, /\[data-admin-shell\] \[data-slot="button"\]/);
  assert.match(mobileAdmin, /min-width: 2\.75rem/);
  assert.match(mobileAdmin, /min-height: 2\.75rem/);
  assert.match(mobileAdmin, /overscroll-behavior-inline: contain/);
});

test("dialogs and sheets stay inside the dynamic viewport and safe area", () => {
  const dialog = read("components/ui/dialog.tsx");
  const sheet = read("components/ui/sheet.tsx");
  assert.match(dialog, /max-h-\[calc\(100dvh-1\.5rem\)\]/);
  assert.match(dialog, /overflow-y-auto overscroll-contain/);
  assert.match(sheet, /max-h-\[calc\(100dvh-env\(safe-area-inset-top\)\)\]/);
  assert.match(sheet, /pb-\[env\(safe-area-inset-bottom\)\]/);
  assert.match(sheet, /w-\[min\(88vw,22rem\)\]/);
});

test("dashboard, order detail and data filters have narrow-screen representations", () => {
  const dashboard = read("components/admin/dashboard-view.tsx");
  const orders = read("components/admin/orders-manager.tsx");
  const filters = read("components/admin/report-filters.tsx");
  assert.match(dashboard, /divide-y sm:hidden/);
  assert.match(dashboard, /hidden overflow-x-auto sm:block/);
  assert.match(orders, /grid-cols-1 gap-2 min-\[380px\]:grid-cols-3/);
  assert.match(orders, /grid-cols-1 gap-2 min-\[380px\]:grid-cols-2/);
  assert.match(filters, /flex flex-col items-stretch[^\"]*sm:flex-row/);
  assert.match(filters, /grid w-full grid-cols-2 gap-2[^\"]*sm:w-auto/);
});

test("menu, tables, QR and ERP remain mobile-first at their dense controls", () => {
  const menuDialogs = read("components/admin/menu-editor-dialogs.tsx");
  const tables = read("components/admin/tables-manager.tsx");
  const qr = read("components/admin/qr-manager.tsx");
  const qrPrint = read("components/admin/qr-print-designer.tsx");
  const erp = read("components/admin/erp-workspace-manager.tsx");
  assert.match(menuDialogs, /<SheetContent[\s\S]*side="bottom"/);
  assert.match(menuDialogs, /max-h-\[92dvh\]/);
  assert.match(tables, /grid grid-cols-1 gap-3/);
  assert.match(qr, /className="grid gap-4 sm:grid-cols-2/);
  assert.match(qrPrint, /grid grid-cols-1 gap-3 min-\[380px\]:grid-cols-2/);
  assert.match(erp, /flex flex-col gap-3 border-t[^\"]*min-\[430px\]:flex-row/);
});

test("admin responsive code avoids forbidden layout shortcuts", () => {
  for (const path of [
    "components/admin/admin-shell.tsx",
    "components/admin/admin-ui.tsx",
    "components/admin/customer-menu-editor.tsx",
    "components/admin/tables-manager.tsx",
    "components/admin/qr-manager.tsx",
    "components/admin/orders-manager.tsx",
    "components/admin/staff-manager.tsx",
  ]) {
    const source = read(path);
    assert.doesNotMatch(source, /transition-all/, `${path} uses transition-all`);
    assert.doesNotMatch(source, /\b100vh\b/, `${path} uses the unstable mobile viewport unit`);
    assert.doesNotMatch(source, /window\.innerWidth/, `${path} controls layout from JavaScript`);
  }
});
