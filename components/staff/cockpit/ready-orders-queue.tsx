"use client";

import { ChefHat, CheckCircle2 } from "lucide-react";

import type { ReadyOrderEntry } from "@/lib/domain/service-attention";
import { formatElapsed } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The pass: plated food waiting to be carried, oldest first.
 *
 * It has to pull the eye without turning the panel into an alarm board, so it
 * gets one confident green rail and a clock rather than a red field. The clock
 * is the argument — a dish that has been ready four minutes is the problem, not
 * the colour of the row.
 */
export function ReadyOrdersQueue({
  entries,
  onSelectTable,
  className,
}: {
  readonly entries: readonly ReadyOrderEntry[];
  readonly onSelectTable: (tableId: string) => void;
  readonly className?: string;
}) {
  return (
    <section className={cn("space-y-2.5", className)} aria-labelledby="ready-orders-title">
      <div className="flex items-center justify-between gap-3">
        <h2
          id="ready-orders-title"
          className="flex items-center gap-2 font-heading text-base font-semibold text-text-primary"
        >
          <ChefHat className="size-4 text-status-success" strokeWidth={1.9} aria-hidden="true" />
          Hazır Siparişler
        </h2>
        {entries.length ? (
          <span
            className="rounded-full bg-status-success px-2 py-0.5 text-xs font-bold tabular-nums text-white"
            aria-label={`${entries.length} hazır sipariş`}
          >
            {entries.length}
          </span>
        ) : null}
      </div>

      {entries.length ? (
        <ul className="space-y-2">
          {entries.map((entry) => (
            <li key={entry.orderId}>
              <button
                type="button"
                disabled={!entry.tableId}
                onClick={() => entry.tableId && onSelectTable(entry.tableId)}
                className={cn(
                  "motion-press flex min-h-14 w-full items-center gap-3 rounded-xl border border-l-4 border-border-subtle border-l-status-success bg-status-success-tint/45 px-3 py-2.5 text-start",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
                  "disabled:cursor-default disabled:opacity-70",
                )}
                aria-label={`${entry.tableName}: ${entry.summary || "hazır sipariş"}${entry.partial ? ", siparişin kalanı hazırlanıyor" : ""}, ${formatElapsed(entry.elapsedMinutes)} bekliyor.`}
              >
                <CheckCircle2
                  className="size-5 shrink-0 text-status-success"
                  strokeWidth={2}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-extrabold text-text-primary">
                      {entry.tableName}
                    </span>
                    {/* Half a round is still food going cold, but the waiter has
                        to know the rest is not coming with it. */}
                    {entry.partial ? (
                      <span className="shrink-0 rounded-full border border-status-warning/30 bg-status-warning-tint px-1.5 py-0.5 text-[0.6875rem] font-bold text-status-warning">
                        Kısmi
                      </span>
                    ) : null}
                  </span>
                  <span className="block truncate text-xs font-medium text-text-secondary">
                    {entry.summary || "Sipariş hazır"}
                  </span>
                </span>
                <span className="shrink-0 text-sm font-bold tabular-nums text-status-success">
                  {formatElapsed(entry.elapsedMinutes)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed border-border/70 bg-surface-raised px-4 py-5 text-sm text-text-muted">
          Serviste bekleyen hazır sipariş yok.
        </p>
      )}
    </section>
  );
}
