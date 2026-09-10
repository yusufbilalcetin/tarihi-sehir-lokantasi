"use client";

import { useState } from "react";
import type { LucideIcon } from "lucide-react";

import { AdminPageHeaderProvider, AdminTodayPill } from "@/components/admin/admin-ui";

/**
 * The page surface shared by every administration module.
 *
 * The exported name is retained so the existing route modules do not need a
 * mechanical rewrite. This is deliberately not a dialog or application
 * window: it participates in AdminShell's normal document flow and uses the
 * full workspace width.
 *
 * The heading owns an empty element on its right-hand side and hands it to
 * `AdminPageHeaderProvider`. A manager's `AdminPageHeader` portals its actions
 * into it, so the page's primary action sits in the header row it belongs to
 * instead of alone on a row of its own. The slot is `empty:hidden`, so a module
 * whose manager declares no actions gets no stray gap.
 *
 * The way up is not drawn here: AdminShell draws it above every screen, so the
 * pages that do not mount this surface (the menu editor) get it too.
 */
export function AdminModuleWindow({
  title,
  description,
  children,
}: {
  readonly title: string;
  readonly description: string;
  /** Retained so the thirteen route modules need no mechanical rewrite. The
   *  heading no longer draws it: an icon beside a page title labels nothing
   *  the title has not already said, and the app switcher is where the
   *  section is identified by shape. */
  readonly icon?: LucideIcon;
  readonly size?: "md" | "lg" | "xl" | "workspace";
  readonly children: React.ReactNode;
}) {
  // State rather than a ref: the portal has to re-render once the node exists,
  // and a ref mutation would not tell it. React calls this during commit, so
  // it is not a setState inside an effect.
  const [actionSlot, setActionSlot] = useState<HTMLElement | null>(null);

  return (
    <section className="min-w-0 space-y-6 sm:space-y-8" aria-labelledby="admin-page-title">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0">
          <h1 id="admin-page-title" className="text-[22px] font-semibold tracking-[-0.02em] text-foreground sm:text-[26px]">{title}</h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
        <div className="flex min-w-0 flex-col gap-2.5 sm:shrink-0 sm:items-end">
          {/* Desktop only: below `md` the same pill already sits in the
              phone's app bar. */}
          <AdminTodayPill className="hidden self-end md:inline-flex" />
          <div
            ref={setActionSlot}
            className="flex min-w-0 flex-wrap items-center gap-2 empty:hidden sm:justify-end"
          />
        </div>
      </header>
      <AdminPageHeaderProvider actionSlot={actionSlot}>{children}</AdminPageHeaderProvider>
    </section>
  );
}
