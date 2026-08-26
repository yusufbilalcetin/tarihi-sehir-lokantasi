/**
 * One order's history, assembled from the records the system already writes.
 *
 * The same domain action often lands in two places — an `order_events` row for
 * the operational timeline and an `audit_logs` row for the forensic trail — so
 * this module folds them into a single user-facing entry while keeping the
 * audit detail available. Nothing here invents an event.
 */

export const TIMELINE_SOURCES = [
  "ORDER_EVENT",
  "AUDIT_LOG",
  "PAYMENT",
  "REFUND",
  "CHECK",
] as const;

export type TimelineSource = (typeof TIMELINE_SOURCES)[number];

export interface OrderTimelineEntry {
  readonly id: string;
  readonly at: string;
  readonly type: string;
  readonly title: string;
  readonly description: string | null;
  readonly actorName: string | null;
  readonly actorRole: string | null;
  readonly amount: string | null;
  readonly productName: string | null;
  readonly reason: string | null;
  readonly source: TimelineSource;
}

/**
 * An event and an audit row describe the same thing when they share a type and
 * land within this window. Both are written inside one transaction, so any gap
 * is clock granularity rather than two real actions.
 */
export const DEDUP_WINDOW_MS = 2_000;

/** Audit actions that merely mirror an order event the timeline already shows. */
const AUDIT_MIRRORS: Readonly<Record<string, string>> = {
  ORDER_STATUS_CHANGED: "ORDER_STATUS",
  ORDER_ITEM_STATUS_CHANGED: "ITEM_STATUS",
  "staff.order.items_added": "ITEMS_ADDED",
  "order.item.cancelled": "ITEM_CANCELLED",
  "order.item.voided": "ITEM_VOIDED",
  "order.cancelled": "ORDER_CANCELLED",
  "payment.completed": "PAYMENT",
  "payment.partial_completed": "PAYMENT",
  "payment.refunded": "REFUND",
};

/** The canonical type an audit action maps onto, if it mirrors one. */
export function auditMirrorType(action: string): string | null {
  return AUDIT_MIRRORS[action] ?? null;
}

/**
 * Sorts chronologically and drops audit rows that only repeat an entry another
 * source already contributed. A duplicate is same-type, same-order and within
 * the transaction window; anything else is kept, because losing a real action
 * is worse than showing one extra line.
 */
export function mergeTimeline(
  entries: readonly OrderTimelineEntry[],
): readonly OrderTimelineEntry[] {
  const sorted = [...entries].sort((left, right) => {
    const byTime = Date.parse(left.at) - Date.parse(right.at);
    if (byTime !== 0) return byTime;
    // A richer source wins the tie so the surviving entry carries more detail.
    return sourceRank(left.source) - sourceRank(right.source);
  });

  const kept: OrderTimelineEntry[] = [];
  for (const entry of sorted) {
    if (entry.source !== "AUDIT_LOG") {
      kept.push(entry);
      continue;
    }
    const duplicate = kept.some(
      (existing) =>
        existing.source !== "AUDIT_LOG" &&
        existing.type === entry.type &&
        Math.abs(Date.parse(existing.at) - Date.parse(entry.at)) <= DEDUP_WINDOW_MS,
    );
    if (!duplicate) kept.push(entry);
  }
  return kept;
}

function sourceRank(source: TimelineSource): number {
  switch (source) {
    case "PAYMENT":
    case "REFUND":
      return 0;
    case "CHECK":
      return 1;
    case "ORDER_EVENT":
      return 2;
    default:
      return 3;
  }
}

const ORDER_EVENT_TITLES: Readonly<Record<string, string>> = {
  ORDER_CREATED: "Sipariş oluşturuldu",
  ORDER_CONFIRMED: "Sipariş onaylandı",
  ORDER_PREPARING: "Hazırlamaya alındı",
  ORDER_READY: "Hazırlandı",
  ORDER_SERVED: "Servis edildi",
  ORDER_COMPLETED: "Sipariş tamamlandı",
  ORDER_CANCELLED: "Sipariş iptal edildi",
  ORDER_ITEM_STATUS_CHANGED: "Kalem durumu değişti",
  ORDER_ITEMS_ADDED: "Ürün eklendi",
  ORDER_ITEM_CANCELLED: "Ürün iptal edildi",
  ORDER_ITEM_VOIDED: "Ürün hesaptan çıkarıldı",
  PAYMENT_RECORDED: "Kısmi ödeme alındı",
  PAYMENT_REFUNDED: "İade yapıldı",
  CHECK_CREATED: "Hesap bölündü",
  CHECK_PAID: "Hesap ödendi",
};

export function orderEventTitle(eventType: string): string {
  return ORDER_EVENT_TITLES[eventType] ?? eventType;
}

/** The canonical timeline type for an order event, used by the dedup pass. */
export function orderEventType(eventType: string): string {
  if (eventType.startsWith("ORDER_ITEM_STATUS")) return "ITEM_STATUS";
  if (eventType === "ORDER_ITEMS_ADDED") return "ITEMS_ADDED";
  if (eventType === "ORDER_ITEM_CANCELLED") return "ITEM_CANCELLED";
  if (eventType === "ORDER_ITEM_VOIDED") return "ITEM_VOIDED";
  if (eventType === "ORDER_CANCELLED") return "ORDER_CANCELLED";
  if (eventType === "PAYMENT_RECORDED") return "PAYMENT";
  if (eventType === "PAYMENT_REFUNDED") return "REFUND";
  if (eventType.startsWith("CHECK_")) return "CHECK";
  return "ORDER_STATUS";
}
