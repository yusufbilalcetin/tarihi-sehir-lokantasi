"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BellRing,
  Check,
  ChefHat,
  CircleCheckBig,
  Clock3,
  CookingPot,
  MessageSquareText,
  Play,
  ReceiptText,
  Utensils,
} from "lucide-react";
import { BrandMark } from "@/components/shared/brand-mark";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { orders } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import type { Order, OrderStatus } from "@/types";

type KitchenStage = Extract<OrderStatus, "pending" | "preparing" | "ready">;

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
    id: "pending",
    title: "Yeni",
    description: "Hazırlığa alınacak",
    icon: ReceiptText,
    headerClassName: "border-burgundy/25 bg-burgundy/[0.055]",
    countClassName: "bg-burgundy text-primary-foreground",
    emptyTitle: "Yeni sipariş yok",
    emptyDescription: "Gelen siparişler burada görünecek.",
  },
  {
    id: "preparing",
    title: "Hazırlanıyor",
    description: "Mutfakta işlemde",
    icon: CookingPot,
    headerClassName: "border-copper/35 bg-copper/[0.09]",
    countClassName: "bg-copper text-[#25211D]",
    emptyTitle: "Hazırlık sırası boş",
    emptyDescription: "Başlatılan siparişler burada izlenir.",
  },
  {
    id: "ready",
    title: "Hazır",
    description: "Servis teslimi bekliyor",
    icon: BellRing,
    headerClassName: "border-olive/25 bg-olive/[0.065]",
    countClassName: "bg-olive text-[#FFFDF8]",
    emptyTitle: "Teslim bekleyen yok",
    emptyDescription: "Hazır siparişler servis için burada bekler.",
  },
];

const initialOrders = orders.filter((order) =>
  stages.some((stage) => stage.id === order.status),
);

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
      className: "border-burgundy/25 bg-burgundy/[0.08] text-burgundy",
      timeClassName: "text-burgundy",
    };
  }

  if (minutes >= 8) {
    return {
      label: "Öncelikli",
      className: "border-copper/35 bg-copper/[0.12] text-[#6A4526]",
      timeClassName: "text-[#82552D]",
    };
  }

  return {
    label: "Zamanında",
    className: "border-olive/20 bg-olive/[0.07] text-olive",
    timeClassName: "text-olive",
  };
}

function getAction(stage: KitchenStage) {
  if (stage === "pending") {
    return {
      label: "Hazırlamaya başla",
      ariaLabel: "hazırlamaya başlat",
      icon: Play,
      nextStatus: "preparing" as const,
      buttonClassName: "bg-burgundy text-primary-foreground hover:bg-burgundy/90",
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

function KitchenOrderCard({
  order,
  elapsedMinutes,
  onAdvance,
}: {
  order: Order;
  elapsedMinutes: number;
  onAdvance: (orderId: string, nextStatus: OrderStatus) => void;
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
          {order.items.map((item) => (
            <li key={item.id} className="grid grid-cols-[2.25rem_1fr] gap-2.5">
              <span className="flex h-8 items-center justify-center rounded-lg bg-muted text-sm font-extrabold tabular-nums text-foreground">
                {item.quantity}×
              </span>
              <div className="min-w-0 pt-1">
                <p className="font-semibold leading-5 text-foreground">{item.productName}</p>
                {item.note ? (
                  <p className="mt-1.5 flex items-start gap-1.5 rounded-lg bg-burgundy/[0.06] px-2.5 py-2 text-xs font-semibold leading-5 text-burgundy">
                    <MessageSquareText className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                    <span>{item.note}</span>
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="border-t border-border bg-muted/35 p-3">
        <Button
          type="button"
          size="lg"
          className={cn("h-11 w-full text-sm font-bold", action.buttonClassName)}
          aria-label={`${order.tableName} ${order.orderNumber} siparişini ${action.ariaLabel}`}
          onClick={() => onAdvance(order.id, action.nextStatus)}
        >
          <ActionIcon className="size-4" aria-hidden="true" />
          {action.label}
        </Button>
      </div>
    </article>
  );
}

export function KitchenBoard() {
  const [activeOrders, setActiveOrders] = useState<Order[]>(initialOrders);
  const [now, setNow] = useState<Date | null>(null);
  const [elapsedOffset, setElapsedOffset] = useState(0);

  useEffect(() => {
    const mountedAt = Date.now();
    const updateClock = () => {
      const current = new Date();
      setNow(current);
      setElapsedOffset(Math.floor((current.getTime() - mountedAt) / 60_000));
    };

    updateClock();
    const interval = window.setInterval(updateClock, 1_000);
    return () => window.clearInterval(interval);
  }, []);

  const counts = useMemo(
    () =>
      stages.reduce<Record<KitchenStage, number>>(
        (result, stage) => ({
          ...result,
          [stage.id]: activeOrders.filter((order) => order.status === stage.id).length,
        }),
        { pending: 0, preparing: 0, ready: 0 },
      ),
    [activeOrders],
  );

  const visibleOrderCount = counts.pending + counts.preparing + counts.ready;

  const advanceOrder = (orderId: string, nextStatus: OrderStatus) => {
    setActiveOrders((current) =>
      current.map((order) =>
        order.id === orderId ? { ...order, status: nextStatus } : order,
      ),
    );
  };

  return (
    <main className="min-h-[100dvh] bg-background">
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
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7" aria-label="Mutfak sipariş panosu">
        <div className="grid gap-4 md:grid-cols-3 xl:gap-5">
          {stages.map((stage) => {
            const StageIcon = stage.icon;
            const stageOrders = activeOrders.filter((order) => order.status === stage.id);

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
                        elapsedMinutes={order.elapsedMinutes + elapsedOffset}
                        onAdvance={advanceOrder}
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
    </main>
  );
}
