import {
  BadgeDollarSign,
  BookOpen,
  Boxes,
  CalendarClock,
  CalendarDays,
  ChartNoAxesCombined,
  ClipboardCheck,
  ClipboardList,
  CookingPot,
  Factory,
  Grid2X2,
  History,
  LayoutDashboard,
  PackageCheck,
  PackageOpen,
  PlugZap,
  Printer,
  QrCode,
  ReceiptText,
  Settings,
  ShoppingBag,
  Store,
  TrendingUp,
  Truck,
  UsersRound,
  Wallet,
  WalletCards,
  type LucideIcon,
} from "lucide-react";

/**
 * Where every admin screen lives, as one table.
 *
 * The panel used to answer that question inside the sidebar component, so the
 * only thing that could say which part of the restaurant a URL belongs to was
 * the thing drawing the left-hand column. This module is that answer on its
 * own: the home, the eight parts of the business, the screens inside each of
 * them, the advanced index, and the pure functions that turn a pathname back
 * into any of those. Nothing here renders, so a launcher, a title bar, a
 * command palette and the current sidebar can all read the same list and agree.
 *
 * A screen is listed in more than one place on purpose — the day-end report is
 * both a till screen and a report — but it belongs to exactly one app. That is
 * what `appId` is for, and it is the only thing route ownership is read from.
 */

/** The eight parts of the restaurant the panel is organised around. */
export type AdminAppId =
  | "tables"
  | "orders"
  | "menu"
  | "cash"
  | "staff"
  | "reports"
  | "settings"
  | "more";

/** Anything with a name, an icon and somewhere to go. */
export interface AdminNavTarget {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  readonly icon: LucideIcon;
  /** Other words someone might type looking for this. Never rendered. */
  readonly aliases?: readonly string[];
}

/** One screen, and the one app it belongs to however many places link it. */
export interface AdminDestination extends AdminNavTarget {
  readonly appId: AdminAppId;
}

export interface AdminApp extends AdminNavTarget {
  readonly id: AdminAppId;
  /**
   * Every route this app is the canonical owner of, its own href included.
   *
   * Ownership is exclusive: a route appears in exactly one app's list, even
   * where another app links it. Nested URLs below a listed route belong to the
   * same owner, so an item detail page needs no entry of its own.
   */
  readonly routes: readonly string[];
  readonly aliases: readonly string[];
  /** The screens the app lists on its own pages; absent when it is one screen. */
  readonly sections?: readonly AdminDestination[];
}

/** A heading and the screens under it, on the advanced index. */
export interface AdminNavGroup {
  readonly title: string;
  readonly items: readonly AdminDestination[];
}

/** One row the local search can return: a screen, and where it is listed. */
export interface AdminSearchEntry {
  readonly destination: AdminNavTarget;
  /** The heading this screen sits under, shown beside the result. */
  readonly section: string;
  /** Alternate words this row answers to beyond its own label. */
  readonly keywords: readonly string[];
}

/** The heading used for a screen that is a whole part of the panel by itself. */
const TOP_LEVEL_SECTION = "Yönetim";

/**
 * Home, which is not one of the apps.
 *
 * It answers "how is service going right now", which is the question every
 * other part of the panel is a follow-up to. A launcher lists the parts of the
 * business; this sits beside the launcher, never inside it.
 */
export const ADMIN_HOME: AdminNavTarget = {
  id: "home",
  label: "Genel Bakış",
  href: "/admin/dashboard",
  icon: LayoutDashboard,
  aliases: ["ana ekran", "bugün"],
};

const tablesApp: AdminApp = {
  id: "tables",
  label: "Masalar",
  href: "/admin/tables",
  icon: Grid2X2,
  routes: ["/admin/tables", "/admin/qr-codes", "/admin/reservations"],
  aliases: ["salon", "oturma"],
  sections: [
    { id: "table-plan", label: "Masa Planı", href: "/admin/tables", icon: Grid2X2, appId: "tables" },
    { id: "qr-codes", label: "QR Kodları", href: "/admin/qr-codes", icon: QrCode, appId: "tables", aliases: ["karekod"] },
    { id: "reservations", label: "Rezervasyonlar", href: "/admin/reservations", icon: CalendarDays, appId: "tables" },
  ],
};

