"use client";

import {
  BellRing,
  Check,
  Clock3,
  CookingPot,
  MessageSquareText,
  Play,
  Printer,
  PrinterCheck,
  ReceiptText,
  TriangleAlert,
  Undo2,
  Utensils,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  TICKET_URGENCY_LABELS,
  collectTicketNotes,
  resolveTicketUrgency,
} from "@/lib/domain/kitchen-board";
import { formatElapsed } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Order, OrderItemStatus, OrderStatus } from "@/types";

/**
 * One kitchen ticket, and the vocabulary a ticket is written in.
 *
 * It lives apart from the board because the board now renders three genuinely
 * different layouts around it — a phone's single column, a tablet's two, and a
 * pass screen's three lanes — and all three must show a cook exactly the same
 * ticket. Splitting it is what stops the phone from quietly drifting into a
 * cut-down version of the real thing.
 */

export type KitchenStage = Extract<OrderStatus, "confirmed" | "preparing" | "ready">;
export type PrintTicketStatus = "PENDING" | "PRINTED" | "FAILED";

const ITEM_ACTION_LABELS: Partial<Record<OrderItemStatus, string>> = {
  pending: "Başla",
  preparing: "Hazır",
  ready: "Servis",
};

export const ITEM_STATUS_LABELS: Record<OrderItemStatus, string> = {
  pending: "Bekliyor",
  preparing: "Hazırlanıyor",
  ready: "Hazır",
  served: "Servis edildi",
  cancelled: "İptal",
  voided: "Hesaptan çıkarıldı",
};

export interface StageConfig {
  id: KitchenStage;
  title: string;
  icon: typeof ReceiptText;
  headerClassName: string;
  countClassName: string;
  emptyTitle: string;
  emptyDescription: string;
}

export const stages: StageConfig[] = [
  {
    id: "confirmed",
    title: "Yeni",
    icon: ReceiptText,
    headerClassName: "border-order-new/25 bg-order-new-tint",
    countClassName: "bg-order-new text-white",
    emptyTitle: "Yeni sipariş yok",
    emptyDescription: "Gelen siparişler burada görünecek.",
  },
  {
    id: "preparing",
    title: "Hazırlanıyor",
    icon: CookingPot,
    headerClassName: "border-order-preparing/25 bg-order-preparing-tint",
    countClassName: "bg-order-preparing text-white",
    emptyTitle: "Hazırlık sırası boş",
    emptyDescription: "Başlatılan siparişler burada izlenir.",
  },
  {
    id: "ready",
    title: "Hazır",
    icon: BellRing,
    headerClassName: "border-order-ready/25 bg-order-ready-tint",
    countClassName: "bg-order-ready text-white",
    emptyTitle: "Teslim bekleyen yok",
    emptyDescription: "Hazır siparişler servis için burada bekler.",
  },
];

export function getUrgency(minutes: number) {
  const urgency = resolveTicketUrgency(minutes);

  if (urgency === "late") {
    return {
      label: TICKET_URGENCY_LABELS.late,
      className: "border-status-danger/25 bg-status-danger-tint text-status-danger",
      timeClassName: "text-status-danger",
    };
  }

  if (urgency === "attention") {
    return {
      label: TICKET_URGENCY_LABELS.attention,
      className: "border-status-warning/25 bg-status-warning-tint text-status-warning",
      timeClassName: "text-status-warning",
    };
  }

  return {
    label: TICKET_URGENCY_LABELS["on-time"],
    // Deliberately quiet: green already means "ready" on this board, and a
    // ticket that is merely on schedule must not compete with one that is not.
    className: "border-border-strong bg-surface-muted text-text-secondary",
    timeClassName: "text-text-secondary",
  };
}

export function getAction(stage: KitchenStage) {
  if (stage === "confirmed") {
    return {
      label: "Hazırlamaya başla",
      ariaLabel: "hazırlamaya başlat",
      icon: Play,
      nextStatus: "preparing" as const,
      buttonClassName: "bg-order-preparing text-white hover:bg-order-preparing/90",
    };
  }

  if (stage === "preparing") {
    return {
      label: "Hazır olarak işaretle",
      ariaLabel: "hazır olarak işaretle",
      icon: Check,
      nextStatus: "ready" as const,
      buttonClassName: "bg-copper text-[#2D2018] hover:bg-copper/85",
    };
  }

  return {
    label: "Servise teslim et",
    ariaLabel: "servise teslim et",
    icon: Utensils,
    nextStatus: "served" as const,
    buttonClassName: "bg-status-success text-[#FBF7EF] hover:bg-status-success/90",
  };
}

