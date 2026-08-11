"use client";

import { useMemo, useState } from "react";
import {
  CheckCircle2,
  ChefHat,
  Clock3,
  PackageCheck,
  Search,
  Utensils,
} from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/format";
import { orders as initialOrders } from "@/lib/mock-data/orders";
import { cn } from "@/lib/utils";
import type { Order, OrderStatus } from "@/types";

type OrderFilter = "all" | OrderStatus;

const filters: { value: OrderFilter; label: string }[] = [
  { value: "all", label: "Tümü" },
  { value: "pending", label: "Bekleyen" },
  { value: "preparing", label: "Hazırlanan" },
  { value: "ready", label: "Hazır" },
  { value: "served", label: "Serviste" },
  { value: "completed", label: "Tamamlanan" },
];

const nextStatus: Partial<Record<OrderStatus, OrderStatus>> = {
  pending: "confirmed",
  confirmed: "preparing",
  preparing: "ready",
  ready: "served",
  served: "completed",
};

const actionLabels: Partial<Record<OrderStatus, string>> = {
  pending: "Siparişi Onayla",
  confirmed: "Mutfağa Gönder",
  preparing: "Hazır İşaretle",
  ready: "Servis Edildi",
  served: "Siparişi Kapat",
};

const actionIcons: Partial<Record<OrderStatus, typeof CheckCircle2>> = {
  pending: CheckCircle2,
  confirmed: ChefHat,
  preparing: PackageCheck,
  ready: Utensils,
  served: CheckCircle2,
};

function OrderCard({
  order,
  onAdvance,
  onCancel,
}: {
  order: Order;
  onAdvance: (order: Order) => void;
  onCancel: (order: Order) => void;
}) {
  const actionLabel = actionLabels[order.status];
  const ActionIcon = actionIcons[order.status];
  const isUrgent = order.status === "pending" || order.status === "ready";

  return (
    <article
      className={cn(
        "overflow-hidden rounded-xl border bg-card shadow-[0_10px_28px_rgb(74_40_40/0.05)]",
        isUrgent && "border-burgundy/25",
      )}
    >
      <header className="flex flex-col gap-3 border-b border-border bg-muted/30 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="flex items-start justify-between gap-3 sm:justify-start">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-heading text-xl font-semibold tracking-tight">{order.tableName}</h2>
              <span className="font-mono text-xs font-bold text-muted-foreground">{order.orderNumber}</span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium text-muted-foreground">
              <span>{order.createdAt}</span>
              <span className="flex items-center gap-1">
                <Clock3 className="size-3.5" strokeWidth={1.8} />
                {order.elapsedMinutes} dakikadır açık
              </span>
              {order.waiterName ? <span>Garson: {order.waiterName}</span> : null}
            </div>
          </div>
          <StatusBadge status={order.status} className="sm:hidden" />
        </div>
        <StatusBadge status={order.status} className="hidden sm:inline-flex" />
      </header>

      <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_220px]">
        <div>
          <div className="divide-y divide-border/70">
            {order.items.map((item) => (
              <div key={item.id} className="flex gap-3 py-2.5 first:pt-0 last:pb-0">
                <span className="min-w-8 font-bold tabular-nums text-burgundy">{item.quantity} ×</span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-foreground">{item.productName}</p>
                  {item.note ? (
                    <p className="mt-1 rounded-md bg-amber-50 px-2 py-1 text-xs font-medium leading-5 text-amber-900">
                      Mutfak notu: {item.note}
                    </p>
                  ) : null}
                </div>
                <span className="shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">
                  {formatCurrency(item.quantity * item.unitPrice)}
                </span>
              </div>
            ))}
          </div>
        </div>

        <aside className="flex flex-col border-t border-border pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0" aria-label={`${order.orderNumber} özeti`}>
          <p className="text-xs font-semibold text-muted-foreground">Sipariş toplamı</p>
          <p className="mt-1 font-heading text-2xl font-semibold tabular-nums text-foreground">
            {formatCurrency(order.total)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{order.items.reduce((sum, item) => sum + item.quantity, 0)} ürün</p>

          <div className="mt-4 grid gap-2">
            {actionLabel && ActionIcon ? (
              <Button type="button" className="min-h-11 w-full" onClick={() => onAdvance(order)}>
                <ActionIcon className="size-4" strokeWidth={1.8} />
                {actionLabel}
              </Button>
            ) : null}
            {(order.status === "pending" || order.status === "confirmed") ? (
              <Button type="button" variant="destructive" className="min-h-11 w-full" onClick={() => onCancel(order)}>
                Siparişi İptal Et
              </Button>
            ) : null}
          </div>
        </aside>
      </div>
    </article>
  );
}

