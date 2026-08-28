"use client";

import Link from "next/link";
import { ArrowRight, RefreshCw, Wallet } from "lucide-react";
import { AdminPageHeader, AdminPanel } from "@/components/admin/admin-ui";
import { panelState } from "@/components/shared/data-states";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/status-badge";
import { staffOrderToViewModel } from "@/lib/adapters/staff-view-model";
import { cashierShiftApi, staffApi } from "@/lib/api/endpoints";
import { useApiResource } from "@/lib/hooks/use-api-resource";
import { formatCurrency, formatElapsed } from "@/lib/format";
import { useCallback, useMemo } from "react";
import { readOverview, TodayPanel } from "@/components/admin/today-panel";

const ORDER_POLL_MS = 20_000;

/** One page of open drawers is enough to answer "şu anda kasa açık mı?". */
const OPEN_SHIFT_QUERY = "status=OPEN&page=1&pageSize=20";

/**
 * One panel's no-content line.
 *
 * Each caller passes the copy for its own resource, because "Stok bilgileri
 * alınamadı" tells a manager what to do and "İşlem tamamlanamadı" does not.
 * The failure stays inside this panel: the shell, the navigation and every
 * sibling panel that loaded fine are untouched.
 */
function PanelNotice({
  loading,
  error,
  empty,
  loadingText,
  errorText,
  emptyText,
  onRetry,
  className,
}: {
  readonly loading: boolean;
  readonly error: unknown;
  readonly empty: boolean;
  readonly loadingText: string;
  readonly errorText: string;
  readonly emptyText: string;
  readonly onRetry?: () => void;
  readonly className?: string;
}) {
  const state = panelState({ loading, error, empty });
  if (state === "ready") return null;
  if (state === "error") {
    return (
      <div role="alert" className={cn("py-8 text-center", className)}>
        <p className="text-sm font-semibold text-status-danger">{errorText}</p>
        {onRetry ? (
          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={onRetry}>
            <RefreshCw className="size-3.5" aria-hidden="true" /> Tekrar dene
          </Button>
        ) : null}
      </div>
    );
  }
  return (
    <p className={cn("py-8 text-center text-sm text-muted-foreground", className)}>
      {state === "loading" ? loadingText : emptyText}
    </p>
  );
}

/**
 * The manager's home, and only the manager's home.
 *
 * It answers four questions and then stops: what did today sell, what is still
 * open on the floor, is a till open, and is anything wrong right now. The
 * fortnight of charts, the best-seller league table and the floor grid this
 * screen used to carry are all still in the product — under Raporlar, Menü and
 * Masalar — and none of them was ever the reason someone opened this page in
 * the middle of service.
 */
