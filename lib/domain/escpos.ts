import { formatCurrency } from "@/lib/format";
import {
  NON_FISCAL_DISCLAIMER,
  NON_FISCAL_DOCUMENT_NOTICE,
  NON_FISCAL_PAYMENT_NOTICE,
  PRINT_LABELS,
  PRINT_PAYLOAD_VERSION,
  UnsupportedPrintPayloadError,
  type PrintDocument,
} from "./print-document";

/**
 * ESC/POS rendering.
 *
 * Two rules make this safe rather than merely convenient:
 *
 * 1. **No caller supplies bytes.** A client asks for "the bill for order X";
 *    the server builds the document and this renderer turns it into commands.
 *    There is no path from a request body to a printer command.
 * 2. **Every string is sanitised.** A product name, a note, a staff name and a
 *    register name are all operator- or guest-influenced text. An `ESC`, `GS`
 *    or `NUL` inside one of them would otherwise become a printer command, so
 *    control characters are stripped before a single byte is emitted.
 */

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

export const SUPPORTED_ENCODINGS = ["CP857", "CP1254", "UTF8"] as const;
export type PrinterEncoding = (typeof SUPPORTED_ENCODINGS)[number];

export class UnsupportedPrinterEncodingError extends Error {
  constructor(readonly encoding: string) {
    super(`Unsupported printer encoding: ${encoding}`);
    this.name = "UnsupportedPrinterEncodingError";
  }
}

export interface PrinterProfile {
  readonly charactersPerLine: number;
  readonly encoding: PrinterEncoding;
  readonly autoCut: boolean;
}

export function isSupportedEncoding(value: string): value is PrinterEncoding {
  return (SUPPORTED_ENCODINGS as readonly string[]).includes(value);
}

/**
 * Strips everything a printer would read as a command and collapses the
 * whitespace a thermal line cannot represent. Printable Turkish letters are
 * untouched; `ESC`, `GS`, `NUL` and friends simply cease to exist.
 */
export function sanitizePrintText(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  return [...String(value)]
    // Layout whitespace becomes a space rather than vanishing: deleting a tab
    // would run two words together on the ticket.
    .map((character) => ("\t\n\r\v\f".includes(character) ? " " : character))
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      // C0 controls (including ESC 0x1B and GS 0x1D), DEL, and C1 controls.
      if (code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f)) return false;
      return true;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/** Turkish letters that have no CP857/CP1254 aliasing problem in transliteration. */
const ASCII_FALLBACK: Record<string, string> = {
  "Ç": "C", "ç": "c", "Ğ": "G", "ğ": "g", "İ": "I", "ı": "i",
  "Ö": "O", "ö": "o", "Ş": "S", "ş": "s", "Ü": "U", "ü": "u",
};

/** IBM code page 857 (Turkish), the usual default on ESC/POS hardware. */
const CP857: Record<string, number> = {
  "Ç": 0x80, "ü": 0x81, "é": 0x82, "â": 0x83, "ä": 0x84, "à": 0x85, "å": 0x86, "ç": 0x87,
  "ê": 0x88, "ë": 0x89, "è": 0x8a, "ï": 0x8b, "î": 0x8c, "ı": 0x8d, "Ä": 0x8e, "Å": 0x8f,
  "É": 0x90, "æ": 0x91, "Æ": 0x92, "ô": 0x93, "ö": 0x94, "ò": 0x95, "û": 0x96, "ù": 0x97,
  "İ": 0x98, "Ö": 0x99, "Ü": 0x9a, "ø": 0x9b, "£": 0x9c, "Ø": 0x9d, "Ş": 0x9e, "ş": 0x9f,
  "á": 0xa0, "í": 0xa1, "ó": 0xa2, "ú": 0xa3, "ñ": 0xa4, "Ñ": 0xa5, "Ğ": 0xa6, "ğ": 0xa7,
};

/** Windows-1254 (Turkish), used by printers that speak the Windows pages. */
const CP1254: Record<string, number> = {
  "Ğ": 0xd0, "ğ": 0xf0, "İ": 0xdd, "ı": 0xfd, "Ş": 0xde, "ş": 0xfe,
  "Ç": 0xc7, "ç": 0xe7, "Ö": 0xd6, "ö": 0xf6, "Ü": 0xdc, "ü": 0xfc,
};

