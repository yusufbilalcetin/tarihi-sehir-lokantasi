"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  ADMIN_APPS,
  ADMIN_HOME,
  ADMIN_HOME_LABEL,
  adminAppForPath,
  isAdminRouteMatch,
} from "@/components/admin/admin-navigation";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const ROW =
  "motion-press flex min-h-12 items-center gap-3 rounded-lg px-3 text-[14px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

/** The accent means "this one", so it marks the current app and nothing else. */
const tone = (current: boolean) =>
  current ? "bg-accent text-accent-foreground" : "text-foreground hover:bg-muted";

/**
 * The home, then the eight parts of the restaurant.
 *
 * Every row is a link read from the navigation table, so this list and the
 * route ownership it marks cannot disagree. The home sits above the apps, never
 * among them. `data-admin-shell` puts the panel's palette on the popup, which
 * is portalled out of the shell and would otherwise wear the guest menu's.
 */
export function AdminAppSwitcher({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const pathname = usePathname();
  const currentApp = adminAppForPath(pathname);
  const atHome = isAdminRouteMatch(pathname, ADMIN_HOME.href);
  const close = () => onOpenChange(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-admin-shell className="gap-4 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[17px] font-semibold">Uygulamalar</DialogTitle>
          <DialogDescription className="sr-only">Ana ekrana ya da işletmenin bir bölümüne geçin.</DialogDescription>
        </DialogHeader>
        <nav aria-label="Uygulamalar">
          <Link
            href={ADMIN_HOME.href}
            onClick={close}
            aria-current={atHome ? "page" : undefined}
            className={cn(ROW, tone(atHome))}
          >
            <ADMIN_HOME.icon className="size-[18px] shrink-0" strokeWidth={1.75} aria-hidden="true" />
            {ADMIN_HOME_LABEL}
          </Link>
          <ul className="mt-3 grid grid-cols-2 gap-1 border-t border-border pt-3">
            {ADMIN_APPS.map((app) => {
              const current = app.id === currentApp?.id;
              return (
                <li key={app.id}>
                  <Link
                    href={app.href}
                    onClick={close}
                    aria-current={current ? "true" : undefined}
                    className={cn(ROW, tone(current))}
                  >
                    <app.icon className="size-[18px] shrink-0" strokeWidth={1.75} aria-hidden="true" />
                    <span className="truncate">{app.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </DialogContent>
    </Dialog>
  );
}
