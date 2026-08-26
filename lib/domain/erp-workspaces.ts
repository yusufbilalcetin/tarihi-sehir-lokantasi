import { DomainError } from "@/lib/api/domain-error";

export const ERP_WORKSPACE_MODULES = [
  "sales",
  "inventory",
  "stock-movements",
  "stock-counts",
  "warehouses",
  "recipes",
  "costing",
  "production",
  "waste",
  "suppliers",
  "purchasing",
  "payables",
  "price-history",
  "forecast",
  "menu-engineering",
  "popular",
  "attendance",
  "schedules",
  "payroll",
  "feedback",
  "reservations",
  "fulfillment",
  "customers",
  "loyalty",
  "integrations",
  "reports",
] as const;

export type ErpWorkspaceModule = (typeof ERP_WORKSPACE_MODULES)[number];

export interface ErpWorkspaceQuery {
  readonly module: ErpWorkspaceModule;
  readonly page: number;
  readonly pageSize: number;
  readonly search: string;
  readonly status: string;
  readonly category: string;
  readonly warehouseId: string | null;
  readonly dateFrom: string | null;
  readonly dateTo: string | null;
}

export interface ErpWorkspaceData {
  readonly module: ErpWorkspaceModule;
  readonly generatedAt: string;
  readonly rows: readonly Record<string, unknown>[];
  readonly summary: Readonly<Record<string, string | number | boolean | null>>;
  readonly options: Readonly<Record<string, readonly Record<string, string>[]>>;
  readonly pagination: {
    readonly page: number;
    readonly pageSize: number;
    readonly total: number;
    readonly totalPages: number;
  };
  readonly notice?: string;
}

/** The largest page a screen may ask for; an export asks for `ERP_EXPORT_MAX_ROWS`. */
export const ERP_PAGE_SIZE_MAX = 100;

/**
 * A CSV is still a bounded query. Five thousand rows is well past what a
 * manager reads and well short of a full-table dump, and the export tells the
 * user when it hit the ceiling rather than silently truncating.
 */
export const ERP_EXPORT_MAX_ROWS = 5_000;

export function normalizeWorkspacePage(page: number, pageSize: number, maxPageSize = ERP_PAGE_SIZE_MAX) {
  const safePage = Math.max(1, Math.trunc(page));
  const safePageSize = Math.min(maxPageSize, Math.max(10, Math.trunc(pageSize)));
  return { page: safePage, pageSize: safePageSize, offset: (safePage - 1) * safePageSize };
}

/**
 * The widest window a date-filtered ERP report may scan.
 *
 * Without this a hand-edited `dateFrom` turns every dated module into an
 * all-history sequential scan. The clamp moves the *start* forward rather than
 * failing the request, so an over-wide filter still answers — with the last
 * `ERP_RANGE_MAX_DAYS` days and a notice saying so.
 */
export const ERP_RANGE_MAX_DAYS = 92;

const DAY_MS = 86_400_000;

export function boundWorkspaceRange(from: string, to: string, maxDays = ERP_RANGE_MAX_DAYS) {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return { from, to, clamped: false };
  }
  const spanDays = Math.round((end - start) / DAY_MS);
  if (spanDays <= maxDays) return { from, to, clamped: false };
  return { from: new Date(end - maxDays * DAY_MS).toISOString().slice(0, 10), to, clamped: true };
}

export const ERP_RANGE_CLAMPED_NOTICE = `Tarih aralığı sunucuda en fazla ${ERP_RANGE_MAX_DAYS} güne sınırlandı; rapor bu pencerenin son günlerini gösterir.`;

export function stockTransferKeys(idempotencyKey: string) {
  return {
    transferId: idempotencyKey,
    out: `transfer:${idempotencyKey}:out`,
    in: `transfer:${idempotencyKey}:in`,
  } as const;
}

export type RecipeLifecycleStatus = "DRAFT" | "ACTIVE" | "RETIRED";