/** `ESC t n` selects the printer's code page; the table must match it. */
const CODE_PAGE_SELECTOR: Record<PrinterEncoding, number | null> = {
  CP857: 13,
  CP1254: 32,
  UTF8: null,
};

function encodeText(text: string, encoding: PrinterEncoding): number[] {
  if (encoding === "UTF8") return [...new TextEncoder().encode(text)];

  const table = encoding === "CP857" ? CP857 : CP1254;
  const bytes: number[] = [];
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0x3f;
    if (code < 0x80) {
      bytes.push(code);
      continue;
    }
    const mapped = table[character];
    if (mapped !== undefined) {
      bytes.push(mapped);
      continue;
    }
    // A letter the code page cannot express degrades to ASCII rather than
    // printing a random glyph.
    const fallback = ASCII_FALLBACK[character];
    bytes.push(...[...(fallback ?? "?")].map((letter) => letter.charCodeAt(0)));
  }
  return bytes;
}

/**
 * Deterministic word wrap. A long Turkish product name breaks between words
 * where it can, and mid-word only when a single word is longer than the line.
 */
export function wrapText(text: string, width: number): string[] {
  if (width < 1) throw new RangeError("Line width must be at least one character.");
  const clean = sanitizePrintText(text);
  if (clean === "") return [""];

  const lines: string[] = [];
  let current = "";
  for (const word of clean.split(" ")) {
    let remaining = word;
    while (remaining.length > width) {
      if (current !== "") {
        lines.push(current);
        current = "";
      }
      lines.push(remaining.slice(0, width));
      remaining = remaining.slice(width);
    }
    if (remaining === "") continue;
    if (current === "") current = remaining;
    else if (current.length + 1 + remaining.length <= width) current += ` ${remaining}`;
    else {
      lines.push(current);
      current = remaining;
    }
  }
  if (current !== "") lines.push(current);
  return lines.length > 0 ? lines : [""];
}

/** `left` flush left, `right` flush right, padded to the line width. */
export function columns(left: string, right: string, width: number): string {
  const leftText = sanitizePrintText(left);
  const rightText = sanitizePrintText(right);
  const space = width - rightText.length;
  if (space <= 1) return `${leftText} ${rightText}`.slice(0, width);
  const trimmedLeft = leftText.slice(0, space - 1);
  return `${trimmedLeft}${" ".repeat(width - trimmedLeft.length - rightText.length)}${rightText}`;
}

class EscPosBuilder {
  private readonly bytes: number[] = [];

  constructor(private readonly profile: PrinterProfile) {
    if (!isSupportedEncoding(profile.encoding)) {
      throw new UnsupportedPrinterEncodingError(profile.encoding);
    }
    // ESC @ — reset to a known state rather than inheriting the last job's.
    this.bytes.push(ESC, 0x40);
    const codePage = CODE_PAGE_SELECTOR[profile.encoding];
    if (codePage !== null) this.bytes.push(ESC, 0x74, codePage);
  }

  private align(mode: 0 | 1 | 2): this {
    this.bytes.push(ESC, 0x61, mode);
    return this;
  }

  private bold(on: boolean): this {
    this.bytes.push(ESC, 0x45, on ? 1 : 0);
    return this;
  }

  private double(on: boolean): this {
    // GS ! n — double width and height, used sparingly for a headline.
    this.bytes.push(GS, 0x21, on ? 0x11 : 0x00);
    return this;
  }

  private write(text: string): this {
    this.bytes.push(...encodeText(text, this.profile.encoding));
    return this;
  }

  feed(count = 1): this {
    for (let index = 0; index < count; index += 1) this.bytes.push(LF);
    return this;
  }

  line(text = "", options: { bold?: boolean; center?: boolean; large?: boolean } = {}): this {
    if (options.center) this.align(1);
    if (options.bold) this.bold(true);
    if (options.large) this.double(true);
    for (const wrapped of wrapText(text, this.wrapWidth(options.large))) {
      this.write(wrapped).feed();
    }
    if (options.large) this.double(false);
    if (options.bold) this.bold(false);
    if (options.center) this.align(0);
    return this;
  }

