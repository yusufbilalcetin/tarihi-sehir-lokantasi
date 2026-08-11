"use client";

import { Download, Link2, Printer, QrCode, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { AdminPageHeader, SummaryChip } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { restaurantTables } from "@/lib/mock-data";

function QrPlaceholder({ tableName }: { tableName: string }) {
  return (
    <div className="relative mx-auto grid aspect-square w-full max-w-48 place-items-center overflow-hidden rounded-2xl border-8 border-card bg-[#fffdf8] ring-1 ring-border">
      <div
        className="absolute inset-3 opacity-[0.09]"
        style={{ backgroundImage: "repeating-conic-gradient(#25211D 0 25%, transparent 0 50%)", backgroundSize: "12px 12px" }}
        aria-hidden
      />
      <div className="relative grid size-20 place-items-center rounded-xl border-4 border-foreground bg-card text-foreground shadow-sm">
        <QrCode className="size-14" strokeWidth={1.8} />
      </div>
      <span className="sr-only">{tableName} için demo QR kod görseli</span>
    </div>
  );
}

function downloadDemo(tableName: string) {
  toast.success(`${tableName} QR kodu demo indirme kuyruğuna eklendi.`);
}

export function QrManager() {
  function printCodes() {
    toast.success("Yazdırma görünümü hazırlanıyor.");
    window.setTimeout(() => window.print(), 250);
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="QR Kodlar"
        description="Her masa için menü bağlantısını kontrol edin, demo QR kartlarını indirin veya yazdırın."
        actions={
          <>
            <Button variant="outline" className="h-10 bg-card" onClick={printCodes}><Printer /> Tümünü Yazdır</Button>
            <Button className="h-10" onClick={() => toast.success("12 QR kodu demo paketi için hazırlandı.")}><Download /> Tümünü İndir</Button>
          </>
        }
      />

      <div className="flex flex-wrap gap-2">
        <SummaryChip label="Toplam masa" value={restaurantTables.length} />
        <SummaryChip label="QR hazır" value={restaurantTables.filter((table) => table.qrAvailable).length} />
        <SummaryChip label="Bağlantı" value="/menu/[masa]" />
      </div>

      <div className="rounded-2xl border border-copper/35 bg-copper/8 p-4 sm:flex sm:items-center sm:justify-between sm:gap-5">
        <div className="flex gap-3"><div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-card text-burgundy"><Link2 className="size-5" /></div><div><p className="text-sm font-extrabold">QR hedefi aktif</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Demo bağlantıları müşteriyi doğrudan ilgili masa menüsüne yönlendirir.</p></div></div>
        <Button variant="outline" className="mt-3 w-full bg-card sm:mt-0 sm:w-auto" onClick={() => toast.success("Tüm QR hedefleri kontrol edildi.")}><RefreshCw /> Bağlantıları Kontrol Et</Button>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4" aria-label="Masa QR kodları">
        {restaurantTables.map((table) => (
          <article key={table.id} className="rounded-2xl border bg-card p-4 shadow-[0_12px_35px_rgba(74,40,40,0.05)] sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div><h2 className="font-heading text-xl font-semibold">{table.name}</h2><p className="mt-1 text-xs text-muted-foreground">/menu/table-{table.id}</p></div>
              <span className="rounded-lg bg-emerald-50 px-2 py-1 text-[10px] font-extrabold text-emerald-800">HAZIR</span>
            </div>
            <div className="my-5 rounded-2xl bg-background p-4"><QrPlaceholder tableName={table.name} /></div>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => downloadDemo(table.name)}><Download /> İndir</Button>
              <Button variant="outline" onClick={printCodes}><Printer /> Yazdır</Button>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}

