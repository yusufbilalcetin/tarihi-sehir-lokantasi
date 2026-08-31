"use client";

import { useMemo, useRef, useState } from "react";
import {
  ChefHat,
  Clock3,
  LayoutGrid,
  ReceiptText,
  TableProperties,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { BrandMark } from "@/components/shared/brand-mark";
import { StatusBadge } from "@/components/shared/status-badge";
import { useMediaQuery, TABLET_MEDIA_QUERY } from "@/components/shared/use-is-desktop";
import { AttentionQueue } from "@/components/staff/cockpit/attention-queue";
import { ProductBrowser, useStaffMenu } from "@/components/staff/cockpit/product-browser";
import { ReadyOrdersQueue } from "@/components/staff/cockpit/ready-orders-queue";
import { ServiceHome } from "@/components/staff/cockpit/service-home";
import { ServiceTableCard } from "@/components/staff/cockpit/service-table-card";
import { StaffProfileView } from "@/components/staff/cockpit/staff-profile-view";
import { OrdersList } from "@/components/staff/orders-list";
import { RealtimeStatus } from "@/components/staff/realtime-status";
import { useStaffSession } from "@/components/staff/staff-session-provider";
import { TableGrid, type TableGridLayoutParts } from "@/components/staff/table-grid";
import { useStaffFloor } from "@/components/staff/use-staff-floor";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { toApiOrderStatus } from "@/lib/adapters/staff-view-model";
import { ApiClientError } from "@/lib/api/client";
import { staffApi } from "@/lib/api/endpoints";
import { buildAttentionQueue, buildReadyQueue } from "@/lib/domain/service-attention";
import { canAddItemsToOrder } from "@/lib/domain/order-mutations";
import { formatElapsed } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Order, RestaurantTable } from "@/types";

/**
 * The service cockpit.
 *
 * A phone gets a service app: what needs a person, then the room, then a sheet
 * for the table you tapped. A tablet on the pass gets three columns — the room
 * and the menu on the left and middle, the table you are serving on the right —
 * because a waiter working from a stand should never lose the open ticket to
 * reach a dish.
 *
 * Every action, permission check and API call still lives in `TableGrid`; this
 * file only decides where those parts appear. That is deliberate: the panel was
 * redrawn, not rewritten, so nothing about what a waiter is allowed to do moved.
 */

type MobileTab = "tables" | "orders" | "ready" | "profile";
type TableFilter = "all" | "attention" | "active" | "available";

const TABLE_FILTERS: readonly { readonly id: TableFilter; readonly label: string }[] = [
  { id: "all", label: "Tüm masalar" },
  { id: "attention", label: "İlgi bekleyen" },
  { id: "active", label: "Dolu" },
  { id: "available", label: "Boş" },
];

function greeting(hour: number): string {
  if (hour < 6) return "İyi geceler";
  if (hour < 12) return "Günaydın";
  if (hour < 18) return "İyi günler";
  return "İyi akşamlar";
}

