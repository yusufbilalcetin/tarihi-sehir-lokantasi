"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Armchair, Clock3, Plus, QrCode, Search, UsersRound } from "lucide-react";
import { toast } from "sonner";
import { AdminPageHeader, DataToolbar, Field, NativeSelect, SummaryChip } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { StatusBadge } from "@/components/shared/status-badge";
import { restaurantTables as initialTables } from "@/lib/mock-data";
import { formatCurrency } from "@/lib/format";
import type { RestaurantTable, TableStatus } from "@/types";

const tableStatuses: Array<{ value: TableStatus; label: string }> = [
  { value: "available", label: "Boş" },
  { value: "occupied", label: "Dolu" },
  { value: "ordering", label: "Sipariş bekliyor" },
  { value: "waiting", label: "Onay bekliyor" },
  { value: "dining", label: "Serviste" },
  { value: "waiter-call", label: "Garson çağrısı" },
  { value: "bill-requested", label: "Hesap istiyor" },
  { value: "cleaning", label: "Temizleniyor" },
];

export function TablesManager() {
  const [tables, setTables] = useState<RestaurantTable[]>(initialTables);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | TableStatus>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [seats, setSeats] = useState("4");
  const [qrAvailable, setQrAvailable] = useState(true);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("tr-TR");
    return tables.filter((table) => (!normalized || table.name.toLocaleLowerCase("tr-TR").includes(normalized)) && (status === "all" || table.status === status));
  }, [tables, query, status]);

  function openNew() {
    setName(`Masa ${tables.length + 1}`);
    setSeats("4");
    setQrAvailable(true);
    setDialogOpen(true);
  }

  function addTable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || Number(seats) < 1) {
      toast.error("Masa adı ve sandalye sayısını kontrol edin.");
      return;
    }
    setTables((current) => [...current, { id: `table-${Date.now()}`, name: name.trim(), seats: Number(seats), status: "available", qrAvailable, lastActivity: "Yeni oluşturuldu" }]);
    setDialogOpen(false);
    toast.success("Yeni masa salon planına eklendi.");
  }

  function updateStatus(id: string, next: TableStatus) {
    setTables((current) => current.map((table) => table.id === id ? { ...table, status: next, lastActivity: "Az önce" } : table));
    toast.success("Masa durumu güncellendi.");
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
      </div>

      <div className="overflow-hidden rounded-2xl border bg-card shadow-[0_14px_40px_rgba(74,40,40,0.055)]">
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

        {filtered.length ? (
          <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {filtered.map((table) => (
              <article key={table.id} className="rounded-2xl border bg-background p-4 transition-colors hover:border-copper/55">
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
                <label className="mt-3 block text-xs font-bold text-muted-foreground">
                  Durumu değiştir
                  <NativeSelect value={table.status} onChange={(event) => updateStatus(table.id, event.target.value as TableStatus)} className="mt-1.5 h-9 bg-card text-xs">
                    {tableStatuses.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </NativeSelect>
                </label>
              </article>
            ))}
          </div>
        ) : (
          <div className="grid min-h-64 place-items-center p-8 text-center"><div><Armchair className="mx-auto size-9 text-muted-foreground" /><p className="mt-3 font-bold">Masa bulunamadı</p><p className="mt-1 text-sm text-muted-foreground">Arama veya durum filtresini değiştirin.</p></div></div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={addTable}>
            <DialogHeader>
              <DialogTitle className="text-xl">Yeni masa oluştur</DialogTitle>
              <DialogDescription>Salona eklenecek masanın adı, kapasitesi ve QR durumunu belirleyin.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-5 sm:grid-cols-2">
              <Field label="Masa adı"><Input value={name} onChange={(event) => setName(event.target.value)} className="h-10" /></Field>
              <Field label="Sandalye"><Input type="number" min="1" max="20" value={seats} onChange={(event) => setSeats(event.target.value)} className="h-10" /></Field>
              <label className="flex min-h-14 items-center justify-between gap-4 rounded-xl border bg-background px-3 sm:col-span-2"><span><span className="block text-sm font-bold">QR kod hazırla</span><span className="text-xs text-muted-foreground">Masa oluşturulunca QR kaydı açılsın</span></span><Switch checked={qrAvailable} onCheckedChange={setQrAvailable} aria-label="QR kod hazırla" /></label>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Vazgeç</Button>
              <Button type="submit">Masayı Ekle</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

