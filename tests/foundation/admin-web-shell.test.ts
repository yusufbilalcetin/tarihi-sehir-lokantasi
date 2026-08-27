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

test("operational roles render as pages, not as floating windows", () => {
  // This assertion used to say the opposite: Admin was corrected first and the
  // operational roles were deliberately left as centered windows. That was the
  // wrong reading of the design intent — a route is a page in every role, and
  // the window metaphor belongs to overlays a person opens on purpose.
  for (const path of [
    "components/staff/tables-module.tsx",
    "components/staff/orders-module.tsx",
    "components/staff/calls-module.tsx",
    "components/kitchen/kitchen-module.tsx",
    "components/cashier/cashier-module.tsx",
  ]) {
    const source = read(path);
    for (const windowDependency of ["ModuleWindow", "CenteredAppWindow", "closeHref", "DialogPrimitive", "inWindow"]) {
      assert.ok(
        !source.includes(windowDependency),
        `${path} still renders a route inside a window (${windowDependency})`,
      );
    }
  }
});

test("no route-as-window abstraction exists any more", () => {
  // Both abstractions that could wrap a route in desktop-window chrome are
  // gone from the tree, not merely unused: `module-window.tsx` wrapped routes
  // directly, and `app-window.tsx` was the shell it wrapped them in. An unused
  // file is a file someone reaches for again.
  for (const removed of ["components/shared/module-window.tsx", "components/shared/app-window.tsx"]) {
    assert.throws(() => read(removed), `${removed} came back`);
  }
});

test("the window treatment belongs to overlays and nothing else", () => {
  // The desktop-window look now lives in exactly one place, and that place is
  // a dialog: it has the backdrop, the popup and the focus semantics.
  const windowDialog = read("components/ui/window-dialog.tsx");
  assert.match(windowDialog, /DialogPrimitive\.Popup/, "the overlay lost its dialog semantics");
  assert.match(windowDialog, /DialogOverlay/);
  assert.match(windowDialog, /DialogPrimitive\.Title/);

  // Nothing that renders a route may import it.
  for (const routeSurface of [
    "components/shared/module-page.tsx",
    "components/admin/admin-module-window.tsx",
    "components/admin/admin-shell.tsx",
    "components/staff/staff-shell.tsx",
  ]) {
    assert.ok(
      !read(routeSurface).includes("ui/window-dialog"),
      `${routeSurface} is a route surface and must not wear window chrome`,
    );
  }
});

test("the route page surface is plain document flow", () => {
  const modulePage = read("components/shared/module-page.tsx");
  for (const windowDependency of ["CenteredAppWindow", "DialogPrimitive", "Backdrop", "closeHref"]) {
    assert.ok(!modulePage.includes(windowDependency), `the route page surface pulled in ${windowDependency}`);
  }
  assert.match(modulePage, /<PageHeader/);
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

test("the window-styled dialog is an overlay treatment and nothing else", () => {
  const windowDialog = read("components/ui/window-dialog.tsx");
  // It is a dialog first: the focus trap, Escape handling and aria wiring are
  // the shared primitives, not a hand-rolled panel that merely looks modal.
  assert.match(windowDialog, /from "@base-ui\/react\/dialog"/);
  assert.match(windowDialog, /DialogPrimitive\.Popup/);
  assert.match(windowDialog, /DialogPrimitive\.Title/);
  assert.match(windowDialog, /DialogOverlay/);
  // The window chrome that routes must never have: a title bar carrying the
  // close control, rather than a control floating over the content.
  assert.match(windowDialog, /DialogPrimitive\.Close/);
  assert.doesNotMatch(windowDialog, /absolute top-2 right-2/);
  // Sizes stay dialog-scale. The route-scale width belongs to the old shell.
  assert.doesNotMatch(windowDialog, /96rem|95vw|100dvh-1rem/);
});

test("no route shell reaches for the window dialog", () => {
  // A route is a page. If a layout or a module shell ever imports this, the
  // whole correction has been undone.
  for (const path of [
    "components/shared/module-page.tsx",
    "components/admin/admin-module-window.tsx",
    "components/admin/admin-shell.tsx",
    "components/staff/staff-shell.tsx",
    "components/staff/tables-module.tsx",
    "components/staff/orders-module.tsx",
    "components/staff/calls-module.tsx",
    "components/kitchen/kitchen-module.tsx",
    "components/cashier/cashier-module.tsx",
  ]) {
    assert.ok(
      !read(path).includes("window-dialog"),
      `${path} is a route surface and must not wear window chrome`,
    );
  }
});

test("button-triggered staff and admin dialogs wear the window treatment", () => {
  // The point of the phase: the treatment exists *and* is what these dialogs
  // actually use. A styled component with no callers is the defect it replaced.
  for (const path of [
    "components/admin/categories-manager.tsx",
    "components/admin/tables-manager.tsx",
    "components/admin/staff-manager.tsx",
    "components/admin/printers-manager.tsx",
    "components/cashier/shift-panel.tsx",
    "components/cashier/shift-report-dialog.tsx",
    "components/kitchen/kitchen-board.tsx",
  ]) {
    const source = read(path);
    assert.match(source, /WindowDialogContent/, `${path} lost the window dialog treatment`);
    assert.doesNotMatch(
      source,
      /<DialogContent/,
      `${path} still mixes the plain dialog card with the window treatment`,
    );
  }
});

test("a printed cash report carries no window chrome", () => {
  // The report prints as a document. Title bar and footer are screen furniture.
  const windowDialog = read("components/ui/window-dialog.tsx");
  assert.equal((windowDialog.match(/data-print-hide/g) ?? []).length, 2);
  assert.match(read("app/globals.css"), /\[data-print-root\] \[data-slot="window-dialog-body"\]/);
  assert.match(read("components/cashier/shift-report-dialog.tsx"), /data-print-root/);
});
