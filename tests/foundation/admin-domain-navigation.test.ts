import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  ADMIN_ADVANCED_GROUPS,
  ADMIN_ADVANCED_ROUTES,
  ADMIN_APPS,
  ADMIN_FULL_NAME_DESTINATIONS,
  ADMIN_HOME,
  ADMIN_SEARCHABLE,
  ADMIN_SEARCH_LIMIT,
  ADMIN_SHELL_ROW_APPS,
  adminAppForPath,
  adminDestinationForPath,
  adminTitleForPath,
  isAdminRouteMatch,
  isAdminSectionCurrent,
  searchAdminNavigation,
  type AdminAppId,
} from "../../components/admin/admin-navigation";
import { ERP_SECTIONS } from "../../components/admin/admin-shell";

/**
 * The sidebar is the business, not the sitemap.
 *
 * It carried nine rows, six of which had to be unfolded before they could be
 * read — so finding a screen meant navigating the menu before navigating the
 * app, and a section could hide the page you were already on. It is eight
 * links now, one per part of a restaurant, and the screens inside a part are
 * listed on the part's own pages as real routes.
 *
 * The table those links are drawn from left the sidebar component and became
 * `components/admin/admin-navigation.ts`, so the answer to "which part of the
 * restaurant does this URL belong to" no longer depends on the thing drawing
 * the left-hand column. Most of what follows is asked of that module directly;
 * what is still read from the shell source is the shape of the column itself,
 * which is a set of Tailwind classes in one file and where a regression is a
 * wrong constant rather than a wrong render.
 */

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const shell = read("components/admin/admin-shell.tsx");

/** Every admin route that exists on disk, redirect-only URLs excluded. */
const REDIRECT_ONLY = new Set(["/admin/categories", "/admin/products"]);

function routesOnDisk(): readonly string[] {
  return readdirSync(new URL("../../app/admin/", import.meta.url), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `/admin/${entry.name}`)
    .filter((route) => !REDIRECT_ONLY.has(route));
}

function pagesOf(id: AdminAppId): readonly { label: string; href: string }[] {
  const app = ADMIN_APPS.find((candidate) => candidate.id === id);
  assert.ok(app, `${id} is missing from the launcher`);
  return (app.sections ?? []).map((section) => ({ label: section.label, href: section.href }));
}

/* ------------------------------------------------ the central model ------ */

test("home is one destination, and the launcher is exactly eight apps", () => {
  // The home answers how service is going right now, which is the question the
  // other eight are follow-ups to. It is beside the launcher, never in it.
  assert.equal(ADMIN_HOME.href, "/admin/dashboard");
  assert.equal(ADMIN_HOME.label, "Genel Bakış");
  assert.equal(ADMIN_APPS.length, 8);
  assert.ok(
    !ADMIN_APPS.some((app) => app.href === ADMIN_HOME.href),
    "the home became one of the apps",
  );
});

test("the eight apps keep their order, their words and their landing screens", () => {
  assert.deepEqual(
    ADMIN_APPS.map((app) => ({ id: app.id, label: app.label, href: app.href })),
    [
      { id: "tables", label: "Masalar", href: "/admin/tables" },
      { id: "orders", label: "Siparişler", href: "/admin/orders" },
      { id: "menu", label: "Menü", href: "/admin/menu" },
      { id: "cash", label: "Kasa", href: "/admin/cash-registers" },
      { id: "staff", label: "Personel", href: "/admin/staff" },
      { id: "reports", label: "Raporlar", href: "/admin/reports" },
      { id: "settings", label: "Ayarlar", href: "/admin/settings" },
      { id: "more", label: "Daha Fazla", href: "/admin/erp" },
    ],
  );
  // An app that cannot draw itself cannot appear in an icon launcher or on the
  // tablet rail, which is the one way this layout could lose a destination.
  for (const app of ADMIN_APPS) assert.equal(typeof app.icon, "object", `${app.id} has no icon`);
});

