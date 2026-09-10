"use client";

import { type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BellRing, ReceiptText, TableProperties, UserRound } from "lucide-react";
import { OperationalBackdrop, OperationalTopBar } from "@/components/staff/operational-ui";
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

function StaffHeader({ pathname, home }: { pathname: string; home: boolean }) {
  return (
    <OperationalTopBar
      title="Servis"
      homeHref="/staff/dashboard"
      end={home ? undefined :
        <nav className="hidden items-center gap-1 md:flex" aria-label="Personel menüsü">
          {navigation.map((item) => {
            const Icon = item.icon;
            const active = isCurrent(pathname, item);

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "motion-press flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-[#6F5D4E] hover:bg-white/60 hover:text-[#2D2018] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-burgundy",
                  active && "bg-[#3D2A20] text-[#FFF9EF] shadow-sm hover:bg-[#3D2A20] hover:text-white",
                )}
              >
                <Icon className="size-4" strokeWidth={active ? 2.2 : 1.8} aria-hidden="true" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      }
    />
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
    <OperationalBackdrop>
      <StaffHeader pathname={pathname} home={cockpit} />
      <main
        className={cn(
          "mx-auto w-full max-w-[1400px] px-3 py-4 sm:px-6 sm:py-6 lg:px-8",
          cockpit ? "md:pb-8" : "pb-24 md:pb-8",
        )}
      >
        {children}
      </main>
      {cockpit ? null : <StaffBottomNavigation pathname={pathname} />}
    </OperationalBackdrop>
  );
}
