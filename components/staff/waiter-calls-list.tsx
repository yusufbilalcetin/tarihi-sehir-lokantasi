"use client";

import { useMemo, useState } from "react";
import {
  BellRing,
  CheckCircle2,
  Clock3,
  ConciergeBell,
  GlassWater,
  ReceiptText,
  Utensils,
} from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { waiterCalls } from "@/lib/mock-data/calls";
import { cn } from "@/lib/utils";
import type { WaiterCall } from "@/types";

type CallFilter = "all" | WaiterCall["status"];

const callFilters: { value: CallFilter; label: string }[] = [
  { value: "all", label: "Tümü" },
  { value: "open", label: "Bekleyen" },
  { value: "assigned", label: "Üstlenilen" },
  { value: "resolved", label: "Tamamlanan" },
];

function getCallIcon(call: WaiterCall) {
  if (call.type === "Hesap istiyor") return ReceiptText;
  if (call.type === "Su istiyorum") return GlassWater;
  if (call.type === "Sipariş vereceğim") return Utensils;
  return ConciergeBell;
}

function getCallTone(call: WaiterCall) {
  if (call.status === "resolved") return "border-l-emerald-600";
  if (call.type === "Hesap istiyor") return "border-l-violet-600 bg-violet-50/35";
  if (call.status === "open") return "border-l-rose-600 bg-rose-50/35";
  return "border-l-sky-600";
}

export function WaiterCallsList() {
  const [calls, setCalls] = useState<WaiterCall[]>(waiterCalls);
  const [filter, setFilter] = useState<CallFilter>("all");

  const visibleCalls = useMemo(
    () => calls.filter((call) => filter === "all" || call.status === filter),
    [calls, filter],
  );

  function assignCall(call: WaiterCall) {
    setCalls((current) =>
      current.map((item) =>
        item.id === call.id
          ? { ...item, status: "assigned", assignedTo: "Ahmet" }
          : item,
      ),
    );
    toast.success(`${call.tableName} talebini üstlendin.`, {
      description: "Durum Ahmet ilgileniyor olarak güncellendi.",
    });
  }

  function resolveCall(call: WaiterCall) {
    setCalls((current) =>
      current.map((item) =>
        item.id === call.id ? { ...item, status: "resolved" } : item,
      ),
    );
    toast.success(`${call.tableName} talebi tamamlandı.`);
  }

  return (
    <div className="space-y-5">
      <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Garson çağrısı filtresi">
        {callFilters.map((item) => {
          const count = item.value === "all"
            ? calls.length
            : calls.filter((call) => call.status === item.value).length;
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
                  : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
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

      {visibleCalls.length > 0 ? (
        <div className="space-y-3" aria-live="polite">
          {visibleCalls.map((call) => {
            const Icon = getCallIcon(call);
            return (
              <article
                key={call.id}
                className={cn(
                  "flex flex-col gap-4 rounded-xl border border-l-4 bg-card p-4 shadow-[0_8px_24px_rgb(74_40_40/0.045)] sm:flex-row sm:items-center sm:p-5",
                  getCallTone(call),
                )}
              >
                <div className="flex min-w-0 flex-1 items-start gap-3.5">
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-background text-burgundy">
                    <Icon className="size-5" strokeWidth={1.8} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-heading text-xl font-semibold tracking-tight">{call.tableName}</h2>
                      <StatusBadge status={call.status} />
                    </div>
                    <p className="mt-1 text-sm font-semibold text-foreground">{call.type}</p>
                    <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock3 className="size-3.5" strokeWidth={1.8} />
                        {call.elapsed}
                      </span>
                      <span>Saat {call.createdAt}</span>
                    </p>
                    <p className="mt-2 text-sm font-semibold text-burgundy">
                      {call.status === "open"
                        ? "Atanmayı bekliyor"
                        : call.status === "assigned"
                          ? `${call.assignedTo} ilgileniyor`
                          : "Talep tamamlandı"}
                    </p>
                  </div>
                </div>

                <div className="sm:w-40 sm:shrink-0">
                  {call.status === "open" ? (
                    <Button type="button" className="min-h-11 w-full" onClick={() => assignCall(call)}>
                      <BellRing className="size-4" strokeWidth={1.8} />
                      Üstlen
                    </Button>
                  ) : call.status === "assigned" ? (
                    <Button type="button" variant="secondary" className="min-h-11 w-full" onClick={() => resolveCall(call)}>
                      <CheckCircle2 className="size-4" strokeWidth={1.8} />
                      Tamamlandı
                    </Button>
                  ) : (
                    <div className="flex min-h-11 items-center justify-center gap-2 rounded-lg bg-emerald-50 px-3 text-sm font-semibold text-emerald-800">
                      <CheckCircle2 className="size-4" strokeWidth={1.8} />
                      Tamamlandı
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={BellRing}
          title="Bu durumda çağrı yok"
          description="Başka bir filtre seçerek salon çağrılarını görüntüleyebilirsiniz."
        />
      )}
    </div>
  );
}