  private wrapWidth(large?: boolean): number {
    return large
      ? Math.max(1, Math.floor(this.profile.charactersPerLine / 2))
      : this.profile.charactersPerLine;
  }

  twoColumn(left: string, right: string, options: { bold?: boolean } = {}): this {
    if (options.bold) this.bold(true);
    this.write(columns(left, right, this.profile.charactersPerLine)).feed();
    if (options.bold) this.bold(false);
    return this;
  }

  rule(character = "-"): this {
    this.write(character.repeat(this.profile.charactersPerLine)).feed();
    return this;
  }

  finish(): Uint8Array {
    this.feed(3);
    // Only cut when the printer actually has a cutter.
    if (this.profile.autoCut) this.bytes.push(GS, 0x56, 0x00);
    return Uint8Array.from(this.bytes);
  }
}

function money(value: string): string {
  return formatCurrency(Number(value));
}

function clock(iso: string): string {
  return new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Istanbul",
  }).format(new Date(iso));
}

function header(builder: EscPosBuilder, document: PrintDocument, title: string): void {
  builder.line(document.restaurantName, { center: true, bold: true });
  builder.line(title, { center: true, bold: true });
  if (document.reprintOfJobId) {
    builder.line(PRINT_LABELS.reprint, { center: true, bold: true });
    if (document.reprintReason) builder.line(document.reprintReason, { center: true });
  }
  builder.line(clock(document.printedAtIso), { center: true });
  builder.rule();
}

/**
 * Turns one document into printer bytes. Pure: no I/O, no clock, no database —
 * the same document and profile always produce the same bytes.
 */
