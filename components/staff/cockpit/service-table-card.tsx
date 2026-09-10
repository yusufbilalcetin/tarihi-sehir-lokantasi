"use client";

import { BellRing, CheckCircle2, Circle, ReceiptText, UsersRound, UtensilsCrossed } from "lucide-react";

import { resolveTableLabel, resolveTableTone, type ServiceTone } from "@/lib/domain/service-attention";
import { formatCurrency, formatElapsed } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { RestaurantTable } from "@/types";

/**
 * One table, compact enough that a section of the room fits on a phone.
 *
 * Four facts in a fixed order, so two cards side by side can be compared
 * without reading either: the number, what it owes, how many are sitting, and
 * what it is doing. The rows are a fixed rhythm and the card stretches to its
 * grid row, so a long status never makes one tile taller than its neighbour.
 *
 * State is carried by an icon, a word and a tone together — never by tone
 * alone. The tone is spent on a left rail and a small badge rather than on the
 * whole tile: a room where four tables have asked for the bill should not be
 * four sheets of orange, or the one that is actually on fire stops standing out.
 */

const TONE_SURFACE: Readonly<Record<ServiceTone, string>> = {
  neutral: "border-white/60 bg-white/58",
  active: "border-[#278D7C]/18 bg-[#E8F5F1]/72",
  ready: "border-[#4E8A62]/20 bg-[#E7F4EA]/78",
  waiting: "border-[#397FC5]/18 bg-[#EAF3FF]/76",
  bill: "border-[#E19B32]/22 bg-[#FFF3DC]/82",
  muted: "border-[#6B4A32]/10 bg-white/42",
};

const TONE_BADGE: Readonly<Record<ServiceTone, string>> = {
  neutral: "bg-surface-muted text-text-muted",
  active: "bg-order-served-tint text-order-served",
  ready: "bg-status-success-tint text-status-success",
  waiting: "bg-order-new-tint text-order-new",
  bill: "bg-status-warning-tint text-status-warning",
  muted: "bg-surface-muted text-text-muted",
};

const TONE_ICON_SURFACE: Readonly<Record<ServiceTone, string>> = {
  neutral: "bg-[#817367] text-white",
  active: "bg-[#278D7C] text-white",
  ready: "bg-[#4E8A62] text-white",
  waiting: "bg-[#397FC5] text-white",
  bill: "bg-[#E19B32] text-[#2B211D]",
  muted: "bg-[#9A8C80] text-white",
};

const TONE_ICON: Readonly<Record<ServiceTone, typeof Circle>> = {
  neutral: Circle,
  active: UtensilsCrossed,
  ready: CheckCircle2,
  waiting: BellRing,
  bill: ReceiptText,
  muted: Circle,
};

export function ServiceTableCard({
  table,
  hasReadyOrder,
  selected = false,
  onSelect,
}: {
  readonly table: RestaurantTable;
  readonly hasReadyOrder: boolean;
  readonly selected?: boolean;
  readonly onSelect: (table: RestaurantTable) => void;
}) {
  const tone = resolveTableTone(table.status, hasReadyOrder);
  const label = resolveTableLabel(table.status, hasReadyOrder);
  const Icon = TONE_ICON[tone];
  const minutes = table.activeMinutes;

  return (
    <button
      type="button"
      onClick={() => onSelect(table)}
      aria-pressed={selected}
      aria-label={`${table.name}, ${label}, ${table.seats} kişilik${
        minutes ? `, ${formatElapsed(minutes)}` : ""
      }. Masa detayını aç.`}
      className={cn(
        "motion-press motion-operational-state flex h-full min-h-32 w-full flex-col rounded-[22px] border p-3.5 text-start shadow-[0_12px_28px_rgba(67,45,29,0.065)] backdrop-blur-md",
        "transition-[border-color,box-shadow] duration-[var(--motion-quick)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
        TONE_SURFACE[tone],
        selected && "ring-2 ring-copper ring-offset-2 ring-offset-surface",
      )}
    >
      {/* The number leads; what the table owes is the one number beside it. */}
      <span className="flex items-start justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2.5">
          <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-[13px] shadow-[0_6px_14px_rgba(43,33,29,0.13)]", TONE_ICON_SURFACE[tone])}>
            <Icon className="size-5" strokeWidth={2} aria-hidden="true" />
          </span>
          <span className="min-w-0 truncate text-[18px] font-extrabold leading-tight tracking-tight text-text-primary">
            {table.name}
          </span>
        </span>
        {table.total ? (
          <span className="shrink-0 text-xs font-bold tabular-nums text-burgundy">
            {formatCurrency(table.total)}
          </span>
        ) : null}
      </span>

      <span className="mt-2 flex items-center gap-1 text-xs font-medium text-text-muted">
        <UsersRound className="size-3 shrink-0" strokeWidth={1.8} aria-hidden="true" />
        {table.seats} kişilik
      </span>

      <span className="mt-auto flex flex-wrap items-center justify-between gap-x-2 gap-y-1 pt-2">
        <span
          className={cn(
            "inline-flex min-w-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-bold",
            TONE_BADGE[tone],
          )}
        >
          <span className="truncate">{label}</span>
        </span>
        {minutes ? (
          <span className="ms-auto shrink-0 text-[11px] font-semibold tabular-nums text-text-muted">
            {formatElapsed(minutes)}
          </span>
        ) : null}
      </span>
    </button>
  );
}
