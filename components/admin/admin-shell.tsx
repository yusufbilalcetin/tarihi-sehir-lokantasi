"use client";

import type { ReactNode } from "react";
import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, LayoutGrid, Search, UserRound, type LucideIcon } from "lucide-react";

import {
  ADMIN_ADVANCED_GROUPS,
  ADMIN_HOME,
  ADMIN_HOME_LABEL,
  adminParentForPath,
  adminTitleForPath,
  isAdminRouteMatch,
  type AdminNavGroup,
} from "@/components/admin/admin-navigation";
import { AdminAppSwitcher } from "@/components/admin/admin-app-switcher";
import { AdminNavigationSearch } from "@/components/admin/admin-navigation-search";
import { AdminProfileDialog } from "@/components/admin/admin-profile-dialog";
import { AdminTodayPill } from "@/components/admin/admin-ui";
import { DemoTablePicker } from "@/components/shared/demo-table-picker";
import { BrandMark } from "@/components/shared/brand-mark";
import { getInitials } from "@/lib/format";
import { useStaffSession } from "@/components/staff/staff-session-provider";
import { cn } from "@/lib/utils";

/**
 * The advanced index, for the page that renders it.
 *
 * The list itself lives in the navigation table now; this stays so the callers
 * that already read it from the shell keep working.
 */
export type AdminSectionGroup = AdminNavGroup;
export const ERP_SECTIONS: readonly AdminSectionGroup[] = ADMIN_ADVANCED_GROUPS;

/** The three overlays the shell owns. One at a time, so one piece of state. */
type ShellDialog = "search" | "apps" | "account";

/** The platform never changes under a page, so nothing is ever subscribed to. */
const NEVER_CHANGES = () => () => {};
const readShortcut = () => (/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K");

const BAR_CONTROL =
  "motion-press flex h-11 shrink-0 items-center gap-2 rounded-lg text-[13px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

/**
 * The one bar above every screen.
 *
 * From `md` up it carries the whole way around the panel: home, search, the
 * apps and the person signed in. Below `md` those controls live in the dock
 * under the thumb, so the bar keeps only the brand and the name of the screen —
 * the page's own title can be below the fold, and nothing here is a heading.
 */
function AppBar({
  pathname,
  pageTitle,
  onOpen,
}: {
  pathname: string;
  pageTitle: string;
  onOpen: (dialog: ShellDialog) => void;
}) {
  const { name } = useStaffSession();
  const shortcut = useSyncExternalStore(NEVER_CHANGES, readShortcut, () => "Ctrl K");
  const atHome = isAdminRouteMatch(pathname, ADMIN_HOME.href);

  return (
    <header className="sticky top-0 z-30 h-14 border-b border-border bg-card md:h-16">
      <div className="mx-auto flex h-full w-full max-w-[1600px] items-center gap-3 px-4 sm:px-6 lg:px-8">
        <Link
          href={ADMIN_HOME.href}
          aria-label={`${ADMIN_HOME_LABEL}, Tarihi Şehir`}
          aria-current={atHome ? "page" : undefined}
          className="flex min-h-11 min-w-11 shrink-0 items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          {/* The burgundy is spent here, on the current app and on the
              selected segment. The serif is the restaurant's, and this is the
              only place the panel uses it. */}
          <BrandMark
            compact
            className="size-9 shrink-0 rounded-lg border-transparent bg-sidebar-primary text-sidebar-primary-foreground shadow-none"
          />
          <span className="hidden font-heading text-[15px] font-semibold tracking-[-0.01em] text-foreground md:inline">
            Tarihi Şehir
          </span>
        </Link>

        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground md:hidden">{pageTitle}</span>
        <AdminTodayPill className="shrink-0 md:hidden" />

        <button
          type="button"
          onClick={() => onOpen("search")}
          aria-haspopup="dialog"
          aria-keyshortcuts="Meta+K Control+K"
          className={cn(
            BAR_CONTROL,
            "ml-3 hidden min-w-0 max-w-sm flex-1 border border-border bg-background px-3 text-muted-foreground hover:bg-muted hover:text-foreground md:flex",
          )}
        >
          <Search className="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
          <span className="flex-1 truncate text-left">Ekran ara</span>
          <kbd aria-hidden="true" className="rounded-md border border-border bg-card px-1.5 py-0.5 font-sans text-[11px] font-medium text-muted-foreground">
            {shortcut}
          </kbd>
        </button>

        <div className="ml-auto hidden items-center gap-1 md:flex">
          <button
            type="button"
            onClick={() => onOpen("apps")}
            aria-haspopup="dialog"
            className={cn(BAR_CONTROL, "px-3 text-foreground hover:bg-muted")}
          >
            <LayoutGrid className="size-[18px] text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
            Uygulamalar
          </button>
          <button
            type="button"
            onClick={() => onOpen("account")}
            aria-haspopup="dialog"
            aria-label={`Hesap, ${name}`}
            className={cn(BAR_CONTROL, "px-1 text-foreground hover:bg-muted lg:pr-3")}
          >
            <span
              aria-hidden="true"
              className="flex size-9 items-center justify-center rounded-full border border-border bg-background text-[12px] font-semibold"
            >
              {getInitials(name)}
            </span>
            <span className="hidden max-w-[10rem] truncate lg:block">{name}</span>
          </button>
        </div>
      </div>
    </header>
  );
}

