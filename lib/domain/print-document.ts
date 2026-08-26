import { NON_FISCAL_DISCLAIMER } from "./cashier-report";

/**
 * The documents this system can put on paper.
 *
 * **None of them is a fiscal document.** There is no ÖKC, no fiscal printer, no
 * bank POS integration, no e-Fatura and no e-Arşiv. A guest copy is an
 * *adisyon* — a statement of what was ordered and what is owed — and a payment
 * copy is an *ödeme bilgi fişi*. Both say so on the paper itself.
 *
 * A document is a **snapshot**. It is built once, from the database, and stored
 * with the print job. Reprinting reproduces exactly what was printed the first
 * time, however much the order has moved on since.
 */

export const PRINT_DOCUMENT_TYPES = [
  "KITCHEN_ORDER",
  "KITCHEN_CANCEL",
  "CUSTOMER_BILL",
  "PAYMENT_RECEIPT",
  "X_REPORT",
  "Z_REPORT",
  "TEST_PRINT",
] as const;

export type PrintDocumentType = (typeof PRINT_DOCUMENT_TYPES)[number];

export const PRINTER_STATION_TYPES = ["KITCHEN", "BAR", "RECEIPT", "GENERAL"] as const;
export type PrinterStationType = (typeof PRINTER_STATION_TYPES)[number];

/** Bumped when a stored payload's shape changes; old rows keep their version. */
export const PRINT_PAYLOAD_VERSION = 1;

/**
 * Turkish operator-facing wording. The database keeps its technical enums —
 * `VOIDED`, `REFUND` — but nothing a guest or a cook reads should say "void".
 */
export const PRINT_LABELS = {
  kitchenOrder: "MUTFAK SİPARİŞ FİŞİ",
  kitchenCancel: "MUTFAK İPTAL FİŞİ",
  itemCancelled: "ÜRÜN İPTALİ",
  customerBill: "ADİSYON / HESAP ÖZETİ",
  paymentReceipt: "ÖDEME BİLGİ FİŞİ",
  refund: "PARA İADESİ",
  reprint: "YENİDEN YAZDIRMA",
  newOrder: "YENİ SİPARİŞ",
  additionalOrder: "EK SİPARİŞ",
  testPrint: "TEST YAZDIRMA",
} as const;

export const NON_FISCAL_DOCUMENT_NOTICE =
  "Bu belge mali belge / ÖKC fişi değildir.";
export const NON_FISCAL_PAYMENT_NOTICE =
  "Bu belge mali belge / banka POS slipi değildir.";

/** Re-exported so every printed cash report carries the Phase 8B wording. */
export { NON_FISCAL_DISCLAIMER };

export interface PrintDocumentHeader {
  readonly restaurantName: string;
  readonly printedAtIso: string;
  /** Set only on a reprint, so a duplicate is recognisable on the counter. */
  readonly reprintOfJobId?: string;
  readonly reprintReason?: string;
}

export interface KitchenLine {
  readonly quantity: number;
  readonly productName: string;
  readonly note: string | null;
  readonly categoryName: string | null;
}

export interface KitchenOrderDocument extends PrintDocumentHeader {
  readonly type: "KITCHEN_ORDER";
  readonly version: number;
  readonly stationLabel: string;
  readonly tableName: string;
  readonly orderNumber: string;
  readonly orderId: string;
  /** An addition to a running order prints only what is new. */
  readonly isAddition: boolean;
  readonly lines: readonly KitchenLine[];
}

export interface KitchenCancelDocument extends PrintDocumentHeader {
  readonly type: "KITCHEN_CANCEL";
  readonly version: number;
  readonly stationLabel: string;
  readonly tableName: string;
  readonly orderNumber: string;
  readonly orderId: string;
  readonly reason: string | null;
  readonly lines: readonly KitchenLine[];
}

export interface BillLine {
  readonly quantity: number;
  readonly productName: string;
  readonly unitPrice: string;
  readonly lineTotal: string;
  readonly note: string | null;
}

export interface CustomerBillDocument extends PrintDocumentHeader {
  readonly type: "CUSTOMER_BILL";
  readonly version: number;
  readonly tableName: string;
  readonly orderNumber: string;
  readonly orderId: string;
  readonly openedAtIso: string;
  readonly lines: readonly BillLine[];
  readonly subtotal: string;
  readonly discountTotal: string;
  readonly serviceChargeTotal: string;
  readonly taxTotal: string;
  readonly total: string;
  readonly paidTotal: string;
  readonly refundedTotal: string;
  readonly outstanding: string;
}

export interface PaymentReceiptDocument extends PrintDocumentHeader {
  readonly type: "PAYMENT_RECEIPT";
  readonly version: number;
  readonly tableName: string;
  readonly orderNumber: string;
  readonly orderId: string;
  readonly paymentId: string;
  readonly amount: string;
  /**
   * The stored payment method and nothing more. No card number, expiry, CVV or
   * processor reference is ever carried into a print payload.
   */
  readonly method: string;
  readonly paidTotal: string;
  readonly refundedTotal: string;
  readonly outstanding: string;
  readonly cashierName: string | null;
  readonly registerName: string | null;
}

export interface CashReportDocument extends PrintDocumentHeader {
  readonly type: "X_REPORT" | "Z_REPORT";
  readonly version: number;
  /** The Phase 8B report, verbatim. A Z is never recomputed for printing. */
  readonly report: Record<string, unknown>;
}

export interface TestPrintDocument extends PrintDocumentHeader {
  readonly type: "TEST_PRINT";
  readonly version: number;
  readonly printerName: string;
  readonly agentName: string;
  readonly encoding: string;
  readonly charactersPerLine: number;
  /** Exercises the printer's code page before anyone trusts a real ticket. */
  readonly characterSample: string;
}

export type PrintDocument =
  | KitchenOrderDocument
  | KitchenCancelDocument
  | CustomerBillDocument
  | PaymentReceiptDocument
  | CashReportDocument
  | TestPrintDocument;

/** Every Turkish letter a code page can get wrong, plus the pairs that alias. */
export const TURKISH_CHARACTER_SAMPLE = "ÇĞİÖŞÜ çğıöşü — Şehir Lokantası";

export function stationLabelFor(station: PrinterStationType): string {
  switch (station) {
    case "KITCHEN":
      return "MUTFAK";
    case "BAR":
      return "BAR";
    case "RECEIPT":
      return "KASA";
    default:
      return "GENEL";
  }
}

/**
 * A stored payload written by a newer build is refused rather than rendered
 * against today's field list, which would silently drop lines from a ticket.
 */
export class UnsupportedPrintPayloadError extends Error {
  constructor(readonly version: unknown) {
    super(`Unsupported print payload version: ${String(version)}`);
    this.name = "UnsupportedPrintPayloadError";
  }
}
