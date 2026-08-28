"use client";

import { useCallback, useMemo, useState } from "react";
import { Printer, QrCode, Search } from "lucide-react";

import { AdminPageHeader, NativeSelect, SummaryChip } from "@/components/admin/admin-ui";
import { QrAccessToggle } from "@/components/admin/qr-access-toggle";
import { QrPrintDesigner } from "@/components/admin/qr-print-designer";
import { TableQrDialog } from "@/components/admin/table-qr-dialog";
import { useAdminTables } from "@/components/admin/use-admin-tables";
import { useTableQrCodes } from "@/components/admin/use-table-qr-codes";
import { BrandedTableQr } from "@/components/shared/branded-table-qr";
import { RealtimeStatus } from "@/components/staff/realtime-status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function QrManager() {
  const admin = useAdminTables();
  const qrCodes = useTableQrCodes();
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "stopped">("all");
  const refetchTables = admin.refetch;
  const refetchQrCodes = qrCodes.refetch;

  const selected = selectedTableId
    ? admin.tables.find((table) => table.id === selectedTableId) ?? null
    : null;

  const refreshAll = useCallback(async () => {
    await Promise.all([refetchTables(), refetchQrCodes()]);
  }, [refetchQrCodes, refetchTables]);

  const printable = qrCodes.codes.filter((code) => code.isActive && !code.revoked);
  const activeQrCount = qrCodes.codes.filter((code) => !code.revoked).length;
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("tr-TR");
    return qrCodes.codes.filter((code) => {
      const active = !code.revoked;
      return (
        (!normalized || code.tableName.toLocaleLowerCase("tr-TR").includes(normalized) || String(code.tableNumber).includes(normalized))
        && (status === "all" || (status === "active" ? active : !active))
      );
    });
  }, [qrCodes.codes, query, status]);

  /**
   * The whole room in one run. It reprints the codes that already exist —
   * nothing here rotates — through the same designer, so every card in the
   * batch comes out at the size the administrator chose once.
   */
  const bulkCards = useMemo(
    () => printable.map((code) => ({ tableName: code.tableName, menuUrl: code.menuUrl })),
    [printable],
  );

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="QR Kodlar"
        description="Her masanın QR menüsünü görüntüleyin, indirin ve yazdırın."
        actions={
          <Button
            variant="outline"
            className="h-10 bg-card"
            disabled={printable.length === 0}
            onClick={() => setBulkOpen(true)}
          >
            <Printer /> Tüm Masa QR&apos;larını Yazdır
          </Button>
        }
      />

      <div className="flex flex-wrap gap-2">
        <SummaryChip label="Toplam masa" value={admin.tables.length} />
        <SummaryChip label="QR aktif" value={activeQrCount} />
        <SummaryChip
          label="Durdurulmuş"
          value={qrCodes.codes.filter((code) => code.revoked).length}
        />
        <RealtimeStatus status={admin.realtimeStatus} />
      </div>

      <div className="flex flex-col gap-3 rounded-lg border bg-card p-3 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="h-11 pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Masa ara" aria-label="QR kodlarında masa ara" />
        </div>
        <NativeSelect className="h-11 sm:w-48" value={status} onChange={(event) => setStatus(event.target.value as "all" | "active" | "stopped")} aria-label="QR kodu durum filtresi">
          <option value="all">Tümü</option>
          <option value="active">Aktif</option>
          <option value="stopped">Durdurulmuş</option>
        </NativeSelect>
      </div>

      {qrCodes.error && qrCodes.codes.length === 0 ? (
        <div className="grid min-h-48 place-items-center rounded-xl border bg-card p-8 text-center">
          <div>
            <QrCode className="mx-auto size-9 text-muted-foreground" />
            <p className="mt-3 font-bold">QR kodu şu anda görüntülenemiyor.</p>
            <Button variant="outline" className="mt-4" onClick={() => void qrCodes.refetch()}>
              Tekrar Dene
            </Button>
          </div>
        </div>
      ) : (
        <section
          className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
          aria-label="Masa QR kodları"
        >
          {filtered.map((code) => {
            const active = !code.revoked;
            return (
              <article
                key={code.tableId}
                className="rounded-lg border bg-card p-4 shadow-[var(--shadow-raised)] sm:p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-heading text-xl font-semibold">{code.tableName}</h2>
                    {!code.isActive ? <p className="mt-1 text-xs text-muted-foreground">Masa servisi kapalı</p> : null}
                  </div>
                  <span
                    className={
                      active
                        ? "rounded-lg bg-status-success-tint px-2 py-1 text-xs font-extrabold text-status-success"
                        : "rounded-lg bg-status-danger-tint px-2 py-1 text-xs font-extrabold text-status-danger"
                    }
                  >
                    {active ? "AKTİF" : "DURDURULDU"}
                  </span>
                </div>

                <div className="my-5 rounded-xl border border-gold/35 bg-[#FBF6EC] p-4">
                  <BrandedTableQr
                    menuUrl={code.menuUrl}
                    className="mx-auto max-w-44"
                    title={`${code.tableName} QR menü kodu`}
                  />
                </div>

                <div className="grid gap-2">
                  {active ? (
                    <Button disabled={!code.isActive} onClick={() => setSelectedTableId(code.tableId)}>
                      <QrCode /> {code.isActive ? "QR Menüyü Gör" : "Masa servisi kapalı"}
                    </Button>
                  ) : (
                    <QrAccessToggle
                      tableId={code.tableId}
                      tableName={code.tableName}
                      paused
                      onChanged={refreshAll}
                    />
                  )}
                  <Button variant="outline" className="min-h-11" onClick={() => setSelectedTableId(code.tableId)}>
                    <QrCode /> {active ? "İndir / Yazdır" : "Durdurulan QR'ı Gör"}
                  </Button>
                  {active ? (
                    <QrAccessToggle
                      tableId={code.tableId}
                      tableName={code.tableName}
                      paused={false}
                      onChanged={refreshAll}
                    />
                  ) : null}
                </div>
              </article>
            );
          })}
        </section>
      )}

      {!qrCodes.error && qrCodes.codes.length > 0 && filtered.length === 0 ? (
        <div className="grid min-h-40 place-items-center rounded-xl border bg-card p-8 text-center">
          <div><QrCode className="mx-auto size-8 text-muted-foreground" /><p className="mt-3 font-bold">Masa bulunamadı.</p><p className="mt-1 text-sm text-muted-foreground">Arama veya filtreyi değiştirin.</p></div>
        </div>
      ) : null}

      <TableQrDialog
        open={Boolean(selectedTableId)}
        onOpenChange={(open) => setSelectedTableId(open ? selectedTableId : null)}
        restaurantName={qrCodes.restaurantName}
        table={selected ? { id: selected.id, name: selected.name } : null}
        qr={selectedTableId ? qrCodes.byTableId(selectedTableId) : null}
        onRotated={refreshAll}
      />

      <QrPrintDesigner
        open={bulkOpen && bulkCards.length > 0}
        onOpenChange={setBulkOpen}
        cards={bulkCards}
        restaurantName={qrCodes.restaurantName}
      />
    </div>
  );
}
