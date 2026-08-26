import { CASH_MOVEMENT_TYPES } from "./cashier-shift";
import type { FulfillmentWorkflowStatus } from "./erp-workspaces";
import { STAFF_ROLE_LABELS } from "./staff-accounts";
import type {
  OrderChannel,
  OrderItemStatus,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  TableStatus,
  UserRole,
  WaiterCallStatus,
  WaiterCallType,
} from "./status";

/**
 * One place where a stored value becomes something a person reads.
 *
 * The database and the domain keep speaking their own language — `PREPARING`,
 * `CASH_IN`, `restaurant_id` — because that is what makes migrations, queries
 * and tests unambiguous. Nothing here renames a column or an enum. What lives
 * here is the other half: the sentence a guest, a waiter or a manager sees
 * instead, in one file rather than re-invented in every component.
 *
 * The same stored value is allowed to read differently per audience. A guest is
 * told about *their* order ("Siparişiniz hazırlanıyor"); the kitchen is told
 * about a ticket ("Hazırlanıyor"). That is the only reason the customer and
 * staff maps are separate.
 */

export type DisplayAudience = "customer" | "staff";

/** Shown where a value is genuinely absent. Never "null", "-" or "N/A". */
export const EMPTY_DISPLAY = "—";

/**
 * Looks a value up and, crucially, never falls back to the value itself: an
 * unmapped code renders as a dash or a supplied phrase, so a new enum member
 * can leak a blank cell but never `ORDER_ALREADY_SETTLED` into someone's face.
 */
export function displayLabel(
  labels: Readonly<Record<string, string>>,
  value: string | null | undefined,
  fallback: string = EMPTY_DISPLAY,
): string {
  if (value === null || value === undefined) return fallback;
  return labels[value] ?? fallback;
}

/* -------------------------------------------------------------- orders --- */

/** Where an order is served. The database calls these DINE_IN and friends. */
export const ORDER_CHANNEL_LABELS: Readonly<Record<OrderChannel, string>> = {
  DINE_IN: "Masada",
  TAKEAWAY: "Paket Sipariş",
  DELIVERY: "Kurye Siparişi",
};

/**
 * The one line that says where an order belongs.
 *
 * Every screen that used to print a table name now asks this instead, so the
 * kitchen, the till and the printed ticket all say the same thing about the
 * same order. A dine-in order answers with its table; a takeaway or courier
 * order answers with what it is, because it genuinely has no table and a
 * screen that insists on one would have to invent it.
 */
export function orderPlaceLabel(
  channel: OrderChannel | null | undefined,
  tableName: string | null | undefined,
): string {
  if (channel === "TAKEAWAY" || channel === "DELIVERY") return ORDER_CHANNEL_LABELS[channel];
  return tableName || EMPTY_DISPLAY;
}


/** What the guest is told about their own order. */
export const CUSTOMER_ORDER_STATUS_LABELS: Readonly<Record<OrderStatus, string>> = {
  NEW: "Siparişiniz alındı",
  CONFIRMED: "Siparişiniz onaylandı",
  PREPARING: "Siparişiniz hazırlanıyor",
  READY: "Siparişiniz hazırlandı",
  SERVED: "Siparişiniz servis edildi",
  COMPLETED: "Sipariş tamamlandı",
  CANCELLED: "Sipariş iptal edildi",
};

/** What the floor, the kitchen and the office are told about the same order. */
export const ORDER_STATUS_LABELS: Readonly<Record<OrderStatus, string>> = {
  NEW: "Yeni",
  CONFIRMED: "Onaylandı",
  PREPARING: "Hazırlanıyor",
  READY: "Hazır",
  SERVED: "Servis edildi",
  COMPLETED: "Tamamlandı",
  CANCELLED: "İptal edildi",
};

export const CUSTOMER_ORDER_ITEM_STATUS_LABELS: Readonly<Record<OrderItemStatus, string>> = {
  PENDING: "Hazırlanmayı bekliyor",
  PREPARING: "Hazırlanıyor",
  READY: "Hazır",
  SERVED: "Servis edildi",
  CANCELLED: "İptal edildi",
  // Served, then written off. To the guest that is simply a line that is no
  // longer charged; the word "void" says nothing and "iptal" would suggest it
  // was never made.
  VOIDED: "Hesaptan çıkarıldı",
};

