"use client";

import { useState } from "react";
import { Link2, Printer, QrCode, RefreshCw, ShieldOff } from "lucide-react";
import { AdminPageHeader, SummaryChip } from "@/components/admin/admin-ui";
import { useAdminTables } from "@/components/admin/use-admin-tables";
import { RealtimeStatus } from "@/components/staff/realtime-status";
import { Button } from "@/components/ui/button";
import { adminApi } from "@/lib/api/endpoints";

function QrPlaceholder({ tableName }: { tableName: string }) {
  return (
    <div className="relative mx-auto grid aspect-square w-full max-w-48 place-items-center overflow-hidden rounded-xl border-8 border-card bg-[#fffdf8] ring-1 ring-border">
      <div
        className="absolute inset-3 opacity-[0.09]"
        style={{ backgroundImage: "repeating-conic-gradient(#25211D 0 25%, transparent 0 50%)", backgroundSize: "12px 12px" }}
        aria-hidden
      />
      <div className="relative grid size-20 place-items-center rounded-xl border-4 border-foreground bg-card text-foreground shadow-sm">
        <QrCode className="size-14" strokeWidth={1.8} />
      </div>
      <span className="sr-only">{tableName} QR kod alanı</span>
    </div>
  );
}

export function QrManager() {
  const admin = useAdminTables();
  const [issued, setIssued] = useState<Record<string, string>>({});

  function printCodes() {
    window.setTimeout(() => window.print(), 250);
  }

  function rotate(tableId: string, tableName: string) {
    void admin
      .run(() => adminApi.rotateTableToken(tableId), `${tableName} QR bağlantısı yenilendi.`)
      .then((result) => {
        if (result) setIssued((current) => ({ ...current, [tableId]: result.rawToken }));
      });
  }

  function revoke(tableId: string, tableName: string) {
    void admin
      .run(() => adminApi.revokeTableToken(tableId), `${tableName} QR bağlantısı iptal edildi.`)
      .then((result) => {
        if (!result) return;
        setIssued((current) => {
          const next = { ...current };
          delete next[tableId];
          return next;
        });
      });
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="QR Kodlar"
        description="Her masanın menü bağlantısını yönetin. Bağlantı yalnızca yenileme anında bir kez gösterilir."
        actions={<Button variant="outline" className="h-10 bg-card" onClick={printCodes}><Printer /> Tümünü Yazdır</Button>}
      />

      <div className="flex flex-wrap gap-2">
        <SummaryChip label="Toplam masa" value={admin.tables.length} />
        <SummaryChip label="QR aktif" value={admin.tables.filter((table) => !table.qrRevoked && table.isActive).length} />
        <SummaryChip label="Yenilenmeli" value={admin.tables.filter((table) => table.qrRevoked).length} />
        <RealtimeStatus status={admin.realtimeStatus} />
      </div>

      <div className="rounded-xl border border-copper/35 bg-copper/8 p-4 sm:flex sm:items-start sm:gap-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-card text-burgundy"><Link2 className="size-5" /></div>
        <div className="mt-3 sm:mt-0">
          <p className="text-sm font-extrabold">Ham QR adresi veritabanında tutulmaz</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Bir masanın bağlantısını sonradan görüntüleyemezsiniz. Bağlantı kaybolduysa
            <strong className="mx-1">QR Yenile</strong>
            ile yeni bir adres üretin; eski QR anında geçersiz olur.
          </p>
        </div>
      </div>

      {admin.error && !admin.tables.length ? (
        <div className="grid min-h-48 place-items-center rounded-xl border bg-card p-8 text-center">
          <div>
            <QrCode className="mx-auto size-9 text-muted-foreground" />
            <p className="mt-3 font-bold">Masalar yüklenemedi</p>
            <p className="mt-1 text-sm text-muted-foreground">{admin.error.message}</p>
          </div>
        </div>
      ) : (
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4" aria-label="Masa QR kodları">
          {admin.tables.map((table) => {
            const rawToken = issued[table.id];
            const active = table.isActive && !table.qrRevoked;

            return (
              <article key={table.id} className="rounded-lg border bg-card p-4 shadow-[var(--shadow-raised)] sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-heading text-xl font-semibold">{table.name}</h2>
                    <p className="mt-1 text-xs text-muted-foreground">Sürüm v{table.qrTokenVersion}</p>
                  </div>
                  <span className={active
                    ? "rounded-lg bg-status-success-tint px-2 py-1 text-xs font-extrabold text-status-success"
                    : "rounded-lg bg-status-danger-tint px-2 py-1 text-xs font-extrabold text-status-danger"}
                  >
                    {active ? "AKTİF" : "YENİLENMELİ"}
                  </span>
                </div>

                <div className="my-5 rounded-xl bg-background p-4"><QrPlaceholder tableName={table.name} /></div>

                {rawToken ? (
                  <div className="mb-3 rounded-xl border border-copper/40 bg-copper/8 p-3" role="status">
                    <p className="text-xs font-extrabold">Yeni bağlantı (yalnızca bir kez)</p>
                    <code className="mt-1 block overflow-x-auto text-xs">/menu/{rawToken}</code>
                  </div>
                ) : null}

                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" disabled={admin.saving} onClick={() => rotate(table.id, table.name)}>
                    <RefreshCw /> QR Yenile
                  </Button>
                  <Button
                    variant="outline"
                    disabled={admin.saving || table.qrRevoked}
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => revoke(table.id, table.name)}
                  >
                    <ShieldOff /> İptal Et
                  </Button>
                </div>
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}
