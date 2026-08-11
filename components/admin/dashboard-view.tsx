import Link from "next/link";
import { ArrowRight, Banknote, CircleDollarSign, Clock3, Grid2X2, ReceiptText, TrendingUp, Utensils } from "lucide-react";
import { AdminKpi, AdminPageHeader, AdminPanel } from "@/components/admin/admin-ui";
import { DashboardSalesChart } from "@/components/admin/admin-charts";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/status-badge";
import { adminUser, bestSellers, orders, restaurantTables } from "@/lib/mock-data";
import { formatCurrency } from "@/lib/format";

export function DashboardView() {
  const activeTables = restaurantTables.filter((table) => table.status !== "available").slice(0, 6);
  const adminFirstName = adminUser.name.split(" ")[0];

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title={`Merhaba ${adminFirstName}`}
        description="Salon, mutfak ve satış hareketlerini tek ekrandan takip edin. Veriler demo amacıyla hazırlanmıştır."
        actions={
          <Button render={<Link href="/admin/reports" />} nativeButton={false} variant="outline" className="h-10 bg-card">
            Raporu Aç <ArrowRight className="size-4" />
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <AdminKpi label="Bugünkü Ciro" value="18.420 ₺" icon={Banknote} change={12.4} changeLabel="düne göre" inverse />
        <AdminKpi label="Sipariş" value="74" icon={ReceiptText} change={8.1} changeLabel="düne göre" />
        <AdminKpi label="Aktif Masa" value="12" icon={Grid2X2} helper="18 masanın 12'si açık" />
        <AdminKpi label="Ortalama Sipariş" value="248 ₺" icon={CircleDollarSign} change={3.2} changeLabel="geçen haftaya göre" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,0.75fr)]">
        <AdminPanel
          title="Satış grafiği"
          description="11-17 Ağustos haftası, günlük brüt satış"
          action={
            <div className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
              <span className="size-2 rounded-full bg-burgundy" /> Satış
            </div>
          }
        >
          <div className="mb-1 flex items-end gap-3">
            <strong className="text-2xl font-extrabold tabular-nums">116.340 ₺</strong>
            <span className="mb-1 inline-flex items-center gap-1 text-xs font-bold text-emerald-700">
              <TrendingUp className="size-3.5" /> %9,6
            </span>
          </div>
          <DashboardSalesChart />
        </AdminPanel>

        <AdminPanel title="En çok satanlar" description="Bugünkü satış adedine göre" contentClassName="p-0 sm:p-0">
          <div className="divide-y">
            {bestSellers.map((item, index) => (
              <div key={item.name} className="flex items-center gap-3 px-4 py-4 sm:px-5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted font-heading text-sm font-bold text-burgundy">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{item.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{formatCurrency(item.revenue)} ciro</p>
                </div>
                <strong className="text-sm tabular-nums">{item.count} adet</strong>
              </div>
            ))}
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
                {orders.slice(0, 5).map((order) => (
                  <tr key={order.id} className="transition-colors hover:bg-muted/25">
                    <td className="px-5 py-3.5 font-extrabold">{order.orderNumber}</td>
                    <td className="px-3 py-3.5 font-semibold">{order.tableName}</td>
                    <td className="px-3 py-3.5"><StatusBadge status={order.status} /></td>
                    <td className="px-3 py-3.5 text-muted-foreground">{order.elapsedMinutes} dk</td>
                    <td className="px-5 py-3.5 text-right font-extrabold tabular-nums">{formatCurrency(order.total)}</td>
                  </tr>
                ))}
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
          {activeTables.map((table) => (
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
          ))}
        </AdminPanel>
      </div>
    </div>
  );
}