export const ORDER_ITEM_STATUS_LABELS: Readonly<Record<OrderItemStatus, string>> = {
  PENDING: "Bekliyor",
  PREPARING: "Hazırlanıyor",
  READY: "Hazır",
  SERVED: "Servis edildi",
  CANCELLED: "İptal edildi",
  // Staff wording keeps the financial meaning: the item was made and served,
  // and the money was written off — not the same event as a cancellation.
  VOIDED: "Hesaptan düşüldü",
};

/* ------------------------------------------------------ order tracking --- */

/**
 * What a takeaway or courier guest is shown about their own order.
 *
 * Two state machines decide this and neither is touched: the kitchen moves the
 * order (NEW → PREPARING → READY → …) and the counter moves the fulfillment
 * request (PLACED → WAITING_FOR_COURIER → OUT_FOR_DELIVERY → DELIVERED). They
 * stay separate in the database and in the domain, exactly as they are; this
 * is the one place that composes them into the single line of progress a
 * person understands, and it composes only the transitions that actually
 * exist. No step here is a state the system cannot reach.
 *
 * The steps are named as translation keys rather than as labels, because a
 * guest may be reading the menu in any of the supported languages and a
 * Turkish sentence baked into an API response could not follow them. The
 * server sends the step; `menuTranslations` — the same dictionary the rest of
 * the customer surface uses — supplies the words. No screen keeps its own copy.
 */
export const ORDER_TRACKING_STEPS = {
  TAKEAWAY: ["trackReceived", "trackPreparing", "trackReady"],
  DELIVERY: [
    "trackReceived",
    "trackPreparing",
    "trackWaitingCourier",
    "trackOnTheWay",
    "trackDelivered",
  ],
} as const satisfies Record<"TAKEAWAY" | "DELIVERY", readonly string[]>;

export const ORDER_TRACKING_CANCELLED_STEP = "trackCancelled";

export type OrderTrackingChannel = keyof typeof ORDER_TRACKING_STEPS;
export type OrderTrackingStepKey =
  | (typeof ORDER_TRACKING_STEPS)[OrderTrackingChannel][number]
  | typeof ORDER_TRACKING_CANCELLED_STEP;

export interface OrderTrackingStep {
  readonly key: OrderTrackingStepKey;
  readonly state: "done" | "current" | "upcoming";
}

/** How far the kitchen alone has carried the order, as a step index. */
function kitchenProgress(orderStatus: OrderStatus): number {
  switch (orderStatus) {
    case "NEW":
    case "CONFIRMED":
      return 0;
    case "PREPARING":
      return 1;
    default:
      // READY, SERVED and COMPLETED all mean the food is made. For takeaway
      // that is the last step; for delivery it is the moment the courier
      // becomes the story, which the fulfillment status below then tells.
      return 2;
  }
}

/** How far the counter has carried it, or null when it has not spoken yet. */
function fulfillmentProgress(status: FulfillmentWorkflowStatus | null): number | null {
  switch (status) {
    case "WAITING_FOR_COURIER":
      return 2;
    case "OUT_FOR_DELIVERY":
      return 3;
    case "DELIVERED":
      return 4;
    default:
      // DRAFT and PLACED say only that the order exists, which the kitchen
      // already said better.
      return null;
  }
}

export function orderTrackingTimeline(input: {
  readonly channel: OrderTrackingChannel;
  readonly orderStatus: OrderStatus;
  readonly fulfillmentStatus: FulfillmentWorkflowStatus | null;
}): { readonly current: OrderTrackingStepKey; readonly steps: readonly OrderTrackingStep[] } {
  const keys = ORDER_TRACKING_STEPS[input.channel];
  const reached = Math.min(
    Math.max(kitchenProgress(input.orderStatus), fulfillmentProgress(input.fulfillmentStatus) ?? 0),
    keys.length - 1,
  );
  const cancelled = input.orderStatus === "CANCELLED" || input.fulfillmentStatus === "CANCELLED";

  if (cancelled) {
    // Cancellation is not a stage of the journey, it is the end of it. What was
    // genuinely done stays done; nothing is invented past it.
    return {
      current: ORDER_TRACKING_CANCELLED_STEP,
      steps: [
        ...keys.map((key, index) => ({
          key,
          state: (index < reached ? "done" : "upcoming") as OrderTrackingStep["state"],
        })),
        { key: ORDER_TRACKING_CANCELLED_STEP, state: "current" },
      ],
    };
  }

  return {
    current: keys[reached],
    steps: keys.map((key, index) => ({
      key,
      state: index < reached ? "done" : index === reached ? "current" : "upcoming",
    })),
  };
}

