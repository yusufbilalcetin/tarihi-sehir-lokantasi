import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ADMIN_APPS,
  ADMIN_HOME,
  ADMIN_HOME_LABEL,
  adminParentForPath,
} from "../../components/admin/admin-navigation";

/**
 * N2: the panel without a sidebar.
 *
 * One bar over every screen, a dock under the thumb on a phone, and three
 * dialogs — search, apps, account — that the shell owns. Every list in them is
 * read from the navigation table, so this file mostly asserts that the shell
 * reaches for the table and never for a copy.
 */

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const shell = read("components/admin/admin-shell.tsx");
const switcher = read("components/admin/admin-app-switcher.tsx");
const search = read("components/admin/admin-navigation-search.tsx");
const profile = read("components/admin/admin-profile-dialog.tsx");
const moduleWindow = read("components/admin/admin-module-window.tsx");
const shellSources = [shell, switcher, search, profile];

test("nothing in the shell draws a sidebar, a rail, a drawer or the old domain row", () => {
  for (const source of shellSources) {
    assert.doesNotMatch(source, /<aside\b|SidebarRail|SidebarContent|<Sheet\b|SheetContent|DomainNav/);
    assert.doesNotMatch(source, /aria-label="Yönetim menüsünü aç"|from "@\/components\/ui\/sheet"/);
  }
  // No global attention control: there is no data source for one in this phase.
  assert.doesNotMatch(shell, /\bBell\b|Bildirim|attention/i);
});

test("the home link around the 36px brand mark keeps a 44px hit area", () => {
  const home = shell.match(/<Link\s+href=\{ADMIN_HOME\.href\}[^>]*?className="([^"]*)"[^>]*>[\s\S]*?<\/Link>/);
  assert.ok(home, "the home link is drawn");
  assert.match(home[0], /<BrandMark\b/, "it is the link that holds the brand mark");
  const classes = home[1].split(/\s+/);
  assert.ok(classes.includes("min-h-11"), "the home link lost its 44px minimum height");
  assert.ok(classes.includes("min-w-11"), "the home link lost its 44px minimum width");
});

