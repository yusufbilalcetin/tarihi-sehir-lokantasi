"use client";

import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight, CalendarDays, ListFilter, Search } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The admin panel's shared vocabulary.
 *
 * Every screen here used to hand-roll its own card, its own toolbar and its own
 * heading, which is why no two of them aged the same way. These are the shapes
 * that appear on more than one screen; a shape that appears on one belongs to
 * that screen, not to this file.
 *
 * Nothing below picks a colour. They read the semantic tokens, and those are
 * re-pointed for the panel in one block in `globals.css` — so the palette moves
 * from there and never from here.
 */

/**
 * How a manager's page actions reach the page heading that AdminModuleWindow
 * drew before the manager mounted.
 *
 * Both halves of a page header are declared in different places: the title and
 * description come from the route module, while the actions belong to the
 * manager because they need its state — the dialog they open, the row they act
 * on. The old contract handled that by having the manager's AdminPageHeader
 * render *only* its actions, wherever the manager happened to sit in the
 * content flow. That put a lone primary button on its own row below the
 * heading, with the page's whole width of empty space around it.
 *
 * So the module heading now owns a slot element and publishes it here, and the
 * manager portals its actions into it. Neither piece moved file: the title is
 * still rendered once by the module, the actions still once by the manager,
 * and they now land in the same row. A portal rather than state because the
 * actions are live JSX closing over manager state — copying them into a
 * provider's state is how you get a stale closure holding a dead handler.
 *
 * `null` means no module heading is above us, and AdminPageHeader draws the
 * whole header itself.
 */
interface AdminPageHeaderHost {
  /** Null until the heading has mounted and handed us its node. */
  readonly actionSlot: HTMLElement | null;
}

const AdminPageHeaderContext = createContext<AdminPageHeaderHost | null>(null);

export function AdminPageHeaderProvider({
  actionSlot,
  children,
}: {
  actionSlot: HTMLElement | null;
  children: ReactNode;
}) {
  const host = useMemo<AdminPageHeaderHost>(() => ({ actionSlot }), [actionSlot]);
  return <AdminPageHeaderContext.Provider value={host}>{children}</AdminPageHeaderContext.Provider>;
}

/** The clock is an external system, and this is the sanctioned way to read one
 *  without claiming the server and the browser agree about it. */
const NEVER_CHANGES = () => () => {};
const readToday = () =>
  new Date().toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" });

/**
 * Today's date, as a quiet reminder rather than a control.
 *
 * The server renders nothing here on purpose: it can be on a different day
 * from the browser, and a date is exactly the value that turns that into a
 * hydration mismatch. The reserved width keeps the row from shifting when the
 * real date arrives.
 */
export function AdminTodayPill({ className }: { className?: string }) {
  const today = useSyncExternalStore(NEVER_CHANGES, readToday, () => null);

  return (
    <span
      className={cn(
        "inline-flex h-9 min-w-[9.5rem] items-center gap-2 rounded-lg border border-border bg-card px-3 text-[13px] font-medium text-muted-foreground",
        className,
      )}
    >
      <CalendarDays className="size-4 shrink-0 text-muted-foreground/70" strokeWidth={1.75} aria-hidden="true" />
      <span className="truncate">{today ?? " "}</span>
    </span>
  );
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
  const host = useContext(AdminPageHeaderContext);

  // A page heading already exists above us, so this call contributes only its
  // actions — into that heading's row, not into the content below it.
  if (host) {
    if (!actions) return null;
    return host.actionSlot ? createPortal(actions, host.actionSlot) : null;
  }

  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-foreground sm:text-[26px]">{title}</h1>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      {actions ? (
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0 sm:justify-end">{actions}</div>
      ) : null}
    </header>
  );
}

/**
 * A titled region of a page. One hairline border and a white ground — the
 * separation comes from the border and the space around it, not from a shadow
 * and not from nesting another card inside this one.
 */
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
    <section className={cn("overflow-hidden rounded-xl border border-border bg-card", className)}>
      {title || action ? (
        <div className="flex flex-col gap-3 border-b border-border px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="min-w-0">
            {title ? <h2 className="text-[15px] font-semibold text-foreground">{title}</h2> : null}
            {description ? (
              <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">{description}</p>
            ) : null}
          </div>
          {action ? <div className="flex min-w-0 flex-wrap items-center gap-2">{action}</div> : null}
        </div>
      ) : null}
      <div className={cn("p-4 sm:p-5", contentClassName)}>{children}</div>
    </section>
  );
}

const KPI_TONES = {
  default: "bg-muted text-muted-foreground",
  success: "bg-status-success-tint text-status-success",
  warning: "bg-status-warning-tint text-status-warning",
  danger: "bg-status-danger-tint text-status-danger",
  info: "bg-status-info-tint text-status-info",
} as const;

export type AdminKpiTone = keyof typeof KPI_TONES;

/**
 * One number, said once.
 *
 * The tint belongs to the icon chip and stops there: four of these sit in a
 * row, and tinting the whole card four different ways turns a summary into a
 * traffic light. Three or four per screen is the budget — a page of these is
 * a page with no answer on it.
 */
