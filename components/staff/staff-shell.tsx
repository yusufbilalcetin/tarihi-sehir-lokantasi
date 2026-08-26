"use client";

import { type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BellRing,
  LayoutDashboard,
  ReceiptText,
  TableProperties,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { BrandMark } from "@/components/shared/brand-mark";
import { LogoutButton } from "@/components/staff/logout-button";
import { useStaffSession } from "@/components/staff/staff-session-provider";
import { STAFF_ROLE_LABELS } from "@/lib/domain/staff-accounts";
import { getInitials } from "@/lib/format";
import { cn } from "@/lib/utils";

const navigation = [
  { href: "/staff/dashboard", label: "Özet", icon: LayoutDashboard },
  { href: "/staff/tables", label: "Masalar", icon: TableProperties },
  { href: "/staff/orders", label: "Siparişler", icon: ReceiptText },
  { href: "/staff/calls", label: "Çağrılar", icon: BellRing },
] as const;

function StaffHeader({ pathname }: { pathname: string }) {
  // The header is the only "who am I signed in as" indicator on these screens,
  // so it reads the real session rather than a fixed name.
  const { name, role } = useStaffSession();
  const roleLabel = STAFF_ROLE_LABELS[role];

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
            <span className="block text-[11px] font-medium text-cream/65">{roleLabel} paneli</span>
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
          <div className="hidden items-center gap-2 sm:flex">
            <Avatar className="size-9 border border-copper/30">
              <AvatarFallback className="bg-copper text-olive">{getInitials(name)}</AvatarFallback>
            </Avatar>
            <div className="hidden leading-tight xl:block">
              <p className="text-sm font-semibold text-card">{name}</p>
              <p className="text-xs text-cream/60">{roleLabel}</p>
            </div>
          </div>
          <LogoutButton className="text-cream/70 hover:bg-sidebar-accent hover:text-card" />
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