export function OrdersList() {
  const [orderList, setOrderList] = useState<Order[]>(initialOrders);
  const [filter, setFilter] = useState<OrderFilter>("all");
  const [query, setQuery] = useState("");

  const visibleOrders = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("tr-TR");

    return orderList.filter((order) => {
      const matchesFilter = filter === "all" || order.status === filter;
      const matchesQuery =
        normalizedQuery.length === 0 ||
        order.tableName.toLocaleLowerCase("tr-TR").includes(normalizedQuery) ||
        order.orderNumber.toLocaleLowerCase("tr-TR").includes(normalizedQuery) ||
        order.items.some((item) =>
          item.productName.toLocaleLowerCase("tr-TR").includes(normalizedQuery),
        );
      return matchesFilter && matchesQuery;
    });
  }, [filter, orderList, query]);

  function advanceOrder(order: Order) {
    const status = nextStatus[order.status];
    if (!status) return;

    setOrderList((current) =>
      current.map((item) => (item.id === order.id ? { ...item, status } : item)),
    );
    toast.success(`${order.tableName} siparişi güncellendi.`, {
      description: `${actionLabels[order.status]} işlemi tamamlandı.`,
    });
  }

  function cancelOrder(order: Order) {
    setOrderList((current) =>
      current.map((item) => (item.id === order.id ? { ...item, status: "cancelled" } : item)),
    );
    toast.info(`${order.tableName} siparişi iptal edildi.`, {
      description: "Değişiklik yalnızca demo arayüzünde saklanır.",
    });
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border bg-card p-3 shadow-[0_8px_24px_rgb(74_40_40/0.04)] sm:p-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" strokeWidth={1.8} />
          <label htmlFor="staff-order-search" className="sr-only">Siparişlerde ara</label>
          <Input
            id="staff-order-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Masa, sipariş veya ürün ara"
            className="h-11 bg-background pl-10 text-base sm:text-sm"
          />
        </div>

        <div className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label="Sipariş durumu filtresi">
          {filters.map((item) => {
            const count = item.value === "all"
              ? orderList.length
              : orderList.filter((order) => order.status === item.value).length;
            const active = filter === item.value;

            return (
              <button
                key={item.value}
                type="button"
                aria-pressed={active}
                onClick={() => setFilter(item.value)}
                className={cn(
                  "flex min-h-11 shrink-0 items-center gap-2 rounded-lg border px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "border-burgundy bg-burgundy text-primary-foreground"
                    : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {item.label}
                <span className={cn("font-mono text-xs", active ? "text-primary-foreground/75" : "text-muted-foreground")}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <p className="text-sm font-medium text-muted-foreground" aria-live="polite">
        {visibleOrders.length} sipariş gösteriliyor
      </p>

      {visibleOrders.length > 0 ? (
        <div className="space-y-4">
          {visibleOrders.map((order) => (
            <OrderCard key={order.id} order={order} onAdvance={advanceOrder} onCancel={cancelOrder} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Search}
          title="Sipariş bulunamadı"
          description="Arama ifadenizi veya seçili durum filtresini değiştirin."
        />
      )}
    </div>
  );
}
