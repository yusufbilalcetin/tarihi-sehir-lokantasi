"use client";

import { useCallback, useMemo, useState } from "react";
import { useStaffSession } from "@/components/staff/staff-session-provider";
import { Download, Printer, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { adminApi, cashRegisterApi } from "@/lib/api/endpoints";
import type { MethodBreakdownRow } from "@/lib/domain/cashier-report";
import { paymentMethodLabel } from "@/lib/domain/display";
import { useApiResource } from "@/lib/hooks/use-api-resource";
import { restaurantToday } from "@/lib/domain/report-range";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The restaurant's end-of-day cash picture.
 *
 * It reports *collection*, not sales: an order opened at lunch and paid at
 * dinner belongs to dinner. And it is an operational document, not a fiscal
 * one — the notice at the foot says so on screen and on paper.
 */

function money(value: string | null): string {
  return value === null ? "—" : formatCurrency(Number(value));
}

/** Shared with the manager's home so the two cannot name different days. */
/** Shared with the manager's home so the two cannot name different days. */
const localToday = (timeZone: string) => restaurantToday(timeZone);

function Figure({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "positive" | "negative";
}) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 text-xl font-extrabold tabular-nums tracking-tight",
          tone === "positive" && "text-status-success",
          tone === "negative" && "text-burgundy",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function MethodRows({ rows }: { rows: readonly MethodBreakdownRow[] }) {
  return (
    <>
      {rows.map((row) => (
        <div key={row.method} className="flex items-baseline justify-between py-1 text-sm">
          <span className="text-muted-foreground">
            {paymentMethodLabel(row.method)} ({row.count})
          </span>
          <span className="font-semibold tabular-nums">{money(row.amount)}</span>
        </div>
      ))}
    </>
  );
}

export function CashDayReportView() {
  // The restaurant's own day, not the browser's: a report opened from a laptop
  // in another zone must still mean the day the restaurant worked.
  const { restaurantTimezone } = useStaffSession();
  const [date, setDate] = useState(() => localToday(restaurantTimezone));
  const [registerId, setRegisterId] = useState("ALL");
  const [cashierId, setCashierId] = useState("ALL");

  const loadRegisters = useCallback((signal: AbortSignal) => cashRegisterApi.list(signal), []);
  const registers = useApiResource(loadRegisters);

  const query = useMemo(() => {
    const search = new URLSearchParams({ date });
    if (registerId !== "ALL") search.set("registerId", registerId);
    if (cashierId !== "ALL") search.set("cashierId", cashierId);
    return search.toString();
  }, [cashierId, date, registerId]);

  const loadReport = useCallback(
    (signal: AbortSignal) => adminApi.cashierDayReport(query, signal),
    [query],
  );
  const resource = useApiResource(loadReport);
  const report = resource.data;

  // Cashiers are offered from the day's own shifts, so the filter can only
  // name someone who actually worked it.
  /*
   * Base UI prints the selected value in the trigger unless the root is given
   * an item map, so these filters showed a database id once a real option was
   * chosen. The id stays the value; only the trigger's words come from here.
   */
  const registerLabels = useMemo(
    () => ({
      ALL: "Tümü",
      ...Object.fromEntries((registers.data?.registers ?? []).map((r) => [r.id, r.name])),
    }),
    [registers.data],
  );

  const cashiers = useMemo(() => {
    const seen = new Map<string, string>();
    for (const shift of report?.shifts ?? []) {
      seen.set(shift.cashierId, shift.cashierName ?? shift.cashierId);
    }
    return [...seen.entries()];
  }, [report]);
  const cashierLabels = useMemo(
    () => ({ ALL: "Tümü", ...Object.fromEntries(cashiers) }),
    [cashiers],
  );

  return (
    <div className="space-y-6">
      <Card className="gap-0 py-0" data-print-hide>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-4 sm:items-end sm:p-5">
          <div>
            <label className="text-xs font-semibold text-muted-foreground" htmlFor="day-date">
              Tarih
            </label>
            <Input
              id="day-date"
              type="date"
              className="mt-1 h-10"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground" htmlFor="day-register">
              Kasa
            </label>
            <Select items={registerLabels} value={registerId} onValueChange={(value) => setRegisterId(value ?? "ALL")}>
              <SelectTrigger id="day-register" className="mt-1 h-10 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Tümü</SelectItem>
                {(registers.data?.registers ?? []).map((register) => (
                  <SelectItem key={register.id} value={register.id}>
                    {register.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground" htmlFor="day-cashier">
              Kasiyer
            </label>
            <Select items={cashierLabels} value={cashierId} onValueChange={(value) => setCashierId(value ?? "ALL")}>
              <SelectTrigger id="day-cashier" className="mt-1 h-10 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Tümü</SelectItem>
                {cashiers.map(([id, name]) => (
                  <SelectItem key={id} value={id}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            {/* Built and escaped on the server; the browser only follows it. */}
            <a
              className={cn(buttonVariants({ variant: "outline" }), "h-10 flex-1")}
              href={`/api/admin/reports/cashier-day?${query}&format=csv`}
            >
              <Download className="size-4" aria-hidden="true" /> CSV
            </a>
            <Button
              type="button"
              variant="outline"
              className="h-10 flex-1"
              onClick={() => window.print()}
            >
              <Printer className="size-4" aria-hidden="true" /> Yazdır
            </Button>
          </div>
        </CardContent>
      </Card>

      {resource.loading ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Rapor hazırlanıyor…</p>
      ) : resource.error ? (
        <p className="py-8 text-center text-sm text-burgundy">{resource.error.message}</p>
      ) : report ? (
        <>
          {report.warnings.length > 0 ? (
            <div className="rounded-xl border border-status-warning/30 bg-status-warning-tint px-4 py-3">
              {report.warnings.map((warning) => (
                <p
                  key={warning}
                  className="flex items-start gap-2 text-sm font-medium text-status-warning"
                >
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  {warning}
                </p>
              ))}
            </div>
          ) : null}

          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Gün özeti">
            <Figure label="Toplam Tahsilat" value={money(report.grossCollected)} tone="positive" />
            <Figure label="İadeler" value={money(report.totalRefunds)} tone="negative" />
            <Figure label="Net Tahsilat" value={money(report.netCollected)} />
            <Figure
              label="Toplam Kasa Farkı"
              value={money(report.closedShiftVarianceTotal)}
              tone={Number(report.closedShiftVarianceTotal) === 0 ? undefined : "negative"}
            />
          </section>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card className="gap-0 py-0">
              <CardHeader className="border-b py-4">
                <CardTitle className="text-lg">Ödeme Yöntemleri</CardTitle>
              </CardHeader>
              <CardContent className="p-4 sm:p-5">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Tahsilat
                </h3>
                <MethodRows rows={report.paymentMethodBreakdown} />
                <h3 className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  İade
                </h3>
                <MethodRows rows={report.refundMethodBreakdown} />
                <div className="mt-3 border-t pt-2 text-sm">
                  <div className="flex justify-between py-0.5">
                    <span className="text-muted-foreground">Nakit Girişi</span>
                    <span className="font-semibold tabular-nums">{money(report.cashIn)}</span>
                  </div>
                  <div className="flex justify-between py-0.5">
                    <span className="text-muted-foreground">Nakit Çıkışı</span>
                    <span className="font-semibold tabular-nums">{money(report.cashOut)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="gap-0 py-0">
              <CardHeader className="border-b py-4">
                <CardTitle className="text-lg">Vardiyalar</CardTitle>
              </CardHeader>
              <CardContent className="p-4 text-sm sm:p-5">
                <div className="flex justify-between py-0.5">
                  <span className="text-muted-foreground">Açılan</span>
                  <span className="font-semibold tabular-nums">{report.openedShiftCount}</span>
                </div>
                <div className="flex justify-between py-0.5">
                  <span className="text-muted-foreground">Kapanan</span>
                  <span className="font-semibold tabular-nums">{report.closedShiftCount}</span>
                </div>
                <div className="flex justify-between py-0.5">
                  <span className="text-muted-foreground">Hâlâ açık</span>
                  <span className="font-semibold tabular-nums">{report.openShiftCount}</span>
                </div>
                <div className="flex justify-between py-0.5">
                  <span className="text-muted-foreground">Z raporu oluşan</span>
                  <span className="font-semibold tabular-nums">{report.zReportCount}</span>
                </div>
                {report.exceptions.length > 0 ? (
                  <div className="mt-3 border-t pt-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Gün içi düzeltmeler
                    </h3>
                    {report.exceptions.map((row) => (
                      <div key={row.kind} className="flex justify-between py-0.5">
                        <span className="text-muted-foreground">
                          {row.kind === "VOID" ? "Hesaptan çıkarılan kalem" : "İptal edilen işlem"} (
                          {row.count})
                        </span>
                        <span className="font-semibold tabular-nums">{money(row.amount)}</span>
                      </div>
                    ))}
                    <p className="mt-1 text-xs text-muted-foreground">
                      Bu düzeltmeler nakit hareketi yaratmaz ve bir kasaya atfedilmez.
                    </p>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </div>

          {[
            { title: "Kasa Bazında", rows: report.registerBreakdown },
            { title: "Kasiyer Bazında", rows: report.cashierBreakdown },
          ].map((section) => (
            <Card key={section.title} className="gap-0 py-0">
              <CardHeader className="border-b py-4">
                <CardTitle className="text-lg">{section.title}</CardTitle>
              </CardHeader>
              <CardContent className="p-4 sm:p-5">
                <div className="overflow-x-auto">
                  <Table className="min-w-[38rem]">
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="pl-0">Ad</TableHead>
                        <TableHead className="text-right">Tahsilat</TableHead>
                        <TableHead className="text-right">İade</TableHead>
                        <TableHead className="text-right">Net</TableHead>
                        <TableHead className="pr-0 text-right">Nakit Giriş/Çıkış</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {section.rows.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className="pl-0 font-semibold">{row.name || "—"}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {money(row.grossCollected)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {money(row.totalRefunds)}
                          </TableCell>
                          <TableCell className="text-right font-bold tabular-nums">
                            {money(row.netCollected)}
                          </TableCell>
                          <TableCell className="pr-0 text-right tabular-nums text-muted-foreground">
                            {money(row.cashIn)} / {money(row.cashOut)}
                          </TableCell>
                        </TableRow>
                      ))}
                      {section.rows.length === 0 ? (
                        <TableRow>
                          <TableCell
                            colSpan={5}
                            className="py-6 text-center text-sm text-muted-foreground"
                          >
                            Bu gün için kayıt yok.
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          ))}

          <Card className="gap-0 py-0">
            <CardHeader className="border-b py-4">
              <CardTitle className="text-lg">Gün İçindeki Vardiyalar</CardTitle>
            </CardHeader>
            <CardContent className="p-4 sm:p-5">
              <div className="overflow-x-auto">
                <Table className="min-w-[44rem]">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="pl-0">Kasa</TableHead>
                      <TableHead>Kasiyer</TableHead>
                      <TableHead>Durum</TableHead>
                      <TableHead className="text-right">Beklenen</TableHead>
                      <TableHead className="text-right">Sayılan</TableHead>
                      <TableHead className="pr-0 text-right">Kasa Farkı</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.shifts.map((shift) => (
                      <TableRow key={shift.id}>
                        <TableCell className="pl-0 font-semibold">{shift.registerName}</TableCell>
                        <TableCell>{shift.cashierName ?? "—"}</TableCell>
                        <TableCell>
                          {shift.status === "OPEN" ? (
                            <Badge className="border border-status-success/30 bg-status-success-tint text-status-success">
                              Açık
                            </Badge>
                          ) : shift.hasZReport ? (
                            <Badge variant="outline">Kapalı · Z var</Badge>
                          ) : (
                            <Badge variant="outline" className="text-muted-foreground">
                              Kapalı · Z yok
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {money(shift.expectedCash)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {money(shift.countedCash)}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "pr-0 text-right font-bold tabular-nums",
                            shift.cashVariance && Number(shift.cashVariance) !== 0
                              ? "text-status-warning"
                              : "text-muted-foreground",
                          )}
                        >
                          {money(shift.cashVariance)}
                        </TableCell>
                      </TableRow>
                    ))}
                    {report.shifts.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={6}
                          className="py-6 text-center text-sm text-muted-foreground"
                        >
                          Bu gün için vardiya yok.
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <p className="text-center text-xs text-muted-foreground">
            {report.restaurantName} · {report.businessDate} · {report.nonFiscalNotice}
          </p>
        </>
      ) : null}
    </div>
  );
}
