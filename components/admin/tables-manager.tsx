"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Armchair, Clock3, Eye, Plus, QrCode, Search, UsersRound } from "lucide-react";
import { toast } from "sonner";

import { AdminPageHeader, DataToolbar, Field, NativeSelect, SummaryChip } from "@/components/admin/admin-ui";
import { TableDetailSheet } from "@/components/admin/table-detail-sheet";
import { TableQrDialog } from "@/components/admin/table-qr-dialog";
import { useAdminTables } from "@/components/admin/use-admin-tables";
import { useTableQrCodes } from "@/components/admin/use-table-qr-codes";
import { StatusBadge } from "@/components/shared/status-badge";
import { RealtimeStatus } from "@/components/staff/realtime-status";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { WindowDialogContent } from "@/components/ui/window-dialog";
import { adminApi } from "@/lib/api/endpoints";
import { matchesAdminTableFilter, summarizeAdminTables, type AdminTableFilter } from "@/lib/domain/admin-table-view";
import { formatCurrency } from "@/lib/format";
import type { RestaurantTable } from "@/types";

type QrFilter = "all" | "ready" | "stopped";

const statusFilters: readonly { value: AdminTableFilter; label: string }[] = [
  { value: "ALL", label: "Tüm masalar" },
  { value: "AVAILABLE", label: "Boş" },
  { value: "ACTIVE", label: "Aktif" },
  { value: "WAITING", label: "Sipariş bekliyor" },
  { value: "DINING", label: "Yemekte" },
  { value: "WAITER_CALL", label: "Garson çağrısı" },
  { value: "BILL_REQUESTED", label: "Hesap istedi" },
  { value: "CLEANING", label: "Temizleniyor" },
  { value: "INACTIVE", label: "Servis kapalı" },
];