export function orderStatusLabel(
  status: string | null | undefined,
  audience: DisplayAudience = "staff",
): string {
  return displayLabel(
    audience === "customer" ? CUSTOMER_ORDER_STATUS_LABELS : ORDER_STATUS_LABELS,
    status,
  );
}

export function orderItemStatusLabel(
  status: string | null | undefined,
  audience: DisplayAudience = "staff",
): string {
  return displayLabel(
    audience === "customer" ? CUSTOMER_ORDER_ITEM_STATUS_LABELS : ORDER_ITEM_STATUS_LABELS,
    status,
  );
}

/* ------------------------------------------------------------- payment --- */

export const PAYMENT_METHOD_LABELS: Readonly<Record<PaymentMethod, string>> = {
  CASH: "Nakit",
  CARD: "Kart",
  OTHER: "Diğer",
};

export const PAYMENT_STATUS_LABELS: Readonly<Record<PaymentStatus, string>> = {
  PENDING: "İşlem bekleniyor",
  COMPLETED: "Ödeme alındı",
  FAILED: "Ödeme başarısız",
  REFUNDED: "İade edildi",
  CANCELLED: "İşlem iptal edildi",
};

export function paymentMethodLabel(method: string | null | undefined): string {
  return displayLabel(PAYMENT_METHOD_LABELS, method, PAYMENT_METHOD_LABELS.OTHER);
}

/* ---------------------------------------------------------- cash drawer --- */

export const CASH_MOVEMENT_TYPE_LABELS: Readonly<
  Record<(typeof CASH_MOVEMENT_TYPES)[number], string>
> = {
  CASH_IN: "Kasaya para girişi",
  CASH_OUT: "Kasadan para çıkışı",
};

/* --------------------------------------------------- service requests --- */

export const WAITER_CALL_TYPE_LABELS: Readonly<Record<WaiterCallType, string>> = {
  WAITER_CALL: "Garson çağrısı",
  BILL_REQUEST: "Hesap talebi",
  OTHER: "Diğer servis talebi",
};

export const WAITER_CALL_STATUS_LABELS: Readonly<Record<WaiterCallStatus, string>> = {
  OPEN: "Bekliyor",
  ACKNOWLEDGED: "İlgileniliyor",
  RESOLVED: "Karşılandı",
  CANCELLED: "İptal edildi",
};

/* -------------------------------------------------------------- tables --- */

export const TABLE_STATUS_LABELS: Readonly<Record<TableStatus, string>> = {
  AVAILABLE: "Boş",
  OCCUPIED: "Dolu",
  ORDERING: "Sipariş veriyor",
  WAITING: "Sipariş bekliyor",
  DINING: "Yemekte",
  WAITER_CALL: "Garson çağırdı",
  BILL_REQUESTED: "Hesap istedi",
  CLEANING: "Temizleniyor",
  INACTIVE: "Kullanım dışı",
};

/* --------------------------------------------------------------- roles --- */

export { STAFF_ROLE_LABELS };

export function staffRoleLabel(role: string | null | undefined): string {
  return displayLabel(STAFF_ROLE_LABELS as Readonly<Record<string, string>>, role);
}

export type { UserRole };

/* ------------------------------------------------------ money and dates --- */

/**
 * One Turkish name per financial concept, so a figure called "Tahsilat" in the
 * till is not called "Ciro" in a report and "Net Revenue" in a third place.
 */
export const MONEY_FIELD_LABELS = {
  subtotal: "Ara toplam",
  discount: "İndirim",
  serviceCharge: "Servis bedeli",
  tax: "Vergi",
  total: "Toplam",
  grossSales: "Satış",
  collected: "Tahsilat",
  netCollected: "Net tahsilat",
  refunded: "İade edilen",
  outstanding: "Kalan tutar",
  unitPrice: "Birim fiyat",
  lineTotal: "Tutar",
  cashVariance: "Kasa farkı",
  expectedCash: "Beklenen kasa",
  countedCash: "Sayılan kasa",
  openingCash: "Açılış kasası",
} as const;