export function DashboardView() {
  // The same bounded endpoint the ERP screen reads — one request, ten
  // statements, one round trip. The panel is imported rather than rebuilt so
  // the two screens cannot disagree about what needs attention today.
  const loadOverview = useCallback((signal: AbortSignal) => readOverview(signal), []);
  const overview = useApiResource(loadOverview);

  const loadOrders = useCallback((signal: AbortSignal) => staffApi.orders(undefined, signal), []);
  const orderResource = useApiResource(loadOrders, { pollMs: ORDER_POLL_MS });
  const orders = useMemo(
    () => (orderResource.data?.orders ?? []).map((order) => staffOrderToViewModel(order)),
    [orderResource.data],
  );

  const loadShifts = useCallback(
    (signal: AbortSignal) => cashierShiftApi.history(OPEN_SHIFT_QUERY, signal),
    [],
  );
  const shiftResource = useApiResource(loadShifts, { pollMs: ORDER_POLL_MS });
  const openShifts = shiftResource.data?.rows ?? [];

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Genel Bakış"
        description="Bugün ne oluyor ve şimdi ne yapmanız gerekiyor."
        actions={
          <Button render={<Link href="/admin/reports" />} nativeButton={false} variant="outline" className="h-10 bg-card">
            Raporu Aç <ArrowRight className="size-4" />
          </Button>
        }
      />

      <TodayPanel overview={overview.data ?? null} error={overview.error} onRetry={() => void overview.refetch()} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.8fr)]">
        <AdminPanel
          title="Açık siparişler"
          description="Salondaki en güncel hareketler"
          action={
            <Button render={<Link href="/admin/orders" />} nativeButton={false} variant="ghost" size="sm">
              Tümünü Gör <ArrowRight className="size-3.5" />
            </Button>
          }
          contentClassName="p-0 sm:p-0"
        >
          <div className="divide-y sm:hidden">
            {orders.length ? orders.slice(0, 6).map((order) => (
              <article key={order.id} className="space-y-3 px-4 py-4">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-extrabold">{order.orderNumber}</p>
                    <p className="mt-0.5 truncate text-xs font-semibold text-muted-foreground">{order.tableName}</p>
                  </div>
                  <strong className="shrink-0 tabular-nums">{formatCurrency(order.total)}</strong>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <StatusBadge status={order.status} />
                  <span className="text-xs text-muted-foreground">{formatElapsed(order.elapsedMinutes)}</span>
                </div>
              </article>
            )) : (
              <PanelNotice
                className="px-4"
                loading={orderResource.loading}
                error={orderResource.error}
                empty={orders.length === 0}
                loadingText="SipariÅŸler yÃ¼kleniyorâ€¦"
                errorText="SipariÅŸ listesi alÄ±namadÄ±."
                emptyText="AÃ§Ä±k sipariÅŸ yok."
                onRetry={() => void orderResource.refetch()}
              />
            )}
          </div>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead className="border-b bg-muted/30 text-xs text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 font-semibold">Sipariş</th>
                  <th className="px-3 py-3 font-semibold">Masa</th>
                  <th className="px-3 py-3 font-semibold">Durum</th>
                  <th className="px-3 py-3 font-semibold">Süre</th>
                  <th className="px-5 py-3 text-right font-semibold">Tutar</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {orders.length ? orders.slice(0, 6).map((order) => (
                  <tr key={order.id} className="transition-colors hover:bg-muted/25">
                    <td className="px-5 py-3.5 font-extrabold">{order.orderNumber}</td>
                    <td className="px-3 py-3.5 font-semibold">{order.tableName}</td>
                    <td className="px-3 py-3.5"><StatusBadge status={order.status} /></td>
                    <td className="px-3 py-3.5 text-muted-foreground">{formatElapsed(order.elapsedMinutes)}</td>
                    <td className="px-5 py-3.5 text-right font-extrabold tabular-nums">{formatCurrency(order.total)}</td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={5} className="px-5">
                      <PanelNotice
                        loading={orderResource.loading}
                        error={orderResource.error}
                        empty={orders.length === 0}
                        loadingText="Siparişler yükleniyor…"
                        errorText="Sipariş listesi alınamadı."
                        emptyText="Açık sipariş yok."
                        onRetry={() => void orderResource.refetch()}
                      />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </AdminPanel>

        {/* Whether a drawer is open decides whether the restaurant can take
            money at all, so it belongs on this screen rather than one level
            down beside the register master data. */}
        <AdminPanel
          title="Açık kasa"
          description="Şu anda açık olan vardiyalar"
          action={
            <Button render={<Link href="/admin/cash-registers" />} nativeButton={false} variant="ghost" size="sm">
              Kasa <ArrowRight className="size-3.5" />
            </Button>
          }
          contentClassName="p-0 sm:p-0"
        >
          <div className="divide-y">
            {openShifts.length ? openShifts.map((shift) => (
              <div key={shift.id} className="flex items-center gap-3 px-4 py-4 sm:px-5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-burgundy">
                  <Wallet className="size-4" strokeWidth={1.8} aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{shift.openedByName ?? "Kasiyer"}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Açılış {formatCurrency(Number(shift.openingCash))}
                  </p>
                </div>
              </div>
            )) : (
              <PanelNotice
                className="px-5"
                loading={shiftResource.loading}
                error={shiftResource.error}
                empty={openShifts.length === 0}
                loadingText="Kasa durumu yükleniyor…"
                errorText="Kasa durumu alınamadı."
                emptyText="Açık kasa yok."
                onRetry={() => void shiftResource.refetch()}
              />
            )}
          </div>
        </AdminPanel>
      </div>
    </div>
  );
}