export function TablesManager() {
  const admin = useAdminTables();
  const qrCodes = useTableQrCodes();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<AdminTableFilter>("ALL");
  const [qrFilter, setQrFilter] = useState<QrFilter>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  const [seats, setSeats] = useState("4");
  const [qrTableId, setQrTableId] = useState<string | null>(null);
  const [detailTableId, setDetailTableId] = useState<string | null>(null);

  const viewsById = useMemo(() => new Map(admin.tableViews.map((table) => [table.id, table])), [admin.tableViews]);
  const qrById = useMemo(() => new Map(qrCodes.codes.map((code) => [code.tableId, code])), [qrCodes.codes]);
  const summary = useMemo(() => summarizeAdminTables(admin.tables), [admin.tables]);
  const nextTableNumber = useMemo(() => admin.tables.reduce((highest, table) => Math.max(highest, table.number), 0) + 1, [admin.tables]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("tr-TR");
    return admin.tables.filter((table) => {
      const qr = qrById.get(table.id);
      const qrReady = Boolean(qr && !qr.revoked);
      const matchesQuery = !normalized || table.name.toLocaleLowerCase("tr-TR").includes(normalized) || String(table.number).includes(normalized);
      const matchesQr = qrFilter === "all" || (qrFilter === "ready" ? qrReady : !qrReady);
      return matchesQuery && matchesAdminTableFilter(table, status) && matchesQr;
    });
  }, [admin.tables, qrById, qrFilter, query, status]);

  const qrTable = qrTableId ? admin.tables.find((table) => table.id === qrTableId) ?? null : null;
  const detailTable = detailTableId ? admin.tables.find((table) => table.id === detailTableId) ?? null : null;
  const detailView = detailTableId ? viewsById.get(detailTableId) ?? null : null;

  function openNew() {
    setName(`Masa ${nextTableNumber}`);
    setNumber(String(nextTableNumber));
    setSeats("4");
    setDialogOpen(true);
  }

  function addTable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const tableNumber = Number(number);
    const capacity = Number(seats);
    if (!name.trim() || !Number.isSafeInteger(tableNumber) || tableNumber < 1 || !Number.isSafeInteger(capacity) || capacity < 1 || capacity > 100) {
      toast.error("Masa adı, numarası ve kapasitesini kontrol edin.");
      return;
    }
    void admin.run(() => adminApi.createTable({ name: name.trim(), tableNumber, seats: capacity }), "Yeni masa salon planına eklendi.").then((result) => {
      if (!result) return;
      setDialogOpen(false);
      void qrCodes.refetch().then(() => setQrTableId(result.table.id));
    });
  }

  function toggleActive(table: RestaurantTable, isActive: boolean) {
    if (!isActive && table.total && !window.confirm(`${table.name} için servisi kapatmak istiyor musunuz? Aktif sipariş kayıtları silinmez.`)) return;
    void admin.run(() => adminApi.updateTable(table.id, { isActive }), isActive ? "Masa servise açıldı." : "Masa servis dışı bırakıldı.");
  }

  function refreshAll() {
    return Promise.all([admin.refetch(), qrCodes.refetch()]).then(() => undefined);
  }

  return (
    <div className="space-y-5">
      <AdminPageHeader title="Masalar" description="Salondaki anlık durumu görün; aktif hesapları, servis isteklerini ve masa erişimini yönetin." actions={<Button className="h-10" onClick={openNew}><Plus /> Yeni Masa</Button>} />

      <div className="flex flex-wrap gap-2" aria-label="Masa özeti">
        <SummaryChip label="Toplam masa" value={summary.total} />
        <SummaryChip label="Boş" value={summary.available} />
        <SummaryChip label="Aktif" value={summary.active} />
        <SummaryChip label="Sipariş bekliyor" value={summary.waiting} />
        <SummaryChip label="Yemekte" value={summary.dining} />
        <SummaryChip label="Garson çağrısı" value={summary.waiterCalls} />
        <SummaryChip label="Hesap istedi" value={summary.billRequested} />
        {summary.cleaning ? <SummaryChip label="Temizleniyor" value={summary.cleaning} /> : null}
        <SummaryChip label="Servis kapalı" value={summary.inactive} />
        <RealtimeStatus status={admin.realtimeStatus} />
      </div>

      <section className="overflow-hidden rounded-lg border bg-card shadow-[var(--shadow-raised)]" aria-label="Masa planı">
        <DataToolbar>
          <div className="relative min-w-0 flex-1 sm:min-w-60">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} className="h-11 bg-background pl-9" placeholder="Masa ara" aria-label="Masa ara" />
          </div>
          <NativeSelect value={status} onChange={(event) => setStatus(event.target.value as AdminTableFilter)} className="h-11 sm:w-52" aria-label="Masa durumu filtresi">
            {statusFilters.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </NativeSelect>
          <NativeSelect value={qrFilter} onChange={(event) => setQrFilter(event.target.value as QrFilter)} className="h-11 sm:w-48" aria-label="QR durumu filtresi">
            <option value="all">Tüm QR kodları</option><option value="ready">QR hazır</option><option value="stopped">QR durdurulmuş</option>
          </NativeSelect>
        </DataToolbar>

        {admin.error && !admin.tables.length ? (
          <div className="grid min-h-64 place-items-center p-8 text-center"><div><Armchair className="mx-auto size-9 text-muted-foreground" /><p className="mt-3 font-bold">Masalar yüklenemedi.</p><p className="mt-1 text-sm text-muted-foreground">Bağlantıyı kontrol edip yeniden deneyin.</p><Button variant="outline" className="mt-4" onClick={() => void admin.refetch()}>Tekrar Dene</Button></div></div>
        ) : filtered.length ? (
          <div className="grid grid-cols-1 gap-3 p-3 sm:p-4 md:grid-cols-2 xl:grid-cols-4">
            {filtered.map((table) => {
              const view = viewsById.get(table.id);
              if (!view) return null;
              const qr = qrById.get(table.id);
              const qrReady = Boolean(qr && !qr.revoked);
              return (
                <article key={table.id} className="group rounded-xl border bg-background p-4 transition-[border-color,box-shadow] hover:border-copper/55 hover:shadow-[var(--shadow-raised)]">
                  <button type="button" className="block w-full rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setDetailTableId(table.id)} aria-label={`${table.name} detaylarını aç`}>
                    <div className="flex items-start justify-between gap-3"><div className="flex size-10 items-center justify-center rounded-xl bg-olive/8 text-olive"><Armchair className="size-5" strokeWidth={1.8} /></div><StatusBadge status={view.status} size="sm" /></div>
                    <div className="mt-3"><h2 className="font-heading text-xl font-semibold">{table.name}</h2><p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><UsersRound className="size-3" /> {table.seats} kişilik · No {table.number}</p></div>
                    <div className="mt-4 min-h-7">{view.total !== undefined ? <strong className="text-lg tabular-nums">{formatCurrency(view.total)}</strong> : <span className="text-sm text-muted-foreground">Aktif hesap yok</span>}{table.activeOrder?.itemCount ? <span className="ml-2 text-xs text-muted-foreground">{table.activeOrder.itemCount} ürün</span> : null}</div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-lg bg-muted/45 px-2.5 py-2"><span className="block text-muted-foreground">Son aktivite</span><strong className="mt-1 flex items-center gap-1"><Clock3 className="size-3" /> {view.lastActivity}</strong></div>
                      <div className="rounded-lg bg-muted/45 px-2.5 py-2"><span className="block text-muted-foreground">QR kod</span><strong className="mt-1 flex items-center gap-1"><QrCode className="size-3" /> {qrReady ? "Hazır" : "Durduruldu"}</strong></div>
                    </div>
                    <span className="mt-3 flex min-h-11 items-center justify-center gap-2 border-t pt-3 text-sm font-bold text-burgundy"><Eye className="size-4" /> Masa Detayını Gör</span>
                  </button>
                  <div className="mt-2 flex min-h-12 items-center justify-between gap-3 border-t pt-2 text-xs font-bold"><span>Servis {table.isActive ? "açık" : "kapalı"}</span><Switch checked={table.isActive} disabled={admin.saving} onCheckedChange={(checked) => toggleActive(view, checked)} aria-label={`${table.name} servisini aç veya kapat`} /></div>
                  <Button variant="outline" className="mt-2 min-h-11 w-full bg-card" onClick={() => setQrTableId(table.id)} aria-label={`${table.name} QR menüsünü aç`}><QrCode /> QR Menüyü Gör</Button>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="grid min-h-64 place-items-center p-8 text-center"><div><Armchair className="mx-auto size-9 text-muted-foreground" /><p className="mt-3 font-bold">Masa bulunamadı.</p><p className="mt-1 text-sm text-muted-foreground">Arama veya filtreleri değiştirin.</p></div></div>
        )}
      </section>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <WindowDialogContent size="sm" title="Yeni masa oluştur" description="Masa planına yeni bir servis noktası ekleyin." render={<form onSubmit={addTable} />} footer={<><Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Vazgeç</Button><Button type="submit" disabled={admin.saving} aria-busy={admin.saving}>Masayı Ekle</Button></>}>
          <div className="grid gap-4"><Field label="Masa numarası"><Input type="number" min="1" max="100000" value={number} onChange={(event) => setNumber(event.target.value)} /></Field><Field label="Masa adı"><Input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} /></Field><Field label="Kapasite"><Input type="number" min="1" max="100" value={seats} onChange={(event) => setSeats(event.target.value)} /></Field><p className="rounded-xl border border-dashed bg-background px-3 py-3 text-xs leading-5 text-muted-foreground">Masa servis açık olarak eklenir. Güvenli QR menüsü otomatik olarak QR Kodlar ekranında görünür.</p></div>
        </WindowDialogContent>
      </Dialog>

      <TableDetailSheet key={detailTableId ?? "closed"} open={Boolean(detailTableId)} onOpenChange={(open) => setDetailTableId(open ? detailTableId : null)} table={detailTable} view={detailView} tables={admin.tableViews} qr={detailTableId ? qrById.get(detailTableId) ?? null : null} restaurantName={qrCodes.restaurantName} saving={admin.saving} onRun={admin.run} onRefresh={refreshAll} />
      <TableQrDialog open={Boolean(qrTableId)} onOpenChange={(open) => setQrTableId(open ? qrTableId : null)} restaurantName={qrCodes.restaurantName} table={qrTable ? { id: qrTable.id, name: qrTable.name } : null} qr={qrTableId ? qrById.get(qrTableId) ?? null : null} onRotated={refreshAll} />
    </div>
  );
}