export const DATE_FIELD_LABELS = {
  createdAt: "Oluşturulma",
  updatedAt: "Son güncelleme",
  servedAt: "Servis zamanı",
  completedAt: "Tamamlanma zamanı",
  voidedAt: "Hesaptan düşülme zamanı",
  openedAt: "Açılış",
  closedAt: "Kapanış",
} as const;

/** Column names guests and staff must never read as-is. */
export const ENTITY_FIELD_LABELS = {
  restaurantId: "Restoran",
  tableId: "Masa",
  staffId: "Personel",
  orderId: "Sipariş",
  cashierShiftId: "Kasa vardiyası",
  isActive: "Durum",
} as const;

/* ------------------------------------------------------------ booleans --- */

export function activeLabel(value: boolean | null | undefined): string {
  if (value === null || value === undefined) return EMPTY_DISPLAY;
  return value ? "Aktif" : "Pasif";
}

export function yesNoLabel(value: boolean | null | undefined): string {
  if (value === null || value === undefined) return EMPTY_DISPLAY;
  return value ? "Evet" : "Hayır";
}

export function availabilityLabel(value: boolean | null | undefined): string {
  if (value === null || value === undefined) return EMPTY_DISPLAY;
  return value ? "Mevcut" : "Tükendi";
}

/* -------------------------------------------------------- error codes --- */

/**
 * The API answers with a machine `code` and a human `message`; panels render
 * the message. This map exists for the cases where only the code is in hand —
 * a realtime payload, a stored job failure, a retry decision — so no screen has
 * to fall back to printing the code.
 */