const ordersApp: AdminApp = {
  id: "orders",
  label: "Siparişler",
  href: "/admin/orders",
  icon: ClipboardList,
  routes: ["/admin/orders", "/admin/fulfillment"],
  aliases: ["adisyon"],
  sections: [
    { id: "order-list", label: "Siparişler", href: "/admin/orders", icon: ClipboardList, appId: "orders" },
    { id: "delivery", label: "Paket ve Kurye", href: "/admin/fulfillment", icon: ShoppingBag, appId: "orders", aliases: ["kurye", "gel al"] },
  ],
};

const menuApp: AdminApp = {
  id: "menu",
  label: "Menü",
  href: "/admin/menu",
  icon: BookOpen,
  routes: ["/admin/menu"],
  aliases: ["yemek listesi", "kategori"],
};

const cashApp: AdminApp = {
  id: "cash",
  label: "Kasa",
  href: "/admin/cash-registers",
  icon: Wallet,
  routes: ["/admin/cash-registers", "/admin/cash-reports"],
  aliases: ["para", "tahsilat"],
  sections: [
    { id: "cash-registers", label: "Kasalar ve Vardiyalar", href: "/admin/cash-registers", icon: Wallet, appId: "cash" },
    { id: "cash-day-report", label: "Gün Sonu", href: "/admin/cash-reports", icon: ReceiptText, appId: "cash", aliases: ["z raporu"] },
  ],
};

const staffApp: AdminApp = {
  id: "staff",
  label: "Personel",
  href: "/admin/staff",
  icon: UsersRound,
  routes: ["/admin/staff", "/admin/schedules", "/admin/attendance", "/admin/payroll"],
  aliases: ["ekip", "kadro"],
  sections: [
    { id: "staff-list", label: "Çalışanlar", href: "/admin/staff", icon: UsersRound, appId: "staff" },
    { id: "schedules", label: "Vardiyalar", href: "/admin/schedules", icon: CalendarDays, appId: "staff", aliases: ["nöbet"] },
    { id: "attendance", label: "Puantaj", href: "/admin/attendance", icon: ClipboardCheck, appId: "staff", aliases: ["mesai", "devam"] },
    { id: "payroll", label: "Ücret Hesabı", href: "/admin/payroll", icon: ReceiptText, appId: "staff", aliases: ["maaş", "bordro"] },
  ],
};

/**
 * The day-end report is linked from here and owned by the till.
 *
 * A manager reading the reports expects the takings beside the sales, so the
 * row keeps the link. It is still one screen with one home: opening it lights
 * up the till, not the reports.
 */
const reportsApp: AdminApp = {
  id: "reports",
  label: "Raporlar",
  href: "/admin/reports",
  icon: ChartNoAxesCombined,
  routes: ["/admin/reports", "/admin/sales", "/admin/menu-engineering", "/admin/popular", "/admin/erp-reports"],
  aliases: ["analiz", "ciro"],
  sections: [
    { id: "reports-overview", label: "Genel", href: "/admin/reports", icon: ChartNoAxesCombined, appId: "reports" },
    { id: "sales", label: "Satış", href: "/admin/sales", icon: TrendingUp, appId: "reports", aliases: ["hasılat"] },
    { id: "menu-engineering", label: "Ürünler", href: "/admin/menu-engineering", icon: PackageCheck, appId: "reports" },
    { id: "popular", label: "Popüler", href: "/admin/popular", icon: PackageCheck, appId: "reports", aliases: ["çok satan"] },
    { id: "reports-cash", label: "Kasa", href: "/admin/cash-reports", icon: ReceiptText, appId: "cash" },
    { id: "erp-reports", label: "Gelişmiş", href: "/admin/erp-reports", icon: Factory, appId: "reports" },
  ],
};

/**
 * The advanced index is linked from here and owned by the back office.
 *
 * Stock, purchasing and the rest are not settings. The link stays because that
 * is where it has been, and where a manager currently goes looking for it.
 */
const settingsApp: AdminApp = {
  id: "settings",
  label: "Ayarlar",
  href: "/admin/settings",
  icon: Settings,
  routes: ["/admin/settings", "/admin/printers", "/admin/integrations"],
  aliases: ["yapılandırma"],
  sections: [
    { id: "business-settings", label: "İşletme", href: "/admin/settings", icon: Settings, appId: "settings" },
    { id: "printers", label: "Yazıcılar", href: "/admin/printers", icon: Printer, appId: "settings", aliases: ["fiş"] },
    { id: "integrations", label: "Entegrasyonlar", href: "/admin/integrations", icon: PlugZap, appId: "settings" },
    { id: "settings-advanced", label: "Gelişmiş", href: "/admin/erp", icon: Factory, appId: "more" },
  ],
};

