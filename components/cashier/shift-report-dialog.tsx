"use client";

import { useCallback } from "react";
import { Download, Printer } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { WindowDialogContent } from "@/components/ui/window-dialog";
import { PrintButton } from "@/components/shared/print-button";
import { cashierShiftApi } from "@/lib/api/endpoints";
import type {
  MethodBreakdownRow,
  XReport,
  ZReportSnapshot,
} from "@/lib/domain/cashier-report";
import { useApiResource } from "@/lib/hooks/use-api-resource";
import { paymentMethodLabel } from "@/lib/domain/display";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The printable operational X and Z reports.
 *
 * These are the restaurant's own cash documents, not fiscal ones, and the view
 * says so in as many words. Either the browser prints an A4 copy, or the report
 * is queued for a thermal printer; neither makes it a fiscal document.
 */

interface ShiftReportDialogProps {
  readonly open: boolean;
  readonly shiftId: string | null;
  readonly kind: "X" | "Z";
  readonly onOpenChange: (open: boolean) => void;
}

function money(value: string): string {
  return formatCurrency(Number(value));
}

function stamp(value: string): string {
  return new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function Line({
  label,
  value,
  strong,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: "negative" | "muted";
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-4 py-1",
        strong && "border-t pt-2 font-bold",
      )}
    >
      <span className={cn("text-sm", tone === "muted" && "text-muted-foreground")}>
        {label}
      </span>
      <span
        className={cn(
          "tabular-nums",
          strong ? "text-base font-extrabold" : "text-sm font-semibold",
          tone === "negative" && "text-burgundy",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function Breakdown({
  title,
  rows,
  total,
  count,
}: {
  title: string;
  rows: readonly MethodBreakdownRow[];
  total: string;
  count: number;
}) {
  return (
    <section className="mt-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {rows.map((row) => (
        <Line
          key={row.method}
          label={`${paymentMethodLabel(row.method)} (${row.count})`}
          value={money(row.amount)}
          tone={row.count === 0 ? "muted" : undefined}
        />
      ))}
      <Line label={`Toplam (${count})`} value={money(total)} strong />
    </section>
  );
}

export function ShiftReportDialog({
  open,
  shiftId,
  kind,
  onOpenChange,
}: ShiftReportDialogProps) {
  const load = useCallback(
    async (signal: AbortSignal): Promise<XReport | ZReportSnapshot | null> => {
      if (!shiftId) return null;
      return kind === "X"
        ? cashierShiftApi.xReport(shiftId, signal)
        : cashierShiftApi.zReport(shiftId, signal);
    },
    [kind, shiftId],
  );
  const resource = useApiResource(load, { enabled: open && Boolean(shiftId) });
  const report = resource.data;
  const closing = report && report.reportType === "Z" ? report : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <WindowDialogContent
        size="md"
        data-print-root
        title={kind === "X" ? "Operasyonel X Raporu" : "Operasyonel Z Raporu"}
        description={
          kind === "X"
            ? "Açık vardiyanın anlık kasa görünümü. Vardiyayı kapatmaz."
            : "Kapatılmış vardiyanın değişmez kasa kaydı."
        }
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Kapat
            </Button>
            {report && shiftId ? (
              <>
                {/* The CSV is built and escaped on the server; the browser only
                    follows the link. */}
                <a
                  className={buttonVariants({ variant: "outline" })}
                  href={`/api/cashier/shifts/${shiftId}/${kind === "X" ? "x-report" : "z-report"}?format=csv`}
                >
                  <Download className="size-4" aria-hidden="true" /> CSV
                </a>
                {/* A4 / browser printing. */}
                <Button type="button" variant="outline" onClick={() => window.print()}>
                  <Printer className="size-4" aria-hidden="true" /> Yazdır
                </Button>
                {/* The thermal path: queued for the local agent, so a printer
                    that is switched off delays paper and nothing else. */}
                <PrintButton
                  variant="default"
                  label="Yazıcıya Gönder"
                  document={{
                    documentType: kind === "X" ? "X_REPORT" : "Z_REPORT",
                    shiftId,
                  }}
                />
              </>
            ) : null}
          </>
        }
      >
        {resource.loading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Rapor hazırlanıyor…</p>
        ) : resource.error ? (
          <p className="py-6 text-center text-sm text-burgundy">{resource.error.message}</p>
        ) : report ? (
          <div className="text-foreground">
            {/* The printed document starts here. */}
            <header className="border-b pb-3 text-center">
              <h2 className="font-heading text-lg font-bold">
                {kind === "X" ? "OPERASYONEL X RAPORU" : "OPERASYONEL Z RAPORU"}
              </h2>
              <p className="mt-0.5 text-sm font-semibold">{report.restaurantNameSnapshot}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {report.registerNameSnapshot} · {report.openedByNameSnapshot ?? "Kasiyer"}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Açılış: {stamp(report.openedAt)}
                {closing ? ` · Kapanış: ${stamp(closing.closedAt)}` : ""}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Rapor: {stamp(report.generatedAt)}
              </p>
            </header>

            <section className="mt-3">
              <Line label="Açılış Nakdi" value={money(report.openingCash)} />
            </section>

            <Breakdown
              title="Tahsilat"
              rows={report.paymentMethodBreakdown}
              total={report.grossCollected}
              count={report.paymentCount}
            />
            <Breakdown
              title="İade"
              rows={report.refundMethodBreakdown}
              total={report.totalRefunds}
              count={report.refundCount}
            />

            <section className="mt-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Kasa
              </h3>
              <Line label="Nakit Girişi" value={money(report.cashIn)} />
              <Line label="Nakit Çıkışı" value={money(report.cashOut)} tone="negative" />
              <Line label="Net Tahsilat" value={money(report.netCollected)} />
              <Line label="Beklenen Nakit" value={money(report.expectedCash)} strong />
              {closing ? (
                <>
                  <Line label="Sayılan Nakit" value={money(closing.countedCash)} />
                  <Line
                    label="Kasa Farkı"
                    value={money(closing.cashVariance)}
                    strong
                    tone={Number(closing.cashVariance) === 0 ? undefined : "negative"}
                  />
                </>
              ) : null}
            </section>

            {closing?.managerOverride ? (
              <p className="mt-3 text-xs text-muted-foreground">
                Vardiya {closing.closedByNameSnapshot ?? "yönetici"} tarafından kapatıldı.
              </p>
            ) : null}
            {closing?.closeNote ? (
              <p className="mt-2 rounded-lg bg-muted/50 px-3 py-2 text-sm">
                {closing.closeNote}
              </p>
            ) : null}

            <p className="mt-4 border-t pt-2 text-center text-[11px] leading-4 text-muted-foreground">
              {report.nonFiscalNotice}
            </p>
          </div>
        ) : null}

      </WindowDialogContent>
    </Dialog>
  );
}
