"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChefHat, ReceiptText, TableProperties, UserRound, X } from "lucide-react";

import { OrdersList } from "@/components/staff/orders-list";
import { ReadyOrdersQueue } from "@/components/staff/cockpit/ready-orders-queue";
import { ServiceHome } from "@/components/staff/cockpit/service-home";
import { ServiceTableCard } from "@/components/staff/cockpit/service-table-card";
import { StaffProfileView } from "@/components/staff/cockpit/staff-profile-view";
import {
  OperationalHero,
  OperationalHome,
  OperationalSectionHeading,
} from "@/components/staff/operational-ui";
import { RealtimeStatus } from "@/components/staff/realtime-status";
import { useStaffSession } from "@/components/staff/staff-session-provider";
import { TableGrid, type TableGridLayoutParts } from "@/components/staff/table-grid";
import { useStaffFloor } from "@/components/staff/use-staff-floor";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  buildAttentionQueue,
  buildReadyQueue,
  LONG_WAIT_MINUTES,
} from "@/lib/domain/service-attention";
import { formatElapsed } from "@/lib/format";
import { cn } from "@/lib/utils";

type ServiceView = "tables" | "orders" | "ready" | "profile";
type TableFilter = "all" | "attention" | "active" | "available";

const WAITER_ATTENTION_RANK = {
  "bill-requested": 0,
  "waiting-too-long": 1,
  "waiter-call": 2,
  "order-ready": 3,
} as const;

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

/**
 * The service Home Screen.
 *
 * TableGrid still owns every permission, mutation and order composer. This
 * component only replaces the old three-pane cockpit with a role home, then
 * opens that exact operational body after a table is selected.
 */
