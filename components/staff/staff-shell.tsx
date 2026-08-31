"use client";

import { type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BellRing, ReceiptText, TableProperties, UserRound } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { BrandMark } from "@/components/shared/brand-mark";
import { LogoutButton } from "@/components/staff/logout-button";
import { useStaffSession } from "@/components/staff/staff-session-provider";
import { STAFF_ROLE_LABELS } from "@/lib/domain/staff-accounts";
import { getInitials } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Three destinations, and the first one is where the work is.
 *
 * The summary tab that used to sit in front of Masalar showed four counters
 * and the first eight tables — a smaller copy of the screen next to it. The
 * floor plan absorbed it, so /staff/dashboard (the route a waiter is signed in
 * to) now renders Masalar as well and lights the same tab.
 */
const navigation = [
  { href: "/staff/tables", label: "Masalar", icon: TableProperties, alias: "/staff/dashboard" },
  { href: "/staff/orders", label: "Siparişler", icon: ReceiptText, alias: null },
  { href: "/staff/calls", label: "Çağrılar", icon: BellRing, alias: null },
  // A tablet has no bottom bar, so this is the only way to a waiter's own
  // timesheet once the personal cards left the tables screen.
  { href: "/staff/profile", label: "Profil", icon: UserRound, alias: null },
] as const;

function isCurrent(pathname: string, item: (typeof navigation)[number]) {
  return pathname === item.href || pathname === item.alias;
}

function StaffHeader({ pathname }: { pathname: string }) {
  // The header is the only "who am I signed in as" indicator on these screens,
  // so it reads the real session rather than a fixed name.
  const { name, role } = useStaffSession();
  const roleLabel = STAFF_ROLE_LABELS[role];

  return (
    <header className="sticky top-0 z-30 border-b border-sidebar-primary/35 bg-sidebar text-sidebar-foreground shadow-[0_4px_16px_rgba(45,32,24,0.12)]">
      <div className="mx-auto flex h-16 w-full max-w-[1400px] items-center gap-3 px-4 sm:px-6 lg:px-8">
        <Link
          href="/staff/tables"
          className="motion-press flex min-h-11 min-w-0 items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
          aria-label="Tarihi Şehir Lokantası masa planı"
        >
          <BrandMark compact className="size-9 shrink-0 border-copper/45 bg-sidebar-accent" />
          <span className="hidden min-w-0 sm:block">
            <span className="block truncate font-heading text-sm font-semibold text-card">
              Tarihi Şehir Lokantası
            </span>
            <span className="block text-xs font-medium text-cream/65">{roleLabel} paneli</span>
          </span>
        </Link>

        <nav className="ml-4 hidden h-full items-center gap-1 md:flex" aria-label="Personel menüsü">
          {navigation.map((item) => {
            const Icon = item.icon;
            const active = isCurrent(pathname, item);

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "motion-press relative flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-semibold text-cream/70 transition-colors after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-sidebar-primary after:opacity-0 after:transition-opacity after:duration-[var(--motion-quick)] hover:bg-sidebar-accent hover:text-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper",
                  active && "bg-sidebar-accent text-card after:opacity-100 [&_svg]:text-sidebar-primary",
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
              <AvatarFallback className="bg-sidebar-accent text-gold">{getInitials(name)}</AvatarFallback>
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
      <div className="mx-auto grid max-w-md grid-cols-3 gap-1">
        {navigation.map((item) => {
          const Icon = item.icon;
          const active = isCurrent(pathname, item);

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "motion-press flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg px-1 text-xs font-semibold text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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

/**
 * The service cockpit carries its own four-tab bar and its own bottom padding,
 * so the shell steps out of its way on those routes rather than stacking a
 * second bar under the first.
 */
const COCKPIT_ROUTES = new Set(["/staff/tables", "/staff/dashboard"]);

export function StaffShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const cockpit = COCKPIT_ROUTES.has(pathname);

  return (
    <div className="min-h-[100dvh] bg-background">
      <StaffHeader pathname={pathname} />
      <main
        className={cn(
          "mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8",
          cockpit ? "md:pb-8" : "pb-24 md:pb-8",
        )}
      >
        {children}
      </main>
      {cockpit ? null : <StaffBottomNavigation pathname={pathname} />}
    </div>
  );
}
