import { toCsv } from "@/lib/domain/csv";
import { erpEnumLabel, type ErpWorkspaceModule } from "@/lib/domain/erp-workspaces";

/**
 * ERP exports.
 *
 * A CSV is not "the query, as a file". Every export below names its columns
 * explicitly, so a column added to a screen — or to a SQL projection for a join
 * — never reaches a spreadsheet just because it happened to be in the row. That
 * allowlist is also the privacy boundary: tenant and row identifiers, delivery
 * addresses, guest phone numbers and contact details have no entry here, so a
 * generic management export cannot carry them.
 *
 * Money and quantities are written as the canonical decimal strings the
 * database produced. Passing them through `Number` would round 0.1 + 0.2 into a
 * spreadsheet, so the unit travels in the header instead of the cell.
 */
export type ErpCsvKind = "text" | "decimal" | "date" | "datetime" | "enum" | "boolean" | "integer";

export interface ErpCsvColumn {
  readonly key: string;
  readonly header: string;
  readonly kind: ErpCsvKind;
}

export interface ErpCsvExport {
  /** Filename stem, already Turkish and free of identifiers. */
  readonly slug: string;
  readonly columns: readonly ErpCsvColumn[];
}

const text = (key: string, header: string): ErpCsvColumn => ({ key, header, kind: "text" });
const decimal = (key: string, header: string): ErpCsvColumn => ({ key, header, kind: "decimal" });
const integer = (key: string, header: string): ErpCsvColumn => ({ key, header, kind: "integer" });
const date = (key: string, header: string): ErpCsvColumn => ({ key, header, kind: "date" });
const datetime = (key: string, header: string): ErpCsvColumn => ({ key, header, kind: "datetime" });
const enumeration = (key: string, header: string): ErpCsvColumn => ({ key, header, kind: "enum" });
const boolean = (key: string, header: string): ErpCsvColumn => ({ key, header, kind: "boolean" });

/**
 * Only the modules that are genuinely a management report get an export. A
 * module missing from this map has no CSV at all, and the route refuses it.
 */
