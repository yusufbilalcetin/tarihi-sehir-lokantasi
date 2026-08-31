"use client";

import { cn } from "@/lib/utils";
import type { KitchenStage } from "@/components/kitchen/kitchen-ticket";

/**
 * The phone's way through the board.
 *
 * A pass screen shows three lanes at once because it has the width for it. A
 * phone does not, and squeezing three 100px columns onto one would make every
 * ticket unreadable — so the phone gets one column and this rail chooses which
 * tickets are in it. "Geciken" is a cut across the stages rather than a stage
 * of its own, because on a phone that is the question actually being asked.
 */

export type KitchenFilter = KitchenStage | "all" | "late";

export interface KitchenFilterOption {
  readonly id: KitchenFilter;
  readonly label: string;
  readonly count: number;
  /** Late is the one filter that earns colour of its own. */
  readonly urgent?: boolean;
}

export function KitchenFilters({
  options,
  active,
  onChange,
  className,
}: {
  readonly options: readonly KitchenFilterOption[];
  readonly active: KitchenFilter;
  readonly onChange: (filter: KitchenFilter) => void;
  readonly className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="Sipariş filtresi"
      className={cn(
        "-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
    >
      {options.map((option) => {
        const selected = active === option.id;
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            aria-pressed={selected}
            className={cn(
              "motion-press flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-bold",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
              selected
                ? "border-transparent bg-[#FBF7EF] text-[#2D2018]"
                : "border-white/20 bg-white/5 text-[#F5EBDD]/80",
              !selected && option.urgent && option.count > 0 && "border-status-danger/50 text-[#FFD9D2]",
            )}
          >
            {option.label}
            <span
              className={cn(
                "min-w-5 rounded-full px-1.5 text-xs font-extrabold tabular-nums",
                selected ? "bg-[#2D2018]/10 text-[#2D2018]" : "bg-white/10 text-[#F5EBDD]",
                !selected && option.urgent && option.count > 0 && "bg-status-danger text-white",
              )}
            >
              {option.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
