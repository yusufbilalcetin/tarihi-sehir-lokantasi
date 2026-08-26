import { BellRing, Clock3, ReceiptText, UsersRound } from "lucide-react";

import { Money } from "@/components/shared/money";
import { StatusBadge } from "@/components/shared/status-badge";
import { cn } from "@/lib/utils";
import type { RestaurantTable, TableStatus } from "@/types";

/**
 * One table on the floor plan.
 *
 * A waiter crossing a room needs to find the right table in about a second, so
 * the number is the largest thing on the card and everything else is arranged
 * under it in the order the floor actually asks for: what state is it in, does
 * it need me *now*, what does it owe, and only then the details.
 *
 * The left edge used to carry nine unrelated hues — emerald, stone, amber, sky,
 * rose, violet, cyan — which made the floor plan read like a chart legend. It
 * now carries the same order/status tokens the rest of the product uses.
 *
 * The two states that mean "somebody is waiting for you" get a labelled marker
 * rather than only a colour, because a tint alone is both easy to miss across a
 * room and invisible to anyone who cannot separate these hues.
 */

/** The accent rail, from the shared status vocabulary rather than ad-hoc hues. */
const RAIL: Readonly<Record<TableStatus, string>> = {
  available: "border-l-status-success",
  occupied: "border-l-order-settled",
  ordering: "border-l-order-new",
  waiting: "border-l-order-new",
  dining: "border-l-order-served",
  "waiter-call": "border-l-status-danger bg-status-danger-tint/40",
  "bill-requested": "border-l-status-warning bg-status-warning-tint/40",
  cleaning: "border-l-status-info",
  inactive: "border-l-border-strong bg-surface-muted/50",
};

/** States where somebody at the table is actively waiting on staff. */
const ATTENTION: Partial<Record<TableStatus, { label: string; icon: typeof BellRing; tone: string }>> = {
  "waiter-call": { label: "Garson çağırdı", icon: BellRing, tone: "bg-status-danger text-white" },
  "bill-requested": { label: "Hesap istedi", icon: ReceiptText, tone: "bg-status-warning text-white" },
};

export function TableCard({
  table,
  onSelect,
  compact = false,
}: {
  table: RestaurantTable;
  onSelect: (table: RestaurantTable) => void;
  compact?: boolean;
}) {
  const attention = ATTENTION[table.status];

  return (
    <button
      type="button"
      onClick={() => onSelect(table)}
      className={cn(
        "group flex min-h-36 w-full flex-col rounded-2xl border border-l-4 border-border-subtle bg-surface-raised p-4 text-left",
        "shadow-[var(--shadow-raised)] transition-colors hover:border-copper/50 hover:bg-surface-muted/40",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
        compact && "min-h-32",
        RAIL[table.status],
      )}
      aria-label={`${table.name} detayını aç`}
    >
      <div className="flex w-full items-start justify-between gap-3">
        <div className="min-w-0">
          {/* Priority one: which table this is, readable at a glance. */}
          <span className="block truncate font-heading text-2xl font-bold leading-tight tracking-tight text-text-primary">
            {table.name}
          </span>
          <span className="mt-1 flex items-center gap-1.5 text-xs font-medium text-text-muted">
            <UsersRound className="size-3.5" strokeWidth={1.8} aria-hidden="true" />
            {table.seats} kişilik
          </span>
        </div>
        {table.total ? (
          <Money amount={table.total} size="sm" className="shrink-0" />
        ) : null}
      </div>

      {attention ? (
        <span
          className={cn(
            "mt-3 inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
            attention.tone,
          )}
        >
          <attention.icon className="size-3.5" strokeWidth={2.2} aria-hidden="true" />
          {attention.label}
        </span>
      ) : null}

      <div className="mt-auto flex w-full items-end justify-between gap-3 pt-4">
        <StatusBadge status={table.status} size="sm" className="max-w-full" />
        <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-text-muted">
          <Clock3 className="size-3" strokeWidth={1.8} aria-hidden="true" />
          {table.lastActivity}
        </span>
      </div>
    </button>
  );
}
