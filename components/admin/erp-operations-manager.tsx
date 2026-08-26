"use client";

import { useCallback, useState, type ComponentProps } from "react";
import Link from "next/link";
import { Boxes, Building2, Loader2, PackagePlus, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Money } from "@/components/shared/money";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ApiResult } from "@/lib/api/response";
import { ERP_UNIT_LABELS } from "@/lib/domain/erp-workspaces";
import { useApiResource } from "@/lib/hooks/use-api-resource";
import { readOverview, Section, TodayPanel } from "@/components/admin/today-panel";

const unitLabels: Readonly<Record<string, string>> = ERP_UNIT_LABELS;

function Label(props: ComponentProps<"label">) {
  return <label {...props} className={`text-sm font-semibold ${props.className ?? ""}`} />;
}

async function sendCommand(command: Record<string, unknown>) {
  const response = await fetch("/api/admin/erp", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command) });
  const payload = await response.json() as ApiResult<unknown>;
  if (!response.ok || !payload.success) throw new Error(payload.success ? "İşlem tamamlanamadı." : payload.error.message);
  return payload.data;
}

export function ErpOperationsManager() {
  const [saving, setSaving] = useState(false);
  const [warehouse, setWarehouse] = useState({ name: "", code: "" });
  const [item, setItem] = useState({ name: "", category: "", baseUnit: "KG", reorderLevel: "0", negativeStockPolicy: "WARN" });

  const loadOverview = useCallback((signal: AbortSignal) => readOverview(signal), []);
  const resource = useApiResource(loadOverview);
  const { data: overview, error, loading, refreshing } = resource;


  async function create(command: Record<string, unknown>, reset: () => void) {
    setSaving(true);
    try { await sendCommand(command); reset(); toast.success("İşlem kaydedildi."); await resource.refetch(); }
    catch (reason) { toast.error(reason instanceof Error ? reason.message : "İşlem tamamlanamadı."); }
    finally { setSaving(false); }
  }

  if (loading && !overview) return <div className="flex min-h-72 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-5 animate-spin" /> İşletme verileri yükleniyor…</div>;
  if (error && !overview) return <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6"><p className="font-semibold text-destructive">ERP verileri okunamadı</p><p className="mt-2 text-sm text-muted-foreground">{error.message}</p><Button variant="outline" className="mt-4" onClick={() => void resource.refetch()}><RefreshCw className="size-4" /> Tekrar dene</Button></div>;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="font-heading text-xl font-semibold">Bugün ne oluyor?</h2><p className="mt-1 text-sm text-muted-foreground">Satış, stok, üretim, mal kabul ve personel sinyalleri gerçek operasyon kayıtlarından okunur.</p></div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void create({ command: "REFRESH_POPULAR", windowDays: 30 }, () => undefined)} disabled={saving}>30 günlük popülerliği yenile</Button>
          <Button variant="outline" onClick={() => void resource.refetch()} disabled={refreshing}><RefreshCw className={refreshing ? "size-4 animate-spin" : "size-4"} /> Yenile</Button>
        </div>
      </div>

      <TodayPanel overview={overview ?? null} />

      <Section title="Operasyon özeti">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(20rem,0.8fr)]">
          <Card>
            <CardHeader><CardTitle>Kritik stok</CardTitle><CardDescription>Kalan miktarı kritik seviyenin altına inen kalemler; tam liste stok ekranında.</CardDescription></CardHeader>
            <CardContent className="p-0">
              {overview?.criticalStock.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead><tr className="border-y bg-muted/45 text-left text-xs text-muted-foreground"><th className="px-5 py-3">Stok kalemi</th><th className="px-4 py-3">Grup</th><th className="px-4 py-3 text-right">Kalan</th><th className="px-4 py-3 text-right">Kritik seviye</th></tr></thead>
                    <tbody>
                      {overview.criticalStock.map((entry) => (
                        <tr key={entry.id} className="border-b last:border-0">
                          <td className="px-5 py-3"><Link className="font-semibold text-olive underline-offset-4 hover:underline" href={`/admin/inventory/${entry.id}`}>{entry.name}</Link></td>
                          <td className="px-4 py-3 text-muted-foreground">{entry.category ?? "Grupsuz"}</td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums">{entry.currentQuantity} {unitLabels[entry.baseUnit]}</td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums">{entry.reorderLevel} {unitLabels[entry.baseUnit]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="px-5 py-6 text-sm text-muted-foreground">Kritik seviyenin altına inen stok kalemi yok.</p>}
              {overview && overview.counts.criticalStock > overview.criticalStock.length ? <p className="border-t px-5 py-3 text-xs text-muted-foreground">{overview.counts.criticalStock} kalemin ilk {overview.criticalStock.length} tanesi gösteriliyor. <Link className="font-semibold text-olive underline-offset-4 hover:underline" href="/admin/inventory">Tümünü aç</Link></p> : null}
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card><CardHeader><CardTitle>Tedarikçi borcu</CardTitle><CardDescription>Açık ve kısmi ödenmiş operasyonel faturalar.</CardDescription></CardHeader><CardContent><Money amount={overview?.outstandingSupplierPayable ?? "0.00"} className="text-2xl font-bold" /><p className="mt-2 text-xs text-muted-foreground">{overview?.counts.openSupplierInvoices ?? 0} açık belge</p></CardContent></Card>
            <Card><CardHeader><CardTitle>Yaklaşan operasyon</CardTitle></CardHeader><CardContent className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl bg-muted/45 p-3"><strong className="block text-lg tabular-nums">{overview?.counts.upcomingReservations ?? 0}</strong><span className="text-muted-foreground">Yaklaşan rezervasyon</span></div>
              <div className="rounded-xl bg-muted/45 p-3"><strong className="block text-lg tabular-nums">{overview?.counts.openPurchaseOrders ?? 0}</strong><span className="text-muted-foreground">Açık satın alma</span></div>
              <div className="rounded-xl bg-muted/45 p-3"><strong className="block text-lg tabular-nums">{overview?.counts.activeRecipes ?? 0}</strong><span className="text-muted-foreground">Aktif reçete</span></div>
              <div className="rounded-xl bg-muted/45 p-3"><strong className="block text-lg tabular-nums">{overview?.counts.warehouses ?? 0}</strong><span className="text-muted-foreground">Aktif depo</span></div>
            </CardContent></Card>
          </div>
        </div>
      </Section>

      <Section title="Kurulum" hint="Depo ve stok kalemi tanımları yalnızca burada yapılır.">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card><CardHeader><CardTitle className="flex items-center gap-2"><Building2 className="size-5 text-olive" /> Depo oluştur</CardTitle><CardDescription>Stok hareketlerinin fiziksel konumunu tanımlar.</CardDescription></CardHeader><CardContent><form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void create({ command: "CREATE_WAREHOUSE", ...warehouse }, () => setWarehouse({ name: "", code: "" })); }}><div className="space-y-2"><Label htmlFor="warehouse-name">Depo adı</Label><Input id="warehouse-name" required minLength={2} value={warehouse.name} onChange={(event) => setWarehouse((value) => ({ ...value, name: event.target.value }))} placeholder="Ana Depo" /></div><div className="space-y-2"><Label htmlFor="warehouse-code">Kod</Label><Input id="warehouse-code" required value={warehouse.code} onChange={(event) => setWarehouse((value) => ({ ...value, code: event.target.value.toUpperCase() }))} placeholder="ANA_DEPO" /></div><Button disabled={saving} className="sm:col-span-2"><PackagePlus className="size-4" /> Depoyu kaydet</Button></form></CardContent></Card>
          <Card><CardHeader><CardTitle className="flex items-center gap-2"><Boxes className="size-5 text-olive" /> Stok kalemi oluştur</CardTitle><CardDescription>Miktar, stok hareketlerinden hesaplanır; doğrudan bakiye yazılmaz.</CardDescription></CardHeader><CardContent><form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void create({ command: "CREATE_INVENTORY_ITEM", ...item }, () => setItem({ name: "", category: "", baseUnit: "KG", reorderLevel: "0", negativeStockPolicy: "WARN" })); }}><div className="space-y-2"><Label htmlFor="item-name">Ad</Label><Input id="item-name" required minLength={2} value={item.name} onChange={(event) => setItem((value) => ({ ...value, name: event.target.value }))} placeholder="Dana Eti" /></div><div className="space-y-2"><Label htmlFor="item-category">Grup</Label><Input id="item-category" value={item.category} onChange={(event) => setItem((value) => ({ ...value, category: event.target.value }))} placeholder="Et Ürünleri" /></div><div className="space-y-2"><Label>Temel birim</Label><Select value={item.baseUnit} onValueChange={(baseUnit) => setItem((value) => ({ ...value, baseUnit: baseUnit ?? "KG" }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(unitLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label htmlFor="reorder-level">Kritik seviye</Label><Input id="reorder-level" inputMode="decimal" required value={item.reorderLevel} onChange={(event) => setItem((value) => ({ ...value, reorderLevel: event.target.value }))} /></div><Button disabled={saving} className="sm:col-span-2"><PackagePlus className="size-4" /> Stok kalemini kaydet</Button></form></CardContent></Card>
        </div>
      </Section>

      <p className="rounded-xl border bg-muted/35 px-4 py-3 text-xs leading-5 text-muted-foreground">Negatif stok varsayılanı operasyonel uyarıdır. Reçete hammaddeleri müşteri menüsündeki “İçindekiler” alanına otomatik yayınlanmaz. Bordro rakamları yalnızca yönetici girdisidir; SGK/vergi hesabı değildir.</p>
    </div>
  );
}
