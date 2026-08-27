"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BadgeDollarSign,
  BookOpen,
  Boxes,
  CalendarClock,
  CalendarDays,
  ChartNoAxesCombined,
  ChevronDown,
  ClipboardCheck,
  ClipboardList,
  CookingPot,
  Factory,
  Grid2X2,
  History,
  LayoutDashboard,
  Menu,
  PackageCheck,
  PackageOpen,
  PlugZap,
  Printer,
  QrCode,
  Search,
  ReceiptText,
  ShoppingBag,
  TrendingUp,
  Truck,
  Settings,
  Store,
  UsersRound,
  Wallet,
  WalletCards,
  X,
  type LucideIcon,
} from "lucide-react";
import { BrandMark } from "@/components/shared/brand-mark";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { getInitials } from "@/lib/format";
import { LogoutButton } from "@/components/staff/logout-button";
import { useStaffSession } from "@/components/staff/staff-session-provider";
import { STAFF_ROLE_LABELS } from "@/lib/domain/display";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

const menuNav: NavItem[] = [
  { label: "Menü Genel Bakış", href: "/admin/menu", icon: BookOpen },
  { label: "Kategoriler", href: "/admin/categories", icon: Boxes },
  { label: "Ürünler", href: "/admin/products", icon: PackageOpen },
];

const tableNav: NavItem[] = [
  { label: "Masa Planı", href: "/admin/tables", icon: Grid2X2 },
  { label: "QR Kodlar", href: "/admin/qr-codes", icon: QrCode },
];

const peopleNav: NavItem[] = [
  { label: "Personel Listesi", href: "/admin/staff", icon: UsersRound },
  { label: "Puantaj", href: "/admin/attendance", icon: ClipboardCheck },
  { label: "Vardiya Planı", href: "/admin/schedules", icon: CalendarDays },
  { label: "Bordro", href: "/admin/payroll", icon: ReceiptText },
];

const cashNav: NavItem[] = [
  { label: "Kasa ve Vardiyalar", href: "/admin/cash-registers", icon: Wallet },
  { label: "Gün Sonu Kasa", href: "/admin/cash-reports", icon: ReceiptText },
];

const reportsNav: NavItem[] = [
  { label: "Genel Raporlar", href: "/admin/reports", icon: ChartNoAxesCombined },
  { label: "Satış Raporu", href: "/admin/sales", icon: TrendingUp },
  { label: "Menü Mühendisliği", href: "/admin/menu-engineering", icon: ChartNoAxesCombined },
  { label: "Popüler Ürünler", href: "/admin/popular", icon: PackageCheck },
  { label: "ERP Raporları", href: "/admin/erp-reports", icon: ChartNoAxesCombined },
];

const settingsNav: NavItem[] = [
  { label: "Genel Ayarlar", href: "/admin/settings", icon: Settings },
  { label: "Yazıcılar", href: "/admin/printers", icon: Printer },
  { label: "Entegrasyonlar", href: "/admin/integrations", icon: PlugZap },
  { label: "ERP / Gelişmiş", href: "/admin/erp", icon: Factory },
];

/**
 * The advanced tools, kept off the sidebar.
 *
 * These eighteen screens are real work, but none of them is daily work for the
 * person who opens this panel to see how service is going. They live one level
 * down, behind "ERP / Gelişmiş", grouped the way a restaurant is run rather
 * than the way its tables are named. Nothing was deleted to get there: the ERP
 * page renders these same sections as its index, and the sidebar search below
 * still finds every one of them by name.
 */
const stockNav: NavItem[] = [
  { label: "Stok", href: "/admin/inventory", icon: Boxes },
  { label: "Stok Hareketleri", href: "/admin/stock-movements", icon: History },
  { label: "Sayım Farkları", href: "/admin/stock-counts", icon: ClipboardCheck },
  { label: "Depolar", href: "/admin/warehouses", icon: Store },
  { label: "Reçeteler", href: "/admin/recipes", icon: CookingPot },
  { label: "Maliyet", href: "/admin/costing", icon: BadgeDollarSign },
  { label: "Üretim", href: "/admin/production", icon: Factory },
  { label: "Fire", href: "/admin/waste", icon: PackageOpen },
  { label: "Üretim Tahmini", href: "/admin/forecast", icon: CalendarClock },
];