export function assertRecipeLifecycleTransition(from: RecipeLifecycleStatus, to: RecipeLifecycleStatus) {
  const allowed: Record<RecipeLifecycleStatus, readonly RecipeLifecycleStatus[]> = {
    DRAFT: ["ACTIVE", "RETIRED"],
    ACTIVE: ["RETIRED"],
    RETIRED: [],
  };
  if (!allowed[from].includes(to)) {
    throw new DomainError("CONFLICT", "Reçete bu durum değişikliğine uygun değil.", { httpStatus: 409 });
  }
}

export type ReservationWorkflowStatus = "PENDING" | "CONFIRMED" | "SEATED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";

export function assertReservationTransition(from: ReservationWorkflowStatus, to: ReservationWorkflowStatus) {
  const allowed: Record<ReservationWorkflowStatus, readonly ReservationWorkflowStatus[]> = {
    PENDING: ["CONFIRMED", "CANCELLED"],
    CONFIRMED: ["SEATED", "CANCELLED", "NO_SHOW"],
    SEATED: ["COMPLETED", "CANCELLED"],
    COMPLETED: [],
    CANCELLED: [],
    NO_SHOW: [],
  };
  if (!allowed[from].includes(to)) {
    throw new DomainError("CONFLICT", "Rezervasyon bu işleme uygun değil.", { httpStatus: 409 });
  }
}

export type PurchaseWorkflowStatus = "DRAFT" | "SENT" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CANCELLED";

export function assertPurchaseTransition(from: PurchaseWorkflowStatus, to: PurchaseWorkflowStatus) {
  const allowed: Record<PurchaseWorkflowStatus, readonly PurchaseWorkflowStatus[]> = {
    DRAFT: ["SENT", "CANCELLED"],
    SENT: ["CANCELLED"],
    PARTIALLY_RECEIVED: ["CANCELLED"],
    RECEIVED: [],
    CANCELLED: [],
  };
  if (!allowed[from].includes(to)) {
    throw new DomainError("CONFLICT", "Satın alma siparişi bu işleme uygun değil.", { httpStatus: 409 });
  }
}

export type FulfillmentWorkflowStatus = "DRAFT" | "PLACED" | "WAITING_FOR_COURIER" | "OUT_FOR_DELIVERY" | "DELIVERED" | "CANCELLED";

export function assertFulfillmentTransition(from: FulfillmentWorkflowStatus, to: FulfillmentWorkflowStatus) {
  const allowed: Record<FulfillmentWorkflowStatus, readonly FulfillmentWorkflowStatus[]> = {
    DRAFT: ["PLACED", "CANCELLED"],
    PLACED: ["WAITING_FOR_COURIER", "CANCELLED"],
    WAITING_FOR_COURIER: ["OUT_FOR_DELIVERY", "CANCELLED"],
    OUT_FOR_DELIVERY: ["DELIVERED", "CANCELLED"],
    DELIVERED: [],
    CANCELLED: [],
  };
  if (!allowed[from].includes(to)) {
    throw new DomainError("CONFLICT", "Teslimat bu durum değişikliğine uygun değil.", { httpStatus: 409 });
  }
}