test("every admin screen on disk has exactly one owner", () => {
  // The home owns itself: it is a destination beside the launcher, not in it.
  const owned = new Map<string, (AdminAppId | "home")[]>([[ADMIN_HOME.href, ["home"]]]);
  for (const app of ADMIN_APPS) {
    for (const route of app.routes) owned.set(route, [...(owned.get(route) ?? []), app.id]);
  }

  const ambiguous = [...owned].filter(([, owners]) => owners.length > 1);
  assert.deepEqual(ambiguous, [], "a route is claimed by more than one app");

  const orphans = routesOnDisk().filter((route) => !owned.has(route));
  assert.deepEqual(orphans, [], `these screens belong to no app: ${orphans.join(", ")}`);

  const invented = [...owned.keys()].filter((route) => !routesOnDisk().includes(route));
  assert.deepEqual(invented, [], "an app owns a route that does not exist");

  // And the two compatibility URLs stay out of it: they forward into the menu
  // editor rather than being screens of their own.
  for (const redirect of REDIRECT_ONLY) assert.ok(!owned.has(redirect), `${redirect} became a destination`);
});

test("a screen linked from two places still has one home", () => {
  // The day-end report is on the reports row and on the till row. It is a till
  // screen; the reports row is a convenience.
  assert.equal(adminAppForPath("/admin/cash-reports")?.id, "cash");
  assert.ok(
    pagesOf("reports").some((page) => page.href === "/admin/cash-reports"),
    "the reports row stopped linking the day-end report",
  );

  // The advanced index is linked from the settings row and owned by the back
  // office, which is not a setting.
  assert.equal(adminAppForPath("/admin/erp")?.id, "more");
  assert.ok(
    pagesOf("settings").some((page) => page.href === "/admin/erp"),
    "the settings row stopped linking the advanced index",
  );

  // A reservation belongs to the table plan and a courier order to the order
  // list, however long the advanced index goes on listing them.
  const advanced = ADMIN_ADVANCED_GROUPS.flatMap((group) => group.items.map((item) => item.href));
  assert.ok(advanced.includes("/admin/reservations"));
  assert.ok(advanced.includes("/admin/fulfillment"));
  assert.equal(adminAppForPath("/admin/reservations")?.id, "tables");
  assert.equal(adminAppForPath("/admin/fulfillment")?.id, "orders");

  // Every screen the advanced index lists has an owner, and the two above are
  // the only ones the back office does not own.
  for (const href of advanced) assert.ok(adminAppForPath(href), `${href} is listed and owned by nobody`);
  const notMore = advanced.filter((href) => adminAppForPath(href)?.id !== "more");
  assert.deepEqual(notMore, ["/admin/reservations", "/admin/fulfillment"]);
});

test("a prefix is not a parent, on any of the three pairs that collide", () => {
  // The menu editor and the product sales report are different screens, as are
  // the reports index and the advanced reports, and the till and the day-end
  // report. A bare startsWith lights two rows at once on half this menu.
  for (const [pathname, href] of [
    ["/admin/menu-engineering", "/admin/menu"],
    ["/admin/erp-reports", "/admin/reports"],
    ["/admin/cash-reports", "/admin/cash-registers"],
  ] as const) {
    assert.equal(isAdminRouteMatch(pathname, href), false, `${pathname} matched ${href}`);
  }
  assert.equal(adminAppForPath("/admin/menu-engineering")?.id, "reports");
  assert.equal(adminAppForPath("/admin/menu")?.id, "menu");
  assert.equal(adminAppForPath("/admin/erp-reports")?.id, "reports");
  assert.equal(adminAppForPath("/admin/reports")?.id, "reports");
  assert.equal(adminAppForPath("/admin/cash-reports")?.id, "cash");
  assert.equal(adminAppForPath("/admin/cash-registers")?.id, "cash");

  // A real child still is one.
  assert.equal(isAdminRouteMatch("/admin/menu/123", "/admin/menu"), true);
  assert.equal(isAdminRouteMatch("/admin/menu", "/admin/menu"), true);
});

