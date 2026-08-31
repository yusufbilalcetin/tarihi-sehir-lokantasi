"use client";

import type { ReactNode } from "react";

import { AttentionQueue } from "@/components/staff/cockpit/attention-queue";
import type { AttentionEntry } from "@/lib/domain/service-attention";
import { cn } from "@/lib/utils";

/**
 * The waiter's home: what needs a person, then the room. Nothing else.
 *
 * This is the screen a waiter scrolls to the bottom of during service, so what
 * sits after the last table card matters. The answer is nothing — no clocking
 * in, no shift list, no account settings. Those are personal and live behind
 * the Profil tab; here the board simply ends and the bottom bar begins.
 */

export interface TableFilterOption {
  readonly id: string;
  readonly label: string;
}

export function ServiceHome({
  attention,
  filters,
  activeFilter,
  onFilterChange,
  onSelectTable,
  visibleCount,
  totalCount,
  board,
  className,
}: {
  readonly attention: readonly AttentionEntry[];
  readonly filters: readonly TableFilterOption[];
  readonly activeFilter: string;
  readonly onFilterChange: (id: string) => void;
  readonly onSelectTable: (tableId: string) => void;
  readonly visibleCount: number;
  readonly totalCount: number;
  readonly board: ReactNode;
  readonly className?: string;
}) {
  return (
    <div className={cn("space-y-5", className)} data-service-home="operational">
      <AttentionQueue entries={attention} onSelectTable={onSelectTable} />

      <section aria-labelledby="table-board-title" className="space-y-2.5">
        <div className="flex items-center justify-between gap-3">
          <h2
            id="table-board-title"
            className="font-heading text-base font-semibold text-text-primary"
          >
            Masalar
          </h2>
          <span className="text-xs font-medium tabular-nums text-text-muted">
            {visibleCount}/{totalCount}
          </span>
        </div>

        <div
          className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="group"
          aria-label="Masa filtresi"
        >
          {filters.map((filter) => (
            <button
              key={filter.id}
              type="button"
              onClick={() => onFilterChange(filter.id)}
              aria-pressed={activeFilter === filter.id}
              className={cn(
                "motion-press min-h-11 shrink-0 rounded-full border border-border-subtle px-3.5 text-sm font-semibold text-text-secondary",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                activeFilter === filter.id &&
                  "border-order-served/40 bg-order-served-tint text-order-served",
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>

        {board}
      </section>
    </div>
  );
}