export const ERP_STATUS_LABELS: Readonly<Record<string, string>> = {
  ACTIVE: "Aktif",
  INACTIVE: "Pasif",
  DRAFT: "Taslak",
  RETIRED: "Emekli",
  SENT: "Gönderildi",
  PARTIALLY_RECEIVED: "Kısmi Kabul",
  RECEIVED: "Tamamı Kabul Edildi",
  OPEN: "Açık",
  PARTIALLY_PAID: "Kısmi Ödendi",
  PAID: "Ödendi",
  PLANNED: "Planlandı",
  IN_PROGRESS: "Üretimde",
  COMPLETED: "Tamamlandı",
  CANCELLED: "İptal",
  PENDING: "Onay Bekliyor",
  CONFIRMED: "Onaylandı",
  SEATED: "Masaya Alındı",
  NO_SHOW: "Gelmedi",
  CORRECTED: "Düzeltildi",
  APPROVED: "Onaylandı",
  NEW: "Yeni",
  REVIEWED: "İncelendi",
  HIDDEN: "Gizlendi",
  PLACED: "Alındı",
  WAITING_FOR_COURIER: "Kurye Bekleniyor",
  OUT_FOR_DELIVERY: "Yola Çıktı",
  DELIVERED: "Teslim Edildi",
  WARN: "Uyar",
  BLOCK: "Engelle",
  NOT_CONFIGURED: "Yapılandırılmadı",
  CONFIGURED: "Yapılandırıldı",
  LINKED: "Mutfakta",
  NOT_LINKED: "Bağlanmadı",
  SERVED: "Servis Edildi",
  PREPARING: "Hazırlanıyor",
  READY: "Hazır",
};

export const STOCK_MOVEMENT_LABELS: Readonly<Record<string, string>> = {
  PURCHASE_RECEIPT: "Mal kabul",
  PRODUCTION_CONSUMPTION: "Üretim tüketimi",
  MANUAL_ADJUSTMENT: "Manuel düzeltme",
  WASTE: "Fire",
  STAFF_MEAL: "Personel yemeği",
  COMPLIMENTARY: "İkram",
  TRANSFER_IN: "Depolar arası giriş",
  TRANSFER_OUT: "Depolar arası çıkış",
  COUNT_CORRECTION: "Sayım farkı",
  RETURN_TO_SUPPLIER: "Tedarikçiye iade",
};

export function movementLabel(value: string) {
  return STOCK_MOVEMENT_LABELS[value] ?? "Stok hareketi";
}

export const ERP_UNIT_LABELS: Readonly<Record<string, string>> = {
  MG: "mg", G: "g", KG: "kg", ML: "ml", L: "L", UNIT: "adet", PACKAGE: "paket", CASE: "kasa",
};

export const ERP_WASTE_TYPE_LABELS: Readonly<Record<string, string>> = {
  SPOILAGE: "Bozulma",
  SPILL: "Dökülme",
  PREPARATION_WASTE: "Hazırlık Firesi",
  STAFF_MEAL: "Personel Yemeği",
  COMPLIMENTARY: "İkram",
  OTHER: "Diğer",
};

/** Where an order came from, in the words a manager uses. */
export const ERP_CHANNEL_LABELS: Readonly<Record<string, string>> = {
  DINE_IN: "Masada",
  TAKEAWAY: "Paket",
  DELIVERY: "Kurye",
};

export const ERP_INTEGRATION_LABELS: Readonly<Record<string, string>> = {
  PAYMENT_TERMINAL: "POS Terminal",
  FISCAL_DOCUMENT: "E-Fatura / e-Arşiv",
  FISCAL_DEVICE: "ÖKC",
  ACCOUNTING: "Muhasebe",
  DELIVERY_PROVIDER: "Teslimat Sağlayıcısı",
};

/**
 * The one place an ERP enum becomes Turkish.
 *
 * Every screen and every CSV asks this, so a value that gains a label gains it
 * everywhere at once and no surface is left printing `PREPARATION_WASTE` at a
 * manager. An unknown value returns null rather than itself: the caller then
 * decides between a fallback and showing the raw token, and the raw token never
 * leaks by accident.
 */
export function erpEnumLabel(value: string): string | null {
  return (
    ERP_STATUS_LABELS[value]
    ?? STOCK_MOVEMENT_LABELS[value]
    ?? ERP_WASTE_TYPE_LABELS[value]
    ?? ERP_CHANNEL_LABELS[value]
    ?? ERP_INTEGRATION_LABELS[value]
    ?? ERP_UNIT_LABELS[value]
    ?? null
  );
}
