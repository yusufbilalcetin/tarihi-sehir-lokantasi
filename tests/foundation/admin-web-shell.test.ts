import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

function read(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

/**
 * Every source a screen actually renders, followed through its imports.
 *
 * The heading guards below used to read a page's *direct*
 * `@/components/admin/*` imports and stop there. That was wrong in both
 * directions: a heading two components down read as "no heading at all" — a
 * false alarm that invites someone to add a second one — and an `<h1>` added
 * deeper than one hop, in `customer-menu-editor.tsx` say, was invisible to the
 * count that is supposed to catch exactly that. One hop is not "what this
 * route renders".
 *
 * Deliberately not a JSX parser: it follows `@/components/...` specifiers with
 * a visited set, which is enough to answer "which files can put a heading on
 * this screen" without pretending to understand React.
 */
function renderedSources(entry: URL, seen = new Set<string>()): string[] {
  if (seen.has(entry.href)) return [];
  seen.add(entry.href);
  let text: string;
  try {
    text = readFileSync(entry, "utf8");
  } catch {
    return [];
  }
  const collected = [text];
  for (const [, specifier] of text.matchAll(/from "@\/(components\/[a-zA-Z0-9-]+(?:\/[a-zA-Z0-9-]+)*)"/g)) {
    collected.push(...renderedSources(new URL(`../../${specifier}.tsx`, import.meta.url), seen));
  }
  return collected;
}

/**
 * A forwarder renders no screen of its own: it redirects and returns no JSX.
 *
 * Tested as that pair, not as "the file contains the substring `redirect(`" —
 * under the old check a real screen could exempt itself from the heading guard
 * entirely by mentioning the word in a comment.
 */
function isRedirectOnlyRoute(source: string): boolean {
  // Any JSX at all disqualifies it, intrinsic elements included — a page that
  // returns `<div>…</div>` draws a screen and owes it a heading, whatever else
  // the file happens to mention.
  return /(?:^|\W)redirect\(/.test(source) && !/<[A-Za-z]/.test(source);
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

test("the admin canvas fills the viewport while its content keeps a reading measure", () => {
  // No column beside the canvas at any width: the shell is a bar over the page.
  assert.doesNotMatch(adminShell, /<aside\b/);
  const main = adminShell.slice(adminShell.indexOf("<main"), adminShell.indexOf("</main>"));
  const mainTag = main.slice(0, main.indexOf(">") + 1);

  // The shell is still the viewport and not a floating desktop window: the
  // landmark itself takes the full width and never caps it.
  assert.match(mainTag, /min-w-0/);
  assert.match(mainTag, /w-full/);
  assert.doesNotMatch(mainTag, /mx-auto|max-w-/, "the whole admin app must not float in a centered max-width frame");

  // The cap belongs to the content inside it, which is a different claim: past
  // roughly 1600px a table row becomes a journey from the guest's name to the
  // order's status, and a 1920px monitor is the common case behind a counter.
  assert.match(main, /mx-auto w-full max-w-\[1600px\]/);
});

test("a page's actions belong to its heading, not to a row of their own", () => {
  const ui = read("components/admin/admin-ui.tsx");

  // The title and the actions are declared in different files — the title by
  // the route module, the actions by the manager that owns the state they act
  // on. They used to be rendered in different places too, which left a lone
  // primary button on its own row with the page's whole width around it.
  //
  // The heading now publishes a slot and the manager portals into it. A portal
  // rather than actions copied into provider state: they are live JSX closing
  // over manager state, and copying that is how a dead handler survives.
  assert.match(adminModule, /const \[actionSlot, setActionSlot\] = useState<HTMLElement \| null>\(null\)/);
  assert.match(adminModule, /ref=\{setActionSlot\}/);
  assert.match(adminModule, /empty:hidden/, "a module with no actions must not leave a gap");
  assert.match(adminModule, /<AdminPageHeaderProvider actionSlot=\{actionSlot\}>/);
  assert.match(ui, /createPortal\(actions, host\.actionSlot\)/);

  // Rendered once each, from one place each.
  assert.equal((adminModule.match(/<h1 /g) ?? []).length, 1);
  assert.equal((adminModule.match(/ref=\{setActionSlot\}/g) ?? []).length, 1);
  assert.doesNotMatch(
    ui,
    /useEffect/,
    "the slot must be published during commit, not synchronised from an effect",
  );
});

test("the admin shell keeps its landmarks and names the current page once", () => {
  // The sidebar is gone at every width. What it was not allowed to take with
  // it is the way in, the way around, and the announcement of where you are.
  assert.match(adminShell, /href="#admin-content"/);
  assert.match(adminShell, /<main id="admin-content"/);

  // `not-sr-only` resets position to static and padding to zero, so a skip link
  // that only carried `fixed left-4 top-4 z-50 px-4 py-2` at rest lost all of it
  // the moment it was focused: it laid out in flow at the top of the document,
  // unpositioned and unpadded, under the fixed sidebar. Focusable, and invisible.
  // The positioning has to be restated inside the same focus variant.
  assert.match(adminShell, /focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:px-4 focus:py-2/);

  // One banner, one phone navigation landmark, and the two home links say
  // when the home is the page being read.
  assert.equal((adminShell.match(/<header /g) ?? []).length, 1);
  assert.match(adminShell, /<nav\s+aria-label="Genel gezinme"/);
  assert.match(adminShell, /aria-current=\{active \? "page" : undefined\}/);
  assert.match(adminShell, /aria-current=\{atHome \? "page" : undefined\}/);

  // The phone bar names the page, because the page's own <h1> can be below
  // the fold — and it does so as text, never as a second heading.
  assert.match(adminShell, /\{pageTitle\}/);
  assert.doesNotMatch(adminShell, /<h[1-6][\s>]/, "the shell must not add a heading to a page that owns its <h1>");

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

test("menu management has one canonical integrated page surface", () => {
  const menuPage = read("app/admin/menu/page.tsx");
  const menuModule = read("components/admin/menu-module.tsx");
  assert.match(menuPage, /MenuOverviewModule/);
  assert.match(menuModule, /MenuOverview/);
  assert.doesNotMatch(menuModule, /AdminModuleWindow/, "the menu editor regained window chrome");

  for (const path of ["app/admin/categories/page.tsx", "app/admin/products/page.tsx"]) {
    const legacyPage = read(path);
    assert.match(legacyPage, /redirect\("\/admin\/menu"\)/, `${path} is not canonicalized`);
    assert.doesNotMatch(legacyPage, /ManagerModule|CustomerMenuEditor/, `${path} still mounts a second editor`);
  }

  const dashboardModule = read("components/admin/dashboard-module.tsx");
  assert.doesNotMatch(dashboardModule, /AdminModuleWindow/, "the Home Screen regained module-window chrome");
  assert.match(dashboardModule, /return <DashboardView \/>/, "the dashboard module no longer mounts the Home Screen");

  for (const path of [
    "components/admin/tables-module.tsx",
    "components/admin/reports-module.tsx",
    "components/admin/erp-operations-module.tsx",
    "components/admin/erp-workspace-module.tsx",
  ]) {
    assert.match(read(path), /AdminModuleWindow/, `${path} bypasses the integrated admin page surface`);
  }
});

test("the sidebar exposes menu as one ordinary destination", () => {
  const shell = read("components/admin/admin-shell.tsx");
  const navigation = read("components/admin/admin-navigation.ts");

  // One row, one screen, no list under it: the editor is the whole domain.
  assert.equal((navigation.match(/label: "Menü"/g) ?? []).length, 1);
  assert.match(navigation, /label: "Menü",\s*\n\s*href: "\/admin\/menu",\s*\n\s*icon: BookOpen,/);
  const menuApp = navigation.slice(navigation.indexOf("const menuApp"), navigation.indexOf("const cashApp"));
  assert.doesNotMatch(menuApp, /sections:/, "Menü is still expandable");
  assert.doesNotMatch(shell, /const menuNav/);
  for (const source of [shell, navigation]) {
    assert.doesNotMatch(source, /Menü Genel Bakış|\/admin\/categories|\/admin\/products/);
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
    // The menu editor's own panels; the three menu managers are now one line
    // each and delegate every dialog here.
    "components/admin/menu-editor-dialogs.tsx",
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

/**
 * One screen, one title.
 *
 * Every admin screen is wrapped in `AdminModuleWindow`, which already renders
 * the module's title and description. Three managers — Kasa ve Vardiyalar,
 * Gün Sonu Kasa Raporu and Yazıcılar — still carried the older `PageHeader`
 * with the same words inside that window, so the page shipped two <h1>s
 * reading the same thing, one above the other. A screen reader announced the
 * heading twice and the second description contradicted the first.
 *
 * Asserted structurally rather than per-file: any manager reached through a
 * module window must not raise a page header of its own.
 */
test("no module-window screen renders a second page header", () => {
  const adminDirectory = new URL("../../components/admin/", import.meta.url);
  const moduleFiles = readdirSync(adminDirectory).filter((name) => name.endsWith("-module.tsx"));

  assert.ok(moduleFiles.length >= 10, "expected the admin module wrappers to be discoverable");

  const offenders: string[] = [];
  for (const moduleFile of moduleFiles) {
    const source = readFileSync(new URL(moduleFile, adminDirectory), "utf8");
    if (!source.includes("AdminModuleWindow")) continue;

    // The children a module wrapper mounts, resolved through its own imports.
    for (const [, specifier] of source.matchAll(/from "@\/components\/admin\/([a-z0-9-]+)"/g)) {
      if (specifier === "admin-module-window") continue;
      let child: string;
      try {
        child = readFileSync(new URL(`${specifier}.tsx`, adminDirectory), "utf8");
      } catch {
        continue;
      }
      if (/<PageHeader[\s/>]/.test(child)) offenders.push(`${moduleFile} -> ${specifier}.tsx`);
    }
  }

  assert.deepEqual(offenders, [], `these screens render a title twice: ${offenders.join(", ")}`);
});

/**
 * The shape of the admin shell, asserted where it is decided.
 *
 * The QA pass that added this could not resize the browser — the automation
 * reported success and left the viewport at 1920 — so the breakpoint contract
 * could not be measured at 390/768/1024. It is a single set of Tailwind
 * classes in one file, so it is pinned here instead: a regression would
 * otherwise only surface on a real device.
 *
 *   any width   one top bar; no sidebar, rail or drawer; no left offset
 *   < 768       compact bar (brand + screen name) and a fixed bottom dock
 *   >= 768      the bar carries search, apps and account; no dock
 *   any width   content is capped at 1600px and centred
 */
test("the admin shell is one top bar and a phone dock, with no column at any width", () => {
  const shell = read("components/admin/admin-shell.tsx");

  assert.doesNotMatch(shell, /<aside\b|SidebarRail|SidebarContent|<Sheet\b|DomainNav/);
  // Nothing to clear at 768 or 1024 any more.
  assert.doesNotMatch(shell, /\b(?:sm|md|lg|xl):pl-/, "content must not clear a column that no longer exists");
  // 56px on a phone, 64px from md up, at every width.
  assert.match(shell, /<header className="sticky top-0[^"]*h-14[^"]*md:h-16"/);
  // The bar's controls from md up; the dock only below it.
  assert.match(shell, /ml-auto hidden items-center gap-1 md:flex/);
  assert.match(shell, /fixed inset-x-0 bottom-0[^"]*md:hidden/);
  // Reading width is capped and centred so 1920 does not stretch a table row,
  // and the bar's row keeps the same measure so its edges meet the content's.
  assert.equal((shell.match(/mx-auto (?:flex h-full )?w-full max-w-\[1600px\]/g) ?? []).length, 2);

  // The shell must never let the document itself scroll sideways; wide tables
  // scroll inside their own container instead.
  assert.match(shell, /data-admin-shell[^>]*overflow-x-clip/s);
});

/**
 * Every admin screen names itself, and exactly once.
 *
 * `/admin/menu` shipped with no level-1 heading anywhere in its document. Its
 * module renders the editor straight into the workspace — deliberately, so no
 * window chrome pushes the customer menu down — and nothing else supplied a
 * heading. The page section had nothing to be labelled by and the outline
 * began at the customer menu's category H2s. Above 768px, where the shell's
 * own title bar is `md:hidden`, the screen had no accessible name at all.
 *
 * The guard is architectural rather than textual. A route may take either of
 * the two legitimate paths to a heading — mount the shared module surface,
 * which owns one, or state the canonical `h1#admin-page-title` itself — but it
 * may not take neither, and it may not take both.
 */
test("every admin screen route supplies exactly one canonical page heading", () => {
  const appAdmin = new URL("../../app/admin/", import.meta.url);

  const pages: string[] = [];
  const walk = (dir: URL, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(new URL(entry.name + "/", dir), prefix + entry.name + "/");
      else if (entry.name === "page.tsx") pages.push(prefix + entry.name);
    }
  };
  walk(appAdmin, "");
  assert.ok(pages.length >= 40, `expected the admin routes to be discoverable, found ${pages.length}`);

  const headless: string[] = [];
  const doubled: string[] = [];
  for (const page of pages) {
    const source = readFileSync(new URL(page, appAdmin), "utf8");
    if (isRedirectOnlyRoute(source)) continue;

    // The whole rendered tree, not just the page's direct imports. The shared
    // surface is the *other* legitimate path to a heading rather than a route
    // declaring one of its own, so its file is dropped from the set: leaving it
    // in would make every route that mounts it look like it did both.
    const sources = renderedSources(new URL(page, appAdmin)).filter(
      (text) => !text.includes("AdminPageHeaderProvider"),
    );
    const viaSharedSurface = sources.some((text) => text.includes("AdminModuleWindow"));
    const viaOwnHeading = sources.some((text) => /id="admin-page-title"/.test(text));
    if (!viaSharedSurface && !viaOwnHeading) headless.push(page);
    if (viaSharedSurface && viaOwnHeading) doubled.push(page);
  }

  assert.deepEqual(headless, [], `these admin screens have no page heading: ${headless.join(", ")}`);
  assert.deepEqual(doubled, [], `these admin screens declare the page heading twice: ${doubled.join(", ")}`);
});

/**
 * A hidden title must still be a title.
 *
 * The menu editor is the one screen that deliberately shows no title band, so
 * its heading is hidden rather than drawn. It has to be hidden the accessible
 * way: `hidden`, `display:none` or dropping the element would take the H1 out
 * of the accessibility tree and put the page back where it started, while
 * still satisfying a naive "does an h1 exist" check.
 */
test("the menu screen's heading is visually hidden, not removed", () => {
  const menuModule = read("components/admin/menu-module.tsx");

  // Counted across everything the route renders, not just this one file.
  // `menu-module.tsx` is 35 lines whose whole body is the section and the
  // heading, so counting it alone could only ever return 1 — an `<h1>` added in
  // `customer-menu-editor.tsx`, which is what actually draws this screen, shipped
  // a second level-1 heading with the suite green.
  // The shared header machinery is excluded for the same reason the guard above
  // excludes it: `AdminPageHeader` and the module window own a heading that
  // belongs to whichever route mounts them, and this route mounts neither. What
  // is left is the tree this screen actually draws.
  const rendered = renderedSources(new URL("../../app/admin/menu/page.tsx", import.meta.url)).filter(
    (text) => !text.includes("AdminPageHeaderProvider"),
  );
  const headings = rendered.flatMap((text) => text.match(/<h1[\s>]/g) ?? []);
  assert.equal(
    headings.length,
    1,
    `the menu route renders ${headings.length} level-1 headings across ${rendered.length} files`,
  );
  assert.match(menuModule, /<h1 id="admin-page-title" className="sr-only">/);
  assert.match(menuModule, /aria-labelledby="admin-page-title"/);

  // Hidden visually, never removed from the tree.
  assert.doesNotMatch(menuModule, /className="[^"]*\bhidden\b/);
  assert.doesNotMatch(menuModule, /aria-hidden/);
});
