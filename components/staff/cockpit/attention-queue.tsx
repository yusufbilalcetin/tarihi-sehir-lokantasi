"use client";

import { BellRing, CheckCircle2, Clock3, ReceiptText, Sparkles } from "lucide-react";

import type { AttentionEntry, AttentionReason } from "@/lib/domain/service-attention";
import { formatElapsed } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * "İlgilenmen Gerekenler" — the first thing on the screen, and on a good night
 * the only thing a waiter reads.
 *
 * Everything here is an errand somebody is already waiting on, ranked by
 * `buildAttentionQueue`. When it is empty that is worth saying plainly rather
 * than leaving a gap, because an empty queue is the good state.
 */

const REASON_STYLE: Readonly<
  Record<AttentionReason, { readonly icon: typeof BellRing; readonly tone: string; readonly surface: string; readonly iconSurface: string }>
> = {
  "order-ready": {
    icon: CheckCircle2,
    tone: "text-status-success",
    surface: "bg-[#E7F4EA]/74",
    iconSurface: "bg-[#4E8A62] text-white",
  },
  "bill-requested": {
    icon: ReceiptText,
    tone: "text-status-warning",
    surface: "bg-[#FFF3DC]/80",
    iconSurface: "bg-[#E19B32] text-[#2B211D]",
  },
  "waiter-call": {
    icon: BellRing,
    tone: "text-order-new",
    surface: "bg-[#EAF3FF]/76",
    iconSurface: "bg-[#397FC5] text-white",
  },
  "waiting-too-long": {
    icon: Clock3,
    tone: "text-status-danger",
    surface: "bg-[#F9E8E8]/80",
    iconSurface: "bg-[#B53C48] text-white",
  },
};

export function AttentionQueue({
  entries,
  onSelectTable,
  className,
}: {
  readonly entries: readonly AttentionEntry[];
  readonly onSelectTable: (tableId: string) => void;
  readonly className?: string;
}) {
  return (
    <section className={cn("space-y-2.5", className)} aria-labelledby="attention-queue-title">
      <div className="flex items-center justify-between gap-3">
        <h2
          id="attention-queue-title"
          className="font-heading text-base font-semibold text-text-primary"
        >
          İlgilenmen Gerekenler
        </h2>
        {entries.length ? (
          <span
            className="rounded-full bg-burgundy px-2 py-0.5 text-xs font-bold tabular-nums text-white"
            aria-label={`${entries.length} bekleyen iş`}
          >
            {entries.length}
          </span>
        ) : null}
      </div>

      {entries.length ? (
        <ul className="space-y-2">
          {entries.map((entry) => {
            const style = REASON_STYLE[entry.reason];
            const Icon = style.icon;
            return (
              <li key={`${entry.tableId}-${entry.reason}`}>
                <button
                  type="button"
                  onClick={() => onSelectTable(entry.tableId)}
                  className={cn(
                    "motion-press flex min-h-16 w-full items-center gap-3 rounded-[18px] border border-white/55 px-3 py-2.5 text-start shadow-[0_8px_20px_rgba(67,45,29,0.045)] backdrop-blur-sm",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
                    style.surface,
                  )}
                  aria-label={`${entry.tableName}: ${entry.label}, ${formatElapsed(entry.waitingMinutes)}. Masayı aç.`}
                >
                  <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-[13px]", style.iconSurface)}>
                    <Icon className="size-5" strokeWidth={2} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-extrabold text-text-primary">
                      {entry.tableName}
                    </span>
                    <span className={cn("block truncate text-xs font-semibold", style.tone)}>
                      {entry.label}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-bold tabular-nums text-text-secondary">
                    {formatElapsed(entry.waitingMinutes)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="flex items-center gap-2 rounded-[18px] border border-white/60 bg-white/52 px-4 py-5 text-sm font-medium text-text-muted backdrop-blur-sm">
          <Sparkles className="size-4 shrink-0 text-status-success" strokeWidth={1.8} aria-hidden="true" />
          Bekleyen iş yok. Salon akışında.
        </p>
      )}
    </section>
  );
}
