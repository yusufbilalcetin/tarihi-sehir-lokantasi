"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BellRing,
  Check,
  ChefHat,
  CircleCheckBig,
  Clock3,
  CookingPot,
  MessageSquareText,
  Play,
  Printer,
  PrinterCheck,
  Undo2,
  ReceiptText,
  TriangleAlert,
  Utensils,
} from "lucide-react";
import { toast } from "sonner";
import { BrandMark } from "@/components/shared/brand-mark";
import { EmptyState } from "@/components/shared/data-states";
import { RealtimeStatus } from "@/components/staff/realtime-status";
import { useStaffSession } from "@/components/staff/staff-session-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  staffOrderToViewModel,
  toApiOrderItemStatus,
  toApiOrderStatus,
} from "@/lib/adapters/staff-view-model";
import { ApiClientError } from "@/lib/api/client";
import { printApi, staffApi } from "@/lib/api/endpoints";
import {
  canRoleTransitionOrderItemStatus,
  canRoleTransitionOrderStatus,
  deriveKitchenStage,
} from "@/lib/domain/status";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useApiResource } from "@/lib/hooks/use-api-resource";
import { useStaffRealtime } from "@/lib/realtime/use-staff-realtime";
import { cn } from "@/lib/utils";
import type { Order, OrderItemStatus, OrderStatus } from "@/types";

type KitchenStage = Extract<OrderStatus, "confirmed" | "preparing" | "ready">;
type PrintTicketStatus = "PENDING" | "PRINTED" | "FAILED";

const KITCHEN_POLL_MS = 15_000;

/** The board's three columns, keyed by the domain's own kitchen stage. */
const KITCHEN_COLUMN_FOR_STAGE: Record<"PENDING" | "PREPARING" | "READY", KitchenStage> = {
  PENDING: "confirmed",
  PREPARING: "preparing",
  READY: "ready",
};

const ITEM_NEXT_STATUS: Partial<Record<OrderItemStatus, OrderItemStatus>> = {
  pending: "preparing",
  preparing: "ready",
  ready: "served",
};

/** The one step back the kitchen may take from each state. */
const ITEM_PREVIOUS_STATUS: Partial<Record<OrderItemStatus, OrderItemStatus>> = {
  preparing: "pending",
  ready: "preparing",
};

const ROLLBACK_REASONS: { value: string; label: string }[] = [
  { value: "UNDERCOOKED", label: "Eksik hazırlandı" },
  { value: "REHEAT", label: "Tekrar ısıtılacak" },
  { value: "MARKED_BY_MISTAKE", label: "Yanlışlıkla hazır yapıldı" },
  { value: "OTHER", label: "Diğer" },
];

const ITEM_ACTION_LABELS: Partial<Record<OrderItemStatus, string>> = {
  pending: "Başla",
  preparing: "Hazır",
  ready: "Servis",
};

const ITEM_STATUS_LABELS: Record<OrderItemStatus, string> = {
  pending: "Bekliyor",
  preparing: "Hazırlanıyor",
  ready: "Hazır",
  served: "Servis edildi",
  cancelled: "İptal",
  voided: "Hesaptan çıkarıldı",
};

interface StageConfig {
  id: KitchenStage;
  title: string;
  description: string;
  icon: typeof ReceiptText;
  headerClassName: string;
  countClassName: string;
  emptyTitle: string;
  emptyDescription: string;
}

const stages: StageConfig[] = [
  {
    id: "confirmed",
    title: "Yeni",
    description: "Hazırlığa alınacak",
    icon: ReceiptText,
    headerClassName: "border-order-new/25 bg-order-new-tint",
    countClassName: "bg-order-new text-white",
    emptyTitle: "Yeni sipariş yok",
    emptyDescription: "Gelen siparişler burada görünecek.",
  },
  {
    id: "preparing",
    title: "Hazırlanıyor",
    description: "Mutfakta işlemde",
    icon: CookingPot,
    headerClassName: "border-order-preparing/25 bg-order-preparing-tint",
    countClassName: "bg-order-preparing text-white",
    emptyTitle: "Hazırlık sırası boş",
    emptyDescription: "Başlatılan siparişler burada izlenir.",
  },
  {
    id: "ready",
    title: "Hazır",
    description: "Servis teslimi bekliyor",
    icon: BellRing,
    headerClassName: "border-order-ready/25 bg-order-ready-tint",
    countClassName: "bg-order-ready text-white",
    emptyTitle: "Teslim bekleyen yok",
    emptyDescription: "Hazır siparişler servis için burada bekler.",
  },
];