export function ServiceCockpit() {
  const floor = useStaffFloor();
  const { name, restaurantTimezone } = useStaffSession();
  const [view, setView] = useState<ServiceView>("tables");
  const [tableFilter, setTableFilter] = useState<TableFilter>("all");
  const [currentHour, setCurrentHour] = useState<number | null>(null);

  const attention = useMemo(
    () => buildAttentionQueue(floor.tables, floor.orders),
    [floor.orders, floor.tables],
  );
  const prioritizedAttention = useMemo(
    () =>
      [...attention].sort(
        (left, right) =>
          WAITER_ATTENTION_RANK[left.reason] - WAITER_ATTENTION_RANK[right.reason] ||
          right.waitingMinutes - left.waitingMinutes,
      ),
    [attention],
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

  useEffect(() => {
    const resolveHour = () => {
      const hour = new Intl.DateTimeFormat("tr-TR", {
        timeZone: restaurantTimezone,
        hour: "2-digit",
        hourCycle: "h23",
      }).format(new Date());
      setCurrentHour(Number(hour));
    };
    const timer = window.setTimeout(resolveHour, 0);
    const interval = window.setInterval(resolveHour, 60_000);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
    };
  }, [restaurantTimezone]);

  const lateOrderCount = useMemo(
    () =>
      floor.orders.filter(
        (order) =>
          (order.status === "pending" ||
            order.status === "confirmed" ||
            order.status === "preparing") &&
          order.elapsedMinutes >= LONG_WAIT_MINUTES,
      ).length,
    [floor.orders],
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

  function showTables() {
    setView("tables");
    window.requestAnimationFrame(() =>
      document.getElementById("table-board-title")?.scrollIntoView({ behavior: "smooth" }),
    );
  }

  function renderBoard(parts: TableGridLayoutParts) {
    if (floor.error && !floor.tables.length) {
      return (
        <p className="rounded-[22px] border border-status-danger/30 bg-status-danger-tint/55 px-4 py-6 text-sm font-semibold text-status-danger" role="alert">
          Masalar yüklenemedi: {floor.error.message}
        </p>
      );
    }
    if (floor.loading && !floor.tables.length) {
      return (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" aria-label="Masalar yükleniyor">
          {Array.from({ length: 8 }, (_, index) => (
            <div
              key={index}
              className="h-32 animate-pulse rounded-[22px] border border-[#6B4A32]/10 bg-white/48 motion-reduce:animate-none"
            />
          ))}
        </div>
      );
    }
    if (!visibleTables.length) {
      return (
        <p className="rounded-[22px] border border-dashed border-[#6B4A32]/20 bg-white/52 px-4 py-10 text-center text-sm font-medium text-[#6B5D53]">
          {tableFilter === "all"
            ? "Masa bulunamadı. Yönetici panelinden masa ekleyerek başlayın."
            : "Bu filtreye uyan masa yok."}
        </p>
      );
    }
    return (
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
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

  function secondaryView(title: string, content: ReactNode) {
    return (
      <section className="rounded-[26px] border border-white/60 bg-white/56 p-3 shadow-[0_18px_44px_rgba(67,45,29,0.07)] backdrop-blur-md sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <OperationalSectionHeading id={`service-${view}-title`} title={title} />
          <Button type="button" variant="outline" className="min-h-11" onClick={() => setView("tables")}>
            Servis ana ekranı
          </Button>
        </div>
        {content}
      </section>
    );
  }

  return (
    <TableGrid
      tables={[...floor.tables]}
      orders={floor.orders}
      calls={floor.calls}
      onChanged={floor.refetch}
      renderLayout={(parts) => (
        <OperationalHome role="service" as="div" className="min-h-0 px-0 pb-[calc(4.5rem+env(safe-area-inset-bottom))] pt-0 sm:px-0 sm:pt-0 md:pb-4">
          <OperationalHero
            title={currentHour === null ? "Hoş geldin" : greeting(currentHour)}
            person={name}
            description="Salon servisi"
            aside={<RealtimeStatus status={floor.realtimeStatus} />}
          />

          {view === "tables" ? (
            <ServiceHome
              attention={prioritizedAttention}
              filters={TABLE_FILTERS}
              activeFilter={tableFilter}
              onFilterChange={(id) => setTableFilter(id as TableFilter)}
              onSelectTable={parts.selectTable}
              visibleCount={visibleTables.length}
              totalCount={floor.tables.length}
              status={{
                activeTables: floor.summary.activeTableCount,
                openOrders: floor.orders.length,
                billRequests: floor.summary.billRequestCount,
                lateOrders: lateOrderCount,
              }}
              dataReady={floor.ready}
              loading={floor.loading}
              board={renderBoard(parts)}
              activeView={view}
              onShowTables={showTables}
              onShowOrders={() => setView("orders")}
              onShowReady={() => setView("ready")}
            />
          ) : null}

          {view === "orders" ? secondaryView("Siparişler", <OrdersList />) : null}
          {view === "ready"
            ? secondaryView(
                "Hazır servisler",
                <ReadyOrdersQueue entries={readyQueue} onSelectTable={parts.selectTable} />,
              )
            : null}
          {view === "profile" ? secondaryView("Profil", <StaffProfileView />) : null}

          <Sheet open={Boolean(parts.selectedTable)} onOpenChange={(open) => !open && parts.close()}>
            <SheetContent
              side="bottom"
              showCloseButton={false}
              className="h-[92dvh] gap-0 overflow-hidden rounded-t-[28px] p-0 sm:inset-y-3 sm:left-auto sm:right-3 sm:h-[calc(100dvh-1.5rem)] sm:w-[min(34rem,calc(100vw-1.5rem))] sm:max-w-none sm:rounded-[28px]"
            >
              {parts.selectedTable ? (
                <>
                  <SheetHeader className="border-b border-[#6B4A32]/10 bg-[#FFF9EF]/92 px-4 py-4 pr-14">
                    <SheetTitle className="text-2xl font-semibold tracking-tight">
                      {parts.selectedTable.name}
                    </SheetTitle>
                    <SheetDescription className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span>{parts.selectedTable.seats} kişilik</span>
                      <span className="tabular-nums">
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
                    <X className="size-5" aria-hidden="true" />
                  </Button>
                  <div className="min-h-0 flex-1 overflow-y-auto">{parts.detailBody}</div>
                </>
              ) : null}
            </SheetContent>
          </Sheet>

          <ServiceBottomNav
            active={view}
            readyCount={readyQueue.length}
            attentionCount={attention.length}
            onChange={setView}
          />
        </OperationalHome>
      )}
    />
  );
}

const MOBILE_TABS: readonly {
  readonly id: ServiceView;
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
  readonly active: ServiceView;
  readonly readyCount: number;
  readonly attentionCount: number;
  readonly onChange: (tab: ServiceView) => void;
}) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-white/55 bg-[#FFF9EF]/88 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1 shadow-[0_-10px_30px_rgba(74,40,40,0.08)] backdrop-blur-xl md:hidden"
      aria-label="Servis menüsü"
    >
      <ul className="mx-auto grid max-w-md grid-cols-4 gap-1">
        {MOBILE_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = active === tab.id;
          const badge = tab.id === "ready" ? readyCount : tab.id === "tables" ? attentionCount : 0;
          return (
            <li key={tab.id}>
              <button
                type="button"
                onClick={() => onChange(tab.id)}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "motion-press relative flex min-h-14 w-full flex-col items-center justify-center gap-1 rounded-xl px-1 text-xs font-semibold text-[#716257] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7A3040]",
                  isActive && "bg-[#278D7C]/10 text-[#206D61]",
                )}
              >
                <span className="relative">
                  <Icon className="size-5" strokeWidth={isActive ? 2.2 : 1.8} aria-hidden="true" />
                  {badge > 0 ? (
                    <span className="absolute -end-2 -top-1.5 flex min-w-4 items-center justify-center rounded-full bg-[#681F25] px-1 text-[10px] font-bold leading-4 text-white" aria-label={`${badge} bekleyen`}>
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
