"use client";

import { useMemo, useState } from "react";
import { CheckCheck, ChevronRight, Clock3, Eye, ListFilter, Search, UtensilsCrossed } from "lucide-react";
import { toast } from "sonner";
import { AdminPageHeader, AdminPanel, DataToolbar, NativeSelect, SummaryChip } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { StatusBadge } from "@/components/shared/status-badge";
import { orders as initialOrders } from "@/lib/mock-data";
import { formatCurrency } from "@/lib/format";
import type { Order, OrderStatus } from "@/types";

const statusOptions: Array<{ value: "all" | OrderStatus; label: string }> = [
  { value: "all", label: "Tüm durumlar" },
  { value: "pending", label: "Bekliyor" },
  { value: "confirmed", label: "Onaylandı" },
  { value: "preparing", label: "Hazırlanıyor" },
  { value: "ready", label: "Hazır" },
  { value: "served", label: "Servis edildi" },
  { value: "completed", label: "Tamamlandı" },
  { value: "cancelled", label: "İptal" },
];

export function OrdersManager() {
  const [orders, setOrders] = useState<Order[]>(initialOrders);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | OrderStatus>("all");
  const [selected, setSelected] = useState<Order | null>(null);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("tr-TR");
    return orders.filter((order) => {
      const matchesQuery =
        !normalized ||
        order.orderNumber.toLocaleLowerCase("tr-TR").includes(normalized) ||
        order.tableName.toLocaleLowerCase("tr-TR").includes(normalized) ||
        order.waiterName?.toLocaleLowerCase("tr-TR").includes(normalized);
      return matchesQuery && (status === "all" || order.status === status);
    });
  }, [orders, query, status]);

  function updateStatus(orderId: string, nextStatus: OrderStatus) {
    setOrders((current) => current.map((order) => (order.id === orderId ? { ...order, status: nextStatus } : order)));
    setSelected((current) => (current?.id === orderId ? { ...current, status: nextStatus } : current));
    toast.success("Sipariş durumu güncellendi.");
  }

  const openCount = orders.filter((order) => !["completed", "cancelled"].includes(order.status)).length;
  const waitingCount = orders.filter((order) => order.status === "pending").length;
  const total = orders.reduce((sum, order) => sum + order.total, 0);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Siparişler"
        description="Açık ve tamamlanan siparişleri görüntüleyin, durumları demo akışı içinde yönetin."
        actions={<Button className="h-10" onClick={() => toast.success("Yeni sipariş ekranı demo modunda açıldı.")}><UtensilsCrossed /> Sipariş Oluştur</Button>}
      />

      <div className="flex flex-wrap gap-2">
        <SummaryChip label="Açık" value={openCount} />
        <SummaryChip label="Onay bekleyen" value={waitingCount} />
        <SummaryChip label="Listelenen ciro" value={formatCurrency(total)} />
      </div>

      <AdminPanel className="overflow-hidden" contentClassName="p-0 sm:p-0">
        <DataToolbar>
          <div className="relative min-w-0 flex-1 sm:min-w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-10 bg-background pl-9"
              placeholder="Sipariş no, masa veya garson ara"
              aria-label="Sipariş ara"
            />
          </div>
          <div className="relative sm:w-52">
            <ListFilter className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
            <NativeSelect value={status} onChange={(event) => setStatus(event.target.value as "all" | OrderStatus)} className="pl-9">
              {statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </NativeSelect>
          </div>
        </DataToolbar>

        {filtered.length ? (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead className="border-b bg-muted/25 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3 font-semibold">Sipariş</th>
                    <th className="px-3 py-3 font-semibold">Masa</th>
                    <th className="px-3 py-3 font-semibold">Saat</th>
                    <th className="px-3 py-3 font-semibold">Ürün</th>
                    <th className="px-3 py-3 font-semibold">Durum</th>
                    <th className="px-3 py-3 font-semibold">Garson</th>
                    <th className="px-3 py-3 text-right font-semibold">Toplam</th>
                    <th className="px-5 py-3"><span className="sr-only">İşlem</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filtered.map((order) => (
                    <tr key={order.id} className="transition-colors hover:bg-muted/25">
                      <td className="px-5 py-4 font-extrabold">{order.orderNumber}</td>
                      <td className="px-3 py-4 font-semibold">{order.tableName}</td>
                      <td className="px-3 py-4 text-muted-foreground">{order.createdAt}</td>
                      <td className="px-3 py-4 text-muted-foreground">{order.items.reduce((sum, item) => sum + item.quantity, 0)} kalem</td>
                      <td className="px-3 py-4"><StatusBadge status={order.status} /></td>
                      <td className="px-3 py-4 text-muted-foreground">{order.waiterName ?? "Atanmadı"}</td>
                      <td className="px-3 py-4 text-right font-extrabold tabular-nums">{formatCurrency(order.total)}</td>
                      <td className="px-5 py-4 text-right">
                        <Button variant="ghost" size="icon-sm" aria-label={`${order.orderNumber} detayını aç`} onClick={() => setSelected(order)}>
                          <ChevronRight className="size-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="divide-y md:hidden">
              {filtered.map((order) => (
                <button key={order.id} type="button" onClick={() => setSelected(order)} className="w-full p-4 text-left transition-colors hover:bg-muted/25">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-extrabold">{order.orderNumber} <span className="font-semibold text-muted-foreground">{order.tableName}</span></p>
                      <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><Clock3 className="size-3" /> {order.createdAt}, {order.elapsedMinutes} dk önce</p>
                    </div>
                    <strong className="tabular-nums">{formatCurrency(order.total)}</strong>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <StatusBadge status={order.status} />
                    <span className="text-xs text-muted-foreground">{order.items.length} farklı ürün</span>
                  </div>
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="grid min-h-64 place-items-center p-8 text-center">
            <div>
              <Eye className="mx-auto size-8 text-muted-foreground" />
              <p className="mt-3 font-bold">Eşleşen sipariş bulunamadı</p>
              <p className="mt-1 text-sm text-muted-foreground">Arama metnini veya durum filtresini değiştirin.</p>
            </div>
          </div>
        )}
      </AdminPanel>

      <Sheet open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          {selected ? (
            <>
              <SheetHeader className="border-b px-5 py-5 pr-12">
                <div className="flex items-center gap-3">
                  <SheetTitle className="text-xl">{selected.orderNumber}</SheetTitle>
                  <StatusBadge status={selected.status} />
                </div>
                <SheetDescription>{selected.tableName}, {selected.createdAt} saatinde oluşturuldu.</SheetDescription>
              </SheetHeader>
              <div className="space-y-5 px-5">
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-xl border bg-muted/25 p-3"><p className="text-[11px] text-muted-foreground">Süre</p><p className="mt-1 font-extrabold">{selected.elapsedMinutes} dk</p></div>
                  <div className="rounded-xl border bg-muted/25 p-3"><p className="text-[11px] text-muted-foreground">Garson</p><p className="mt-1 truncate font-extrabold">{selected.waiterName ?? "Atanmadı"}</p></div>
                  <div className="rounded-xl border bg-muted/25 p-3"><p className="text-[11px] text-muted-foreground">Toplam</p><p className="mt-1 font-extrabold">{formatCurrency(selected.total)}</p></div>
                </div>

                <div>
                  <h3 className="text-sm font-extrabold">Sipariş kalemleri</h3>
                  <div className="mt-3 rounded-xl border">
                    {selected.items.map((item, index) => (
                      <div key={item.id} className={`flex gap-3 p-3 ${index ? "border-t" : ""}`}>
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-extrabold">{item.quantity}x</span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-bold">{item.productName}</p>
                          {item.note ? <p className="mt-1 text-xs leading-5 text-burgundy">Not: {item.note}</p> : null}
                        </div>
                        <p className="text-sm font-bold tabular-nums">{formatCurrency(item.quantity * item.unitPrice)}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {selected.note ? (
                  <div className="rounded-xl border border-copper/30 bg-copper/8 p-3 text-sm leading-6">
                    <strong>Masa notu:</strong> {selected.note}
                  </div>
                ) : null}
              </div>
              <SheetFooter className="sticky bottom-0 border-t bg-card">
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" onClick={() => updateStatus(selected.id, "preparing")}>Hazırlanıyor</Button>
                  <Button onClick={() => updateStatus(selected.id, "completed")}><CheckCheck /> Tamamlandı</Button>
                </div>
              </SheetFooter>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

