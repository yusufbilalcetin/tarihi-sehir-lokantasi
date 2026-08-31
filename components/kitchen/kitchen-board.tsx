"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChefHat, CircleCheckBig, TriangleAlert, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { BrandMark } from "@/components/shared/brand-mark";
import { EmptyState } from "@/components/shared/data-states";
import { KitchenFilters, type KitchenFilter } from "@/components/kitchen/kitchen-filters";
import { SoundControl } from "@/components/shared/sound-control";
import { LogoutButton } from "@/components/staff/logout-button";
import { RealtimeStatus } from "@/components/staff/realtime-status";
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
} from "@/lib/domain/status";
import { Dialog } from "@/components/ui/dialog";
import { WindowDialogContent } from "@/components/ui/window-dialog";
import { useApiResource } from "@/lib/hooks/use-api-resource";
import { useStaffRealtime } from "@/lib/realtime/use-staff-realtime";
import { STAFF_ROLE_LABELS } from "@/lib/domain/staff-accounts";
import { getInitials } from "@/lib/format";
import { cn } from "@/lib/utils";
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

  const filterOptions = useMemo(
    () => [
      { id: "all" as const, label: "Tümü", count: visibleOrderCount },
      { id: "confirmed" as const, label: "Yeni", count: counts.confirmed },
      { id: "preparing" as const, label: "Hazırlanıyor", count: counts.preparing },
      { id: "ready" as const, label: "Hazır", count: counts.ready },
      { id: "late" as const, label: "Geciken", count: lateCount, urgent: true },
    ],
    [counts, lateCount, visibleOrderCount],
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
    <main className="flex min-h-[100dvh] flex-col bg-background lg:h-[100dvh]">
      {/* One line. The date, the badge and the tagline told the kitchen nothing
          it did not already know, and each cost a row of tickets. */}
      <header className="shrink-0 border-b border-sidebar-primary/35 bg-sidebar text-[#FBF7EF]">
        <div className="flex items-center justify-between gap-4 px-4 py-2.5 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <BrandMark compact className="size-9 shrink-0 border-gold/35" />
            <h1 className="truncate text-lg font-bold tracking-tight sm:text-xl">Mutfak</h1>
          </div>

          <div className="flex shrink-0 items-center gap-3 sm:gap-4">
            {/* A live feed that has quietly stopped is the worst failure this
                screen can have, so its state is never hidden behind a
                breakpoint. */}
            <RealtimeStatus status={realtimeStatus} />
            <SoundControl />
            <div className="flex items-baseline gap-1.5">
              <span className="hidden text-xs text-[#F5EBDD]/60 sm:inline">Aktif fiş</span>
              <span className="text-lg font-extrabold tabular-nums">{visibleOrderCount}</span>
            </div>
            {/* The one count that changes what a cook does next, so it is on
                the bar at every width rather than only inside the filter rail. */}
            {lateCount > 0 ? (
              <span
                className="flex items-center gap-1.5 rounded-md bg-status-danger px-2 py-1 text-xs font-extrabold text-white"
                aria-label={lateCount + " geciken sipariş"}
              >
                <TriangleAlert className="size-3.5" strokeWidth={2.4} aria-hidden="true" />
                {lateCount} geciken
              </span>
            ) : null}
            <p className="text-lg font-extrabold tabular-nums tracking-tight" suppressHydrationWarning>
              {formatClock(now)}
            </p>

            <span className="hidden h-8 w-px bg-white/15 sm:block" aria-hidden="true" />

            {/*
              Who is signed in, at the weight it deserves: a cook needs it to
              know whose shift the board is being worked under, and never more
              than that. The tickets stay the loudest thing on the screen.

              The same route is legitimately opened by a manager or an admin, so
              the role is read from the session and labelled with the product's
              own mapping rather than assumed to be the kitchen.
            */}
            <div className="flex shrink-0 items-center gap-2">
              <span
                className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-xs font-bold text-gold"
                aria-hidden="true"
              >
                {getInitials(name)}
              </span>
              {/* Below lg the board needs the width more than the name does;
                  the initials and the logout control stay either way. */}
              <span className="hidden min-w-0 max-w-40 leading-tight lg:block">
                <span className="block truncate text-xs font-semibold text-[#FFFDF8]">{name}</span>
                <span className="block truncate text-xs text-[#F5EBDD]/60">{STAFF_ROLE_LABELS[role]}</span>
              </span>
              <LogoutButton className="shrink-0 text-[#F5EBDD]/70 hover:bg-white/10 hover:text-[#FFFDF8]" />
            </div>
          </div>
        </div>
      </header>

      {/*
        Three layouts, one ticket.

        A phone gets one column and a filter rail, because three lanes on a
        390px screen is three unreadable 110px columns. A tablet gets the lanes
        stacked but its tickets two-up, so a 768px board is not one tall
        ribbon. A pass screen gets the real thing: three lanes, each scrolling
        alone under its own heading.
      */}

      {/* --------------------------------- phone --------------------------- */}
      <section className="min-h-0 flex-1 px-3 py-3 lg:hidden" aria-label="Mutfak sipariş panosu">
        <KitchenFilters
          className="mb-3"
          options={filterOptions}
          active={mobileFilter}
          onChange={setMobileFilter}
        />
        {mobileTickets.length ? (
          <div className="grid content-start gap-3 md:grid-cols-2">
            {mobileTickets.map((order) => (
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

      {/* ------------------------------ pass screen ------------------------ */}
      {/* No max width: on a 24-inch board a centred column throws away a third
          of the screen. */}
      <section
        className="hidden min-h-0 flex-1 px-4 py-3 lg:block"
        aria-label="Mutfak sipariş panosu (lane görünümü)"
      >
        <div className="grid gap-3 lg:h-full lg:min-h-0 lg:grid-cols-3 xl:gap-4">
          {stages.map((stage) => {
            const StageIcon = stage.icon;
            // Oldest first: the feed arrives newest-first under a row limit,
            // which is the right query and the wrong reading order.
            const stageOrders = sortKitchenTickets(
              board.filter((entry) => entry.column === stage.id).map((entry) => entry.order),
            );

            return (
              <section
                key={stage.id}
                className="flex min-w-0 flex-col lg:min-h-0"
                aria-labelledby={`stage-${stage.id}`}
              >
                <div className={cn("mb-2 flex shrink-0 items-center justify-between gap-3 rounded-lg border px-3 py-2", stage.headerClassName)}>
                  <div className="flex min-w-0 items-center gap-2.5">
                    <StageIcon className="size-5 shrink-0 text-foreground" strokeWidth={2} aria-hidden="true" />
                    <h2 id={`stage-${stage.id}`} className="truncate text-base font-bold tracking-tight text-foreground">
                      {stage.title}
                    </h2>
                  </div>
                  <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-md text-sm font-extrabold tabular-nums", stage.countClassName)} aria-label={`${counts[stage.id]} sipariş`}>
                    {counts[stage.id]}
                  </span>
                </div>

                {/* Each lane scrolls alone, so a long queue in one stage never
                    pushes the other two off the screen. A lane is ~620px on a
                    24-inch board, so tickets flow two-up once it can hold two
                    readable ones. */}
                <div className="grid content-start gap-3 lg:min-h-0 lg:flex-1 lg:overflow-y-auto 2xl:grid-cols-2">
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
                    <div className="2xl:col-span-2">
                      <EmptyState
                        icon={stage.id === "ready" ? CircleCheckBig : ChefHat}
                        title={stage.emptyTitle}
                        description={stage.emptyDescription}
                      />
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
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
    </main>
  );
}
