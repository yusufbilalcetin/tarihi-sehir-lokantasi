"use client";

import { ChefHat, CircleCheckBig, Clock3, CookingPot, ReceiptText } from "lucide-react";

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

const FILTER_VIEW = {
  all: { icon: ChefHat, iconClassName: "bg-[#6D5C50] text-white" },
  late: { icon: Clock3, iconClassName: "bg-[#B53C48] text-white" },
  confirmed: { icon: ReceiptText, iconClassName: "bg-[#397FC5] text-white" },
  preparing: { icon: CookingPot, iconClassName: "bg-[#E29A2F] text-[#2B211D]" },
  ready: { icon: CircleCheckBig, iconClassName: "bg-[#4E8A62] text-white" },
} as const;

export interface KitchenFilterOption {
  readonly id: KitchenFilter;
  readonly label: string;
  /** Null until the first read lands. An unread board has no count, not zero. */
  readonly count: number | null;
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
        "-mx-3 flex gap-2.5 overflow-x-auto px-3 pb-2 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-5 sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden",
        className,
      )}
    >
      {options.map((option) => {
        const selected = active === option.id;
        const view = FILTER_VIEW[option.id];
        const Icon = view.icon;
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            aria-pressed={selected}
            className={cn(
              "motion-press flex min-h-[76px] min-w-[76px] shrink-0 flex-col items-center justify-center gap-1.5 rounded-[20px] border px-2 py-2 text-xs font-bold sm:min-w-0",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
              selected
                ? "border-[#3D2A20]/18 bg-white/82 text-[#2B211D] shadow-[0_10px_24px_rgba(67,45,29,0.09)]"
                : "border-white/60 bg-white/46 text-[#655244] backdrop-blur-sm",
              !selected && option.urgent && (option.count ?? 0) > 0 && "border-status-danger/35 bg-status-danger-tint/65 text-status-danger",
            )}
          >
            <span className={cn("relative flex size-9 items-center justify-center rounded-[12px] shadow-[0_5px_12px_rgba(43,33,29,0.12)]", view.iconClassName)}>
              <Icon className="size-[18px]" strokeWidth={2} aria-hidden="true" />
              <span className="absolute -end-1.5 -top-1.5 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-[#2B211D] px-1 text-[9px] font-extrabold leading-4 text-white ring-2 ring-[#F7F0E6]">
                {option.count ?? "—"}
              </span>
            </span>
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
