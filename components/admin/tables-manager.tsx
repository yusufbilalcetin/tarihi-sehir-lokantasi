"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Armchair, Clock3, Plus, QrCode, Search, UsersRound } from "lucide-react";
import { toast } from "sonner";
import { AdminPageHeader, DataToolbar, Field, NativeSelect, SummaryChip } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { WindowDialogContent } from "@/components/ui/window-dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { StatusBadge } from "@/components/shared/status-badge";
import { RealtimeStatus } from "@/components/staff/realtime-status";
import { useAdminTables } from "@/components/admin/use-admin-tables";
import { adminApi } from "@/lib/api/endpoints";
import { formatCurrency } from "@/lib/format";
import type { TableStatus } from "@/types";

const tableStatuses: Array<{ value: TableStatus; label: string }> = [
  { value: "available", label: "Boş" },
  { value: "occupied", label: "Dolu" },
  { value: "ordering", label: "Sipariş bekliyor" },
  { value: "waiting", label: "Onay bekliyor" },
  { value: "dining", label: "Serviste" },
  { value: "waiter-call", label: "Garson çağrısı" },
  { value: "bill-requested", label: "Hesap istiyor" },
  { value: "cleaning", label: "Temizleniyor" },
  { value: "inactive", label: "Pasif" },
];