const purchasingNav: NavItem[] = [
  { label: "Tedarikçiler", href: "/admin/suppliers", icon: Truck },
  { label: "Satın Alma", href: "/admin/purchasing", icon: ClipboardList },
  { label: "Borçlar", href: "/admin/payables", icon: WalletCards },
  { label: "Alım Fiyat Geçmişi", href: "/admin/price-history", icon: TrendingUp },
];

const guestNav: NavItem[] = [
  { label: "Rezervasyon", href: "/admin/reservations", icon: CalendarDays },
  { label: "Paket ve Kurye", href: "/admin/fulfillment", icon: ShoppingBag },
  { label: "Müşteriler", href: "/admin/customers", icon: UsersRound },
  { label: "Geri Bildirim", href: "/admin/feedback", icon: BookOpen },
  { label: "Sadakat", href: "/admin/loyalty", icon: Wallet },
];

export interface AdminSectionGroup {
  readonly title: string;
  readonly items: readonly NavItem[];
}

/** The index the "ERP / Gelişmiş" page renders. Exported so it has one source. */
export const ERP_SECTIONS: readonly AdminSectionGroup[] = [
  { title: "Stok ve Üretim", items: stockNav },
  { title: "Satın Alma", items: purchasingNav },
  { title: "Misafir ve Rezervasyon", items: guestNav },
];

interface NavSection {
  readonly label: string;
  /** A section is a single destination when it has an href, a group when it has items. */
  readonly href?: string;
  readonly icon?: LucideIcon;
  readonly items?: readonly NavItem[];
}

/**
 * The menu, as data.
 *
 * Eight rows. Two of them go straight to a screen — today's state and the
 * order list, the two things this panel is opened for — and the other six open
 * to at most five links each. Nothing was removed: every screen that used to
 * be a sidebar row is still one click from the row that owns it, and the ones
 * that moved a level down are listed on the ERP page and found by the search
 * below.
 */
const NAV_SECTIONS: readonly NavSection[] = [
  { label: "Genel Bakış", href: "/admin/dashboard", icon: LayoutDashboard },
  { label: "Siparişler", href: "/admin/orders", icon: ClipboardList },
  { label: "Menü", items: menuNav },
  { label: "Masalar", items: tableNav },
  { label: "Personel", items: peopleNav },
  { label: "Kasa", items: cashNav },
  { label: "Raporlar", items: reportsNav },
  { label: "Ayarlar", items: settingsNav },
];

/** Every destination in the product, section name included, for the search below. */
const SEARCHABLE: readonly { item: NavItem; section: string }[] = [
  ...NAV_SECTIONS.flatMap((section) =>
    section.items
      ? section.items.map((item) => ({ item, section: section.label }))
      : section.href && section.icon
        ? [{ item: { label: section.label, href: section.href, icon: section.icon }, section: "Yönetim" }]
        : [],
  ),
  ...ERP_SECTIONS.flatMap((section) => section.items.map((item) => ({ item, section: section.title }))),
];

/**
 * Finding a screen without knowing which section owns it.
 *
 * This searches the menu that is already in memory — labels and section names,
 * nothing else. No request is made, so typing costs nothing and there is no
 * query to bound. It is also how the eighteen advanced screens stay one search
 * away after leaving the sidebar: it answers "where is fire girişi", not
 * "which product is called fire".
 */
function searchNav(query: string): readonly { item: NavItem; section: string }[] {
  const needle = query.trim().toLocaleLowerCase("tr");
  if (needle.length < 2) return [];
  const matches: { item: NavItem; section: string }[] = [];
  for (const entry of SEARCHABLE) {
    const haystack = `${entry.item.label} ${entry.section}`.toLocaleLowerCase("tr");
    if (haystack.includes(needle)) matches.push(entry);
  }
  return matches.slice(0, 8);
}

const titleByPath = SEARCHABLE.reduce<Record<string, string>>((acc, entry) => {
  acc[entry.item.href] = entry.item.label;
  return acc;
}, {});

const ERP_ROUTES: readonly string[] = ERP_SECTIONS.flatMap((section) =>
  section.items.map((item) => item.href),
);

