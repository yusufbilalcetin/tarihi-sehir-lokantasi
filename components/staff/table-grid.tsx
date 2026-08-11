"use client";

import { useState } from "react";
import {
  BadgeCheck,
  BellRing,
  Clock3,
  Plus,
  ReceiptText,
  StickyNote,
  UsersRound,
  Utensils,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { TableCard } from "@/components/staff/table-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { orders } from "@/lib/mock-data/orders";
import { formatCurrency } from "@/lib/format";
import type { Order, RestaurantTable } from "@/types";

const tableActions = [
  { label: "Sipariş Ekle", icon: Plus, variant: "default" as const },
  { label: "Siparişi Onayla", icon: BadgeCheck, variant: "secondary" as const },
  { label: "Servis Edildi", icon: Utensils, variant: "outline" as const },
  { label: "Garson Talebi", icon: BellRing, variant: "outline" as const },
  { label: "Hesap", icon: ReceiptText, variant: "outline" as const },
  { label: "Masa Notu", icon: StickyNote, variant: "outline" as const },
] as const;

function TableOrderDetails({ order }: { order: Order }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between gap-3 bg-muted/55 px-4 py-3">
        <div>
          <p className="text-xs font-semibold text-muted-foreground">Aktif sipariş</p>
          <p className="mt-0.5 font-bold text-foreground">{order.orderNumber}</p>
        </div>
        <StatusBadge status={order.status} />
      </div>
      <div className="divide-y divide-border/70 px-4">
        {order.items.map((item) => (
          <div key={item.id} className="flex gap-3 py-3">
            <span className="min-w-8 font-bold tabular-nums text-burgundy">{item.quantity} ×</span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-foreground">{item.productName}</p>
              {item.note ? (
                <p className="mt-1 text-xs leading-5 text-muted-foreground">Not: {item.note}</p>
              ) : null}
            </div>
            <span className="shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">
              {formatCurrency(item.quantity * item.unitPrice)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TableGrid({
  tables,
  compact = false,
}: {
  tables: RestaurantTable[];
  compact?: boolean;
}) {
  const [selectedTable, setSelectedTable] = useState<RestaurantTable | null>(null);
  const selectedOrder = selectedTable
    ? orders.find((order) => order.tableId === selectedTable.id)
    : undefined;

  function runDemoAction(action: string) {
    if (!selectedTable) return;
    toast.success(`${selectedTable.name}: ${action} işlemi kaydedildi.`, {
      description: "Bu işlem demo amaçlı olarak yerel arayüzde tamamlandı.",
    });
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-6">
        {tables.map((table) => (
          <TableCard
            key={table.id}
            table={table}
            compact={compact}
            onSelect={setSelectedTable}
          />
        ))}
      </div>

      <Sheet open={Boolean(selectedTable)} onOpenChange={(open) => !open && setSelectedTable(null)}>
        <SheetContent
          side="right"
          showCloseButton={false}
          className="w-full max-w-full gap-0 data-[side=right]:sm:max-w-md"
        >
          {selectedTable ? (
            <>
              <Button
                type="button"
                variant="ghost"
                className="absolute right-2 top-2 z-10 size-11 p-0"
                onClick={() => setSelectedTable(null)}
                aria-label="Masa detayını kapat"
              >
                <X className="size-5" strokeWidth={1.8} />
              </Button>
              <SheetHeader className="border-b border-border bg-muted/35 px-5 py-5 pr-14">
                <div className="flex items-center gap-2.5">
                  <SheetTitle className="text-2xl font-semibold tracking-tight">
                    {selectedTable.name}
                  </SheetTitle>
                  <StatusBadge status={selectedTable.status} />
                </div>
                <SheetDescription className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="flex items-center gap-1.5">
                    <UsersRound className="size-4" strokeWidth={1.8} />
                    {selectedTable.seats} kişilik
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Clock3 className="size-4" strokeWidth={1.8} />
                    {selectedTable.activeMinutes
                      ? `${selectedTable.activeMinutes} dakikadır açık`
                      : "Şu an boş"}
                  </span>
                </SheetDescription>
              </SheetHeader>

              <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
                {selectedOrder ? (
                  <TableOrderDetails order={selectedOrder} />
                ) : (
                  <div className="rounded-xl border border-dashed border-border bg-muted/25 p-6 text-center">
                    <Utensils className="mx-auto size-6 text-muted-foreground" strokeWidth={1.6} />
                    <p className="mt-3 font-semibold text-foreground">Aktif sipariş yok</p>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      Bu masa için yeni sipariş ekleyebilirsiniz.
                    </p>
                  </div>
                )}

                <div className="rounded-xl bg-olive p-4 text-card shadow-[0_12px_30px_rgb(48_56_45/0.16)]">
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold text-cream/65">Masa toplamı</p>
                      <p className="mt-1 font-heading text-3xl font-semibold tabular-nums">
                        {formatCurrency(selectedTable.total ?? selectedOrder?.total ?? 0)}
                      </p>
                    </div>
                    <p className="text-right text-xs leading-5 text-cream/60">
                      Son hareket<br />{selectedTable.lastActivity}
                    </p>
                  </div>
                </div>

                <Separator />

                <div>
                  <h3 className="font-heading text-lg font-semibold">Masa işlemleri</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Servis sırasında en sık kullanılan işlemler.
                  </p>
                  <div className="mt-4 grid grid-cols-2 gap-2.5">
                    {tableActions.map((action) => {
                      const Icon = action.icon;
                      return (
                        <Button
                          key={action.label}
                          type="button"
                          variant={action.variant}
                          className="min-h-12 justify-start px-3 text-left"
                          onClick={() => runDemoAction(action.label)}
                        >
                          <Icon className="size-4" strokeWidth={1.8} />
                          {action.label}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <SheetFooter className="border-t border-border bg-card px-5 py-4">
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 w-full"
                  onClick={() => setSelectedTable(null)}
                >
                  Detayı Kapat
                </Button>
              </SheetFooter>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}
