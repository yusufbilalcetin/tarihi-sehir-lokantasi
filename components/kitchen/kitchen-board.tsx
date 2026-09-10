"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BellRing, ChefHat, CircleCheckBig, Clock3, CookingPot, ReceiptText, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/shared/data-states";
import { KitchenFilters, type KitchenFilter } from "@/components/kitchen/kitchen-filters";
import {
  OperationalBackdrop,
  OperationalHero,
  OperationalHome,
  OperationalMetric,
  OperationalMetricGrid,
  OperationalSectionHeading,
  OperationalTopBar,
} from "@/components/staff/operational-ui";
import { useStaffSession } from "@/components/staff/staff-session-provider";
import { Button } from "@/components/ui/button";
import {
  staffOrderToViewModel,
  toApiOrderItemStatus,
  toApiOrderStatus,
} from "@/lib/adapters/staff-view-model";
import { ApiClientError } from "@/lib/api/client";
import { printApi, staffApi } from "@/lib/api/endpoints";
import { NewEntityTracker } from "@/lib/audio/new-entity-tracker";
import { resolveTicketUrgency, sortKitchenTickets } from "@/lib/domain/kitchen-board";
import { playSound } from "@/lib/audio/sound-effects";
import {
  canRoleTransitionOrderItemStatus,
  canRoleTransitionOrderStatus,
  deriveKitchenStage,
  itemsBlockingOrderStage,
} from "@/lib/domain/status";
import { Dialog } from "@/components/ui/dialog";
import { WindowDialogContent } from "@/components/ui/window-dialog";
import { useApiResource } from "@/lib/hooks/use-api-resource";
import { useStaffRealtime } from "@/lib/realtime/use-staff-realtime";
import type { Order, OrderItemStatus, OrderStatus } from "@/types";

import {
  KitchenOrderCard,
  getAction,
  stages,
  type KitchenStage,
  type PrintTicketStatus,
} from "@/components/kitchen/kitchen-ticket";

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