function formatClock(date: Date | null) {
  if (!date) return "--:--";
  return new Intl.DateTimeFormat("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function formatDate(date: Date | null) {
  if (!date) return "Bugün";
  return new Intl.DateTimeFormat("tr-TR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date);
}

function getUrgency(minutes: number) {
  if (minutes >= 15) {
    return {
      label: "Gecikti",
      className: "border-status-danger/25 bg-status-danger-tint text-status-danger",
      timeClassName: "text-status-danger",
    };
  }

  if (minutes >= 8) {
    return {
      label: "Öncelikli",
      className: "border-status-warning/25 bg-status-warning-tint text-status-warning",
      timeClassName: "text-status-warning",
    };
  }

  return {
    label: "Zamanında",
    // Deliberately quiet: green already means "ready" on this board, and a
    // ticket that is merely on schedule must not compete with one that is not.
    className: "border-border-strong bg-surface-muted text-text-secondary",
    timeClassName: "text-text-secondary",
  };
}

function getAction(stage: KitchenStage) {
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
      buttonClassName: "bg-copper text-[#25211D] hover:bg-copper/85",
    };
  }

  return {
    label: "Servise teslim et",
    ariaLabel: "servise teslim et",
    icon: Utensils,
    nextStatus: "served" as const,
    buttonClassName: "bg-olive text-[#FFFDF8] hover:bg-olive/90",
  };
}

/**
 * The ticket's own progress, kept deliberately quiet: it sits next to the
 * order number and never competes with the cooking status. "Yazdırıldı" means
 * the bytes reached the printer, not that anyone tore the paper off.
 */
const PRINT_STATUS: Record<
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

