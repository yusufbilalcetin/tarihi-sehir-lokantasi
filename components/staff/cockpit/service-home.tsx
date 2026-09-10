"use client";

import type { ReactNode } from "react";
import { BellRing, ChefHat, Clock3, ReceiptText, TableProperties, UtensilsCrossed } from "lucide-react";

import { AttentionQueue } from "@/components/staff/cockpit/attention-queue";
import {
  OperationalAction,
  OperationalActionGrid,
  OperationalMetric,
  OperationalMetricGrid,
  OperationalSectionHeading,
} from "@/components/staff/operational-ui";
import type { AttentionEntry } from "@/lib/domain/service-attention";
import { cn } from "@/lib/utils";

/**
 * The waiter's home: what needs a person, then the room. Nothing else.
 *
 * This is the screen a waiter scrolls to the bottom of during service, so what
 * sits after the last table card matters. The answer is nothing — no clocking
 * in, no shift list, no account settings. Those are personal and live behind
 * the Profil tab; here the board simply ends and the bottom bar begins.
 */

export interface TableFilterOption {
  readonly id: string;
  readonly label: string;
}

export function ServiceHome({
  attention,
  filters,
  activeFilter,
  onFilterChange,
  onSelectTable,
  visibleCount,
  totalCount,
  status,
  dataReady,
  loading,
  board,
  activeView,
  onShowTables,
  onShowOrders,
  onShowReady,
  className,
}: {
  readonly attention: readonly AttentionEntry[];
  readonly filters: readonly TableFilterOption[];
  readonly activeFilter: string;
  readonly onFilterChange: (id: string) => void;
  readonly onSelectTable: (tableId: string) => void;
  readonly visibleCount: number;
  readonly totalCount: number;
  readonly status: {
    readonly activeTables: number;
    readonly openOrders: number;
    readonly billRequests: number;
    readonly lateOrders: number;
  };
  readonly dataReady: boolean;
  readonly loading: boolean;
  readonly board: ReactNode;
  readonly activeView: "tables" | "orders" | "ready" | "profile";
  readonly onShowTables: () => void;
  readonly onShowOrders: () => void;
  readonly onShowReady: () => void;
  readonly className?: string;
}) {
  return (
    <div className={cn("space-y-6", className)} data-service-home="radical">
      <OperationalMetricGrid ariaLabel="Canlı servis durumu">
        <OperationalMetric
          label="Açık Masa"
          value={status.activeTables}
          icon={TableProperties}
          tone="teal"
          iconClassName="bg-[#278D7C] text-white"
          ready={dataReady}
          loading={loading}
        />
        <OperationalMetric
          label="Açık Sipariş"
          value={status.openOrders}
          icon={UtensilsCrossed}
          tone="blue"
          iconClassName="bg-[#397FC5] text-white"
          ready={dataReady}
          loading={loading}
        />
        <OperationalMetric
          label="Hesap Bekleyen"
          value={status.billRequests}
          icon={ReceiptText}
          tone="amber"
          iconClassName="bg-[#E49A32] text-white"
          ready={dataReady}
          loading={loading}
        />
        <OperationalMetric
          label="Geciken"
          value={status.lateOrders}
          icon={Clock3}
          tone="burgundy"
          iconClassName="bg-[#B53C48] text-white"
          ready={dataReady}
          loading={loading}
        />
      </OperationalMetricGrid>

      <section aria-labelledby="service-apps-title">
        <OperationalSectionHeading id="service-apps-title" title="Servis uygulamaları" />
        <OperationalActionGrid ariaLabel="Servis uygulamaları">
          <OperationalAction
            label="Masalar"
            icon={TableProperties}
            iconClassName="bg-[#278D7C]"
            active={activeView === "tables"}
            onClick={onShowTables}
          />
          <OperationalAction
            label="Siparişler"
            icon={ReceiptText}
            iconClassName="bg-[#397FC5]"
            active={activeView === "orders"}
            onClick={onShowOrders}
          />
          <OperationalAction
            label="Hazır Servis"
            icon={ChefHat}
            iconClassName="bg-[#E29A2F] text-[#2B211D]"
            active={activeView === "ready"}
            onClick={onShowReady}
          />
          <OperationalAction
            label="Çağrılar"
            icon={BellRing}
            iconClassName="bg-[#B54755]"
            href="/staff/calls"
            badge={attention.filter((entry) => entry.reason === "waiter-call").length || undefined}
          />
        </OperationalActionGrid>
      </section>

      {dataReady ? (
        <AttentionQueue entries={attention.slice(0, 3)} onSelectTable={onSelectTable} />
      ) : loading ? (
        <div className="h-20 animate-pulse rounded-2xl border border-[#6B4A32]/10 bg-white/48 motion-reduce:animate-none" aria-label="İlgilenilecek işler yükleniyor" />
      ) : null}

      <section aria-labelledby="table-board-title" className="space-y-2.5">
        <OperationalSectionHeading
          id="table-board-title"
          title="Masalar"
          // "0/0" before the floor has answered is a claim that the restaurant
          // has no tables. Until it has, the count is a dash.
          detail={<span className="tabular-nums">{dataReady ? `${visibleCount}/${totalCount}` : "—"}</span>}
        />

        <div
          className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="group"
          aria-label="Masa filtresi"
        >
          {filters.map((filter) => (
            <button
              key={filter.id}
              type="button"
              onClick={() => onFilterChange(filter.id)}
              aria-pressed={activeFilter === filter.id}
              className={cn(
                "motion-press min-h-11 shrink-0 rounded-full border border-border-subtle px-3.5 text-sm font-semibold text-text-secondary",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                activeFilter === filter.id &&
                  "border-order-served/40 bg-order-served-tint text-order-served",
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>

        {board}
      </section>
    </div>
  );
}