/**
 * The back office: eighteen screens, none of them daily work.
 *
 * They are real work and nothing was deleted to move them here — the advanced
 * index renders them as its own page, and the search below finds every one of
 * them by name. What they are not is a row someone reads past on the way to
 * the order list.
 */
const moreApp: AdminApp = {
  id: "more",
  label: "Daha Fazla",
  href: "/admin/erp",
  icon: Factory,
  routes: [
    "/admin/erp",
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
  aliases: ["arka ofis", "işletme araçları"],
};

/**
 * The launcher, in the order it will offer them.
 *
 * Eight, and every one of them is somewhere a restaurant actually is: the
 * floor, the counter, the kitchen's list, the till, the people, the numbers,
 * the setup, and everything else.
 */
export const ADMIN_APPS: readonly AdminApp[] = [
  tablesApp,
  ordersApp,
  menuApp,
  cashApp,
  staffApp,
  reportsApp,
  settingsApp,
  moreApp,
];

/** The routes reached through the advanced index, gateway included. */
export const ADMIN_ADVANCED_ROUTES: readonly string[] = moreApp.routes;

/**
 * The advanced index, grouped the way a restaurant is rather than the way its
 * tables are named. One source: the index page renders this, and so does the
 * search.
 *
 * Two of the rows belong to an app above — a reservation is part of the table
 * plan, a courier order is part of the order list — and they stay listed here
 * because this is still the one page that shows the whole back office. Their
 * `appId` says where they actually live.
 */
export const ADMIN_ADVANCED_GROUPS: readonly AdminNavGroup[] = [
  {
    title: "Stok ve Üretim",
    items: [
      { id: "inventory", label: "Stok", href: "/admin/inventory", icon: Boxes, appId: "more" },
      { id: "stock-movements", label: "Stok Hareketleri", href: "/admin/stock-movements", icon: History, appId: "more" },
      { id: "stock-counts", label: "Sayım Farkları", href: "/admin/stock-counts", icon: ClipboardCheck, appId: "more" },
      { id: "warehouses", label: "Depolar", href: "/admin/warehouses", icon: Store, appId: "more" },
      { id: "recipes", label: "Reçeteler", href: "/admin/recipes", icon: CookingPot, appId: "more" },
      { id: "costing", label: "Maliyet Hesabı", href: "/admin/costing", icon: BadgeDollarSign, appId: "more" },
      { id: "production", label: "Üretim", href: "/admin/production", icon: Factory, appId: "more" },
      { id: "waste", label: "Fire", href: "/admin/waste", icon: PackageOpen, appId: "more" },
      { id: "forecast", label: "Üretim Tahmini", href: "/admin/forecast", icon: CalendarClock, appId: "more" },
    ],
  },
  {
    title: "Satın Alma",
    items: [
      { id: "suppliers", label: "Tedarikçiler", href: "/admin/suppliers", icon: Truck, appId: "more" },
      { id: "purchasing", label: "Satın Alma", href: "/admin/purchasing", icon: ClipboardList, appId: "more" },
      { id: "payables", label: "Borçlar", href: "/admin/payables", icon: WalletCards, appId: "more" },
      { id: "price-history", label: "Alış Fiyat Geçmişi", href: "/admin/price-history", icon: TrendingUp, appId: "more" },
    ],
  },
  {
    title: "Misafir ve Rezervasyon",
    items: [
      { id: "advanced-reservations", label: "Rezervasyon", href: "/admin/reservations", icon: CalendarDays, appId: "tables" },
      { id: "advanced-delivery", label: "Paket ve Kurye", href: "/admin/fulfillment", icon: ShoppingBag, appId: "orders" },
      { id: "customers", label: "Müşteriler", href: "/admin/customers", icon: UsersRound, appId: "more" },
      { id: "feedback", label: "Geri Bildirim", href: "/admin/feedback", icon: BookOpen, appId: "more" },
      { id: "loyalty", label: "Sadakat", href: "/admin/loyalty", icon: Wallet, appId: "more" },
    ],
  },
  {
    // Read-only, and the last thing anyone needs on a normal day — but the
    // first thing they need when something looks wrong.
    title: "Sistem",
    items: [
      { id: "activity-log", label: "İşlem Geçmişi", href: "/admin/audit", icon: History, appId: "more" },
    ],
  },
];

/**
 * The full name of a screen, for the places with no heading to lean on.
 *
 * A row inside an app can call a screen Ürünler or Gelişmiş, because the row
 * already said Raporlar or Ayarlar. A title bar and a search field have
 * nothing written above them, so they use the whole name. These come first so
 * theirs is the name that wins where a screen is listed twice.
 */
export const ADMIN_FULL_NAME_DESTINATIONS: readonly AdminDestination[] = [
  { id: "more-index", label: "Gelişmiş İşletme Araçları", href: "/admin/erp", icon: Factory, appId: "more", aliases: ["arka ofis"] },
  { id: "menu-engineering-full", label: "Ürün Satış Analizi", href: "/admin/menu-engineering", icon: PackageCheck, appId: "reports" },
  { id: "popular-full", label: "Popüler Ürünler", href: "/admin/popular", icon: PackageCheck, appId: "reports" },
  { id: "erp-reports-full", label: "İşletme Raporları", href: "/admin/erp-reports", icon: ChartNoAxesCombined, appId: "reports" },
];

/**
 * The seven apps the shell still draws as sidebar rows, in its current order.
 *
 * N1 moves the table out of the shell and changes nothing on screen, so the
 * order the rows are listed in, and the order two matching screens are offered
 * in, are still the ones they were. The launcher order above is what the next
 * phase builds on; this is what today renders.
 */
export const ADMIN_SHELL_ROW_APPS: readonly AdminApp[] = [
  ordersApp,
  menuApp,
  tablesApp,
  staffApp,
  cashApp,
  reportsApp,
  settingsApp,
];

/** How many results the local search will ever return. */
export const ADMIN_SEARCH_LIMIT = 8;

/**
 * An app's own name and aliases belong to its landing screen, not to every
 * screen in it. The name matters where the landing row is shown under a
 * fuller one — the back office is listed as Gelişmiş İşletme Araçları, and
 * still answers to Daha Fazla.
 */
function entry(destination: AdminNavTarget, section: string, app?: AdminApp): AdminSearchEntry {
  const inherited = app && destination.href === app.href ? [app.label, ...app.aliases] : [];
  return { destination, section, keywords: [...(destination.aliases ?? []), ...inherited] };
}

/**
 * Every destination the panel has, once each, section name included.
 *
 * An app's landing screen also answers to the app's name and aliases, so someone
 * looking for the floor finds the table plan whichever word they reach for.
 * Screens linked from two apps are reduced to one row before anything renders
 * them: two entries with the same href would be two results saying the same
 * thing under the same React key.
 *
 * ponytail: a linear scan over ~40 module-scope entries. If this ever grows
 * past a few hundred, build a Map.
 */
export const ADMIN_SEARCHABLE: readonly AdminSearchEntry[] = [
  ...ADMIN_FULL_NAME_DESTINATIONS.map((destination) =>
    entry(destination, TOP_LEVEL_SECTION, appById(destination.appId)),
  ),
  entry(ADMIN_HOME, TOP_LEVEL_SECTION),
  ...ADMIN_SHELL_ROW_APPS.flatMap((app) =>
    app.sections ? app.sections.map((section) => entry(section, app.label, app)) : [entry(app, TOP_LEVEL_SECTION, app)],
  ),
  ...ADMIN_ADVANCED_GROUPS.flatMap((group) =>
    group.items.map((item) => entry(item, group.title, appById(item.appId))),
  ),
].filter((row, index, all) => all.findIndex((other) => other.destination.href === row.destination.href) === index);

function appById(id: AdminAppId): AdminApp {
  const app = ADMIN_APPS.find((candidate) => candidate.id === id);
  if (!app) throw new Error(`Unknown admin app: ${id}`);
  return app;
}

/**
 * What a title bar calls a screen, since the page's own heading is below it.
 *
 * An app's landing screen is named by the app: the row on the reports screen
 * reads Genel because Raporlar is written above it, and a title bar has
 * nothing written above it at all. The advanced index keeps its full name,
 * because nothing announces it either.
 */
export const ADMIN_TITLE_BY_PATH: Readonly<Record<string, string>> = {
  ...Object.fromEntries(ADMIN_SEARCHABLE.map((row) => [row.destination.href, row.destination.label])),
  ...Object.fromEntries([ADMIN_HOME, ...ADMIN_SHELL_ROW_APPS].map((target) => [target.href, target.label])),
};

/** Longest first, so a child URL is never named by its parent's row. */
const TITLES_BY_DEPTH: readonly (readonly [string, string])[] = Object.entries(ADMIN_TITLE_BY_PATH).sort(
  ([left], [right]) => right.length - left.length,
);

/**
 * A route, or a route below it — and nothing that merely starts with its text.
 *
 * The menu editor and the product sales report are different screens, as are
 * the reports index and the advanced reports, and the till and the day-end
 * report. A bare startsWith lights two rows at once on half this menu, so the
 * separator is required.
 */
export function isAdminRouteMatch(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The one app a pathname belongs to, nested URLs included.
 *
 * Ownership is a property of the route table rather than of whatever happens
 * to link the screen, so a path has one answer here no matter how many rows
 * point at it.
 */
export function adminAppForPath(pathname: string): AdminApp | undefined {
  return ADMIN_APPS.find((app) => app.routes.some((route) => isAdminRouteMatch(pathname, route)));
}

/** The most specific listed screen a pathname is on, or below. */
export function adminDestinationForPath(pathname: string): AdminNavTarget | undefined {
  let best: AdminNavTarget | undefined;
  for (const row of ADMIN_SEARCHABLE) {
    if (!isAdminRouteMatch(pathname, row.destination.href)) continue;
    if (!best || row.destination.href.length > best.href.length) best = row.destination;
  }
  return best;
}

/** What the home is called where it is somewhere to go back to, not a page title. */
export const ADMIN_HOME_LABEL = "Ana Ekran";

/**
 * Where "up" leads from a screen: its app's landing screen, or the home from a
 * landing screen. Read from the route table and never from history, so a deep
 * link, a refresh and a shared URL all get the same answer. The home itself
 * has nowhere above it.
 */
export function adminParentForPath(pathname: string): { readonly href: string; readonly label: string } | null {
  if (isAdminRouteMatch(pathname, ADMIN_HOME.href)) return null;
  const app = adminAppForPath(pathname);
  if (!app || pathname === app.href) return { href: ADMIN_HOME.href, label: ADMIN_HOME_LABEL };
  return { href: app.href, label: app.label };
}

export function adminTitleForPath(pathname: string, fallback = "Yönetim"): string {
  return TITLES_BY_DEPTH.find(([href]) => isAdminRouteMatch(pathname, href))?.[1] ?? fallback;
}

/**
 * Whether a link inside an app's own row is the page being read.
 *
 * The back-office screens are the one case where the answer is not the path:
 * they are reached through the gateway, have no row of their own, and would
 * leave the row with nothing marked — so the gateway carries the mark for
 * them, and it stays one visible step away from wherever you ended up.
 */
export function isAdminSectionCurrent(pathname: string, href: string): boolean {
  if (isAdminRouteMatch(pathname, href)) return true;
  return href === moreApp.href && adminAppForPath(pathname)?.id === "more";
}

/**
 * Finding a screen without knowing which app owns it.
 *
 * This reads the table above and nothing else. No request is made, so typing
 * costs nothing and there is no query to bound. It is also how the eighteen
 * back-office screens stay one search away after leaving the sidebar: it
 * answers where is fire girişi, not which product is called fire.
 *
 * Names are matched first and alternate words second, so a search that had an
 * answer before aliases existed still gets the same answers in the same order.
 */
export function searchAdminNavigation(query: string): readonly AdminSearchEntry[] {
  const needle = query.trim().toLocaleLowerCase("tr");
  if (needle.length < 2) return [];
  const byName: AdminSearchEntry[] = [];
  const byAlias: AdminSearchEntry[] = [];
  for (const row of ADMIN_SEARCHABLE) {
    if (`${row.destination.label} ${row.section}`.toLocaleLowerCase("tr").includes(needle)) byName.push(row);
    else if (row.keywords.some((word) => word.toLocaleLowerCase("tr").includes(needle))) byAlias.push(row);
  }
  return [...byName, ...byAlias].slice(0, ADMIN_SEARCH_LIMIT);
}