/** 56px each: the dock is the only way around the panel on a phone. */
const DOCK_ITEM =
  "motion-press flex min-h-14 w-full min-w-14 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[11px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

const DOCK_DIALOGS: readonly (readonly [ShellDialog, string, LucideIcon])[] = [
  ["search", "Ara", Search],
  ["apps", "Uygulamalar", LayoutGrid],
  ["account", "Hesap", UserRound],
];

function MobileDock({ pathname, onOpen }: { pathname: string; onOpen: (dialog: ShellDialog) => void }) {
  const active = isAdminRouteMatch(pathname, ADMIN_HOME.href);

  return (
    <nav
      aria-label="Genel gezinme"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="mx-auto grid max-w-md grid-cols-4 px-2 py-1">
        <li>
          <Link
            href={ADMIN_HOME.href}
            aria-current={active ? "page" : undefined}
            className={cn(DOCK_ITEM, active ? "text-accent-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            <ADMIN_HOME.icon className="size-5" strokeWidth={1.75} aria-hidden="true" />
            Bugün
          </Link>
        </li>
        {DOCK_DIALOGS.map(([dialog, label, Icon]) => (
          <li key={dialog}>
            <button
              type="button"
              onClick={() => onOpen(dialog)}
              aria-haspopup="dialog"
              className={cn(DOCK_ITEM, "text-muted-foreground hover:text-foreground")}
            >
              <Icon className="size-5" strokeWidth={1.75} aria-hidden="true" />
              {label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * `demoLauncherEnabled` decides whether this panel can offer the guest menu at
 * all. The entry used to link at `/menu/demo-table`, which is not a QR token
 * and never was: the gate rejects it and the manager landed on "QR bağlantısı
 * doğrulanamadı". The table picker is the flow that already exists for this —
 * it reads the restaurant's live tables and opens a real, validated session —
 * and where the launcher is switched off there is no valid link to offer, so
 * the entry is absent rather than dead.
 */
export function AdminShell({
  children,
  demoLauncherEnabled,
}: {
  children: ReactNode;
  demoLauncherEnabled: boolean;
}) {
  const pathname = usePathname();
  const [dialog, setDialog] = useState<ShellDialog | null>(null);
  const [qrMenuOpen, setQrMenuOpen] = useState(false);
  const onOpenQrMenu = demoLauncherEnabled ? () => setQrMenuOpen(true) : null;
  const pageTitle = adminTitleForPath(pathname);
  const parent = adminParentForPath(pathname);

  // Cmd+K on a Mac, Ctrl+K elsewhere — the shortcut the bar's search field shows.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setDialog("search");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const dialogProps = (name: ShellDialog) => ({
    open: dialog === name,
    onOpenChange: (open: boolean) => setDialog(open ? name : null),
  });

  return (
    <div data-admin-shell className="min-h-[100dvh] min-w-0 overflow-x-clip bg-background">
      <a href="#admin-content" className="sr-only rounded-lg bg-foreground text-sm font-semibold text-background focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:px-4 focus:py-2">
        Ana içeriğe geç
      </a>

      <AppBar pathname={pathname} pageTitle={pageTitle} onOpen={setDialog} />

      {/* Below `md` the bottom padding is the dock's height plus the home
          indicator, so the last row of a page is never under it. */}
      <main id="admin-content" className="w-full min-w-0 pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0">
        {/* Reading width, not screen width: past ~1600px a table row becomes
            a journey from the name to the status. */}
        <div className="mx-auto w-full max-w-[1600px] px-4 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
          {/* The way up, drawn here rather than by the page surface so every
              screen gets it, including those that do not mount one. A fixed
              route, never a history step: a deep link goes to the same place. */}
          {parent ? (
            <nav aria-label="Üst ekran" className="-ml-2 mb-1">
              <Link
                href={parent.href}
                className="motion-press inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-[13px] font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                <ChevronLeft className="size-4" strokeWidth={1.75} aria-hidden="true" />
                {parent.label}
              </Link>
            </nav>
          ) : null}
          {children}
        </div>
      </main>

      <MobileDock pathname={pathname} onOpen={setDialog} />

      <AdminNavigationSearch {...dialogProps("search")} />
      <AdminAppSwitcher {...dialogProps("apps")} />
      <AdminProfileDialog {...dialogProps("account")} onOpenQrMenu={onOpenQrMenu} />

      {/* Never mounted where it could not load anything. */}
      {demoLauncherEnabled ? (
        <DemoTablePicker open={qrMenuOpen} onOpenChange={setQrMenuOpen} />
      ) : null}
    </div>
  );
}
