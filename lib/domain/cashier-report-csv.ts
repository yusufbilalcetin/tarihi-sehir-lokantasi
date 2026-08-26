import { toCsv } from "./csv";
import {
  NON_FISCAL_DISCLAIMER,
  type MethodBreakdownRow,
  type XReport,
  type ZReportSnapshot,
} from "./cashier-report";

/**
 * Server-side CSV for the cash reports.
 *
 * Every cell goes through `escapeCsvCell`, which neutralises the leading
 * characters spreadsheets treat as formulas — register names, cashier names and
 * free-text notes are all operator-supplied and end up in these files.
 *
 * Money is exported as the exact decimal string it is stored as, never
 * locale-formatted: `1250.00`, not `1.250,00`. The screen may format; the file
 * must stay machine-parseable.
 */

type Row = readonly (string | number | null | undefined)[];

function breakdownRows(label: string, rows: readonly MethodBreakdownRow[]): Row[] {
  return rows.map((row) => [label, row.method, row.amount, row.count]);
}

export function xReportToCsv(report: XReport): string {
  const rows: Row[] = [
    ["Rapor", "Tür", "OPERASYONEL X RAPORU", ""],
    ["Rapor", "Not", NON_FISCAL_DISCLAIMER, ""],
    ["Kimlik", "Restoran", report.restaurantNameSnapshot, ""],
    ["Kimlik", "Kasa", report.registerNameSnapshot, ""],
    ["Kimlik", "Kasiyer", report.openedByNameSnapshot ?? "", ""],
    ["Kimlik", "Vardiya", report.shiftId, ""],
    ["Kimlik", "Açılış", report.openedAt, ""],
    ["Kimlik", "Rapor zamanı", report.generatedAt, ""],
    ["Kasa", "Açılış Nakdi", report.openingCash, ""],
    ...breakdownRows("Tahsilat", report.paymentMethodBreakdown),
    ["Tahsilat", "TOPLAM", report.grossCollected, report.paymentCount],
    ...breakdownRows("İade", report.refundMethodBreakdown),
    ["İade", "TOPLAM", report.totalRefunds, report.refundCount],
    ["Kasa", "Nakit Girişi", report.cashIn, ""],
    ["Kasa", "Nakit Çıkışı", report.cashOut, report.movementCount],
    ["Kasa", "Net Tahsilat", report.netCollected, ""],
    ["Kasa", "Beklenen Nakit", report.expectedCash, ""],
  ];
  return toCsv(["Bölüm", "Kalem", "Tutar", "Adet"], rows);
}

export function zReportToCsv(report: ZReportSnapshot): string {
  const rows: Row[] = [
    ["Rapor", "Tür", "OPERASYONEL Z RAPORU", ""],
    ["Rapor", "Not", NON_FISCAL_DISCLAIMER, ""],
    ["Rapor", "Sürüm", String(report.version), ""],
    ["Kimlik", "Restoran", report.restaurantNameSnapshot, ""],
    ["Kimlik", "Kasa", report.registerNameSnapshot, ""],
    ["Kimlik", "Açan", report.openedByNameSnapshot ?? "", ""],
    ["Kimlik", "Kapatan", report.closedByNameSnapshot ?? "", ""],
    ["Kimlik", "Vardiya", report.shiftId, ""],
    ["Kimlik", "Açılış", report.openedAt, ""],
    ["Kimlik", "Kapanış", report.closedAt, ""],
    ["Kasa", "Açılış Nakdi", report.openingCash, ""],
    ...breakdownRows("Tahsilat", report.paymentMethodBreakdown),
    ["Tahsilat", "TOPLAM", report.grossCollected, report.paymentCount],
    ...breakdownRows("İade", report.refundMethodBreakdown),
    ["İade", "TOPLAM", report.totalRefunds, report.refundCount],
    ["Kasa", "Nakit Girişi", report.cashIn, ""],
    ["Kasa", "Nakit Çıkışı", report.cashOut, report.movementCount],
    ["Kasa", "Net Tahsilat", report.netCollected, ""],
    ["Kasa", "Beklenen Nakit", report.expectedCash, ""],
    ["Kasa", "Sayılan Nakit", report.countedCash, ""],
    ["Kasa", "Kasa Farkı", report.cashVariance, ""],
    ["Kapanış", "Yönetici kapanışı", report.managerOverride ? "EVET" : "HAYIR", ""],
    ["Kapanış", "Açıklama", report.closeNote ?? "", ""],
  ];
  return toCsv(["Bölüm", "Kalem", "Tutar", "Adet"], rows);
}