test("a screen below a screen belongs to the same app and says the same name", () => {
  assert.equal(adminAppForPath("/admin/inventory/42")?.id, "more");
  assert.equal(adminTitleForPath("/admin/inventory/42"), "Stok");
  assert.equal(adminDestinationForPath("/admin/inventory/42")?.href, "/admin/inventory");

  assert.equal(adminAppForPath("/admin/tables/5/orders")?.id, "tables");
  assert.equal(adminTitleForPath("/admin/tables/5/orders"), "Masalar");

  assert.equal(adminAppForPath("/admin/cash-reports/2026-09-10")?.id, "cash");
  assert.equal(adminTitleForPath("/admin/cash-reports/2026-09-10"), "Gün Sonu");

  // A path outside the table is named, not left blank.
  assert.equal(adminTitleForPath("/admin/nowhere"), "Yönetim");
  assert.equal(adminAppForPath("/admin/nowhere"), undefined);
});

test("an app's own row names its landing screen, and the back office keeps its full name", () => {
  // A row inside Raporlar can be called Genel because Raporlar is written
  // above it; a title bar has nothing written above it at all.
  assert.equal(adminTitleForPath("/admin/reports"), "Raporlar");
  assert.equal(adminTitleForPath("/admin/settings"), "Ayarlar");
  assert.equal(adminTitleForPath("/admin/tables"), "Masalar");
  assert.equal(adminTitleForPath("/admin/erp"), "Gelişmiş İşletme Araçları");
  assert.equal(adminTitleForPath("/admin/menu-engineering"), "Ürün Satış Analizi");
  assert.equal(adminTitleForPath("/admin/popular"), "Popüler Ürünler");
  assert.equal(adminTitleForPath("/admin/erp-reports"), "İşletme Raporları");
  assert.equal(
    ADMIN_FULL_NAME_DESTINATIONS.map((destination) => destination.href).length,
    new Set(ADMIN_FULL_NAME_DESTINATIONS.map((destination) => destination.href)).size,
  );
});

test("the advanced gateway carries the mark for the screens reached through it", () => {
  // They have no row of their own, so without this the settings row would show
  // nothing selected while you are down there, and the index would stop being
  // one visible step away from wherever you ended up.
  assert.equal(isAdminSectionCurrent("/admin/inventory", "/admin/erp"), true);
  assert.equal(isAdminSectionCurrent("/admin/audit", "/admin/erp"), true);
  assert.equal(isAdminSectionCurrent("/admin/erp", "/admin/erp"), true);
  // And not for the two the index lists on behalf of an app above.
  assert.equal(isAdminSectionCurrent("/admin/reservations", "/admin/erp"), false);
  assert.equal(isAdminSectionCurrent("/admin/fulfillment", "/admin/erp"), false);
  // Every other link answers with its own path and nothing else.
  assert.equal(isAdminSectionCurrent("/admin/inventory", "/admin/settings"), false);
  assert.equal(isAdminSectionCurrent("/admin/settings/theme", "/admin/settings"), true);

  assert.equal(ADMIN_ADVANCED_ROUTES[0], "/admin/erp");
  assert.equal(ADMIN_ADVANCED_ROUTES.length, 18);
});

/* ------------------------------------------------ the local search ------- */

