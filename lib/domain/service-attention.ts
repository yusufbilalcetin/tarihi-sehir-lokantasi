import type { Order, OrderItem, RestaurantTable, TableStatus } from "@/types";

/**
 * What the floor is asking of a waiter, ranked.
 *
 * The waiter panel used to present every table as an equal tile, so "table 12's
 * food is going cold on the pass" and "table 3 is empty" competed for the same
 * glance. This module is the one place that decides what counts as needing a
 * person and in which order, so the mobile queue, the table cards and the
 * cockpit's ready rail cannot disagree about it.
 *
 * It is deliberately pure: no backend state is invented here, every reason is
 * derived from a status the API already returns.
 */

export type AttentionReason =
  | "order-ready"
  | "bill-requested"
  | "waiter-call"
  | "waiting-too-long";

/** Lower sorts first. Food going cold outranks a request that can be spoken to. */
const REASON_RANK: Readonly<Record<AttentionReason, number>> = {
  "order-ready": 0,
  "bill-requested": 1,
  "waiter-call": 2,
  "waiting-too-long": 3,
};

export const ATTENTION_LABELS: Readonly<Record<AttentionReason, string>> = {
  "order-ready": "Sipariş hazır",
  "bill-requested": "Hesap istedi",
  "waiter-call": "Garson çağırdı",
  "waiting-too-long": "Uzun süredir bekliyor",
};

/**
 * When an unserved order stops being "in progress" and starts being a problem.
 * The kitchen board already calls 15 minutes late, so the floor agrees with it.
 */
export const LONG_WAIT_MINUTES = 15;

export interface AttentionEntry {
  readonly tableId: string;
  readonly tableName: string;
  readonly reason: AttentionReason;
  readonly label: string;
  /** Minutes the table has been in this state; drives the queue's clock. */
  readonly waitingMinutes: number;
  readonly orderId?: string;
}

/**
 * The lines that are plated and still waiting to be carried.
 *
 * A round is rarely finished all at once: the soup is at the pass while the
 * main is still on the stove, which leaves the *order* preparing. Keying the
 * floor off the order's own status therefore hides plated food until the whole
 * ticket lands, and the dish goes cold with no screen saying so. The lines
 * know, so the floor asks them.
 */
export function readyOrderItems(order: Order): readonly OrderItem[] {
  return order.items.filter((item) => item.status === "ready");
}

/** Whether anything on this order is waiting on the pass right now. */
export function hasReadyFood(order: Order): boolean {
  // An order that carries no line detail is still trusted to its own status.
  return readyOrderItems(order).length > 0 || (order.status === "ready" && !order.items.length);
}

function orderIsUnserved(order: Order): boolean {
  return order.status === "pending" || order.status === "confirmed" || order.status === "preparing";
}

/**
 * The queue, most urgent first.
 *
 * A table appears at most once: a table whose food is ready *and* who asked for
 * the bill is one errand, and listing it twice would make the queue look longer
 * than the work actually is.
 */
