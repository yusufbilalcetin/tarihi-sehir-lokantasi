"use client";

import { useCallback } from "react";
import { Info } from "lucide-react";

import { EmptyState } from "@/components/shared/data-states";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { adminApi } from "@/lib/api/endpoints";
import { orderStatusLabel, staffRoleLabel } from "@/lib/domain/display";
import { formatCurrency } from "@/lib/format";
import { useApiResource } from "@/lib/hooks/use-api-resource";

/** Drill-downs behind the report tables: one product, or one order's history. */

function hourWindow(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00 – ${String((hour + 1) % 24).padStart(2, "0")}:00`;
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

export function ProductDetailSheet({
  productId,
  rangeQuery,
  onClose,
}: {
  productId: string;
  /** The same period the table behind this sheet is showing. */
  rangeQuery: string;
  onClose: () => void;
}) {
  const detail = useApiResource(
    useCallback(
      (signal: AbortSignal) =>
        adminApi.reportProductDetail(
          `${rangeQuery}&productId=${encodeURIComponent(productId)}`,
          signal,
        ),
      [productId, rangeQuery],
    ),
  );
  const data = detail.data;

  return (
    <Sheet open onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader className="border-b px-5 py-5 pr-12 sm:px-6">
          <SheetTitle className="text-xl">{data?.productName ?? "Ürün detayı"}</SheetTitle>
          <SheetDescription>
            {data?.categoryName ?? "Kategori bilgisi yok"}
            {data?.removedFromCatalog ? " · menüden kaldırılmış" : ""}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-5 py-5 sm:px-6">
          {detail.error && !data ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/[0.04] p-4">
              <p className="text-sm font-semibold text-destructive">{detail.error.message}</p>
              <Button
                type="button"
                variant="outline"
                className="mt-2 min-h-11"
                onClick={() => void detail.refetch()}
              >
                Yeniden Dene
              </Button>
            </div>
          ) : !data ? (
            <p className="text-sm text-muted-foreground">Yükleniyor…</p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Fact label="Satılan Adet" value={data.soldQuantity.toLocaleString("tr-TR")} />
                <Fact label="Net Satış" value={formatCurrency(Number(data.netSales))} />
                <Fact
                  label="Ortalama Birim Fiyat"
                  value={formatCurrency(Number(data.averagePrice))}
                />
                <Fact label="Sipariş Sayısı" value={data.orderCount.toLocaleString("tr-TR")} />
                <Fact
                  label="İptal"
                  value={`${data.cancelledQuantity} · ${formatCurrency(Number(data.cancelledAmount))}`}
                />
                <Fact
                  label="Hesaptan Çıkarma"
                  value={`${data.voidedQuantity} · ${formatCurrency(Number(data.voidedAmount))}`}
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <Fact
                  label="En Yoğun Saat"
                  value={data.busiestHour ? hourWindow(data.busiestHour.hour) : "—"}
                />
                <Fact label="En Yoğun Gün" value={data.busiestWeekday?.label ?? "—"} />
                <Fact label="En Yoğun Tarih" value={data.busiestDate?.date ?? "—"} />
              </div>

              {data.daily.length === 0 ? (
                <EmptyState
                  icon={Info}
                  title="Bu dönemde satış kaydı yok"
                  description="Ürünün bu tarih aralığında hareketi bulunmuyor."
                />
              ) : (
                <div className="overflow-x-auto rounded-xl border border-border">
                  <table className="w-full min-w-[26rem] text-sm">
                    <thead className="bg-muted/50 text-left">
                      <tr>
                        <th className="px-3 py-2 font-semibold">Tarih</th>
                        <th className="px-3 py-2 text-right font-semibold">Adet</th>
                        <th className="px-3 py-2 text-right font-semibold">İptal</th>
                        <th className="px-3 py-2 text-right font-semibold">Void</th>
                        <th className="px-3 py-2 text-right font-semibold">Net</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.daily.map((row) => (
                        <tr key={row.date} className="border-t border-border">
                          <td className="px-3 py-2 tabular-nums">{row.date}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{row.quantity}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {row.cancelledQuantity}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {row.voidedQuantity}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold tabular-nums">
                            {formatCurrency(Number(row.netSales))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function OrderTimelineSheet({
  orderId,
  onClose,
}: {
  orderId: string;
  onClose: () => void;
}) {
  const timeline = useApiResource(
    useCallback(
      (signal: AbortSignal) => adminApi.reportOrderTimeline(orderId, signal),
      [orderId],
    ),
  );
  const data = timeline.data;

  return (
    <Sheet open onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader className="border-b px-5 py-5 pr-12 sm:px-6">
          <SheetTitle className="text-xl">
            {data ? `Sipariş ${data.order.orderNumber}` : "Sipariş geçmişi"}
          </SheetTitle>
          <SheetDescription>
            {data
              ? `${data.order.tableName} · ${orderStatusLabel(data.order.status)}`
              : "Yükleniyor…"}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-5 py-5 sm:px-6">
          {timeline.error && !data ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/[0.04] p-4">
              <p className="text-sm font-semibold text-destructive">{timeline.error.message}</p>
              <Button
                type="button"
                variant="outline"
                className="mt-2 min-h-11"
                onClick={() => void timeline.refetch()}
              >
                Yeniden Dene
              </Button>
            </div>
          ) : !data ? (
            <p className="text-sm text-muted-foreground">Yükleniyor…</p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Fact label="Sipariş Tutarı" value={formatCurrency(Number(data.order.total))} />
                <Fact
                  label="Net Tahsilat"
                  value={formatCurrency(Number(data.order.netCollected))}
                />
                <Fact label="İadeler" value={formatCurrency(Number(data.order.refunds))} />
                <Fact label="Kalan" value={formatCurrency(Number(data.order.outstanding))} />
              </div>

              {data.entries.length === 0 ? (
                <EmptyState
                  icon={Info}
                  title="Kayıt bulunamadı"
                  description="Bu sipariş için saklanmış bir hareket geçmişi yok."
                />
              ) : (
                <ol className="space-y-2">
                  {data.entries.map((entry) => (
                    <li
                      key={entry.id}
                      className="rounded-lg border border-border bg-card px-3 py-2.5"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="font-semibold">{entry.title}</p>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {new Date(entry.at).toLocaleString("tr-TR")}
                        </span>
                      </div>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {[
                          entry.actorName
                            ? `${entry.actorName}${entry.actorRole ? ` (${staffRoleLabel(entry.actorRole)})` : ""}`
                            : null,
                          entry.productName,
                          entry.amount ? formatCurrency(Number(entry.amount)) : null,
                          entry.reason,
                          entry.description,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