test("search reads the menu in memory, in Turkish, and never the network", () => {
  const source = read("components/admin/admin-navigation.ts");
  const search = source.slice(source.indexOf("export function searchAdminNavigation("));
  assert.doesNotMatch(search, /fetch\(|useApiResource|await /, "navigation search must not hit the network");
  assert.match(search, /toLocaleLowerCase\("tr"\)/, "Turkish casing, so 'İ' and 'ı' match as a Turkish speaker expects");

  // Turkish casing, both ways round: the dotted capital of a Turkish 'i' is
  // 'İ', and the lower case of 'I' is 'ı'. A default lower-casing gets both
  // wrong and the search silently stops finding the screens named with them.
  assert.ok(searchAdminNavigation("İŞLETME").some((row) => row.destination.href === "/admin/settings"));
  assert.ok(searchAdminNavigation("işletme").some((row) => row.destination.href === "/admin/settings"));
  assert.ok(searchAdminNavigation("ücret").some((row) => row.destination.href === "/admin/payroll"));

  // One character is every screen; two is a question.
  assert.deepEqual(searchAdminNavigation("s"), []);
  assert.deepEqual(searchAdminNavigation("   "), []);
});

test("search answers to the words people actually type, not only to labels", () => {
  const hrefsFor = (query: string) => searchAdminNavigation(query).map((row) => row.destination.href);
  assert.ok(hrefsFor("bordro").includes("/admin/payroll"), "nobody looks for Ücret Hesabı by that name");
  assert.ok(hrefsFor("karekod").includes("/admin/qr-codes"));
  assert.ok(hrefsFor("adisyon").includes("/admin/orders"));
  assert.ok(hrefsFor("mesai").includes("/admin/attendance"));
  assert.ok(hrefsFor("arka ofis").includes("/admin/erp"));

  // A name still outranks an alternate word, so a search that had an answer
  // before aliases existed gets the same answer first.
  const byName = searchAdminNavigation("kasa");
  assert.equal(byName[0]?.destination.href, "/admin/cash-registers");
});

test("every app is found by the name the launcher shows it under", () => {
  // The launcher will print these eight words, so each has to lead back to its
  // app — including where the landing row is listed under a fuller name.
  for (const app of ADMIN_APPS) {
    const hrefs = searchAdminNavigation(app.label).map((row) => row.destination.href);
    assert.ok(hrefs.includes(app.href), `"${app.label}" does not find ${app.href}`);
  }
});

test("search is bounded, and never offers the same screen twice", () => {
  for (const query of ["a", "ar", "e", "er", "ra", "la", "sa", "st"]) {
    const results = searchAdminNavigation(query);
    assert.ok(results.length <= ADMIN_SEARCH_LIMIT, `"${query}" returned ${results.length} rows`);
    const hrefs = results.map((row) => row.destination.href);
    assert.equal(hrefs.length, new Set(hrefs).size, `"${query}" offered one screen twice`);
  }
  assert.equal(ADMIN_SEARCH_LIMIT, 8);

  // The table it searches is deduplicated once, at module scope, rather than
  // per keystroke: two rows with the same href would be two results saying the
  // same thing under the same React key.
  const hrefs = ADMIN_SEARCHABLE.map((row) => row.destination.href);
  assert.equal(hrefs.length, new Set(hrefs).size);
});

test("the order two matching screens are offered in did not move", () => {
  // Results come out in table order, so the table order is the answer order.
  // N1 moved this list out of the sidebar and must not have reshuffled it:
  // the full names first, so theirs is the name that wins where a screen is
  // listed twice, then the home, then the rows the column draws, then the
  // back office.
  assert.deepEqual(
    ADMIN_SEARCHABLE.map((row) => row.destination.href),
    [
      "/admin/erp",
      "/admin/menu-engineering",
      "/admin/popular",
      "/admin/erp-reports",
      "/admin/dashboard",
      "/admin/orders",
      "/admin/fulfillment",
      "/admin/menu",
      "/admin/tables",
      "/admin/qr-codes",
      "/admin/reservations",
      "/admin/staff",
      "/admin/schedules",
      "/admin/attendance",
      "/admin/payroll",
      "/admin/cash-registers",
      "/admin/cash-reports",
      "/admin/reports",
      "/admin/sales",
      "/admin/settings",
      "/admin/printers",
      "/admin/integrations",
      "/admin/inventory",
      "/admin/stock-movements",
      "/admin/stock-counts",
      "/admin/warehouses",
      "/admin/recipes",
      "/admin/costing",
      "/admin/production",
      "/admin/waste",
      "/admin/forecast",
      "/admin/suppliers",
      "/admin/purchasing",
      "/admin/payables",
      "/admin/price-history",
      "/admin/customers",
      "/admin/feedback",
      "/admin/loyalty",
      "/admin/audit",
    ],
  );

  // The section shown beside a result is the row the screen is listed under,
  // and the four full names have no row above them at all.
  const sectionOf = (href: string) =>
    ADMIN_SEARCHABLE.find((row) => row.destination.href === href)?.section;
  assert.equal(sectionOf("/admin/erp"), "Yönetim");
  assert.equal(sectionOf("/admin/qr-codes"), "Masalar");
  assert.equal(sectionOf("/admin/cash-reports"), "Kasa");
  assert.equal(sectionOf("/admin/audit"), "Sistem");
});

test("every screen is one search away, whichever app owns it", () => {
  const searchable = new Set(ADMIN_SEARCHABLE.map((row) => row.destination.href));
  for (const route of routesOnDisk()) {
    assert.ok(searchable.has(route), `${route} cannot be found by name`);
  }
  // Including the eighteen that left the sidebar.
  for (const href of ADMIN_ADVANCED_ROUTES) assert.ok(searchable.has(href), `${href} left the search`);
});

/* ------------------------------------------------ the current shell ------ */

test("the eight rows the search is ordered by did not move, and no column draws them", () => {
  assert.deepEqual(
    [ADMIN_HOME, ...ADMIN_SHELL_ROW_APPS].map((row) => ({ label: row.label, href: row.href })),
    [
      { label: "Genel Bakış", href: "/admin/dashboard" },
      { label: "Siparişler", href: "/admin/orders" },
      { label: "Menü", href: "/admin/menu" },
      { label: "Masalar", href: "/admin/tables" },
      { label: "Personel", href: "/admin/staff" },
      { label: "Kasa", href: "/admin/cash-registers" },
      { label: "Raporlar", href: "/admin/reports" },
      { label: "Ayarlar", href: "/admin/settings" },
    ],
  );
  // The sidebar that drew them is gone; the switcher reads the launcher order
  // from the table, and the shell restates no route of its own.
  assert.doesNotMatch(shell, /NAV_SECTIONS|ADMIN_SHELL_ROW_APPS/);
  assert.doesNotMatch(shell, /href: "\/admin\//, "the route table came back into the shell");
});

test("no sidebar row is a disclosure, and nothing nests under one", () => {
  // The row is a link. There is no button that opens a list of links, no
  // expanded state to remember, and no chevron rotating in the column.
  assert.doesNotMatch(shell, /function NavGroup/, "the nested sidebar section came back");
  assert.doesNotMatch(shell, /items:/, "a sidebar row holds a list again");
  assert.doesNotMatch(shell, /aria-expanded/, "something in the shell unfolds instead of navigating");

  // Every row carries an href, because the rail draws the same eight rows as
  // icons and an icon that opens a menu says nothing about where it goes.
  const rows = [ADMIN_HOME, ...ADMIN_SHELL_ROW_APPS];
  assert.equal(rows.length, 8);
  for (const row of rows) assert.match(row.href, /^\/admin\//);
});

test("each domain lists its own screens as routes, not as tabs", () => {
  assert.deepEqual(pagesOf("orders"), [
    { label: "Siparişler", href: "/admin/orders" },
    { label: "Paket ve Kurye", href: "/admin/fulfillment" },
  ]);
  assert.deepEqual(pagesOf("tables"), [
    { label: "Masa Planı", href: "/admin/tables" },
    { label: "QR Kodları", href: "/admin/qr-codes" },
    { label: "Rezervasyonlar", href: "/admin/reservations" },
  ]);
  assert.deepEqual(pagesOf("staff"), [
    { label: "Çalışanlar", href: "/admin/staff" },
    { label: "Vardiyalar", href: "/admin/schedules" },
    { label: "Puantaj", href: "/admin/attendance" },
    { label: "Ücret Hesabı", href: "/admin/payroll" },
  ]);
  assert.deepEqual(pagesOf("cash"), [
    { label: "Kasalar ve Vardiyalar", href: "/admin/cash-registers" },
    { label: "Gün Sonu", href: "/admin/cash-reports" },
  ]);
  assert.deepEqual(pagesOf("reports"), [
    { label: "Genel", href: "/admin/reports" },
    { label: "Satış", href: "/admin/sales" },
    { label: "Ürünler", href: "/admin/menu-engineering" },
    { label: "Popüler", href: "/admin/popular" },
    { label: "Kasa", href: "/admin/cash-reports" },
    { label: "Gelişmiş", href: "/admin/erp-reports" },
  ]);
  assert.deepEqual(pagesOf("settings"), [
    { label: "İşletme", href: "/admin/settings" },
    { label: "Yazıcılar", href: "/admin/printers" },
    { label: "Entegrasyonlar", href: "/admin/integrations" },
    { label: "Gelişmiş", href: "/admin/erp" },
  ]);
  // One screen, so no row of one.
  assert.equal(pagesOf("menu").length, 0);

  // The table keeps them; the shell no longer draws them as a row above every
  // page. Nothing in it can be a tab strip either, because nothing is drawn.
  assert.doesNotMatch(shell, /DomainNav|isAdminSectionCurrent|role="tab/, "the automatic domain row came back");
});

test("the shell asks the shared path question and keeps no matcher of its own", () => {
  // The boundary-aware matcher is the shared one; the shell no longer keeps a
  // second copy that could drift from it.
  assert.match(
    read("components/admin/admin-navigation.ts"),
    /pathname === href \|\| pathname\.startsWith\(`\$\{href\}\/`\)/,
  );
  assert.doesNotMatch(shell, /function isActivePath\(|function domainFor\(/, "the shell grew a second path matcher");
  assert.match(shell, /isAdminRouteMatch\(pathname, ADMIN_HOME\.href\)/);
});

test("every admin route reachable before this change is still reachable", () => {
  const linked = new Set([
    ADMIN_HOME.href,
    ...ADMIN_SEARCHABLE.map((row) => row.destination.href),
    ...ERP_SECTIONS.flatMap((section) => section.items.map((item) => item.href)),
  ]);

  const orphans = routesOnDisk().filter((route) => !linked.has(route));
  assert.deepEqual(orphans, [], `these screens have no link anywhere: ${orphans.join(", ")}`);

  // The advanced index is still one list with one source, and the shell still
  // re-exports it for the page that renders it.
  assert.equal(ERP_SECTIONS, ADMIN_ADVANCED_GROUPS);
  assert.deepEqual(
    ERP_SECTIONS.map((section) => section.title),
    ["Stok ve Üretim", "Satın Alma", "Misafir ve Rezervasyon", "Sistem"],
  );
});

test("the panel keeps one warm accent, and spends it in the same places", () => {
  const css = read("app/globals.css");
  const tokens = css.slice(css.indexOf("[data-admin-shell] {"), css.indexOf("[data-admin-shell] table"));

  // The sidebar is a quieter plane than the content, not a black column beside
  // it: its ground sits between the page ground and the card.
  assert.match(tokens, /--sidebar: #F1ECE5;/);
  assert.match(tokens, /--sidebar-foreground: #2A2420;/);
  // One accent, used for the selected segment, the current domain link, the
  // active sidebar row and the brand mark — and nowhere else.
  assert.match(tokens, /--accent-foreground: #7A4038;/);
  assert.match(tokens, /--sidebar-primary: #7A4038;/);
  // Statuses are meaning, not decoration, and this pass did not touch them.
  assert.match(tokens, /--status-success: #2E7D4F;/);
  assert.match(tokens, /--status-warning: #B4791A;/);
  assert.match(tokens, /--status-danger: #C0392B;/);
  assert.match(tokens, /--status-info: #3B6FB5;/);

  // Scoped to the panel: the guest menu is warm cream on purpose and none of
  // this may reach it.
  for (const token of ["--sidebar: #F1ECE5", "--accent-foreground: #7A4038"]) {
    const occurrences = css.split(token).length - 1;
    assert.equal(occurrences, 1, `${token} is declared outside the admin scope`);
  }
});