export function buildAttentionQueue(
  tables: readonly RestaurantTable[],
  orders: readonly Order[],
): readonly AttentionEntry[] {
  const entries: AttentionEntry[] = [];

  for (const table of tables) {
    if (table.status === "inactive") continue;

    const tableOrders = orders.filter((order) => order.tableId === table.id);
    const readyOrder = tableOrders.find(hasReadyFood);
    const oldestUnserved = tableOrders
      .filter(orderIsUnserved)
      .sort((left, right) => right.elapsedMinutes - left.elapsedMinutes)[0];

    let reason: AttentionReason | null = null;
    let label: string | null = null;
    let waitingMinutes = table.activeMinutes ?? 0;
    let orderId: string | undefined;

    if (readyOrder) {
      reason = "order-ready";
      // Half a round is still an errand, but "Sipariş hazır" would send the
      // waiter for plates that are still on the stove. The row says what is
      // actually on the pass instead.
      const ready = readyOrderItems(readyOrder);
      label = readyOrder.items.some(
        (line) => line.status === "pending" || line.status === "preparing",
      )
        ? `${ready.length} ürün hazır`
        : ATTENTION_LABELS["order-ready"];
      waitingMinutes = readyOrder.elapsedMinutes;
      orderId = readyOrder.id;
    } else if (table.status === "bill-requested") {
      reason = "bill-requested";
    } else if (table.status === "waiter-call") {
      reason = "waiter-call";
    } else if (oldestUnserved && oldestUnserved.elapsedMinutes >= LONG_WAIT_MINUTES) {
      reason = "waiting-too-long";
      waitingMinutes = oldestUnserved.elapsedMinutes;
      orderId = oldestUnserved.id;
    }

    if (!reason) continue;
    entries.push({
      tableId: table.id,
      tableName: table.name,
      reason,
      label: label ?? ATTENTION_LABELS[reason],
      waitingMinutes,
      orderId,
    });
  }

  // Same reason: whoever has been waiting longest is served first.
  return entries.sort(
    (left, right) =>
      REASON_RANK[left.reason] - REASON_RANK[right.reason] ||
      right.waitingMinutes - left.waitingMinutes,
  );
}

/**
 * The word on a table card.
 *
 * These are UI labels over the API's own statuses — no status is invented and
 * none is dropped, so a state the backend can return can always be named.
 */
export const TABLE_STATUS_LABELS: Readonly<Record<TableStatus, string>> = {
  available: "Boş",
  occupied: "Aktif",
  ordering: "Sipariş veriyor",
  waiting: "Sipariş bekliyor",
  dining: "Serviste",
  "waiter-call": "Garson çağırdı",
  "bill-requested": "Hesap istedi",
  cleaning: "Hazırlanıyor",
  inactive: "Kapalı",
};

export type ServiceTone = "neutral" | "active" | "ready" | "waiting" | "bill" | "muted";

/**
 * Every tone is paired with a label and an icon at the call site, so colour is
 * never the only carrier of a table's state.
 */
export const TABLE_STATUS_TONES: Readonly<Record<TableStatus, ServiceTone>> = {
  available: "neutral",
  occupied: "active",
  ordering: "active",
  waiting: "waiting",
  dining: "active",
  "waiter-call": "waiting",
  "bill-requested": "bill",
  cleaning: "neutral",
  inactive: "muted",
};

/** Ready food overrides the table's own status on the card. */
export function resolveTableTone(status: TableStatus, hasReadyOrder: boolean): ServiceTone {
  return hasReadyOrder ? "ready" : TABLE_STATUS_TONES[status];
}

export function resolveTableLabel(status: TableStatus, hasReadyOrder: boolean): string {
  return hasReadyOrder ? "Hazır" : TABLE_STATUS_LABELS[status];
}

export interface ReadyOrderEntry {
  readonly orderId: string;
  readonly tableId: string | null;
  readonly tableName: string;
  /** Only the plated lines: a waiter must not be sent out with food still cooking. */
  readonly summary: string;
  readonly readyItemCount: number;
  /** True when the rest of the ticket is still in the kitchen. */
  readonly partial: boolean;
  readonly elapsedMinutes: number;
}

/** The pass queue: what is plated and waiting to be carried, oldest first. */
export function buildReadyQueue(orders: readonly Order[]): readonly ReadyOrderEntry[] {
  return orders.filter(hasReadyFood).map(toReadyEntry).sort(
    (left, right) => right.elapsedMinutes - left.elapsedMinutes,
  );
}

function toReadyEntry(order: Order): ReadyOrderEntry {
  const ready = readyOrderItems(order);
  return {
    orderId: order.id,
    tableId: order.tableId,
    tableName: order.tableName,
    summary: ready
      .map((item) => (item.quantity > 1 ? `${item.quantity}× ${item.productName}` : item.productName))
      .join(", "),
    readyItemCount: ready.length,
    partial: order.items.some(
      (item) => item.status === "pending" || item.status === "preparing",
    ),
    elapsedMinutes: order.elapsedMinutes,
  };
}