export function ServiceCockpit() {
  const floor = useStaffFloor();
  const { name } = useStaffSession();
  const menu = useStaffMenu();
  // Phone-first on the server: a waiter is on a phone far more often than a
  // stand, and the wrong guess here stacks the menu under the table board.
  const isTabletUp = useMediaQuery(TABLET_MEDIA_QUERY, false);

  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [tableFilter, setTableFilter] = useState<TableFilter>("all");
  const [mobileTab, setMobileTab] = useState<MobileTab>("tables");
  const [addPendingId, setAddPendingId] = useState<string | null>(null);
  // Held across a retry so a failed-then-retried tap cannot double-charge.
  const idempotencyKeyRef = useRef<string | null>(null);

  const attention = useMemo(
    () => buildAttentionQueue(floor.tables, floor.orders),
    [floor.orders, floor.tables],
  );
  const readyQueue = useMemo(() => buildReadyQueue(floor.orders), [floor.orders]);
  const readyTableIds = useMemo(
    () => new Set(readyQueue.map((entry) => entry.tableId).filter(Boolean) as string[]),
    [readyQueue],
  );
  const attentionTableIds = useMemo(
    () => new Set(attention.map((entry) => entry.tableId)),
    [attention],
  );

  const visibleTables = useMemo(() => {
    switch (tableFilter) {
      case "attention":
        return floor.tables.filter((table) => attentionTableIds.has(table.id));
      case "active":
        return floor.tables.filter(
          (table) => table.status !== "available" && table.status !== "inactive",
        );
      case "available":
        return floor.tables.filter((table) => table.status === "available");
      default:
        return floor.tables;
    }
  }, [attentionTableIds, floor.tables, tableFilter]);

  /**
   * One tap on a dish. It reuses the order pad's contract exactly: append to a
   * running order when the domain says that order still accepts lines, open a
   * new round otherwise, and let the server price it.
   */
  async function quickAdd(productId: string, table: RestaurantTable, order: Order | undefined) {
    if (addPendingId) return;
    setAddPendingId(productId);
    idempotencyKeyRef.current ??= staffApi.newIdempotencyKey();
    const items = [{ productId, quantity: 1 }];
    try {
      if (order && canAddItemsToOrder(toApiOrderStatus(order.status))) {
        await staffApi.addOrderItems(order.id, items, idempotencyKeyRef.current);
      } else {
        await staffApi.createOrder({ tableId: table.id, items }, idempotencyKeyRef.current);
      }
      idempotencyKeyRef.current = null;
      await floor.refetch();
      toast.success(`${table.name} siparişine eklendi.`);
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "Ürün eklenemedi.");
    } finally {
      setAddPendingId(null);
    }
  }

  /**
   * The board serves two very different widths: the phone branch gets the whole
   * screen, the cockpit's middle column gets ~380px. Viewport breakpoints would
   * put four cards in that column at 1024px — 94px each — so the caller states
   * the columns its own context can afford.
   */
  function renderBoard(parts: TableGridLayoutParts, gridClassName: string) {
    if (floor.error && !floor.tables.length) {
      return (
        <p className="rounded-xl border border-dashed border-status-danger/40 bg-status-danger-tint/40 px-4 py-6 text-sm text-status-danger">
          Masalar yüklenemedi: {floor.error.message}
        </p>
      );
    }
    if (floor.loading && !floor.tables.length) {
      return (
        <div className={cn("grid gap-2.5", gridClassName)}>
          {Array.from({ length: 8 }, (_, index) => (
            <div
              key={index}
              className="h-24 animate-pulse rounded-xl border border-border-subtle bg-surface-muted/60 motion-reduce:animate-none"
            />
          ))}
        </div>
      );
    }
    if (!visibleTables.length) {
      return (
        <p className="rounded-xl border border-dashed border-border/70 bg-surface-raised px-4 py-8 text-center text-sm text-text-muted">
          {tableFilter === "all"
            ? "Masa bulunamadı. Yönetici panelinden masa ekleyerek başlayın."
            : "Bu filtreye uyan masa yok."}
        </p>
      );
    }
    return (
      <ul className={cn("grid gap-2.5", gridClassName)}>
        {visibleTables.map((table) => (
          <li key={table.id} className="h-full">
            <ServiceTableCard
              table={table}
              hasReadyOrder={readyTableIds.has(table.id)}
              selected={parts.selectedTable?.id === table.id}
              onSelect={(selected) => parts.selectTable(selected.id)}
            />
          </li>
        ))}
      </ul>
    );
  }

  function renderTablePanelHeader(table: RestaurantTable) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h2 className="font-heading text-xl font-semibold tracking-tight text-text-primary">
          {table.name}
        </h2>
        <StatusBadge status={table.status} size="sm" />
        <span className="flex items-center gap-1.5 text-xs font-medium text-text-muted">
          <UsersRound className="size-3.5" strokeWidth={1.8} aria-hidden="true" />
          {table.seats} kişilik
        </span>
        <span className="flex items-center gap-1.5 text-xs font-medium tabular-nums text-text-muted">
          <Clock3 className="size-3.5" strokeWidth={1.8} aria-hidden="true" />
          {table.activeMinutes ? `${formatElapsed(table.activeMinutes)} açık` : "Şu an boş"}
        </span>
      </div>
    );
  }

  return (
    <TableGrid
      tables={[...floor.tables]}
      orders={floor.orders}
      calls={floor.calls}
      onChanged={floor.refetch}
      renderLayout={(parts) => {
        const selectedOrder = parts.selectedTable?.orderId
          ? floor.orders.find((order) => order.id === parts.selectedTable?.orderId)
          : undefined;

        /* ---------------------------- tablet cockpit ---------------------------- */
        if (isTabletUp) {
          return (
            // The shell is a 64px header over 32px of padding, so the cockpit takes
            // exactly the rest of the viewport. That bound is what lets each column
            // scroll on its own instead of moving the whole page.
            <div className="flex h-[calc(100dvh-8rem)] min-h-0 gap-4 overflow-hidden lg:gap-5">
              {/* Two columns on a 768px tablet, three from 1024px. Held back because
                  208px of rail plus a 304px table panel leaves a 176px menu at 768,
                  which is narrower than one product card. */}
              <aside className="hidden w-52 shrink-0 flex-col gap-5 overflow-y-auto lg:flex lg:w-56" aria-label="Menü ve masa filtreleri">
                <div className="flex items-center gap-2.5">
                  <BrandMark compact className="size-9 shrink-0 border-copper/45" />
                  <span className="min-w-0">
                    <span className="block truncate font-heading text-sm font-semibold text-text-primary">
                      Tarihi Şehir Lokantası
                    </span>
                    <span className="block text-xs text-text-muted">Servis Kokpiti</span>
                  </span>
                </div>
                <div className="h-px bg-gradient-to-r from-copper/45 to-transparent" />

                <nav aria-label="Kategoriler">
                  <h2 className="mb-2 text-xs font-bold uppercase tracking-[0.08em] text-text-muted">
                    Kategoriler
                  </h2>
                  <ul className="space-y-1">
                    <li>
                      <button
                        type="button"
                        onClick={() => setActiveCategoryId(null)}
                        aria-current={activeCategoryId === null ? "true" : undefined}
                        className={cn(
                          "motion-press flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-start text-sm font-semibold text-text-secondary",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          activeCategoryId === null && "bg-order-served-tint text-order-served",
                        )}
                      >
                        <LayoutGrid className="size-4 shrink-0" strokeWidth={1.9} aria-hidden="true" />
                        Tümü
                      </button>
                    </li>
                    {menu.categories.map((category) => (
                      <li key={category.id}>
                        <button
                          type="button"
                          onClick={() => setActiveCategoryId(category.id)}
                          aria-current={activeCategoryId === category.id ? "true" : undefined}
                          className={cn(
                            "motion-press flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-3 text-start text-sm font-semibold text-text-secondary",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            activeCategoryId === category.id && "bg-order-served-tint text-order-served",
                          )}
                        >
                          <span className="min-w-0 truncate">{category.name}</span>
                          <span className="shrink-0 text-xs tabular-nums text-text-muted">
                            {category.count}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </nav>

                {/* The backend has no room/zone model, so this groups by the
                    state the API does return rather than inventing sections. */}
                <nav aria-label="Masa grupları">
                  <h2 className="mb-2 text-xs font-bold uppercase tracking-[0.08em] text-text-muted">
                    Masalar
                  </h2>
                  <ul className="space-y-1">
                    {TABLE_FILTERS.map((filter) => (
                      <li key={filter.id}>
                        <button
                          type="button"
                          onClick={() => setTableFilter(filter.id)}
                          aria-current={tableFilter === filter.id ? "true" : undefined}
                          className={cn(
                            "motion-press flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-start text-sm font-semibold text-text-secondary",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            tableFilter === filter.id && "bg-order-served-tint text-order-served",
                          )}
                        >
                          <TableProperties className="size-4 shrink-0" strokeWidth={1.9} aria-hidden="true" />
                          {filter.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                </nav>
              </aside>

              <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-hidden">
                <RealtimeStatus status={floor.realtimeStatus} />
                {attention.length ? (
                  <AttentionQueue entries={attention.slice(0, 3)} onSelectTable={parts.selectTable} />
                ) : null}
                <div className="min-h-0 shrink-0">
                  {renderBoard(parts, "grid-cols-2 xl:grid-cols-3")}
                </div>
                <nav
                  className="-mx-1 flex shrink-0 gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] lg:hidden [&::-webkit-scrollbar]:hidden"
                  aria-label="Kategoriler"
                >
                  <button
                    type="button"
                    onClick={() => setActiveCategoryId(null)}
                    aria-pressed={activeCategoryId === null}
                    className={cn(
                      "motion-press min-h-11 shrink-0 rounded-full border border-border-subtle px-3.5 text-sm font-semibold text-text-secondary",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      activeCategoryId === null && "border-order-served/40 bg-order-served-tint text-order-served",
                    )}
                  >
                    Tümü
                  </button>
                  {menu.categories.map((category) => (
                    <button
                      key={category.id}
                      type="button"
                      onClick={() => setActiveCategoryId(category.id)}
                      aria-pressed={activeCategoryId === category.id}
                      className={cn(
                        "motion-press min-h-11 shrink-0 rounded-full border border-border-subtle px-3.5 text-sm font-semibold text-text-secondary",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        activeCategoryId === category.id && "border-order-served/40 bg-order-served-tint text-order-served",
                      )}
                    >
                      {category.name}
                    </button>
                  ))}
                </nav>
                <ProductBrowser
                  products={menu.products}
                  activeCategoryId={activeCategoryId}
                  canAdd={Boolean(parts.selectedTable)}
                  pendingProductId={addPendingId}
                  loading={menu.loading}
                  onAdd={(productId) =>
                    parts.selectedTable &&
                    void quickAdd(productId, parts.selectedTable, selectedOrder)
                  }
                  className="min-h-0 flex-1"
                />
              </div>

              <aside
                className="hidden w-[19rem] shrink-0 flex-col overflow-hidden rounded-2xl border border-border-subtle bg-surface-raised md:flex lg:w-[21rem]"
                aria-label="Seçili masa"
              >
                {parts.selectedTable ? (
                  <>
                    <div className="border-b border-border bg-surface-muted/45 px-4 py-3.5">
                      {renderTablePanelHeader(parts.selectedTable)}
                    </div>
                    {parts.detailBody}
                  </>
                ) : (
                  <div className="flex flex-1 flex-col items-center justify-center gap-2 px-5 py-10 text-center">
                    <TableProperties className="size-7 text-text-muted" strokeWidth={1.5} aria-hidden="true" />
                    <p className="font-semibold text-text-primary">Masa seçilmedi</p>
                    <p className="text-sm leading-6 text-text-muted">
                      Sipariş almak için soldan bir masaya dokun.
                    </p>
                  </div>
                )}
                <div className="border-t border-border px-4 py-3.5">
                  <ReadyOrdersQueue entries={readyQueue.slice(0, 4)} onSelectTable={parts.selectTable} />
                </div>
              </aside>
            </div>
          );
        }

        /* ------------------------------ phone app ------------------------------ */
        return (
          // The bar is a 56px row over 4px of lead and the home indicator, so
          // the content reserves exactly that and never hides its last table.
          <div className="pb-[calc(4.5rem+env(safe-area-inset-bottom))]">
            <header className="mb-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium text-text-muted">
                  {greeting(new Date().getHours())}
                </p>
                <p className="truncate font-heading text-lg font-semibold text-text-primary">{name}</p>
              </div>
              <RealtimeStatus status={floor.realtimeStatus} />
            </header>

            {/* One tab, one view. Nothing from another tab is ever appended
                below the active one — that is what put clocking-in under the
                last table card on the screen this replaced. */}
            {mobileTab === "tables" ? (
              <ServiceHome
                attention={attention}
                filters={TABLE_FILTERS}
                activeFilter={tableFilter}
                onFilterChange={(id) => setTableFilter(id as TableFilter)}
                onSelectTable={parts.selectTable}
                visibleCount={visibleTables.length}
                totalCount={floor.tables.length}
                board={renderBoard(parts, "grid-cols-2 sm:grid-cols-3")}
              />
            ) : null}

            {mobileTab === "orders" ? <OrdersList /> : null}

            {mobileTab === "ready" ? (
              <ReadyOrdersQueue entries={readyQueue} onSelectTable={parts.selectTable} />
            ) : null}

            {mobileTab === "profile" ? <StaffProfileView /> : null}

            {/* The table sheet: a phone opens the same body the cockpit column
                shows, so both screens offer identical actions. */}
            <Sheet
              open={Boolean(parts.selectedTable)}
              onOpenChange={(open) => !open && parts.close()}
            >
              <SheetContent side="bottom" showCloseButton={false} className="h-[92dvh] gap-0 p-0">
                {parts.selectedTable ? (
                  <>
                    <SheetHeader className="border-b border-border bg-surface-muted/45 px-4 py-3.5 pr-14">
                      <SheetTitle className="font-heading text-xl font-semibold tracking-tight">
                        {parts.selectedTable.name}
                      </SheetTitle>
                      <SheetDescription className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="flex items-center gap-1.5">
                          <UsersRound className="size-3.5" strokeWidth={1.8} />
                          {parts.selectedTable.seats} kişilik
                        </span>
                        <span className="flex items-center gap-1.5 tabular-nums">
                          <Clock3 className="size-3.5" strokeWidth={1.8} />
                          {parts.selectedTable.activeMinutes
                            ? `${formatElapsed(parts.selectedTable.activeMinutes)} açık`
                            : "Şu an boş"}
                        </span>
                      </SheetDescription>
                    </SheetHeader>
                    <Button
                      type="button"
                      variant="ghost"
                      className="absolute right-2 top-2 z-10 size-11 p-0"
                      onClick={parts.close}
                      aria-label="Masa detayını kapat"
                    >
                      <X className="size-5" strokeWidth={1.8} />
                    </Button>
                    {parts.detailBody}
                  </>
                ) : null}
              </SheetContent>
            </Sheet>

            <ServiceBottomNav
              active={mobileTab}
              readyCount={readyQueue.length}
              attentionCount={attention.length}
              onChange={setMobileTab}
            />
          </div>
        );
      }}
    />
  );
}

const MOBILE_TABS: readonly {
  readonly id: MobileTab;
  readonly label: string;
  readonly icon: typeof TableProperties;
}[] = [
  { id: "tables", label: "Masalar", icon: TableProperties },
  { id: "orders", label: "Siparişler", icon: ReceiptText },
  { id: "ready", label: "Hazır", icon: ChefHat },
  { id: "profile", label: "Profil", icon: UserRound },
];

function ServiceBottomNav({
  active,
  readyCount,
  attentionCount,
  onChange,
}: {
  readonly active: MobileTab;
  readonly readyCount: number;
  readonly attentionCount: number;
  readonly onChange: (tab: MobileTab) => void;
}) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1 shadow-[0_-10px_30px_rgb(74_40_40/0.08)] backdrop-blur-md md:hidden"
      aria-label="Servis menüsü"
    >
      <ul className="mx-auto grid max-w-md grid-cols-4 gap-1">
        {MOBILE_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = active === tab.id;
          const badge =
            tab.id === "ready" ? readyCount : tab.id === "tables" ? attentionCount : 0;

          return (
            <li key={tab.id}>
              <button
                type="button"
                onClick={() => onChange(tab.id)}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "motion-press relative flex min-h-14 w-full flex-col items-center justify-center gap-1 rounded-lg px-1 text-xs font-semibold text-muted-foreground",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isActive && "bg-burgundy/[0.08] text-burgundy",
                )}
              >
                <span className="relative">
                  <Icon className="size-5" strokeWidth={isActive ? 2.2 : 1.8} aria-hidden="true" />
                  {badge > 0 ? (
                    <span
                      className="absolute -end-2 -top-1.5 flex min-w-4 items-center justify-center rounded-full bg-burgundy px-1 text-[10px] font-bold leading-4 text-white"
                      aria-label={`${badge} bekleyen`}
                    >
                      {badge}
                    </span>
                  ) : null}
                </span>
                {tab.label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
