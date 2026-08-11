"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  BookOpen,
  Boxes,
  ChartNoAxesCombined,
  ChevronDown,
  ClipboardList,
  Grid2X2,
  LayoutDashboard,
  Menu,
  PackageOpen,
  QrCode,
  Search,
  Settings,
  SlidersHorizontal,
  Store,
  UsersRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { BrandMark } from "@/components/shared/brand-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

const primaryNav: NavItem[] = [
  { label: "Dashboard", href: "/admin/dashboard", icon: LayoutDashboard },
  { label: "Siparişler", href: "/admin/orders", icon: ClipboardList },
  { label: "Masalar", href: "/admin/tables", icon: Grid2X2 },
];

const catalogNav: NavItem[] = [
  { label: "Menü", href: "/admin/menu", icon: BookOpen },
  { label: "Kategoriler", href: "/admin/categories", icon: Boxes },
  { label: "Ürünler", href: "/admin/products", icon: PackageOpen },
];

const managementNav: NavItem[] = [
  { label: "Personel", href: "/admin/staff", icon: UsersRound },
  { label: "QR Kodlar", href: "/admin/qr-codes", icon: QrCode },
  { label: "Raporlar", href: "/admin/reports", icon: ChartNoAxesCombined },
  { label: "Ayarlar", href: "/admin/settings", icon: Settings },
];

const titleByPath = [...primaryNav, ...catalogNav, ...managementNav].reduce<Record<string, string>>(
  (acc, item) => {
    acc[item.href] = item.label;
    return acc;
  },
  {},
);

function NavGroup({
  label,
  items,
  pathname,
  onNavigate,
}: {
  label: string;
  items: NavItem[];
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <div className="space-y-1">
      <p className="px-3 pb-1 pt-4 text-[11px] font-bold uppercase tracking-[0.14em] text-sidebar-foreground/45">
        {label}
      </p>
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex min-h-10 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition-colors",
              active
                ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
                : "text-sidebar-foreground/72 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            )}
          >
            <Icon className="size-[18px]" strokeWidth={1.8} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </div>
  );
}

function SidebarContent({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-[76px] items-center gap-3 border-b border-sidebar-border px-5">
        <BrandMark compact className="size-11 shrink-0" />
        <div className="min-w-0">
          <p className="truncate font-heading text-base font-semibold">Tarihi Şehir</p>
          <p className="truncate text-xs text-sidebar-foreground/55">Yönetim Merkezi</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-4 pt-2" aria-label="Yönetim menüsü">
        <NavGroup label="Operasyon" items={primaryNav} pathname={pathname} onNavigate={onNavigate} />
        <NavGroup label="Katalog" items={catalogNav} pathname={pathname} onNavigate={onNavigate} />
        <NavGroup label="Yönetim" items={managementNav} pathname={pathname} onNavigate={onNavigate} />
      </nav>

      <div className="border-t border-sidebar-border p-3">
        <Link
          href="/menu/demo-table"
          onClick={onNavigate}
          className="flex min-h-11 items-center gap-3 rounded-xl border border-sidebar-border bg-sidebar-accent/55 px-3 text-sm font-semibold text-sidebar-foreground transition-colors hover:bg-sidebar-accent"
        >
          <Store className="size-[18px] text-sidebar-primary" strokeWidth={1.8} />
          <span className="flex-1">QR Menüyü Gör</span>
          <ChevronDown className="size-4 -rotate-90 opacity-60" />
        </Link>
        <div className="mt-3 flex items-center gap-3 px-2 py-1.5">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-sidebar-primary text-sm font-bold text-sidebar-primary-foreground">
            NÇ
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">Nermin Çelik</p>
            <p className="truncate text-xs text-sidebar-foreground/50">Yönetici</p>
          </div>
          <SlidersHorizontal className="size-4 text-sidebar-foreground/50" />
        </div>
      </div>
    </div>
  );
}

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const pageTitle = titleByPath[pathname] ?? "Yönetim";

  return (
    <div className="min-h-[100dvh] bg-background">
      <aside className="fixed inset-y-0 left-0 hidden w-[264px] border-r border-sidebar-border lg:block">
        <SidebarContent pathname={pathname} />
      </aside>

      <div className="lg:pl-[264px]">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border/80 bg-background/95 px-4 backdrop-blur-md sm:px-6 lg:px-8">
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

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-foreground sm:text-base">{pageTitle}</p>
            <p className="hidden text-xs text-muted-foreground sm:block">11 Ağustos 2026, Salı</p>
          </div>

          <div className="relative hidden w-full max-w-xs md:block">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="h-10 bg-card pl-9" aria-label="Yönetim panelinde ara" placeholder="Hızlı ara..." />
          </div>

          <Button variant="outline" size="icon-lg" className="relative size-10 bg-card" aria-label="Bildirimler">
            <Bell className="size-[18px]" />
            <span className="absolute right-2 top-2 size-2 rounded-full bg-burgundy ring-2 ring-card" />
          </Button>
          <Button variant="ghost" className="hidden h-10 gap-2 px-2 sm:flex" aria-label="Kullanıcı menüsü">
            <span className="flex size-8 items-center justify-center rounded-lg bg-olive text-xs font-bold text-cream">NÇ</span>
            <span className="hidden text-left xl:block">
              <span className="block text-xs font-bold">Nermin Çelik</span>
              <span className="block text-[11px] text-muted-foreground">Admin</span>
            </span>
            <ChevronDown className="size-4 text-muted-foreground" />
          </Button>
        </header>

        <main className="mx-auto w-full max-w-[1600px] p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
