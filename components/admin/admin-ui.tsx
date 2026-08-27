"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Set by AdminModuleWindow's page-level heading. Every admin manager states
 * its own title through AdminPageHeader, so the context prevents duplicate
 * headings while allowing manager-specific actions to remain available.
 *
 * The actions keep rendering either way: they are the module's toolbar, not
 * decoration, and remain part of the page content.
 */
const AdminPageHeaderContext = createContext(false);

export function AdminPageHeaderProvider({ children }: { children: ReactNode }) {
  return <AdminPageHeaderContext.Provider value>{children}</AdminPageHeaderContext.Provider>;
}

export function AdminPageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  const pageHeadingAlreadyRendered = useContext(AdminPageHeaderContext);

  if (pageHeadingAlreadyRendered) {
    return actions ? (
      <div className="flex flex-wrap items-center justify-end gap-2">{actions}</div>
    ) : null;
  }

  return (
    <header className="flex flex-col gap-4 border-b border-border/80 pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <div className="mb-2 h-px w-9 bg-copper" aria-hidden="true" />
        <h1 className="font-heading text-2xl font-semibold tracking-[-0.02em] text-foreground sm:text-3xl">{title}</h1>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function AdminPanel({
  title,
  description,
  action,
  children,
  className,
  contentClassName,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <section className={cn("overflow-hidden rounded-lg border border-border/80 bg-card shadow-[var(--shadow-raised)]", className)}>
      {title || action ? (
        <div className="flex items-start justify-between gap-4 border-b border-border/75 bg-muted/25 px-4 py-4 sm:px-5">
          <div>
            {title ? <h2 className="font-heading text-lg font-semibold">{title}</h2> : null}
            {description ? <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</p> : null}
          </div>
          {action}
        </div>
      ) : null}
      <div className={cn("p-4 sm:p-5", contentClassName)}>{children}</div>
    </section>
  );
}

export function AdminKpi({
  label,
  value,
  helper,
  icon: Icon,
  change,
  changeLabel,
  inverse = false,
}: {
  label: string;
  value: string;
  helper?: string;
  icon: LucideIcon;
  change?: number;
  changeLabel?: string;
  inverse?: boolean;
}) {
  const positive = (change ?? 0) >= 0;
  const TrendIcon = positive ? ArrowUpRight : ArrowDownRight;
  return (
    <article
      className={cn(
        "relative overflow-hidden rounded-lg border border-border/80 bg-card p-4 shadow-[var(--shadow-raised)] sm:p-5",
        inverse && "border-copper/45 bg-card text-foreground",
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className={cn("text-sm font-semibold text-muted-foreground")}>{label}</p>
          <p className="mt-2 truncate text-2xl font-extrabold tabular-nums tracking-tight sm:text-[28px]">{value}</p>
        </div>
        <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-md border border-copper/25 bg-muted/45 text-burgundy", inverse && "text-copper")}>
          <Icon className="size-5" strokeWidth={1.8} />
        </div>
      </div>
      <div className="mt-4 flex min-h-5 items-center gap-2 text-xs">
        {change !== undefined ? (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 font-bold",
              positive ? "text-status-success" : "text-status-danger",
            )}
          >
            <TrendIcon className="size-3.5" /> %{Math.abs(change).toLocaleString("tr-TR")}
          </span>
        ) : null}
        <span className="text-muted-foreground">{changeLabel ?? helper}</span>
      </div>
    </article>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("grid gap-2 text-sm font-semibold text-foreground", className)}>
      <span>{label}</span>
      {children}
      {hint ? <span className="text-xs font-normal leading-5 text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

export function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-10 w-full rounded-lg border border-input bg-card px-3 text-sm font-medium text-foreground outline-none transition focus:border-ring focus:ring-3 focus:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function DataToolbar({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-3 border-b bg-card/60 p-4 sm:flex-row sm:flex-wrap sm:items-center">{children}</div>;
}

export function SummaryChip({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
      {label} <strong className="ml-1 font-extrabold tabular-nums text-foreground">{value}</strong>
    </div>
  );
}