export const ERROR_CODE_MESSAGES: Readonly<Record<string, string>> = {
  VALIDATION_ERROR: "Girilen bilgiler geçerli değil.",
  AUTHENTICATION_REQUIRED: "Oturumunuz sona ermiş. Lütfen yeniden giriş yapın.",
  FORBIDDEN: "Bu işlemi yapmaya yetkiniz yok.",
  ACCOUNT_INACTIVE: "Bu hesap kullanım dışı.",
  RESTAURANT_SCOPE_VIOLATION: "Bu kayıt başka bir restorana ait.",
  NOT_FOUND: "Kayıt bulunamadı.",
  CONFLICT: "Bu kayıt başka bir işlem tarafından değiştirildi.",
  RATE_LIMITED: "Çok fazla istek gönderildi. Lütfen biraz bekleyin.",
  INTERNAL_ERROR: "Şu anda işlem tamamlanamıyor. Lütfen tekrar deneyin.",
  NETWORK_ERROR: "Bağlantı kurulamadı. Lütfen tekrar deneyin.",
  INVALID_STATUS_TRANSITION: "Bu işlem siparişin mevcut durumunda yapılamaz.",
  SAME_STATUS: "Sipariş zaten bu durumda.",
  INVALID_TABLE_TOKEN: "Masa bağlantısı geçersiz. QR kodu yeniden okutun.",
  TABLE_INACTIVE: "Bu masa şu anda kullanım dışı.",
  PRODUCT_NOT_FOUND: "Ürün bulunamadı.",
  PRODUCT_UNAVAILABLE: "Bu ürün şu anda sunulmuyor.",
  ORDER_NOT_FOUND: "Sipariş bilgisine ulaşılamadı.",
  WAITER_CALL_NOT_FOUND: "Servis talebi bulunamadı.",
  IDEMPOTENCY_CONFLICT: "Bu istek daha önce farklı bir sipariş için kullanıldı.",
  IDEMPOTENCY_IN_FLIGHT: "Bu istek hâlâ işleniyor. Lütfen birkaç saniye bekleyin.",
  ORDER_NOT_MUTABLE: "Bu sipariş artık değiştirilemez.",
  ORDER_ALREADY_COMPLETED: "Bu sipariş tamamlanmış.",
  ORDER_ITEM_NOT_FOUND: "Sipariş kalemi bulunamadı.",
  ORDER_ITEM_ALREADY_CANCELLED: "Bu kalem zaten iptal edilmiş.",
  ITEM_CANNOT_BE_CANCELLED: "Bu kalem artık iptal edilemez.",
  TABLE_NOT_FOUND: "Masa bulunamadı.",
  TABLE_TARGET_OCCUPIED: "Hedef masa dolu.",
  TABLE_HAS_OPEN_ORDER: "Bu masada açık hesap var.",
  TABLE_TRANSFER_CONFLICT: "Masa taşıma sırasında masa durumu değişti.",
  TABLE_MERGE_CONFLICT: "Masa birleştirme sırasında masa durumu değişti.",
  TABLE_RESET_BLOCKED: "Açık hesabı olan masa sıfırlanamaz.",
  ORDER_ITEM_ALREADY_VOIDED: "Bu kalem zaten hesaptan düşülmüş.",
  ITEM_CANNOT_BE_VOIDED: "Bu kalem hesaptan düşülemez.",
  PAYMENT_ALREADY_COMPLETED: "Bu tahsilat zaten alınmış.",
  PAYMENT_NOT_FOUND: "Tahsilat kaydı bulunamadı.",
  PAYMENT_EXCEEDS_BALANCE: "Tahsilat tutarı kalan hesabı aşıyor.",
  REFUND_EXCEEDS_REFUNDABLE: "İade tutarı iade edilebilir tutarı aşıyor.",
  ORDER_ALREADY_SETTLED: "Bu hesap zaten tamamen ödenmiş.",
  CHECK_NOT_FOUND: "Hesap bulunamadı.",
  CHECK_ALLOCATION_INVALID: "Hesap paylaştırması geçersiz.",
  CHECK_ALREADY_PAID: "Bu hesap zaten ödenmiş.",
  CHECK_NOT_MUTABLE: "Bu hesap artık değiştirilemez.",
  CASHIER_SHIFT_REQUIRED: "Önce kasa vardiyanızı açmanız gerekiyor.",
  CASHIER_SHIFT_ALREADY_OPEN: "Bu kasada açık bir vardiya var.",
  CASHIER_SHIFT_CLOSED: "Vardiya kapatılmış.",
  CASHIER_SHIFT_HAS_PENDING_PAYMENT: "Bekleyen tahsilat varken vardiya kapatılamaz.",
  CASHIER_SHIFT_NOTE_REQUIRED: "Bu işlem için açıklama girmeniz gerekiyor.",
  CASHIER_SHIFT_NOT_CLOSED: "Vardiya henüz kapatılmadı.",
  LEGACY_SHIFT_WITHOUT_Z_SNAPSHOT: "Bu vardiyanın Z raporu bulunmuyor.",
  PRINT_ROUTE_MISSING: "Bu belge için yazıcı tanımlı değil.",
  UNSUPPORTED_PRINT_PAYLOAD: "Bu belge yazdırılamıyor.",
  UNSUPPORTED_PRINTER_ENCODING: "Yazıcı bu karakter setini desteklemiyor.",
  PRINTER_AGENT_UNAUTHORIZED: "Yazıcı aracısı yetkilendirilemedi.",
};

/**
 * What the local print agent reports back when a ticket does not come out.
 * These never cross the API boundary as `DomainError`s, so their only route to
 * a screen is the stored job row.
 */
export const PRINT_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  PRINTER_AGENT_OFFLINE: "Yazıcı aracısı çevrimdışı",
  PRINTER_DEVICE_NOT_FOUND: "Yazıcı bulunamadı",
  PRINTER_CONNECTION_FAILED: "Yazıcıya bağlanılamadı",
  PRINTER_WRITE_FAILED: "Yazıcıya gönderilemedi",
  PRINT_JOB_LEASE_EXPIRED: "Yazdırma görevi zaman aşımına uğradı",
  PRINT_ROUTE_MISSING: "Bu belge için yazıcı tanımlı değil",
  UNSUPPORTED_PRINT_PAYLOAD: "Bu belge yazdırılamıyor",
  UNSUPPORTED_PRINTER_ENCODING: "Yazıcı bu karakter setini desteklemiyor",
};

export function printErrorLabel(code: string | null | undefined): string {
  return displayLabel(PRINT_ERROR_MESSAGES, code, "Yazdırma hatası");
}

/** A staff-facing sentence for a failure whose code is all that is known. */
export function errorCodeMessage(
  code: string | null | undefined,
  fallback = "İşlem tamamlanamadı. Lütfen tekrar deneyin.",
): string {
  return displayLabel(ERROR_CODE_MESSAGES, code, fallback);
}
