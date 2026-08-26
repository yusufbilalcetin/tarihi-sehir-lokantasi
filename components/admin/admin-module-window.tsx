"use client";

import type { LucideIcon } from "lucide-react";

import { AdminPageHeaderProvider } from "@/components/admin/admin-ui";

/**
 * The page surface shared by every administration module.
 *
 * The exported name is retained so the existing route modules do not need a
 * mechanical rewrite. This is deliberately not a dialog or application
 * window: it participates in AdminShell's normal document flow and uses the
 * full workspace width. The provider keeps managers from repeating the same
 * heading while preserving their page actions.
 */
export function AdminModuleWindow({
  title,
  description,
  icon: Icon,
  children,
}: {
  readonly title: string;
  readonly description: string;
  readonly icon: LucideIcon;
  readonly size?: "md" | "lg" | "xl" | "workspace";
  readonly children: React.ReactNode;
}) {
  return (
    <section className="min-w-0 space-y-6" aria-labelledby="admin-page-title">
      <header className="flex items-start gap-3 border-b border-border/70 pb-5 sm:gap-4 sm:pb-6">
        <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-olive/10 text-olive sm:size-11" aria-hidden="true">
          <Icon className="size-5" strokeWidth={1.8} />
        </span>
        <div className="min-w-0">
          <h1 id="admin-page-title" className="font-heading text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{title}</h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
      </header>
      <AdminPageHeaderProvider>{children}</AdminPageHeaderProvider>
    </section>
  );
}
