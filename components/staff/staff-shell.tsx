"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BellRing,
  Clock3,
  LayoutDashboard,
  LogOut,
  ReceiptText,
  TableProperties,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { BrandMark } from "@/components/shared/brand-mark";
import { cn } from "@/lib/utils";

const navigation = [
  { href: "/staff/dashboard", label: "Özet", icon: LayoutDashboard },
  { href: "/staff/tables", label: "Masalar", icon: TableProperties },
  { href: "/staff/orders", label: "Siparişler", icon: ReceiptText },
  { href: "/staff/calls", label: "Çağrılar", icon: BellRing },
] as const;

function StaffHeader({ pathname }: { pathname: string }) {
  return (
    <header className="sticky top-0 z-30 border-b border-sidebar-border bg-olive text-sidebar-foreground shadow-[0_8px_28px_rgb(48_56_45/0.12)]">
      <div className="mx-auto flex h-16 w-full max-w-[1400px] items-center gap-3 px-4 sm:px-6 lg:px-8">
        <Link
          href="/staff/dashboard"
          className="flex min-h-11 min-w-0 items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
          aria-label="Tarihi Şehir Lokantası personel özeti"
        >
          <BrandMark compact className="size-9 shrink-0 border-copper/45 bg-sidebar-accent" />
          <span className="hidden min-w-0 sm:block">
            <span className="block truncate font-heading text-sm font-semibold text-card">
              Tarihi Şehir Lokantası
            </span>
            <span className="block text-[11px] font-medium text-cream/65">Garson paneli</span>
          </span>
        </Link>

        <nav className="ml-4 hidden h-full items-center gap-1 md:flex" aria-label="Personel menüsü">
          {navigation.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-cream/70 transition-colors hover:bg-sidebar-accent hover:text-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper",
                  active && "bg-sidebar-accent text-card",
                )}
              >
                <Icon className="size-4" strokeWidth={1.8} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <div className="hidden items-center gap-2 rounded-lg border border-sidebar-border bg-sidebar-accent/60 px-3 py-2 text-xs font-medium text-cream/75 lg:flex">
            <Clock3 className="size-4 text-copper" strokeWidth={1.8} />
            10:00 - 18:00
          </div>
          <div className="hidden items-center gap-2 sm:flex">
            <Avatar className="size-9 border border-copper/30">
              <AvatarFallback className="bg-copper text-olive">AY</AvatarFallback>
            </Avatar>
            <div className="hidden leading-tight xl:block">
              <p className="text-sm font-semibold text-card">Ahmet Yılmaz</p>
              <p className="text-xs text-cream/60">Garson</p>
            </div>
          </div>
          <Link
            href="/staff/login"
            className="flex size-11 items-center justify-center rounded-lg text-cream/70 transition-colors hover:bg-sidebar-accent hover:text-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
            aria-label="Personel panelinden çıkış yap"
          >
            <LogOut className="size-5" strokeWidth={1.8} />
          </Link>
        </div>
      </div>
    </header>
  );
}

function StaffBottomNavigation({ pathname }: { pathname: string }) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1 shadow-[0_-10px_30px_rgb(74_40_40/0.08)] backdrop-blur-md md:hidden"
      aria-label="Mobil personel menüsü"
    >
      <div className="mx-auto grid max-w-md grid-cols-4 gap-1">
        {navigation.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href;

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg px-1 text-[11px] font-semibold text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active && "bg-burgundy/[0.08] text-burgundy",
              )}
            >
              <Icon className="size-5" strokeWidth={active ? 2.2 : 1.8} />
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export function StaffShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  if (pathname === "/staff/login") {
    return <>{children}</>;
  }

  return (
    <div className="min-h-[100dvh] bg-background">
      <StaffHeader pathname={pathname} />
      <main className="mx-auto w-full max-w-[1400px] px-4 py-6 pb-24 sm:px-6 sm:py-8 md:pb-8 lg:px-8">
        {children}
      </main>
      <StaffBottomNavigation pathname={pathname} />
    </div>
  );
}