export function TablesManager() {
  const admin = useAdminTables();
  const tables = admin.tableViews;
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | TableStatus>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [seats, setSeats] = useState("4");
  const [issuedToken, setIssuedToken] = useState<{ tableName: string; rawToken: string } | null>(null);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("tr-TR");
    return tables.filter((table) => (!normalized || table.name.toLocaleLowerCase("tr-TR").includes(normalized)) && (status === "all" || table.status === status));
  }, [tables, query, status]);

  const nextTableNumber = useMemo(
    () => admin.tables.reduce((highest, table) => Math.max(highest, table.number), 0) + 1,
    [admin.tables],
  );

  function openNew() {
    setName(`Masa ${nextTableNumber}`);
    setSeats("4");
    setDialogOpen(true);
  }

  function addTable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || Number(seats) < 1) {
      toast.error("Masa adı ve sandalye sayısını kontrol edin.");
      return;
    }
    void admin
      .run(
        () => adminApi.createTable({
          name: name.trim(),
          tableNumber: nextTableNumber,
          seats: Number(seats),
        }),
        "Yeni masa salon planına eklendi.",
      )
      .then((result) => {
        if (!result) return;
        setDialogOpen(false);
        setIssuedToken({ tableName: result.table.name, rawToken: result.rawToken });
      });
  }

  function toggleActive(id: string, isActive: boolean) {
    void admin.run(
      () => adminApi.updateTable(id, { isActive }),
      isActive ? "Masa servise açıldı." : "Masa servis dışı bırakıldı.",
    );
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Masalar"
        description="Salon planını, masa kapasitesini ve anlık operasyon durumlarını yönetin."
        actions={<Button className="h-10" onClick={openNew}><Plus /> Yeni Masa</Button>}
      />

      <div className="flex flex-wrap gap-2">
        <SummaryChip label="Toplam" value={tables.length} />
        <SummaryChip label="Boş" value={tables.filter((table) => table.status === "available").length} />
        <SummaryChip label="Aktif" value={tables.filter((table) => table.status !== "available").length} />
        <SummaryChip label="Hizmet bekleyen" value={tables.filter((table) => ["waiter-call", "bill-requested"].includes(table.status)).length} />
        <RealtimeStatus status={admin.realtimeStatus} />
      </div>

      {issuedToken ? (
        <div className="rounded-xl border border-copper/40 bg-copper/8 p-4" role="status">
          <p className="text-sm font-extrabold">{issuedToken.tableName} QR bağlantısı oluşturuldu</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Bu adres yalnızca bir kez gösterilir ve veritabanında saklanmaz. Kaydetmezseniz masa için QR Yenile işlemi yapmanız gerekir.
          </p>
          <code className="mt-2 block overflow-x-auto rounded-lg bg-card px-3 py-2 text-xs">/menu/{issuedToken.rawToken}</code>
          <Button variant="outline" className="mt-3 bg-card" onClick={() => setIssuedToken(null)}>Kapat</Button>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-lg border bg-card shadow-[var(--shadow-raised)]">
        <DataToolbar>
          <div className="relative min-w-0 flex-1 sm:min-w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} className="h-10 bg-background pl-9" placeholder="Masa ara" aria-label="Masa ara" />
          </div>
          <NativeSelect value={status} onChange={(event) => setStatus(event.target.value as "all" | TableStatus)} className="sm:w-52" aria-label="Masa durumu filtresi">
            <option value="all">Tüm durumlar</option>
            {tableStatuses.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </NativeSelect>
        </DataToolbar>

        {admin.error && !tables.length ? (
          <div className="grid min-h-64 place-items-center p-8 text-center"><div><Armchair className="mx-auto size-9 text-muted-foreground" /><p className="mt-3 font-bold">Masalar yüklenemedi</p><p className="mt-1 text-sm text-muted-foreground">{admin.error.message}</p></div></div>
        ) : filtered.length ? (
          <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {filtered.map((table) => (
              <article key={table.id} className="rounded-xl border bg-background p-4 transition-colors hover:border-copper/55">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex size-11 items-center justify-center rounded-xl bg-olive/8 text-olive"><Armchair className="size-5" strokeWidth={1.8} /></div>
                  <StatusBadge status={table.status} />
                </div>
                <div className="mt-4 flex items-end justify-between gap-3">
                  <div><h2 className="font-heading text-xl font-semibold">{table.name}</h2><p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><UsersRound className="size-3" /> {table.seats} kişilik</p></div>
                  {table.total ? <strong className="text-sm tabular-nums">{formatCurrency(table.total)}</strong> : null}
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg bg-muted/45 px-2.5 py-2"><span className="block text-muted-foreground">Son aktivite</span><strong className="mt-1 flex items-center gap-1"><Clock3 className="size-3" /> {table.lastActivity}</strong></div>
                  <div className="rounded-lg bg-muted/45 px-2.5 py-2"><span className="block text-muted-foreground">QR kod</span><strong className="mt-1 flex items-center gap-1"><QrCode className="size-3" /> {table.qrAvailable ? "Hazır" : "Eksik"}</strong></div>
                </div>
                <label className="mt-3 flex min-h-12 items-center justify-between gap-3 border-t pt-3 text-xs font-bold">
                  <span>Servise açık</span>
                  <Switch
                    checked={table.status !== "inactive"}
                    disabled={admin.saving}
                    onCheckedChange={(checked) => toggleActive(table.id, checked)}
                    aria-label={`${table.name} servis durumu`}
                  />
                </label>
              </article>
            ))}
          </div>
        ) : (
          <div className="grid min-h-64 place-items-center p-8 text-center"><div><Armchair className="mx-auto size-9 text-muted-foreground" /><p className="mt-3 font-bold">Masa bulunamadı</p><p className="mt-1 text-sm text-muted-foreground">Arama veya durum filtresini değiştirin.</p></div></div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <WindowDialogContent
          size="sm"
          title="Yeni masa oluştur"
          description="Salona eklenecek masanın adı, kapasitesi ve QR durumunu belirleyin."
          render={<form onSubmit={addTable} />}
          footer={
            <>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Vazgeç</Button>
              <Button type="submit" disabled={admin.saving} aria-busy={admin.saving}>Masayı Ekle</Button>
            </>
          }
        >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Masa adı"><Input value={name} onChange={(event) => setName(event.target.value)} className="h-10" /></Field>
              <Field label="Sandalye"><Input type="number" min="1" max="20" value={seats} onChange={(event) => setSeats(event.target.value)} className="h-10" /></Field>
              <p className="rounded-xl border border-dashed bg-background px-3 py-3 text-xs leading-5 text-muted-foreground sm:col-span-2">Masa oluşturulduğunda QR bağlantısı bir kez gösterilir. Bağlantıyı kaybederseniz QR Kodlar ekranından yenileyin.</p>
            </div>
        </WindowDialogContent>
      </Dialog>
    </div>
  );
}