export function renderEscPos(
  document: PrintDocument,
  profile: PrinterProfile,
): Uint8Array {
  if (document.version !== PRINT_PAYLOAD_VERSION) {
    throw new UnsupportedPrintPayloadError(document.version);
  }
  const builder = new EscPosBuilder(profile);

  switch (document.type) {
    case "KITCHEN_ORDER": {
      header(builder, document, PRINT_LABELS.kitchenOrder);
      builder.line(
        document.isAddition ? PRINT_LABELS.additionalOrder : PRINT_LABELS.newOrder,
        { center: true, bold: true, large: true },
      );
      builder.twoColumn(document.tableName, document.orderNumber, { bold: true });
      builder.line(document.stationLabel);
      builder.rule();
      for (const item of document.lines) {
        builder.line(`${item.quantity} x ${item.productName}`, { bold: true });
        if (item.note) builder.line(`   Not: ${item.note}`);
      }
      break;
    }

    case "KITCHEN_CANCEL": {
      header(builder, document, PRINT_LABELS.kitchenCancel);
      builder.line(PRINT_LABELS.itemCancelled, { center: true, bold: true, large: true });
      builder.twoColumn(document.tableName, document.orderNumber, { bold: true });
      builder.line(document.stationLabel);
      builder.rule();
      for (const item of document.lines) {
        builder.line(`${item.quantity} x ${item.productName}`, { bold: true });
      }
      if (document.reason) {
        builder.rule();
        builder.line(`Gerekçe: ${document.reason}`);
      }
      break;
    }

    case "CUSTOMER_BILL": {
      header(builder, document, PRINT_LABELS.customerBill);
      builder.twoColumn(document.tableName, document.orderNumber, { bold: true });
      builder.line(`Açılış: ${clock(document.openedAtIso)}`);
      builder.rule();
      for (const item of document.lines) {
        builder.line(`${item.quantity} x ${item.productName}`);
        builder.twoColumn(`   ${money(item.unitPrice)}`, money(item.lineTotal));
        if (item.note) builder.line(`   Not: ${item.note}`);
      }
      builder.rule();
      builder.twoColumn("Ara Toplam", money(document.subtotal));
      if (Number(document.discountTotal) > 0) {
        builder.twoColumn("İndirim", money(document.discountTotal));
      }
      if (Number(document.serviceChargeTotal) > 0) {
        builder.twoColumn("Servis", money(document.serviceChargeTotal));
      }
      if (Number(document.taxTotal) > 0) {
        builder.twoColumn("Vergi", money(document.taxTotal));
      }
      builder.twoColumn("TOPLAM", money(document.total), { bold: true });
      builder.rule();
      builder.twoColumn("Tahsil Edilen", money(document.paidTotal));
      if (Number(document.refundedTotal) > 0) {
        builder.twoColumn(PRINT_LABELS.refund, money(document.refundedTotal));
      }
      builder.twoColumn("Kalan", money(document.outstanding), { bold: true });
      builder.rule();
      builder.line(NON_FISCAL_DOCUMENT_NOTICE, { center: true });
      break;
    }

    case "PAYMENT_RECEIPT": {
      header(builder, document, PRINT_LABELS.paymentReceipt);
      builder.twoColumn(document.tableName, document.orderNumber, { bold: true });
      builder.rule();
      builder.twoColumn("Ödeme", money(document.amount), { bold: true });
      builder.twoColumn("Yöntem", document.method);
      builder.rule();
      builder.twoColumn("Toplam Tahsilat", money(document.paidTotal));
      if (Number(document.refundedTotal) > 0) {
        builder.twoColumn(PRINT_LABELS.refund, money(document.refundedTotal));
      }
      builder.twoColumn("Kalan", money(document.outstanding));
      if (document.cashierName) builder.twoColumn("Kasiyer", document.cashierName);
      if (document.registerName) builder.twoColumn("Kasa", document.registerName);
      builder.rule();
      builder.line(NON_FISCAL_PAYMENT_NOTICE, { center: true });
      break;
    }

    case "X_REPORT":
    case "Z_REPORT": {
      const report = document.report as Record<string, string | number | undefined> & {
        paymentMethodBreakdown?: { method: string; amount: string; count: number }[];
        refundMethodBreakdown?: { method: string; amount: string; count: number }[];
      };
      header(
        builder,
        document,
        document.type === "X_REPORT" ? "OPERASYONEL X RAPORU" : "OPERASYONEL Z RAPORU",
      );
      builder.line(String(report.registerNameSnapshot ?? ""), { bold: true });
      builder.line(String(report.openedByNameSnapshot ?? ""));
      builder.rule();
      builder.twoColumn("Açılış Nakdi", money(String(report.openingCash ?? "0.00")));
      for (const row of report.paymentMethodBreakdown ?? []) {
        builder.twoColumn(`Tahsilat ${row.method} (${row.count})`, money(row.amount));
      }
      builder.twoColumn(
        "Toplam Tahsilat",
        money(String(report.grossCollected ?? "0.00")),
        { bold: true },
      );
      for (const row of report.refundMethodBreakdown ?? []) {
        builder.twoColumn(`${PRINT_LABELS.refund} ${row.method} (${row.count})`, money(row.amount));
      }
      builder.twoColumn("Toplam İade", money(String(report.totalRefunds ?? "0.00")));
      builder.twoColumn("Net Tahsilat", money(String(report.netCollected ?? "0.00")));
      builder.rule();
      builder.twoColumn("Nakit Girişi", money(String(report.cashIn ?? "0.00")));
      builder.twoColumn("Nakit Çıkışı", money(String(report.cashOut ?? "0.00")));
      builder.twoColumn(
        "Beklenen Nakit",
        money(String(report.expectedCash ?? "0.00")),
        { bold: true },
      );
      if (document.type === "Z_REPORT") {
        builder.twoColumn("Sayılan Nakit", money(String(report.countedCash ?? "0.00")));
        builder.twoColumn(
          "Kasa Farkı",
          money(String(report.cashVariance ?? "0.00")),
          { bold: true },
        );
        if (report.closeNote) builder.line(`Açıklama: ${String(report.closeNote)}`);
      }
      builder.rule();
      builder.line(NON_FISCAL_DISCLAIMER, { center: true });
      break;
    }

    case "TEST_PRINT": {
      header(builder, document, PRINT_LABELS.testPrint);
      builder.twoColumn("Yazıcı", document.printerName);
      builder.twoColumn("Agent", document.agentName);
      builder.twoColumn("Kodlama", document.encoding);
      builder.twoColumn("Satır", String(document.charactersPerLine));
      builder.rule();
      builder.line(document.characterSample);
      builder.line("0123456789 ABCDEFGHIJKLMNOPQRSTUVWXYZ");
      builder.rule();
      builder.line(NON_FISCAL_DOCUMENT_NOTICE, { center: true });
      break;
    }
  }

  return builder.finish();
}