/**
 * The ticket's own progress, kept deliberately quiet: it sits next to the
 * order number and never competes with the cooking status. "Yazdırıldı" means
 * the bytes reached the printer, not that anyone tore the paper off.
 */
export const PRINT_STATUS: Record<
  PrintTicketStatus,
  { label: string; icon: typeof Printer; className: string }
> = {
  PENDING: { label: "Yazdırma bekliyor", icon: Printer, className: "text-muted-foreground" },
  PRINTED: { label: "Yazdırıldı", icon: PrinterCheck, className: "text-status-success" },
  FAILED: { label: "Yazdırılamadı", icon: TriangleAlert, className: "text-burgundy" },
};

function PrintStatusNote({ status }: { status: PrintTicketStatus | undefined }) {
  if (!status) return null;
  const view = PRINT_STATUS[status];
  const Icon = view.icon;
  return (
    <span className={cn("flex items-center gap-1 text-xs font-medium", view.className)}>
      <Icon className="size-3.5" aria-hidden="true" />
      {view.label}
    </span>
  );
}

export function KitchenOrderCard({
  order,
  stage,
  elapsedMinutes,
  canAdvance,
  pending,
  printStatus,
  itemAction,
  itemRollback,
  onAdvance,
  onAdvanceItem,
  onRollbackItem,
}: {
  order: Order;
  /**
   * The lane this ticket is in, decided by its lines rather than by the order
   * header. A cola added to a finished ticket puts it back in the queue, and
   * the button on it has to be the queue's button — not "servise teslim et"
   * inherited from the round that is already plated.
   */
  stage: KitchenStage;
  elapsedMinutes: number;
  printStatus: PrintTicketStatus | undefined;
  canAdvance: boolean;
  pending: boolean;
  itemAction: (order: Order, item: Order["items"][number]) => OrderItemStatus | null;
  itemRollback: (item: Order["items"][number]) => OrderItemStatus | null;
  onAdvance: (orderId: string, nextStatus: OrderStatus) => void;
  onAdvanceItem: (itemId: string, nextStatus: OrderItemStatus) => void;
  onRollbackItem: (item: Order["items"][number], target: OrderItemStatus) => void;
}) {
  const action = getAction(stage);
  const ActionIcon = action.icon;
  const urgency = getUrgency(elapsedMinutes);
  const ticketNotes = collectTicketNotes(order);

  return (
    <article data-motion-enter="true" className="motion-table motion-operational-state overflow-hidden rounded-2xl border border-[#6B4A32]/12 bg-[#FFFDF8]/88 shadow-[0_14px_34px_rgba(67,45,29,0.08)] backdrop-blur-sm">
      <div className="border-b border-[#6B4A32]/10 bg-white/38 px-4 py-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h3 className="text-2xl font-extrabold leading-none tracking-tight text-foreground">
                {order.tableName}
              </h3>
              <span className="text-base font-bold tabular-nums text-burgundy">
                {order.orderNumber}
              </span>
            </div>
            <p className="mt-1.5 text-xs font-medium text-muted-foreground">
              {order.createdAt} siparişi
              {order.waiterName ? `, ${order.waiterName}` : ", QR menü"}
            </p>
            <div className="mt-1">
              <PrintStatusNote status={printStatus} />
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className={cn("flex items-center justify-end gap-1 text-base font-extrabold tabular-nums", urgency.timeClassName)}>
              <Clock3 className="size-4" aria-hidden="true" />
              {formatElapsed(elapsedMinutes)}
            </div>
            <Badge variant="outline" className={cn("mt-1.5 font-semibold", urgency.className)}>
              {urgency.label}
            </Badge>
          </div>
        </div>
      </div>

      {/*
        The note on the order itself.

        This was never rendered: a guest asking for no onions, or telling the
        kitchen a child is eating, wrote it here from the QR menu and no cook
        ever saw it. It governs every line on the ticket, so it sits above them
        all and is the loudest text on the card after the table number.
      */}
      {ticketNotes.orderNote ? (
        <div className="border-b border-status-warning/30 bg-status-warning-tint px-4 py-3">
          <p className="flex items-start gap-2 text-sm font-bold leading-5 text-[#6A4526]">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={2.2} aria-hidden="true" />
            <span>
              <span className="block text-xs font-extrabold uppercase tracking-[0.06em]">
                Sipariş notu
              </span>
              <span className="mt-0.5 block">{ticketNotes.orderNote}</span>
            </span>
          </p>
        </div>
      ) : null}

      <div className="px-4 py-3">
        <ul className="space-y-3" aria-label={`${order.tableName} sipariş kalemleri`}>
          {order.items.map((item) => {
            const itemStatus = item.status ?? "pending";
            const nextItemStatus = itemAction(order, item);
            const previousItemStatus = itemRollback(item);
            // A voided line was served then written off; either way the kitchen
            // has no work left on it.
            const cancelled = itemStatus === "cancelled" || itemStatus === "voided";
            // A line still pending while the order is already being cooked or
            // plated is a later addition, so it needs to stand out.
            const lateAddition =
              !cancelled &&
              itemStatus === "pending" &&
              (order.status === "preparing" || order.status === "ready");

            return (
              <li
                key={item.id}
                className={cn("grid grid-cols-[2.5rem_1fr] gap-2.5", cancelled && "opacity-55")}
              >
                <span
                  className={cn(
                    "flex h-9 items-center justify-center rounded-lg text-base font-extrabold tabular-nums",
                    cancelled
                      ? "bg-muted/60 text-muted-foreground line-through"
                      : "bg-muted text-foreground",
                  )}
                >
                  {item.quantity}×
                </span>
                <div className="min-w-0 pt-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p
                      className={cn(
                        "text-base font-semibold leading-6",
                        cancelled
                          ? "text-muted-foreground line-through"
                          : "text-foreground",
                      )}
                    >
                      {item.productName}
                      {lateAddition ? (
                        <Badge
                          variant="outline"
                          className="ml-2 border-copper/40 bg-copper/[0.14] align-middle text-xs font-bold text-[#6A4526]"
                        >
                          Yeni eklendi
                        </Badge>
                      ) : null}
                    </p>
                    {nextItemStatus || previousItemStatus ? (
                      <span className="flex shrink-0 items-center gap-2">
                        {previousItemStatus ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={pending}
                            aria-busy={pending}
                            className="size-11 shrink-0 p-0 text-muted-foreground hover:text-foreground"
                            title="Bir önceki aşamaya döndür"
                            aria-label={`${item.productName}: geri al`}
                            onClick={() => onRollbackItem(item, previousItemStatus)}
                          >
                            <Undo2 className="size-4" aria-hidden="true" />
                          </Button>
                        ) : null}
                        {nextItemStatus ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={pending}
                            aria-busy={pending}
                            className="h-11 min-w-16 px-3 text-sm font-bold"
                            aria-label={`${item.productName}: ${ITEM_ACTION_LABELS[itemStatus] ?? "Güncelle"}`}
                            onClick={() => onAdvanceItem(item.id, nextItemStatus)}
                          >
                            {ITEM_ACTION_LABELS[itemStatus] ?? "Güncelle"}
                          </Button>
                        ) : (
                          <span className="text-xs font-semibold text-muted-foreground">
                            {ITEM_STATUS_LABELS[itemStatus]}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span
                        className={cn(
                          "shrink-0 text-xs font-semibold",
                          cancelled ? "text-destructive" : "text-muted-foreground",
                        )}
                      >
                        {ITEM_STATUS_LABELS[itemStatus]}
                      </span>
                    )}
                  </div>
                  {item.note ? (
                    <p className="mt-1.5 flex items-start gap-1.5 rounded-lg bg-burgundy/[0.08] px-2.5 py-2 text-sm font-bold leading-5 text-burgundy">
                      <MessageSquareText className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                      <span>{item.note}</span>
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {canAdvance ? (
        <div className="border-t border-[#6B4A32]/10 bg-[#F8F1E7]/72 p-3">
          <Button
            type="button"
            size="lg"
            disabled={pending}
            aria-busy={pending}
            className={cn("h-14 w-full rounded-xl text-base font-bold", action.buttonClassName)}
            aria-label={`${order.tableName} ${order.orderNumber} siparişini ${action.ariaLabel}`}
            onClick={() => onAdvance(order.id, action.nextStatus)}
          >
            <ActionIcon className="size-4" aria-hidden="true" />
            {action.label}
          </Button>
        </div>
      ) : null}
    </article>
  );
}