export const ERP_CSV_EXPORTS: Partial<Readonly<Record<ErpWorkspaceModule, ErpCsvExport>>> = {
  sales: {
    slug: "satis",
    columns: [
      date("business_date", "İş Günü"),
      enumeration("channel", "Kanal"),
      integer("order_count", "Sipariş Adedi"),
      decimal("gross_sales", "Brüt Satış (TRY)"),
      decimal("average_check", "Ortalama Adisyon (TRY)"),
    ],
  },
  inventory: {
    slug: "stok-durumu",
    columns: [
      text("name", "Stok Kalemi"),
      text("category", "Grup"),
      decimal("available_quantity", "Kullanılabilir Miktar"),
      enumeration("unit", "Birim"),
      decimal("critical_quantity", "Kritik Seviye"),
      boolean("critical", "Kritik mi"),
      enumeration("negative_stock_policy", "Negatif Stok Politikası"),
      boolean("is_active", "Aktif"),
    ],
  },
  "stock-movements": {
    slug: "stok-hareketleri",
    columns: [
      datetime("occurred_at", "Tarih"),
      text("inventory_item", "Stok Kalemi"),
      text("warehouse", "Depo"),
      enumeration("movement_type", "Hareket"),
      decimal("quantity_delta", "Miktar"),
      enumeration("unit", "Birim"),
      decimal("unit_cost", "Birim Maliyet (TRY)"),
      text("reason", "Açıklama"),
      text("recorded_by", "Kaydeden"),
    ],
  },
  production: {
    slug: "uretim",
    columns: [
      date("business_date", "İş Günü"),
      text("product", "Ürün"),
      text("warehouse", "Depo"),
      decimal("planned_portions", "Planlanan"),
      decimal("prepared_portions", "Üretilen"),
      decimal("sold_portions", "Satılan"),
      decimal("waste_portions", "Fire"),
      decimal("remaining_portions", "Kalan"),
      enumeration("status", "Durum"),
    ],
  },
  waste: {
    slug: "fire",
    columns: [
      datetime("occurred_at", "Tarih"),
      text("inventory_item", "Stok Kalemi"),
      text("warehouse", "Depo"),
      enumeration("waste_type", "Fire Türü"),
      decimal("quantity", "Miktar"),
      enumeration("unit", "Birim"),
      decimal("estimated_cost", "Tahmini Maliyet (TRY)"),
      text("reason", "Neden"),
      text("recorded_by", "Kaydeden"),
    ],
  },
  purchasing: {
    slug: "satin-alma",
    columns: [
      datetime("order_date", "Sipariş Tarihi"),
      text("order_number", "Sipariş No"),
      text("supplier", "Tedarikçi"),
      enumeration("status", "Durum"),
      decimal("total", "Sipariş Tutarı (TRY)"),
      decimal("ordered_quantity", "Sipariş Miktarı"),
      decimal("received_quantity", "Kabul Edilen"),
      decimal("remaining_quantity", "Kalan"),
    ],
  },
  "price-history": {
    slug: "alim-fiyat-gecmisi",
    columns: [
      datetime("created_at", "Mal Kabul Tarihi"),
      text("item_name", "Stok Kalemi"),
      text("supplier", "Tedarikçi"),
      text("receipt_number", "İrsaliye No"),
      decimal("received_quantity", "Miktar"),
      enumeration("unit", "Birim"),
      decimal("previous_unit_price", "Önceki Birim Fiyat (TRY)"),
      decimal("unit_price", "Ödenen Birim Fiyat (TRY)"),
      decimal("change_percent", "Değişim (%)"),
    ],
  },
  payables: {
    slug: "tedarikci-borclari",
    columns: [
      datetime("invoice_date", "Fatura Tarihi"),
      text("invoice_number", "Fatura No"),
      text("supplier", "Tedarikçi"),
      date("due_date", "Vade"),
      decimal("total", "Fatura Tutarı (TRY)"),
      decimal("paid_total", "Ödenen (TRY)"),
      decimal("remaining", "Kalan Borç (TRY)"),
      enumeration("status", "Durum"),
    ],
  },
  attendance: {
    slug: "puantaj",
    columns: [
      date("business_date", "İş Günü"),
      text("staff", "Personel"),
      datetime("clock_in_at", "Giriş"),
      datetime("clock_out_at", "Çıkış"),
      integer("break_minutes", "Mola (dk)"),
      integer("duration_minutes", "Çalışma (dk)"),
      enumeration("status", "Durum"),
      text("correction_reason", "Düzeltme Gerekçesi"),
    ],
  },
};

const dateFormatter = new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Istanbul" });
const dateTimeFormatter = new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });

export function erpCsvCell(value: unknown, kind: ErpCsvKind): string {
  if (value === null || value === undefined || value === "") return "";
  if (kind === "boolean") return value === true || value === "true" ? "Evet" : "Hayır";
  if (kind === "enum") {
    const token = String(value);
    // An unlabelled enum would put a database token in a manager's
    // spreadsheet, so it is named as unknown rather than printed raw.
    return erpEnumLabel(token) ?? "Tanımsız";
  }
  if (kind === "date" || kind === "datetime") {
    const parsed = new Date(String(value));
    if (Number.isNaN(parsed.getTime())) return "";
    return (kind === "date" ? dateFormatter : dateTimeFormatter).format(parsed);
  }
  // Decimals and integers keep the exact text the database produced.
  return String(value);
}

export function erpRowsToCsv(columns: readonly ErpCsvColumn[], rows: readonly Record<string, unknown>[]): string {
  return toCsv(
    columns.map((column) => column.header),
    rows.map((row) => columns.map((column) => erpCsvCell(row[column.key], column.kind))),
  );
}

/** `satis-2026-08-01-2026-08-31.csv` — readable, deterministic, no identifiers. */
export function erpCsvFilename(slug: string, from: string | null, to: string | null): string {
  const span = from && to ? `-${from}-${to}` : from ? `-${from}` : "";
  return `${slug}${span}.csv`;
}
