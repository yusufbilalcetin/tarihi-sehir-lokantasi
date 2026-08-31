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
  Record<AttentionReason, { readonly icon: typeof BellRing; readonly tone: string; readonly rail: string }>
> = {
  "order-ready": {
    icon: CheckCircle2,
    tone: "text-status-success",
    rail: "border-l-status-success bg-status-success-tint/55",
  },
  "bill-requested": {
    icon: ReceiptText,
    tone: "text-status-warning",
    rail: "border-l-status-warning bg-status-warning-tint/55",
  },
  "waiter-call": {
    icon: BellRing,
    tone: "text-order-new",
    rail: "border-l-order-new bg-order-new-tint/50",
  },
  "waiting-too-long": {
    icon: Clock3,
    tone: "text-status-danger",
    rail: "border-l-status-danger bg-status-danger-tint/45",
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
                    "motion-press flex min-h-14 w-full items-center gap-3 rounded-xl border border-l-4 border-border-subtle px-3 py-2.5 text-start",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
                    style.rail,
                  )}
                  aria-label={`${entry.tableName}: ${entry.label}, ${formatElapsed(entry.waitingMinutes)}. Masayı aç.`}
                >
                  <Icon className={cn("size-5 shrink-0", style.tone)} strokeWidth={2} aria-hidden="true" />
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
        <p className="flex items-center gap-2 rounded-xl border border-dashed border-border/70 bg-surface-raised px-4 py-5 text-sm text-text-muted">
          <Sparkles className="size-4 shrink-0 text-status-success" strokeWidth={1.8} aria-hidden="true" />
          Bekleyen iş yok. Salon akışında.
        </p>
      )}
    </section>
  );
}