export function AdminKpi({
  label,
  value,
  helper,
  icon: Icon,
  change,
  changeLabel,
  tone = "default",
  inverse = false,
}: {
  label: string;
  value: string;
  helper?: string;
  icon: LucideIcon;
  change?: number;
  changeLabel?: string;
  tone?: AdminKpiTone;
  /** Retained for callers that predate `tone`; reads as the neutral card. */
  inverse?: boolean;
}) {
  const positive = (change ?? 0) >= 0;
  const TrendIcon = positive ? ArrowUpRight : ArrowDownRight;
  const footnote = changeLabel ?? helper;

  return (
    <article className={cn("rounded-xl border border-border bg-card p-4", inverse && "border-border-strong")}>
      <div className="flex items-center gap-2.5">
        <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", KPI_TONES[tone])}>
          <Icon className="size-[18px]" strokeWidth={1.75} />
        </span>
        <p className="min-w-0 truncate text-[13px] font-medium text-muted-foreground">{label}</p>
      </div>
      <p className="mt-3 truncate text-[26px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-foreground">
        {value}
      </p>
      {change !== undefined || footnote ? (
        <div className="mt-2 flex min-h-[18px] items-center gap-1.5 text-[12px]">
          {change !== undefined ? (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 font-semibold tabular-nums",
                positive ? "text-status-success" : "text-status-danger",
              )}
            >
              <TrendIcon className="size-3.5" aria-hidden="true" />%{Math.abs(change).toLocaleString("tr-TR")}
            </span>
          ) : null}
          {footnote ? <span className="truncate text-muted-foreground">{footnote}</span> : null}
        </div>
      ) : null}
    </article>
  );
}

export interface AdminSegment {
  readonly value: string;
  readonly label: string;
  /** Rendered as the small count inside the pill. */
  readonly count?: number;
}

/**
 * The segmented filter the reference uses for departments, for date ranges and
 * for payroll views alike — one control, so those three read as the same idea.
 *
 * A radiogroup rather than tabs: it filters what a table shows, it does not
 * swap panels, and arrow keys should move the selection the way they do in a
 * radio group.
 */
export function AdminSegmentedControl({
  segments,
  value,
  onValueChange,
  label,
  className,
}: {
  segments: readonly AdminSegment[];
  value: string;
  onValueChange: (value: string) => void;
  label: string;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {segments.map((segment) => {
        const selected = segment.value === value;
        return (
          <button
            key={segment.value}
            type="button"
            role="radio"
            // The phone touch-target rule in globals.css keys off this slot, and
            // a filter chip is a button by every measure except the component it
            // is built from. Without it the chip stays 32px under the thumb.
            data-slot="button"
            aria-checked={selected}
            onClick={() => onValueChange(segment.value)}
            className={cn(
              "motion-press inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium transition-colors duration-150",
              selected
                ? "border-accent-foreground/20 bg-accent text-accent-foreground"
                : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <span className="truncate">{segment.label}</span>
            {segment.count !== undefined ? (
              <span
                className={cn(
                  "rounded px-1 text-[11px] font-semibold tabular-nums",
                  selected ? "bg-accent-foreground/10" : "bg-muted text-muted-foreground",
                )}
              >
                {segment.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function AdminSearchInput({
  value,
  onValueChange,
  placeholder,
  label,
  className,
}: {
  value: string;
  onValueChange: (value: string) => void;
  placeholder: string;
  label: string;
  className?: string;
}) {
  return (
    <label className={cn("relative block w-full sm:w-64", className)}>
      <span className="sr-only">{label}</span>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/70"
        aria-hidden="true"
      />
      <input
        type="search"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder={placeholder}
        className="h-9 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-[13px] font-medium text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-ring focus:ring-2 focus:ring-ring/20"
      />
    </label>
  );
}

/**
 * The one control that opens the filters, instead of eight selects laid across
 * the top of the page. What it opens is the caller's business.
 */
export function AdminFilterButton({
  onClick,
  activeCount = 0,
  label = "Filtrele",
  className,
}: {
  onClick?: () => void;
  activeCount?: number;
  label?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "motion-press inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-muted",
        className,
      )}
    >
      <ListFilter className="size-4 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
      <span>{label}</span>
      {activeCount > 0 ? (
        <span className="rounded bg-accent px-1 text-[11px] font-semibold tabular-nums text-accent-foreground">
          {activeCount}
        </span>
      ) : null}
    </button>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("grid gap-1.5 text-[13px] font-medium text-foreground", className)}>
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
        "h-9 w-full rounded-lg border border-input bg-card px-3 text-[13px] font-medium text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function DataToolbar({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2.5 border-b border-border p-3 [&>*]:min-w-0 sm:flex-row sm:flex-wrap sm:items-center sm:p-4">
      {children}
    </div>
  );
}

export function SummaryChip({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border bg-muted/60 px-3 py-1.5 text-[12px] text-muted-foreground">
      {label} <strong className="ml-1 font-semibold tabular-nums text-foreground">{value}</strong>
    </div>
  );
}
