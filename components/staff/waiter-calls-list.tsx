"use client";

import { useCallback, useMemo, useState } from "react";
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
import { EmptyState } from "@/components/shared/data-states";
import { RealtimeStatus } from "@/components/staff/realtime-status";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { staffCallToViewModel } from "@/lib/adapters/staff-view-model";
import { ApiClientError } from "@/lib/api/client";
import { staffApi } from "@/lib/api/endpoints";
import { useApiResource } from "@/lib/hooks/use-api-resource";
import { useStaffRealtime } from "@/lib/realtime/use-staff-realtime";
import { cn } from "@/lib/utils";
import type { WaiterCall } from "@/types";

type CallFilter = "all" | WaiterCall["status"];

const CALL_POLL_MS = 15_000;

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
  // Urgency, in the shared status vocabulary: an open call is the one that
  // needs somebody now, a bill request is the warning tier, and a resolved
  // call recedes.
  if (call.status === "resolved") return "border-l-status-success";
  if (call.type === "Hesap istiyor") return "border-l-status-warning bg-status-warning-tint/40";
  if (call.status === "open") return "border-l-status-danger bg-status-danger-tint/40";
  return "border-l-status-info";
}

export function WaiterCallsList() {
  const [filter, setFilter] = useState<CallFilter>("all");
  const [pendingCallId, setPendingCallId] = useState<string | null>(null);

  const loadCalls = useCallback((signal: AbortSignal) => staffApi.calls(undefined, signal), []);
  const resource = useApiResource(loadCalls, { pollMs: CALL_POLL_MS });
  const { refetch } = resource;
  const realtimeStatus = useStaffRealtime({
    onEvent: useCallback(() => void refetch(), [refetch]),
    onResync: useCallback(() => void refetch(), [refetch]),
  });

  const calls = useMemo(
    () => (resource.data?.calls ?? []).map((call) => staffCallToViewModel(call)),
    [resource.data],
  );

  const visibleCalls = useMemo(
    () => calls.filter((call) => filter === "all" || call.status === filter),
    [calls, filter],
  );

  async function updateCall(
    call: WaiterCall,
    status: "ACKNOWLEDGED" | "RESOLVED",
    successMessage: string,
  ) {
    if (pendingCallId) return;
    setPendingCallId(call.id);
    try {
      await staffApi.updateCall(call.id, status);
      await refetch();
      toast.success(`${call.tableName} ${successMessage}`);
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "İşlem tamamlanamadı.");
    } finally {
      setPendingCallId(null);
    }
  }

  function assignCall(call: WaiterCall) {
    void updateCall(call, "ACKNOWLEDGED", "talebini üstlendin.");
  }

  function resolveCall(call: WaiterCall) {
    void updateCall(call, "RESOLVED", "talebi tamamlandı.");
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-medium text-muted-foreground" aria-live="polite">
          {resource.loading ? "Çağrılar yükleniyor…" : `${visibleCalls.length} çağrı gösteriliyor`}
        </p>
        <RealtimeStatus status={realtimeStatus} />
      </div>

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

      {resource.error && !resource.data ? (
        <EmptyState
          icon={BellRing}
          title="Çağrılar yüklenemedi"
          description={resource.error.message}
        />
      ) : visibleCalls.length > 0 ? (
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
                          ? `${call.assignedTo ?? "Bir garson"} ilgileniyor`
                          : "Talep tamamlandı"}
                    </p>
                  </div>
                </div>

                <div className="sm:w-40 sm:shrink-0">
                  {call.status === "open" ? (
                    <Button type="button" className="min-h-11 w-full" disabled={pendingCallId === call.id} aria-busy={pendingCallId === call.id} onClick={() => assignCall(call)}>
                      <BellRing className="size-4" strokeWidth={1.8} />
                      Üstlen
                    </Button>
                  ) : call.status === "assigned" ? (
                    <Button type="button" variant="secondary" className="min-h-11 w-full" disabled={pendingCallId === call.id} aria-busy={pendingCallId === call.id} onClick={() => resolveCall(call)}>
                      <CheckCircle2 className="size-4" strokeWidth={1.8} />
                      Tamamlandı
                    </Button>
                  ) : (
                    <div className="flex min-h-11 items-center justify-center gap-2 rounded-lg bg-status-success-tint px-3 text-sm font-semibold text-status-success">
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