function KitchenOrderCard({
  order,
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
  const stage = order.status as KitchenStage;
  const action = getAction(stage);
  const ActionIcon = action.icon;
  const urgency = getUrgency(elapsedMinutes);

  return (
    <article className="overflow-hidden rounded-xl border border-border bg-card shadow-[0_12px_32px_rgba(74,40,40,0.065)]">
      <div className="border-b border-border px-4 py-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h3 className="font-heading text-xl font-semibold leading-none text-foreground">
                {order.tableName}
              </h3>
              <span className="text-sm font-bold tabular-nums text-burgundy">
                {order.orderNumber}
              </span>
            </div>
            <p className="mt-2 text-xs font-medium text-muted-foreground">
              {order.createdAt} siparişi
              {order.waiterName ? `, ${order.waiterName}` : ", QR menü"}
            </p>
            <div className="mt-1">
              <PrintStatusNote status={printStatus} />
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className={cn("flex items-center justify-end gap-1 text-sm font-extrabold tabular-nums", urgency.timeClassName)}>
              <Clock3 className="size-4" aria-hidden="true" />
              {elapsedMinutes} dk
            </div>
            <Badge variant="outline" className={cn("mt-1.5 font-semibold", urgency.className)}>
              {urgency.label}
            </Badge>
          </div>
        </div>
      </div>

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
                className={cn("grid grid-cols-[2.25rem_1fr] gap-2.5", cancelled && "opacity-55")}
              >
                <span
                  className={cn(
                    "flex h-8 items-center justify-center rounded-lg text-sm font-extrabold tabular-nums",
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
                        "font-semibold leading-5",
                        cancelled
                          ? "text-muted-foreground line-through"
                          : "text-foreground",
                      )}
                    >
                      {item.productName}
                      {lateAddition ? (
                        <Badge
                          variant="outline"
                          className="ml-2 border-copper/40 bg-copper/[0.14] align-middle text-[10px] font-bold text-[#6A4526]"
                        >
                          Yeni eklendi
                        </Badge>
                      ) : null}
                    </p>
                    {nextItemStatus || previousItemStatus ? (
                      <span className="flex shrink-0 items-center gap-1.5">
                        {previousItemStatus ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={pending}
                            aria-busy={pending}
                            className="h-8 px-2 text-xs font-semibold text-muted-foreground hover:text-foreground"
                            title="Bir önceki aşamaya döndür"
                            aria-label={`${item.productName}: geri al`}
                            onClick={() => onRollbackItem(item, previousItemStatus)}
                          >
                            <Undo2 className="size-3.5" aria-hidden="true" /> Geri Al
                          </Button>
                        ) : null}
                        {nextItemStatus ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={pending}
                            aria-busy={pending}
                            className="h-8 px-2.5 text-xs font-bold"
                            aria-label={`${item.productName}: ${ITEM_ACTION_LABELS[itemStatus] ?? "Güncelle"}`}
                            onClick={() => onAdvanceItem(item.id, nextItemStatus)}
                          >
                            {ITEM_ACTION_LABELS[itemStatus] ?? "Güncelle"}
                          </Button>
                        ) : (
                          <span className="text-[11px] font-semibold text-muted-foreground">
                            {ITEM_STATUS_LABELS[itemStatus]}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span
                        className={cn(
                          "shrink-0 text-[11px] font-semibold",
                          cancelled ? "text-destructive" : "text-muted-foreground",
                        )}
                      >
                        {ITEM_STATUS_LABELS[itemStatus]}
                      </span>
                    )}
                  </div>
                  {item.note ? (
                    <p className="mt-1.5 flex items-start gap-1.5 rounded-lg bg-burgundy/[0.06] px-2.5 py-2 text-xs font-semibold leading-5 text-burgundy">
                      <MessageSquareText className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
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
        <div className="border-t border-border bg-muted/35 p-3">
          <Button
            type="button"
            size="lg"
            disabled={pending}
            aria-busy={pending}
            className={cn("h-11 w-full text-sm font-bold", action.buttonClassName)}
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

/**
 * `inWindow` renders the board as a module-window body: the page-level chrome
 * (its own dark bar, clock and ticket count) is suppressed because the window
 * header already carries that context, and two stacked headers would cost the
 * kitchen a strip of screen it needs for tickets.
 */
export function KitchenBoard({ inWindow = false }: { inWindow?: boolean } = {}) {
  const { role } = useStaffSession();
  const [now, setNow] = useState<Date | null>(null);
  const [pending, setPending] = useState(false);
  const [rollback, setRollback] = useState<{
    item: Order["items"][number];
    target: OrderItemStatus;
  } | null>(null);
  const [rollbackReason, setRollbackReason] = useState<string>("MARKED_BY_MISTAKE");

  // Only what the kitchen still owes a table: the list is newest-first and
  // capped, so settled orders would use up the rows a ticket that is still
  // cooking needs, silently pushing the oldest live order off the board.
  const loadOrders = useCallback(
    (signal: AbortSignal) => staffApi.orders({ open: true }, signal),
    [],
  );
  const resource = useApiResource(loadOrders, { pollMs: KITCHEN_POLL_MS });
  const { refetch } = resource;
  const realtimeStatus = useStaffRealtime({
    onEvent: useCallback(() => void refetch(), [refetch]),
    onResync: useCallback(() => void refetch(), [refetch]),
  });

  useEffect(() => {
    // Deferred so the ticking clock never sets state inside the effect body.
    const timer = window.setTimeout(() => setNow(new Date()), 0);
    const interval = window.setInterval(() => setNow(new Date()), 1_000);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
    };
  }, []);

  // Zero until the first client tick; minutesSince clamps negatives to 0.
  const nowMs = now?.getTime() ?? 0;
  /**
   * Which column an order belongs in is decided by its lines, not by the order
   * header: a late line added to an otherwise finished ticket pulls it back to
   * the queue, which is what the pass has to see. The rule itself lives in the
   * domain so the board never invents its own.
   */
  const board = useMemo(() => {
    const entries = (resource.data?.orders ?? [])
      .map((order) => staffOrderToViewModel(order, nowMs))
      .filter((order) => order.status !== "completed" && order.status !== "cancelled")
      .map((order) => ({
        order,
        stage: deriveKitchenStage(
          order.items.map((item) => ({
            status: toApiOrderItemStatus(item.status ?? "pending"),
          })),
        ),
      }))
      .filter((entry): entry is { order: Order; stage: "PENDING" | "PREPARING" | "READY" } =>
        entry.stage !== null,
      );
    return entries.map((entry) => ({
      order: entry.order,
      column: KITCHEN_COLUMN_FOR_STAGE[entry.stage],
    }));
  }, [nowMs, resource.data]);
  const activeOrders = useMemo(() => board.map((entry) => entry.order), [board]);

  // Asked for separately so the shared order feed stays one cheap query for
  // every other screen that reads it.
  const orderIdKey = useMemo(
    () => activeOrders.map((order) => order.id).sort().join(","),
    [activeOrders],
  );
  const loadPrintStatus = useCallback(
    (signal: AbortSignal): Promise<{ statuses: Record<string, PrintTicketStatus> }> =>
      orderIdKey.length === 0
        ? Promise.resolve({ statuses: {} })
        : printApi.kitchenStatus(orderIdKey.split(","), signal),
    [orderIdKey],
  );
  const printStatuses =
    useApiResource(loadPrintStatus, { pollMs: KITCHEN_POLL_MS }).data?.statuses ?? {};

  const counts = useMemo(
    () =>
      stages.reduce<Record<KitchenStage, number>>(
        (result, stage) => ({
          ...result,
          [stage.id]: board.filter((entry) => entry.column === stage.id).length,
        }),
        { confirmed: 0, preparing: 0, ready: 0 },
      ),
    [board],
  );

  const visibleOrderCount = counts.confirmed + counts.preparing + counts.ready;

  const canAdvanceOrder = useCallback(
    (order: Order) => {
      const action = getAction(order.status as KitchenStage);
      return canRoleTransitionOrderStatus(
        role,
        toApiOrderStatus(order.status),
        toApiOrderStatus(action.nextStatus),
      );
    },
    [role],
  );

  const itemAction = useCallback(
    (order: Order, item: Order["items"][number]): OrderItemStatus | null => {
      const current = item.status ?? "pending";
      const next = ITEM_NEXT_STATUS[current];
      if (!next) return null;
      return canRoleTransitionOrderItemStatus(
        role,
        toApiOrderItemStatus(current),
        toApiOrderItemStatus(next),
      )
        ? next
        : null;
    },
    [role],
  );

  const itemRollback = useCallback(
    (item: Order["items"][number]): OrderItemStatus | null => {
      const current = item.status ?? "pending";
      const previous = ITEM_PREVIOUS_STATUS[current];
      if (!previous) return null;
      // The same rule the server enforces, so a visible button is never a 403.
      return canRoleTransitionOrderItemStatus(
        role,
        toApiOrderItemStatus(current),
        toApiOrderItemStatus(previous),
      )
        ? previous
        : null;
    },
    [role],
  );

  async function runMutation(work: () => Promise<unknown>) {
    if (pending) return;
    setPending(true);
    try {
      await work();
      await refetch();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "İşlem tamamlanamadı.");
    } finally {
      setPending(false);
    }
  }

  const advanceOrder = (orderId: string, nextStatus: OrderStatus) => {
    void runMutation(() => staffApi.updateOrderStatus(orderId, toApiOrderStatus(nextStatus)));
  };

  const advanceItem = (itemId: string, nextStatus: OrderItemStatus) => {
    void runMutation(() =>
      staffApi.updateOrderItemStatus(itemId, toApiOrderItemStatus(nextStatus)),
    );
  };

  /** Undoing a step is confirmed first; the reason is recorded with it. */
  const requestRollback = (item: Order["items"][number], target: OrderItemStatus) => {
    setRollbackReason("MARKED_BY_MISTAKE");
    setRollback({ item, target });
  };

  const confirmRollback = () => {
    const request = rollback;
    if (!request) return;
    setRollback(null);
    void runMutation(() =>
      staffApi.updateOrderItemStatus(
        request.item.id,
        toApiOrderItemStatus(request.target),
        { reasonCode: rollbackReason },
      ),
    );
  };

  return (
    <main className={inWindow ? "" : "min-h-[100dvh] bg-background"}>
      {inWindow ? null : (
      <header className="border-b border-white/10 bg-olive text-[#FFFDF8]">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-5 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div className="flex items-center gap-3">
            <BrandMark compact className="size-11 shrink-0 border-gold/35" />
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
                  Mutfak Ekranı
                </h1>
                <Badge className="border border-gold/30 bg-gold/10 text-[#F7E5C2]">
                  Canlı operasyon
                </Badge>
              </div>
              <p className="mt-1 text-sm text-[#F5EBDD]/65">Aktif sipariş akışı</p>
            </div>
          </div>

          <div className="flex items-center justify-between gap-5 lg:justify-end">
            <div className="text-right">
              <p className="text-xs font-medium capitalize text-[#F5EBDD]/60">{formatDate(now)}</p>
              <p className="mt-0.5 text-2xl font-extrabold tabular-nums tracking-tight" suppressHydrationWarning>
                {formatClock(now)}
              </p>
            </div>
            <div className="hidden h-10 w-px bg-white/15 sm:block" aria-hidden="true" />
            <div className="hidden text-right sm:block">
              <p className="text-xs text-[#F5EBDD]/60">Aktif fiş</p>
              <p className="mt-0.5 text-xl font-extrabold tabular-nums">{visibleOrderCount}</p>
            </div>
            <RealtimeStatus status={realtimeStatus} className="hidden xl:inline-flex" />
          </div>
        </div>
      </header>
      )}

      <section
        className={inWindow ? "px-4 py-4 sm:px-6" : "mx-auto max-w-[1600px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7"}
        aria-label="Mutfak sipariş panosu"
      >
        <div className="grid gap-4 lg:grid-cols-3 xl:gap-5">
          {stages.map((stage) => {
            const StageIcon = stage.icon;
            const stageOrders = board
              .filter((entry) => entry.column === stage.id)
              .map((entry) => entry.order);

            return (
              <section key={stage.id} className="min-w-0" aria-labelledby={`stage-${stage.id}`}>
                <div className={cn("mb-3 flex min-h-16 items-center justify-between rounded-xl border px-4 py-3", stage.headerClassName)}>
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-current/10 bg-card/75 text-foreground">
                      <StageIcon className="size-4.5" strokeWidth={1.8} aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <h2 id={`stage-${stage.id}`} className="font-heading text-lg font-semibold leading-5 text-foreground">
                        {stage.title}
                      </h2>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{stage.description}</p>
                    </div>
                  </div>
                  <span className={cn("ml-3 flex size-8 shrink-0 items-center justify-center rounded-lg text-sm font-extrabold tabular-nums", stage.countClassName)} aria-label={`${counts[stage.id]} sipariş`}>
                    {counts[stage.id]}
                  </span>
                </div>

                <div className="space-y-3.5">
                  {stageOrders.length ? (
                    stageOrders.map((order) => (
                      <KitchenOrderCard
                        key={order.id}
                        order={order}
                        elapsedMinutes={order.elapsedMinutes}
                        canAdvance={canAdvanceOrder(order)}
                        pending={pending}
                        printStatus={printStatuses[order.id]}
                        itemAction={itemAction}
                        itemRollback={itemRollback}
                        onAdvance={advanceOrder}
                        onAdvanceItem={advanceItem}
                        onRollbackItem={requestRollback}
                      />
                    ))
                  ) : (
                    <EmptyState
                      icon={stage.id === "ready" ? CircleCheckBig : ChefHat}
                      title={stage.emptyTitle}
                      description={stage.emptyDescription}
                    />
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </section>

      {/* Undoing a step is deliberate: it is confirmed, and it says why. */}
      <Dialog open={rollback !== null} onOpenChange={(open) => !open && setRollback(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Ürünü geri al</DialogTitle>
            <DialogDescription>
              {rollback?.target === "pending"
                ? "Ürün mutfak listesinde tekrar Yeni olarak görünecek."
                : "Ürün mutfak listesinde tekrar Hazırlanıyor olarak görünecek."}
            </DialogDescription>
          </DialogHeader>

          {rollback ? (
            <p className="text-sm font-semibold">
              {rollback.item.quantity}× {rollback.item.productName}
            </p>
          ) : null}

          <fieldset className="space-y-2">
            <legend className="text-xs font-bold text-muted-foreground">Gerekçe</legend>
            <div className="grid gap-1.5">
              {ROLLBACK_REASONS.map((reason) => (
                <label
                  key={reason.value}
                  className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium"
                >
                  <input
                    type="radio"
                    name="kitchen-rollback-reason"
                    value={reason.value}
                    checked={rollbackReason === reason.value}
                    onChange={() => setRollbackReason(reason.value)}
                    className="size-4 accent-burgundy"
                  />
                  {reason.label}
                </label>
              ))}
            </div>
          </fieldset>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRollback(null)}>
              Vazgeç
            </Button>
            <Button type="button" disabled={pending} onClick={confirmRollback}>
              <Undo2 className="size-4" aria-hidden="true" /> Geri Al
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
