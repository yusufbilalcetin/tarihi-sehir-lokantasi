import { Clock3, UsersRound } from "lucide-react";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { RestaurantTable, TableStatus } from "@/types";

const statusStyles: Record<TableStatus, string> = {
  available: "border-l-emerald-600 hover:border-emerald-300",
  occupied: "border-l-stone-500 hover:border-stone-300",
  ordering: "border-l-amber-500 bg-amber-50/35 hover:border-amber-300",
  waiting: "border-l-amber-600 bg-amber-50/35 hover:border-amber-300",
  dining: "border-l-sky-600 hover:border-sky-300",
  "waiter-call": "border-l-rose-600 bg-rose-50/45 hover:border-rose-300",
  "bill-requested": "border-l-violet-600 bg-violet-50/45 hover:border-violet-300",
  cleaning: "border-l-cyan-600 hover:border-cyan-300",
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
  return (
    <button
      type="button"
      onClick={() => onSelect(table)}
      className={cn(
        "group flex min-h-36 w-full flex-col rounded-xl border border-l-4 bg-card p-4 text-left shadow-[0_10px_26px_rgb(74_40_40/0.055)] transition-colors hover:bg-card/80 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/45",
        compact && "min-h-32",
        statusStyles[table.status],
      )}
      aria-label={`${table.name} detayını aç`}
    >
      <div className="flex w-full items-start justify-between gap-3">
        <div>
          <span className="font-heading text-xl font-semibold tracking-tight text-foreground">
            {table.name}
          </span>
          <span className="mt-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <UsersRound className="size-3.5" strokeWidth={1.8} />
            {table.seats} kişilik
          </span>
        </div>
        {table.total ? (
          <span className="text-sm font-bold tabular-nums text-foreground">
            {formatCurrency(table.total)}
          </span>
        ) : null}
      </div>

      <div className="mt-auto flex w-full items-end justify-between gap-3 pt-4">
        <StatusBadge status={table.status} className="max-w-full" />
        <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-muted-foreground">
          <Clock3 className="size-3" strokeWidth={1.8} />
          {table.lastActivity}
        </span>
      </div>
    </button>
  );
}