export interface DailyCsvInput {
  readonly restaurantName: string;
  readonly businessDate: string;
  readonly generatedAt: string;
  readonly paymentMethodBreakdown: readonly MethodBreakdownRow[];
  readonly grossCollected: string;
  readonly paymentCount: number;
  readonly refundMethodBreakdown: readonly MethodBreakdownRow[];
  readonly totalRefunds: string;
  readonly refundCount: number;
  readonly netCollected: string;
  readonly cashIn: string;
  readonly cashOut: string;
  readonly openedShiftCount: number;
  readonly closedShiftCount: number;
  readonly openShiftCount: number;
  readonly zReportCount: number;
  readonly closedShiftVarianceTotal: string;
  readonly registerBreakdown: readonly {
    readonly name: string;
    readonly grossCollected: string;
    readonly totalRefunds: string;
    readonly netCollected: string;
    readonly cashIn: string;
    readonly cashOut: string;
  }[];
  readonly cashierBreakdown: readonly {
    readonly name: string;
    readonly grossCollected: string;
    readonly totalRefunds: string;
    readonly netCollected: string;
  }[];
  readonly warnings: readonly string[];
}

export function dailyReportToCsv(report: DailyCsvInput): string {
  const rows: Row[] = [
    ["Rapor", "Tür", "GÜN SONU KASA RAPORU", ""],
    ["Rapor", "Not", NON_FISCAL_DISCLAIMER, ""],
    ["Rapor", "Restoran", report.restaurantName, ""],
    ["Rapor", "Tarih", report.businessDate, ""],
    ["Rapor", "Rapor zamanı", report.generatedAt, ""],
    ...report.paymentMethodBreakdown.map(
      (row): Row => ["Tahsilat", row.method, row.amount, row.count],
    ),
    ["Tahsilat", "TOPLAM", report.grossCollected, report.paymentCount],
    ...report.refundMethodBreakdown.map(
      (row): Row => ["İade", row.method, row.amount, row.count],
    ),
    ["İade", "TOPLAM", report.totalRefunds, report.refundCount],
    ["Genel", "Net Tahsilat", report.netCollected, ""],
    ["Genel", "Nakit Girişi", report.cashIn, ""],
    ["Genel", "Nakit Çıkışı", report.cashOut, ""],
    ["Vardiya", "Açılan", "", report.openedShiftCount],
    ["Vardiya", "Kapanan", "", report.closedShiftCount],
    ["Vardiya", "Hâlâ açık", "", report.openShiftCount],
    ["Vardiya", "Z raporu", "", report.zReportCount],
    ["Vardiya", "Toplam Kasa Farkı", report.closedShiftVarianceTotal, ""],
    // A name always occupies a cell of its own, so `escapeCsvCell` sees it at
    // the start of the value and can neutralise it. Concatenating it into a
    // longer label would defuse an attack only by accident.
    ...report.registerBreakdown.flatMap((row): Row[] => [
      ["Kasa tahsilat", row.name, row.grossCollected, ""],
      ["Kasa iade", row.name, row.totalRefunds, ""],
      ["Kasa net", row.name, row.netCollected, ""],
      ["Kasa nakit giriş/çıkış", row.name, `${row.cashIn}/${row.cashOut}`, ""],
    ]),
    ...report.cashierBreakdown.flatMap((row): Row[] => [
      ["Kasiyer tahsilat", row.name, row.grossCollected, ""],
      ["Kasiyer iade", row.name, row.totalRefunds, ""],
      ["Kasiyer net", row.name, row.netCollected, ""],
    ]),
    ...report.warnings.map((warning): Row => ["Uyarı", warning, "", ""]),
  ];
  return toCsv(["Bölüm", "Kalem", "Tutar", "Adet"], rows);
}