function isActivePath(pathname: string, href: string) {
  if (pathname === href || pathname.startsWith(`${href}/`)) return true;
  // The eighteen advanced screens no longer have a row of their own, so the row
  // that owns them lights up instead — a demoted screen must still be able to
  // say where in the menu it lives.
  return (
    href === "/admin/erp" &&
    ERP_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`))
  );
}

function NavLink({
  item,
  pathname,
  onNavigate,
}: {
  item: NavItem;
  pathname: string;
  onNavigate?: () => void;
}) {
  const active = isActivePath(pathname, item.href);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "motion-press group relative flex min-h-10 items-center gap-3 rounded-md px-3 text-sm font-semibold transition-colors before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-sidebar-primary before:opacity-0 before:transition-opacity before:duration-[var(--motion-quick)] [&_svg]:transition-colors [&_svg]:duration-[var(--motion-quick)]",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground before:opacity-100 [&_svg]:text-sidebar-primary"
          : "text-sidebar-foreground/72 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
      )}
    >
      <Icon className="size-[18px]" strokeWidth={1.8} />
      <span>{item.label}</span>
    </Link>
  );
}

function NavGroup({
  label,
  items,
  pathname,
  onNavigate,
}: {
  label: string;
  items: readonly NavItem[];
  pathname: string;
  onNavigate?: () => void;
}) {
  const holdsCurrentPage = items.some((item) => isActivePath(pathname, item.href));
  const [open, setOpen] = useState(holdsCurrentPage);
  const panelId = `nav-${label.replace(/[^a-zA-Z]+/g, "-").toLowerCase()}`;

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls={panelId}
        className="motion-press flex min-h-10 w-full items-center gap-2 rounded-md px-3 text-sm font-semibold text-sidebar-foreground/72 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      >
        <span className="flex-1 text-left">{label}</span>
        {/* A closed section that holds the current page still says so, so the
            collapse never hides where the user actually is. */}
        {!open && holdsCurrentPage ? <span className="size-1.5 rounded-full bg-sidebar-primary" aria-hidden="true" /> : null}
        <ChevronDown className={cn("size-4 transition-transform", !open && "-rotate-90")} aria-hidden="true" />
      </button>
      <div id={panelId} hidden={!open} className="space-y-1 pl-3">
        {items.map((item) => (
          <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />
        ))}
      </div>
    </div>
  );
}

function NavSearch({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  const [query, setQuery] = useState("");
  const results = searchNav(query);
  const searching = query.trim().length >= 2;

  return (
    <div className="pb-1 pt-2">
      <label className="relative block">
        <span className="sr-only">Menüde ara</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-sidebar-foreground/45" aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Ekran ara…"
          className="min-h-10 w-full rounded-md border border-sidebar-border bg-sidebar-accent/55 pl-9 pr-3 text-sm font-medium text-sidebar-foreground placeholder:text-sidebar-foreground/40 focus:outline-none focus:ring-2 focus:ring-sidebar-primary"
        />
      </label>
      {searching ? (
        <div className="mt-2 space-y-1" role="status" aria-live="polite">
          {results.length ? (
            results.map((result) => (
              <Link
                key={result.item.href}
                href={result.item.href}
                onClick={() => { setQuery(""); onNavigate?.(); }}
                aria-current={isActivePath(pathname, result.item.href) ? "page" : undefined}
                className="motion-press flex min-h-10 items-center gap-3 rounded-md px-3 text-sm font-semibold text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              >
                <result.item.icon className="size-[18px] shrink-0" strokeWidth={1.8} />
                <span className="min-w-0 flex-1 truncate">{result.item.label}</span>
                <span className="shrink-0 truncate text-xs font-medium text-sidebar-foreground/40">{result.section}</span>
              </Link>
            ))
          ) : (
            <p className="px-3 py-2 text-xs text-sidebar-foreground/50">Eşleşen ekran yok.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function SidebarContent({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  const { name, role } = useStaffSession();
  const roleLabel = STAFF_ROLE_LABELS[role];

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-[76px] items-center gap-3 border-b border-sidebar-border px-5">
        <BrandMark compact className="size-11 shrink-0 bg-sidebar-accent" />
        <div className="min-w-0">
          <p className="truncate font-heading text-base font-semibold tracking-[-0.01em]">Tarihi Şehir</p>
          <p className="truncate text-[11px] font-medium uppercase tracking-[0.11em] text-sidebar-primary/80">Yönetim Merkezi</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-4 pt-2" aria-label="Yönetim menüsü">
        <NavSearch pathname={pathname} onNavigate={onNavigate} />
        {NAV_SECTIONS.map((section) =>
          section.items ? (
            <NavGroup key={section.label} label={section.label} items={section.items} pathname={pathname} onNavigate={onNavigate} />
          ) : section.href && section.icon ? (
            <NavLink
              key={section.label}
              item={{ label: section.label, href: section.href, icon: section.icon }}
              pathname={pathname}
              onNavigate={onNavigate}
            />
          ) : null,
        )}
      </nav>

      <div className="border-t border-sidebar-border p-3">
        <Link
          href="/menu/demo-table"
          onClick={onNavigate}
          className="motion-press flex min-h-11 items-center gap-3 rounded-md border border-sidebar-border bg-sidebar-accent/55 px-3 text-sm font-semibold text-sidebar-foreground transition-colors hover:border-sidebar-primary/45 hover:bg-sidebar-accent"
        >
          <Store className="size-[18px] text-sidebar-primary" strokeWidth={1.8} />
          <span className="flex-1">QR Menüyü Gör</span>
          <ChevronDown className="size-4 -rotate-90 opacity-60" />
        </Link>
        <div className="mt-3 flex items-center gap-3 px-2 py-1.5">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-sidebar-primary/35 bg-sidebar-accent text-sm font-bold text-sidebar-primary">
            {getInitials(name)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{name}</p>
            <p className="truncate text-xs text-sidebar-foreground/50">{roleLabel}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AdminShell({ children }: { children: ReactNode }) {
  const { name, role } = useStaffSession();
  const roleLabel = STAFF_ROLE_LABELS[role];
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const pageTitle = Object.entries(titleByPath)
    .sort(([left], [right]) => right.length - left.length)
    .find(([href]) => isActivePath(pathname, href))?.[1] ?? "Yönetim";

  return (
    <div className="min-h-[100dvh] bg-background">
      <a href="#admin-content" className="sr-only fixed left-4 top-4 z-50 rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-background focus:not-sr-only">
        Ana içeriğe geç
      </a>
      <aside className="fixed inset-y-0 left-0 hidden w-[264px] border-r border-sidebar-border lg:block">
        <SidebarContent pathname={pathname} />
      </aside>

      <div className="lg:pl-[264px]">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border/80 bg-card/96 px-4 shadow-[0_1px_6px_rgba(45,32,24,0.04)] backdrop-blur-md sm:px-6 lg:px-8">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger
              render={
                <Button
                  variant="outline"
                  size="icon-lg"
                  className="size-10 bg-card lg:hidden"
                  aria-label="Yönetim menüsünü aç"
                />
              }
            >
              <Menu className="size-5" />
            </SheetTrigger>
            <SheetContent side="left" className="w-[min(88vw,320px)] gap-0 border-sidebar-border bg-sidebar p-0" showCloseButton={false}>
              <SheetHeader className="sr-only">
                <SheetTitle>Yönetim menüsü</SheetTitle>
                <SheetDescription>Yönetim bölümleri arasında gezin.</SheetDescription>
              </SheetHeader>
              <Button
                variant="ghost"
                size="icon-lg"
                className="absolute right-3 top-3 z-10 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
                onClick={() => setMobileOpen(false)}
                aria-label="Menüyü kapat"
              >
                <X className="size-5" />
              </Button>
              <SidebarContent pathname={pathname} onNavigate={() => setMobileOpen(false)} />
            </SheetContent>
          </Sheet>

          <nav className="min-w-0 flex-1 text-sm" aria-label="İçerik yolu">
            <ol className="flex min-w-0 items-center gap-2">
              <li className="hidden font-medium text-muted-foreground sm:block">Yönetim</li>
              <li className="hidden text-muted-foreground/45 sm:block" aria-hidden="true">/</li>
              <li className="truncate font-bold text-foreground" aria-current="page">{pageTitle}</li>
            </ol>
          </nav>

          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-olive text-xs font-bold text-cream">{getInitials(name)}</span>
            <span className="hidden text-left sm:block">
              <span className="block text-xs font-bold">{name}</span>
              <span className="block text-xs text-muted-foreground">{roleLabel}</span>
            </span>
          </div>
          <LogoutButton className="text-muted-foreground hover:bg-muted hover:text-foreground" />
        </header>

        <main id="admin-content" className="min-w-0 w-full p-4 sm:p-6 lg:p-8 xl:p-10">{children}</main>
      </div>
    </div>
  );
}