function formatClock(date: Date | null) {
  if (!date) return "--:--";
  return new Intl.DateTimeFormat("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

/**
 * The kitchen board.
 *
 * It owns the whole viewport on purpose. Everything here is read standing up,
 * often from a couple of metres away, so screen area spent on chrome is screen
 * area taken from tickets: the bar is one line, the columns scroll on their own
 * under sticky headings, and nothing is capped to a comfortable reading width.
 */
export function KitchenBoard() {
  const { role, name } = useStaffSession();
  const [now, setNow] = useState<Date | null>(null);
  const [pending, setPending] = useState(false);
  const [rollback, setRollback] = useState<{
    item: Order["items"][number];
    target: OrderItemStatus;
    expectedOrderVersion: number;
  } | null>(null);
  const [rollbackReason, setRollbackReason] = useState<string>("MARKED_BY_MISTAKE");
  const [mobileFilter, setMobileFilter] = useState<KitchenFilter>("all");
  const newOrderTracker = useRef(new NewEntityTracker());

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
    const orders = resource.data?.orders;
    if (!orders) return;
    if (newOrderTracker.current.update(orders.map((order) => order.id))) {
      void playSound("new-order");
    }
  }, [resource.data?.orders]);

  useEffect(() => {
    // Deferred so the ticking clock never sets state inside the effect body.
    const timer = window.setTimeout(() => setNow(new Date()), 0);
    const interval = window.setInterval(() => setNow(new Date()), 1_000);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
    };
  }, []);

  const dataReady = resource.data !== null;
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
  /** Which lane a ticket is in, so its card and its button agree with it. */
  const stageById = useMemo(
    () => new Map(board.map((entry) => [entry.order.id, entry.column])),
    [board],
  );

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

  /**
   * The phone's single column.
   *
   * "Geciken" cuts across the three stages rather than being a fourth one: on a
   * phone the question is "what is going cold", not "what stage is it in". The
   * board itself is untouched — this only decides which of its tickets are in
   * the column.
   */
  const lateCount = useMemo(
    () =>
      board.filter((entry) => resolveTicketUrgency(entry.order.elapsedMinutes) === "late").length,
    [board],
  );

  // Before the first read there is no board to count, so every rail badge is a
  // dash. A zero here is a claim that nothing is cooking, which nobody knows yet.
  const filterOptions = useMemo(
    () => [
      { id: "all" as const, label: "Tümü", count: dataReady ? visibleOrderCount : null },
      { id: "late" as const, label: "Geciken", count: dataReady ? lateCount : null, urgent: true },
      { id: "confirmed" as const, label: "Yeni", count: dataReady ? counts.confirmed : null },
      { id: "preparing" as const, label: "Hazırlanıyor", count: dataReady ? counts.preparing : null },
      { id: "ready" as const, label: "Hazır", count: dataReady ? counts.ready : null },
    ],
    [counts, dataReady, lateCount, visibleOrderCount],
  );

  const mobileTickets = useMemo(() => {
    const matching = board.filter((entry) => {
      if (mobileFilter === "all") return true;
      if (mobileFilter === "late") {
        return resolveTicketUrgency(entry.order.elapsedMinutes) === "late";
      }
      return entry.column === mobileFilter;
    });
    return sortKitchenTickets(matching.map((entry) => entry.order));
  }, [board, mobileFilter]);

  const mobileEmpty =
    mobileFilter === "late"
      ? { title: "Geciken sipariş yok", description: "Bütün fişler süresinde ilerliyor." }
      : mobileFilter === "all"
        ? { title: "Bekleyen sipariş yok", description: "Gelen siparişler burada görünecek." }
        : {
            title: stages.find((stage) => stage.id === mobileFilter)?.emptyTitle ?? "Sipariş yok",
            description:
              stages.find((stage) => stage.id === mobileFilter)?.emptyDescription ?? "",
          };

  const canAdvanceOrder = useCallback(
    (order: Order, stage: KitchenStage) => {
      const action = getAction(stage);
      const nextStatus = toApiOrderStatus(action.nextStatus);
      // A line added after the round went in has not been cooked, so the whole
      // ticket cannot be called ready over it. The server refuses; the button
      // goes away rather than becoming a 409 the cook has to read.
      const blocked = itemsBlockingOrderStage(
        nextStatus,
        order.items.map((item) => ({ status: toApiOrderItemStatus(item.status ?? "pending") })),
      );
      return (
        blocked.length === 0 &&
        canRoleTransitionOrderStatus(role, toApiOrderStatus(order.status), nextStatus)
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
      void playSound("error");
      toast.error(error instanceof ApiClientError ? error.message : "İşlem tamamlanamadı.");
    } finally {
      setPending(false);
    }
  }

  const advanceOrder = (orderId: string, nextStatus: OrderStatus) => {
    void runMutation(() => staffApi.updateOrderStatus(orderId, toApiOrderStatus(nextStatus)));
  };

  const advanceItem = (itemId: string, nextStatus: OrderItemStatus) => {
    const order = resource.data?.orders.find((entry) => entry.items.some((item) => item.id === itemId));
    if (!order) return;
    void runMutation(() =>
      staffApi.updateOrderItemStatus(itemId, toApiOrderItemStatus(nextStatus), { expectedOrderVersion: order.version }),
    );
  };

  /** Undoing a step is confirmed first; the reason is recorded with it. */
  const requestRollback = (item: Order["items"][number], target: OrderItemStatus) => {
    const order = resource.data?.orders.find((entry) => entry.items.some((line) => line.id === item.id));
    if (!order) return;
    setRollbackReason("MARKED_BY_MISTAKE");
    setRollback({ item, target, expectedOrderVersion: order.version });
  };

  const confirmRollback = () => {
    const request = rollback;
    if (!request) return;
    setRollback(null);
    void runMutation(() =>
      staffApi.updateOrderItemStatus(
        request.item.id,
        toApiOrderItemStatus(request.target),
        { reasonCode: rollbackReason, expectedOrderVersion: request.expectedOrderVersion },
      ),
    );
  };

  return (
    <OperationalBackdrop>
      <OperationalTopBar
        title="Mutfak"
        homeHref="/kitchen"
        realtimeStatus={realtimeStatus}
        sound
      />

      <OperationalHome role="kitchen">
        <OperationalHero
          title="Mutfak"
          person={name}
          description="Bugünün servis akışı"
          aside={<span className="hidden text-sm font-bold tabular-nums text-[#5D493B] sm:block" suppressHydrationWarning>{formatClock(now)}</span>}
        />

        <section aria-labelledby="kitchen-live-title">
          <h2 id="kitchen-live-title" className="sr-only">Canlı mutfak durumu</h2>
          <OperationalMetricGrid ariaLabel="Canlı mutfak durumu">
            <OperationalMetric label="Yeni" value={counts.confirmed} icon={ReceiptText} tone="blue" iconClassName="bg-[#397FC5] text-white" ready={dataReady} loading={resource.loading} />
            <OperationalMetric label="Hazırlanıyor" value={counts.preparing} icon={CookingPot} tone="amber" iconClassName="bg-[#E29A2F] text-[#2B211D]" ready={dataReady} loading={resource.loading} />
            <OperationalMetric label="Geciken" value={lateCount} icon={Clock3} tone="burgundy" iconClassName="bg-[#B53C48] text-white" ready={dataReady} loading={resource.loading} />
            <OperationalMetric label="Hazır" value={counts.ready} icon={BellRing} tone="green" iconClassName="bg-[#4E8A62] text-white" ready={dataReady} loading={resource.loading} />
          </OperationalMetricGrid>
          {resource.error ? (
            <p className="mt-2 rounded-xl border border-status-warning/25 bg-status-warning-tint/75 px-3 py-2 text-sm font-semibold text-status-warning" role="alert">
              {dataReady
                ? "Mutfak listesi yenilenemedi; son alınan durum gösteriliyor."
                : `Mutfak siparişleri yüklenemedi: ${resource.error.message}`}
            </p>
          ) : null}
        </section>

      <section className="mt-6" aria-labelledby="kitchen-modes-title">
        <OperationalSectionHeading id="kitchen-modes-title" title="Çalışma görünümü" />
        <KitchenFilters
          options={filterOptions}
          active={mobileFilter}
          onChange={setMobileFilter}
        />
      </section>

      <section className="mt-6" aria-labelledby="kitchen-priority-title">
        <OperationalSectionHeading
          id="kitchen-priority-title"
          title="Şimdi hazırlanacaklar"
          detail={<span className="tabular-nums">{dataReady ? `${mobileTickets.length} sipariş` : "—"}</span>}
        />
        {!dataReady ? (
          // A failed first read is not an empty pass: the alert above says what
          // happened, and no "bekleyen sipariş yok" is claimed over it.
          resource.loading ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Mutfak siparişleri yükleniyor">
              {Array.from({ length: 6 }, (_, index) => (
                <div key={index} className="h-72 animate-pulse rounded-[24px] border border-[#6B4A32]/10 bg-white/48 motion-reduce:animate-none" />
              ))}
            </div>
          ) : null
        ) : mobileTickets.length ? (
          <div className="grid content-start gap-4 md:grid-cols-2 xl:grid-cols-3">
            {mobileTickets.map((order) => (
              <KitchenOrderCard
                key={order.id}
                order={order}
                stage={stageById.get(order.id) ?? "confirmed"}
                elapsedMinutes={order.elapsedMinutes}
                canAdvance={canAdvanceOrder(order, stageById.get(order.id) ?? "confirmed")}
                pending={pending}
                printStatus={printStatuses[order.id]}
                itemAction={itemAction}
                itemRollback={itemRollback}
                onAdvance={advanceOrder}
                onAdvanceItem={advanceItem}
                onRollbackItem={requestRollback}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={mobileFilter === "ready" ? CircleCheckBig : ChefHat}
            title={mobileEmpty.title}
            description={mobileEmpty.description}
          />
        )}
      </section>

      {/* Undoing a step is deliberate: it is confirmed, and it says why. */}
      <Dialog open={rollback !== null} onOpenChange={(open) => !open && setRollback(null)}>
        <WindowDialogContent
          size="sm"
          title="Ürünü geri al"
          description={
            rollback?.target === "pending"
              ? "Ürün mutfak listesinde tekrar Yeni olarak görünecek."
              : "Ürün mutfak listesinde tekrar Hazırlanıyor olarak görünecek."
          }
          footer={
            <>
              <Button type="button" variant="outline" onClick={() => setRollback(null)}>
                Vazgeç
              </Button>
              <Button type="button" disabled={pending} onClick={confirmRollback}>
                <Undo2 className="size-4" aria-hidden="true" /> Geri Al
              </Button>
            </>
          }
        >
          <div className="grid gap-4">
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

          </div>
        </WindowDialogContent>
      </Dialog>
      </OperationalHome>
    </OperationalBackdrop>
  );
}
