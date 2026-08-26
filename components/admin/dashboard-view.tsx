"use client";

import Link from "next/link";
import { ArrowRight, Banknote, CircleDollarSign, Clock3, Grid2X2, ReceiptText, RefreshCw, Utensils } from "lucide-react";
import { AdminKpi, AdminPageHeader, AdminPanel } from "@/components/admin/admin-ui";
import { panelState } from "@/components/shared/data-states";
import { cn } from "@/lib/utils";
import { DashboardSalesChart } from "@/components/admin/admin-charts";
import { useAdminReports } from "@/components/admin/use-admin-reports";
import { useAdminTables } from "@/components/admin/use-admin-tables";
import { RealtimeStatus } from "@/components/staff/realtime-status";
import { useStaffSession } from "@/components/staff/staff-session-provider";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/status-badge";
import { staffOrderToViewModel } from "@/lib/adapters/staff-view-model";
import { staffApi } from "@/lib/api/endpoints";
import { useApiResource } from "@/lib/hooks/use-api-resource";
import { formatCurrency } from "@/lib/format";
import { useCallback, useMemo } from "react";
import { readOverview, TodayPanel } from "@/components/admin/today-panel";

const ORDER_POLL_MS = 20_000;


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

export function DashboardView() {
  const { name } = useStaffSession();
  const reports = useAdminReports();
  const tables = useAdminTables();

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

  const activeTables = tables.tableViews
    .filter((table) => table.status !== "available" && table.status !== "inactive")
    .slice(0, 6);
  const totals = reports.reports?.totals;
  const bestSellers = reports.reports?.bestSellers ?? [];
  const adminFirstName = name.split(" ")[0];

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title={`Merhaba ${adminFirstName}`}
        description="Bugün ne oluyor ve şimdi ne yapmanız gerekiyor."
        actions={
          <Button render={<Link href="/admin/reports" />} nativeButton={false} variant="outline" className="h-10 bg-card">
            Raporu Aç <ArrowRight className="size-4" />
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <RealtimeStatus status={tables.realtimeStatus} />
      </div>

      <TodayPanel overview={overview.data ?? null} error={overview.error} onRetry={() => void overview.refetch()} />

      <div>
        <h3 className="font-heading text-lg font-semibold">Son 14 gün</h3>
        <p className="text-sm text-muted-foreground">Bugünün ötesindeki eğilim; günlük karar için yukarısı yeterlidir.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <AdminKpi label="14 Günlük Ciro" value={formatCurrency(Number(totals?.revenue ?? 0))} icon={Banknote} inverse />
        <AdminKpi label="Sipariş" value={String(totals?.orderCount ?? 0)} icon={ReceiptText} />
        <AdminKpi
          label="Aktif Masa"
          value={String(activeTables.length)}
          icon={Grid2X2}
          helper={`${tables.tableViews.length} masanın ${activeTables.length}'i açık`}
        />
        <AdminKpi label="Ortalama Sipariş" value={formatCurrency(Number(totals?.averageOrder ?? 0))} icon={CircleDollarSign} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,0.75fr)]">
        <AdminPanel
          title="Satış grafiği"
          description="Son 14 gün, günlük brüt satış"
          action={
            <div className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
              <span className="size-2 rounded-full bg-burgundy" /> Satış
            </div>
          }
        >
          <div className="mb-1 flex items-end gap-3">
            <strong className="text-2xl font-extrabold tabular-nums">{formatCurrency(Number(totals?.revenue ?? 0))}</strong>
          </div>
          {reports.salesSeries.length && !reports.error ? (
            <DashboardSalesChart data={reports.salesSeries} />
          ) : (
            <PanelNotice
              className="py-20"
              loading={reports.loading}
              error={reports.error}
              empty={reports.salesSeries.length === 0}
              loadingText="Satış verisi yükleniyor…"
              errorText="Satış verileri alınamadı."
              emptyText="Bu dönemde satış kaydı yok."
              onRetry={reports.refetch}
            />
          )}
        </AdminPanel>

        <AdminPanel title="En çok satanlar" description="Son 14 günün satış adedine göre" contentClassName="p-0 sm:p-0">
          <div className="divide-y">
            {bestSellers.length && !reports.error ? bestSellers.slice(0, 4).map((item, index) => (
              <div key={item.productName} className="flex items-center gap-3 px-4 py-4 sm:px-5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted font-heading text-sm font-bold text-burgundy">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{item.productName}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{formatCurrency(Number(item.revenue))} ciro</p>
                </div>
                <strong className="text-sm tabular-nums">{item.quantity} adet</strong>
              </div>
            )) : (
              <PanelNotice
                className="px-5"
                loading={reports.loading}
                error={reports.error}
                empty={bestSellers.length === 0}
                loadingText="Ürün performansı yükleniyor…"
                errorText="Ürün performansı alınamadı."
                emptyText="Henüz satış yok."
                onRetry={reports.refetch}
              />
            )}
          </div>
          <div className="border-t bg-muted/25 p-3">
            <Button render={<Link href="/admin/products" />} nativeButton={false} variant="ghost" className="w-full justify-between">
              Ürün performansı <ArrowRight className="size-4" />
            </Button>
          </div>
        </AdminPanel>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.9fr)]">
        <AdminPanel
          title="Son siparişler"
          description="Salondaki en güncel hareketler"
          action={
            <Button render={<Link href="/admin/orders" />} nativeButton={false} variant="ghost" size="sm">
              Tümünü Gör <ArrowRight className="size-3.5" />
            </Button>
          }
          contentClassName="p-0 sm:p-0"
        >
          <div className="overflow-x-auto">
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
                {orders.length ? orders.slice(0, 5).map((order) => (
                  <tr key={order.id} className="transition-colors hover:bg-muted/25">
                    <td className="px-5 py-3.5 font-extrabold">{order.orderNumber}</td>
                    <td className="px-3 py-3.5 font-semibold">{order.tableName}</td>
                    <td className="px-3 py-3.5"><StatusBadge status={order.status} /></td>
                    <td className="px-3 py-3.5 text-muted-foreground">{order.elapsedMinutes} dk</td>
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

        <AdminPanel
          title="Aktif masalar"
          description="Anlık salon görünümü"
          action={
            <Button render={<Link href="/admin/tables" />} nativeButton={false} variant="ghost" size="sm">
              Salon <ArrowRight className="size-3.5" />
            </Button>
          }
          contentClassName="grid grid-cols-2 gap-3"
        >
          {activeTables.length ? activeTables.map((table) => (
            <Link
              key={table.id}
              href="/admin/tables"
              className="rounded-xl border bg-background p-3 transition-colors hover:border-copper/60 hover:bg-accent/35"
            >
              <div className="flex items-start justify-between gap-2">
                <Utensils className="size-4 text-burgundy" strokeWidth={1.8} />
                <StatusBadge status={table.status} className="max-w-full overflow-hidden text-[10px]" />
              </div>
              <p className="mt-3 text-sm font-extrabold">{table.name}</p>
              <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                <Clock3 className="size-3" /> {table.activeMinutes ?? 0} dk
              </p>
            </Link>
          )) : (
            <PanelNotice
              className="col-span-2"
              loading={tables.loading}
              error={tables.error}
              empty={activeTables.length === 0}
              loadingText="Salon yükleniyor…"
              errorText="Masa bilgileri alınamadı."
              emptyText="Şu anda açık masa yok."
            />
          )}
        </AdminPanel>
      </div>
    </div>
  );
}