test("the switcher is the home, then exactly the eight apps, from the table", () => {
  assert.equal(ADMIN_APPS.length, 8);
  assert.equal(ADMIN_HOME_LABEL, "Ana Ekran");

  // The home is its own row above the list, never one of the eight.
  assert.match(switcher, /href=\{ADMIN_HOME\.href\}[\s\S]*\{ADMIN_HOME_LABEL\}/);
  assert.equal((switcher.match(/\.map\(/g) ?? []).length, 1, "the switcher draws one list");
  assert.match(switcher, /ADMIN_APPS\.map\(\(app\) =>/);
  assert.match(switcher, /href=\{app\.href\}/);
  assert.doesNotMatch(switcher, /href="\/admin|href: "\/admin/, "the switcher restated a route");

  // The current app is marked for the eye and for a screen reader alike.
  assert.match(switcher, /aria-current=\{current \? "true" : undefined\}/);
  assert.match(switcher, /aria-current=\{atHome \? "page" : undefined\}/);
  assert.match(switcher, /current \? "bg-accent text-accent-foreground"/);
});

test("every shell dialog is the shared Base UI dialog, so focus, Escape and return come with it", () => {
  for (const source of [switcher, search, profile]) {
    assert.match(source, /from "@\/components\/ui\/dialog"/);
    assert.match(source, /<Dialog open=\{open\} onOpenChange=\{onOpenChange\}>/);
    assert.match(source, /<DialogTitle/);
    // Portalled out of the shell, so it opts back into the panel's palette.
    assert.match(source, /<DialogContent\s+data-admin-shell/);
    assert.doesNotMatch(source, /hover:opacity-100|group-hover:/, "nothing in a dialog may be reachable only by hover");
  }
  // One dialog at a time, and every trigger announces that it opens one.
  assert.match(shell, /useState<ShellDialog \| null>\(null\)/);
  assert.ok((shell.match(/aria-haspopup="dialog"/g) ?? []).length >= 4);
});

test("Cmd or Ctrl+K opens the search, and the search never leaves the page", () => {
  assert.match(shell, /\(event\.metaKey \|\| event\.ctrlKey\) && !event\.altKey && event\.key\.toLowerCase\(\) === "k"/);
  assert.match(shell, /event\.preventDefault\(\);\s*setDialog\("search"\)/);
  assert.match(shell, /window\.removeEventListener\("keydown", onKeyDown\)/);
  assert.match(shell, /aria-keyshortcuts="Meta\+K Control\+K"/);
  assert.match(shell, />Ekran ara</);

  // The table in memory is the only source; no request per keystroke.
  assert.match(search, /searchAdminNavigation\(query\)/);
  assert.doesNotMatch(search, /fetch\(|useApiResource|await |from "@\/lib\/api/);
  // A labelled field that takes focus, links for answers, and an empty state.
  assert.match(search, /<span className="sr-only">Ekran ara<\/span>/);
  assert.match(search, /initialFocus=\{inputRef\}/);
  assert.match(search, /<Link\s+href=\{result\.destination\.href\}/);
  assert.match(search, /adında bir ekran yok/);
  assert.match(search, /role="status"/);
});

test("the way up is a fixed route from the table, never a history step", () => {
  const home = { href: ADMIN_HOME.href, label: "Ana Ekran" };
  // An app's landing screen goes up to the home.
  for (const app of ADMIN_APPS) assert.deepEqual(adminParentForPath(app.href), home, app.href);
  // A screen inside an app goes up to the app, by the app's name.
  assert.deepEqual(adminParentForPath("/admin/qr-codes"), { href: "/admin/tables", label: "Masalar" });
  assert.deepEqual(adminParentForPath("/admin/cash-reports"), { href: "/admin/cash-registers", label: "Kasa" });
  assert.deepEqual(adminParentForPath("/admin/menu-engineering"), { href: "/admin/reports", label: "Raporlar" });
  // Deeper still goes to the owner, not to the URL one segment up.
  assert.deepEqual(adminParentForPath("/admin/inventory/42"), { href: "/admin/erp", label: "Daha Fazla" });
  assert.deepEqual(adminParentForPath("/admin/tables/5/orders"), { href: "/admin/tables", label: "Masalar" });
  // The home has nothing above it; an unknown screen goes home.
  assert.equal(adminParentForPath("/admin/dashboard"), null);
  assert.deepEqual(adminParentForPath("/admin/nowhere"), home);

  // The shell draws it above every screen's content, so a page that mounts no
  // module window (the menu editor) still gets it, and it never asks history.
  assert.match(shell, /const parent = adminParentForPath\(pathname\)/);
  assert.match(shell, /<nav aria-label="Üst ekran"[^>]*>\s*<Link\s+href=\{parent\.href\}/);
  assert.doesNotMatch(shell, /router\.back|history\.back|useRouter/);
  const content = shell.slice(shell.indexOf('<main id="admin-content"'), shell.indexOf("</main>"));
  assert.ok(content.indexOf("max-w-[1600px]") < content.indexOf("parent.href"), "the way up sits inside the content column");
  assert.ok(content.indexOf("parent.href") < content.indexOf("{children}"), "the way up sits above the page");
  // Drawn once: the page surface no longer has its own copy.
  assert.doesNotMatch(moduleWindow, /adminParentForPath|parent\.href/);
  assert.equal((moduleWindow.match(/<h1 /g) ?? []).length, 1);
  assert.equal(adminParentForPath("/admin/menu")?.label, "Ana Ekran");
});

test("the account dialog names the person, keeps the way out and the real QR picker", () => {
  assert.match(profile, /const \{ name, role, restaurantName \} = useStaffSession\(\)/);
  assert.match(profile, /STAFF_ROLE_LABELS\[role\]/);
  assert.match(profile, /<LogoutButton\b/);
  // The picker is the existing one, opened by the shell, and only when it can work.
  assert.match(profile, /\{onOpenQrMenu \? \(/);
  assert.match(profile, /QR Menüyü Gör/);
  assert.doesNotMatch(profile, /\/menu\/demo-table|href=/);
  assert.match(shell, /<AdminProfileDialog \{\.\.\.dialogProps\("account"\)\} onOpenQrMenu=\{onOpenQrMenu\} \/>/);
  // The bar's account button says whose session it is.
  assert.match(shell, /aria-label=\{`Hesap, \$\{name\}`\}/);
});
