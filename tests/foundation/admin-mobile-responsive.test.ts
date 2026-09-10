import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ADMIN_APPS, ADMIN_HOME } from "../../components/admin/admin-navigation";

function read(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

test("the admin shell owns phone overflow and has no drawer to open", () => {
  const shell = read("components/admin/admin-shell.tsx");
  assert.match(shell, /data-admin-shell/);
  assert.match(shell, /overflow-x-clip/);
  // No sidebar from `lg` up and no drawer below it: one bar, and a dock on a
  // phone. A hamburger would be a second way around the same panel.
  assert.doesNotMatch(shell, /<aside\b|<Sheet\b|SheetContent|aria-label="Yönetim menüsünü aç"/);
  // The page keeps a padding ramp rather than jumping to one desktop value.
  assert.match(shell, /px-4 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-8/);
});

test("one navigation model at every width, and every destination survives it", () => {
  const shell = read("components/admin/admin-shell.tsx");
  const switcher = read("components/admin/admin-app-switcher.tsx");

  // Phone, tablet and desktop share the one bar; no rail between md and lg.
  assert.match(shell, /<header className="sticky top-0[^"]*"/);
  assert.doesNotMatch(shell, /md:block lg:hidden|w-\[68px\]|hidden w-60/);

  // The switcher draws each app as an icon and a word, so an app without an
  // icon would draw a hole — the one way it could lose a destination.
  const rows = [ADMIN_HOME, ...ADMIN_APPS];
  assert.equal(rows.length, 9);
  for (const row of rows) {
    assert.ok(typeof row.icon === "object" || typeof row.icon === "function", `${row.label} has no icon`);
  }
  // And it draws the table rather than a list of its own.
  assert.match(switcher, /ADMIN_APPS\.map\(\(app\) =>/);
});

test("the phone dock is four named, thumb-sized controls clear of the home indicator", () => {
  const shell = read("components/admin/admin-shell.tsx");
  const dock = shell.slice(shell.indexOf("const DOCK_ITEM"), shell.indexOf("export function AdminShell("));

  // 56px each, wider than the 44px floor: the dock is the only way around.
  assert.match(dock, /min-h-14[^"]*min-w-14/);
  // Bugün is the one link; the other three open a dialog and say so.
  assert.equal((dock.match(/<Link\b/g) ?? []).length, 1);
  assert.match(dock, />\s*Bugün\s*</);
  assert.deepEqual(
    [...dock.matchAll(/\["(?:search|apps|account)", "([^"]+)"/g)].map((match) => match[1]),
    ["Ara", "Uygulamalar", "Hesap"],
  );
  assert.match(dock, /aria-haspopup="dialog"/);
  assert.match(dock, /pb-\[env\(safe-area-inset-bottom\)\]/);

  // The page's last row clears the dock — 4px + 56px + 4px + 1px hairline,
  // under 4.5rem — plus the home indicator, and only where the dock exists.
  assert.match(
    shell,
    /<main id="admin-content" className="[^"]*pb-\[calc\(4\.5rem\+env\(safe-area-inset-bottom\)\)\] md:pb-0"/,
  );
  assert.match(dock, /grid-cols-4 px-2 py-1/);
});

test("shared admin headers and toolbars stack before they run out of room", () => {
  const ui = read("components/admin/admin-ui.tsx");
  // Page actions wrap onto a second line rather than pushing the header wider
  // than the phone. `flex-wrap` does this at every width, which is why it
  // replaced the bespoke `min-[430px]` ramp it used to take three rules to say.
  assert.match(ui, /flex w-full flex-wrap items-center gap-2 sm:w-auto/);
  assert.match(ui, /flex flex-col gap-4 sm:flex-row/);
  assert.match(ui, /flex min-w-0 flex-col gap-2\.5[^"]*sm:flex-row sm:flex-wrap/);
  assert.match(ui, /\[&>\*\]:min-w-0/);
});

test("admin phone controls keep thumb-sized targets without changing public surfaces", () => {
  const css = read("app/globals.css");
  const mobileAdmin = css.slice(css.indexOf("@media (max-width: 639px) {", css.indexOf("data-admin-shell") - 80));
  assert.match(mobileAdmin, /\[data-admin-shell\] \[data-slot="button"\]/);
  assert.match(mobileAdmin, /min-width: 2\.75rem/);
  assert.match(mobileAdmin, /min-height: 2\.75rem/);
  assert.match(mobileAdmin, /overscroll-behavior-inline: contain/);

  // The rule reaches buttons through `data-slot`, which only the Button
  // component sets. The segmented filter chips are hand-rolled <button>s, so
  // they sat at their desktop 32px under a thumb until they opted in.
  const ui = read("components/admin/admin-ui.tsx");
  const chip = ui.slice(ui.indexOf("export function AdminSegmentedControl("), ui.indexOf("export function AdminSearchInput("));
  assert.match(chip, /role="radio"/);
  assert.match(chip, /data-slot="button"/);
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
  assert.match(dashboard, /grid grid-cols-2 gap-2\.5 md:hidden/);
  assert.match(dashboard, /grid grid-cols-4 gap-x-2 gap-y-2\.5/);
  assert.match(dashboard, /min-h-\[78px\]/);
  assert.match(dashboard, /size-14[^\n]*sm:size-\[72px\]/);
  assert.doesNotMatch(dashboard, /<table\b|overflow-x-auto/);
  assert.match(orders, /grid-cols-1 gap-2 min-\[380px\]:grid-cols-2/);
  assert.match(orders, /adminOrderProgressAction/);
  assert.match(orders, /Rolünüz için uygulanabilir bir sonraki durum işlemi yok/);
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
