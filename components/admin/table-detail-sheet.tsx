"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import {
  ArrowRight,
  Clock3,
  Pencil,
  QrCode,
  ReceiptText,
  Settings2,
  UsersRound,
} from "lucide-react";
import { toast } from "sonner";

import { Field } from "@/components/admin/admin-ui";
import { QrAccessToggle } from "@/components/admin/qr-access-toggle";
import { TableQrDialog } from "@/components/admin/table-qr-dialog";
import { useIsDesktop } from "@/components/shared/use-is-desktop";
import { StatusBadge } from "@/components/shared/status-badge";
import { TableOperationsPanel } from "@/components/staff/table-operations-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { adminApi, type TableQrCodeRow } from "@/lib/api/endpoints";
import { formatCurrency } from "@/lib/format";
import type { StaffTableResult } from "@/lib/services/staff-table-service";
import type { RestaurantTable } from "@/types";

const ORDER_LABELS: Readonly<Record<string, string>> = {
  NEW: "Yeni sipariş",
  CONFIRMED: "Onaylandı",
  PREPARING: "Hazırlanıyor",
  READY: "Servise hazır",
  SERVED: "Servis edildi",
};

function relativeFromIso(iso: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return "az önce";
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60_000));
  if (minutes < 1) return "az önce";
  if (minutes < 60) return `${minutes} dk önce`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} sa önce` : `${Math.floor(hours / 24)} gün önce`;
}

export function TableDetailSheet({
  open,
  onOpenChange,
  table,
  view,
  tables,
  qr,
  restaurantName,
  saving,
  onRun,
  onRefresh,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly table: StaffTableResult | null;
  readonly view: RestaurantTable | null;
  readonly tables: readonly RestaurantTable[];
  readonly qr: TableQrCodeRow | null;
  readonly restaurantName: string;
  readonly saving: boolean;
  readonly onRun: <T>(work: () => Promise<T>, message: string) => Promise<T | null>;
  readonly onRefresh: () => Promise<void> | void;
}) {
  const isDesktop = useIsDesktop();
  const [editing, setEditing] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [name, setName] = useState(() => table?.name ?? "");
  const [number, setNumber] = useState(() => table ? String(table.number) : "");
  const [seats, setSeats] = useState(() => table ? String(table.seats) : "");

  if (!table || !view) return null;

  const selectedTable = table;
  const activeOrder = table.activeOrder;
  const activeCalls = table.activeCalls ?? [];
  const qrReady = Boolean(qr && !qr.revoked);
  const billCall = activeCalls.find((call) => call.type === "BILL_REQUEST");
  const waiterCall = activeCalls.find((call) => call.type === "WAITER_CALL");

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const tableNumber = Number(number);
    const capacity = Number(seats);
    if (!name.trim() || !Number.isSafeInteger(tableNumber) || tableNumber < 1 || !Number.isSafeInteger(capacity) || capacity < 1 || capacity > 100) {
      toast.error("Masa adı, numarası ve kapasitesini kontrol edin.");
      return;
    }
    void onRun(
      () => adminApi.updateTable(selectedTable.id, { name: name.trim(), tableNumber, seats: capacity }),
      "Masa bilgileri güncellendi.",
    ).then((result) => result && setEditing(false));
  }

  function toggleService(checked: boolean) {
    if (!checked && activeOrder && !window.confirm(`${selectedTable.name} için servisi kapatmak istiyor musunuz? Aktif sipariş kayıtları silinmez.`)) return;
    void onRun(
      () => adminApi.updateTable(selectedTable.id, { isActive: checked }),
      checked ? "Masa servise açıldı." : "Masa servis dışı bırakıldı.",
    );
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side={isDesktop ? "right" : "bottom"}
          className="w-full gap-0 overflow-hidden p-0 data-[side=bottom]:max-h-[92dvh] data-[side=bottom]:rounded-t-2xl data-[side=right]:sm:max-w-[500px]"
        >
          <SheetHeader className="border-b px-5 py-5 pr-16">
            <div className="flex flex-wrap items-center gap-2">
              <SheetTitle className="text-2xl font-semibold">{table.name}</SheetTitle>
              <StatusBadge status={view.status} size="sm" />
            </div>
            <SheetDescription className="flex items-center gap-1.5">
              <UsersRound className="size-3.5" /> {table.seats} kişilik · Masa no {table.number}
            </SheetDescription>
          </SheetHeader>

          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
            <section className="grid grid-cols-2 gap-3" aria-label="Genel durum">
              <div className="rounded-xl border bg-muted/25 p-3">
                <p className="text-xs text-muted-foreground">Aktif hesap</p>
                <p className="mt-1 text-xl font-extrabold tabular-nums">
                  {activeOrder ? formatCurrency(Number(activeOrder.total)) : "—"}
                </p>
              </div>
              <div className="rounded-xl border bg-muted/25 p-3">
                <p className="text-xs text-muted-foreground">Son aktivite</p>
                <p className="mt-1 flex items-center gap-1.5 font-bold">
                  <Clock3 className="size-4" /> {view.lastActivity}
                </p>
              </div>
              <div className="rounded-xl border bg-muted/25 p-3">
                <p className="text-xs text-muted-foreground">QR menü</p>
                <p className="mt-1 font-bold">{qrReady ? "Aktif" : "Durduruldu"}</p>
              </div>
              <div className="rounded-xl border bg-muted/25 p-3">
                <p className="text-xs text-muted-foreground">Servis</p>
                <p className="mt-1 font-bold">{table.isActive ? "Açık" : "Kapalı"}</p>
              </div>
            </section>

            {billCall || waiterCall ? (
              <section className="space-y-2 rounded-xl border border-copper/30 bg-gold/8 p-4">
                <h3 className="font-heading text-lg font-semibold">Servis isteği</h3>
                {billCall ? <p className="text-sm"><strong>Hesap istendi</strong> · {relativeFromIso(billCall.createdAt)}</p> : null}
                {waiterCall ? <p className="text-sm"><strong>Garson çağrısı</strong> · {relativeFromIso(waiterCall.createdAt)}</p> : null}
                <p className="text-xs leading-5 text-muted-foreground">İstek otomatik kapatılmaz; servis ekibi mevcut çağrı akışından sonuçlandırır.</p>
              </section>
            ) : null}

            <section className="space-y-3 border-t pt-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-heading text-lg font-semibold">Aktif sipariş</h3>
                  {activeOrder ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {activeOrder.itemCount ?? activeOrder.items?.reduce((sum, item) => sum + item.quantity, 0) ?? 0} ürün · {ORDER_LABELS[activeOrder.status ?? ""] ?? "Açık"}
                    </p>
                  ) : null}
                </div>
                {activeOrder ? <strong className="tabular-nums">{formatCurrency(Number(activeOrder.total))}</strong> : null}
              </div>
              {activeOrder ? (
                <>
                  <ul className="space-y-2 rounded-xl bg-muted/30 p-3">
                    {(activeOrder.items ?? []).slice(0, 6).map((item) => (
                      <li key={item.id} className="flex justify-between gap-3 text-sm">
                        <span>{item.quantity}× {item.productName}</span>
                      </li>
                    ))}
                  </ul>
                  <Button render={<Link href="/admin/orders" />} nativeButton={false} variant="outline" className="min-h-11 w-full">
                    <ReceiptText /> Siparişleri Gör <ArrowRight className="ml-auto" />
                  </Button>
                </>
              ) : (
                <p className="rounded-xl bg-muted/30 px-4 py-5 text-sm text-muted-foreground">Bu masada aktif sipariş yok.</p>
              )}
            </section>

            <section className="space-y-3 border-t pt-5">
              <h3 className="font-heading text-lg font-semibold">Masa aksiyonları</h3>
              <label className="flex min-h-12 items-center justify-between gap-3 rounded-xl border px-3">
                <span className="font-semibold">Servis {table.isActive ? "açık" : "kapalı"}</span>
                <Switch checked={table.isActive} disabled={saving} onCheckedChange={toggleService} aria-label={`${table.name} servisini aç veya kapat`} />
              </label>
              <TableOperationsPanel table={view} tables={tables} onChanged={onRefresh} />
            </section>

            <section className="space-y-3 border-t pt-5">
              <div>
                <h3 className="font-heading text-lg font-semibold">QR menü</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">Durum: {qrReady ? "Aktif" : "Durduruldu"}</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Button render={<Link href="/admin/qr-codes" />} nativeButton={false} variant="outline" className="min-h-11"><Settings2 /> QR Kodunu Yönet</Button>
                <Button variant="outline" className="min-h-11" onClick={() => setQrOpen(true)}><QrCode /> {qrReady ? "QR Menüyü Gör" : "Durdurulan QR'ı Gör"}</Button>
                {qr ? (
                  <QrAccessToggle
                    tableId={table.id}
                    tableName={table.name}
                    paused={qr.revoked}
                    onChanged={onRefresh}
                    className="sm:col-span-2 sm:w-full"
                  />
                ) : null}
              </div>
            </section>

            <section className="space-y-3 border-t pt-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="font-heading text-lg font-semibold">Masa ayarları</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">Ad, numara ve kapasite.</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => setEditing((value) => !value)}><Pencil /> {editing ? "Kapat" : "Düzenle"}</Button>
              </div>
              {editing ? (
                <form className="grid gap-4 rounded-xl border bg-muted/20 p-4" onSubmit={save}>
                  <Field label="Masa adı"><Input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} /></Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Masa numarası"><Input type="number" min="1" max="100000" value={number} onChange={(event) => setNumber(event.target.value)} /></Field>
                    <Field label="Kapasite"><Input type="number" min="1" max="100" value={seats} onChange={(event) => setSeats(event.target.value)} /></Field>
                  </div>
                  <Button type="submit" disabled={saving} aria-busy={saving}>Değişiklikleri Kaydet</Button>
                </form>
              ) : null}
            </section>
          </div>
        </SheetContent>
      </Sheet>

      <TableQrDialog
        open={qrOpen}
        onOpenChange={setQrOpen}
        restaurantName={restaurantName}
        table={{ id: table.id, name: table.name }}
        qr={qr}
        onRotated={() => void onRefresh()}
      />
    </>
  );
}
