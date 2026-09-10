import type {
  OrderItemStatus as DomainOrderItemStatus,
  OrderStatus as DomainOrderStatus,
} from "@/lib/domain/status";
import type { StaffCallPayload } from "@/lib/api/endpoints";
import type { StaffOrderListResult } from "@/lib/services/staff-order-service";
import type { StaffTableResult } from "@/lib/services/staff-table-service";
import { formatElapsed } from "@/lib/format";
import type {
  Order,
  OrderItemStatus,
  OrderStatus,
  RestaurantTable,
  TableStatus,
  WaiterCall,
  WaiterCallType,
} from "@/types";

/** Panels were built on lowercase view statuses; the database uses uppercase. */
const ORDER_STATUS_TO_VIEW: Record<string, OrderStatus> = {
  NEW: "pending",
  CONFIRMED: "confirmed",
  PREPARING: "preparing",
  READY: "ready",
  SERVED: "served",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
};

const VIEW_STATUS_TO_ORDER: Record<OrderStatus, DomainOrderStatus> = {
  pending: "NEW",
  confirmed: "CONFIRMED",
  preparing: "PREPARING",
  ready: "READY",
  served: "SERVED",
  completed: "COMPLETED",
  cancelled: "CANCELLED",
};

const ITEM_STATUS_TO_VIEW: Record<string, OrderItemStatus> = {
  PENDING: "pending",
  PREPARING: "preparing",
  READY: "ready",
  SERVED: "served",
  CANCELLED: "cancelled",
  VOIDED: "voided",
};

const VIEW_STATUS_TO_ITEM: Record<OrderItemStatus, DomainOrderItemStatus> = {
  pending: "PENDING",
  preparing: "PREPARING",
  ready: "READY",
  served: "SERVED",
  cancelled: "CANCELLED",
  voided: "VOIDED",
};

export function toApiOrderItemStatus(status: OrderItemStatus): DomainOrderItemStatus {
  return VIEW_STATUS_TO_ITEM[status];
}

const CALL_STATUS_TO_VIEW: Record<string, WaiterCall["status"]> = {
  OPEN: "open",
  ACKNOWLEDGED: "assigned",
  RESOLVED: "resolved",
  CANCELLED: "resolved",
};

export function toApiOrderStatus(status: OrderStatus): DomainOrderStatus {
  return VIEW_STATUS_TO_ORDER[status];
}

const clockFormatter = new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" });

/**
 * A wall-clock time for a screen, or a dash when there is no honest one.
 *
 * `Intl.DateTimeFormat.format` throws a RangeError on an invalid Date, and
 * these adapters fed it the API string directly. A single malformed timestamp
 * would therefore take down whichever board rendered it — the kitchen ticket
 * list, the order list or the calls list — rather than losing one line of one
 * row. Every clock label in this file goes through here.
 *
 * The dash is the same convention `Money` uses for a value that is not there:
 * a missing time is stated as missing, never invented and never "Invalid Date".
 */
function clockLabel(iso: string): string {
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? "—" : clockFormatter.format(parsed);
}

function minutesSince(iso: string, now: number): number {
  const started = Date.parse(iso);
  if (Number.isNaN(started)) return 0;
  return Math.max(0, Math.floor((now - started) / 60_000));
}

export function staffOrderToViewModel(
  order: StaffOrderListResult,
  now: number = Date.now(),
): Order {
  return {
    id: order.id,
    orderNumber: `#${order.orderNumber}`,
    tableId: order.table?.id ?? null,
    tableName: order.placeLabel,
    createdAt: clockLabel(order.createdAt),
    elapsedMinutes: minutesSince(order.createdAt, now),
    version: order.version,
    outstanding: order.outstanding,
    status: ORDER_STATUS_TO_VIEW[order.status] ?? "pending",
    total: Number(order.amounts.total),
    note: order.notes ?? undefined,
    items: order.items.map((item) => ({
      id: item.id,
      productId: item.id,
      productName: item.productName,
      quantity: item.quantity,
      unitPrice: Number(item.unitPrice),
      note: item.notes ?? undefined,
      status: ITEM_STATUS_TO_VIEW[item.status] ?? "pending",
    })),
  };
}

const CALL_TYPE_LABELS: Record<string, WaiterCallType> = {
  BILL_REQUEST: "Hesap istiyor",
  WAITER_CALL: "Garson çağır",
  OTHER: "Diğer",
};

const KNOWN_REQUEST_LABELS = new Set<string>([
  "Garson çağır",
  "Sipariş vereceğim",
  "Su istiyorum",
  "Ekmek istiyorum",
  "Ek servis istiyorum",
  "Hesap istiyor",
  "Masa notu",
  "Diğer",
]);

/**
 * How fresh a request is, in the words the floor actually uses.
 *
 * Durations everywhere else go through `formatElapsed`, and this did too — but
 * `formatElapsed` floors to whole minutes, so a call raised twelve seconds ago
 * read "0 dk önce" on the one screen whose entire job is making the newest
 * request stand out. Under a minute the honest answer is that it just
 * happened; from a minute on, the shared formatter takes over unchanged.
 *
 * An unparseable timestamp lands here too: "az önce" is closer to the truth
 * than a fabricated zero, and it can never read as a stale call.
 */
function relativeLabel(iso: string, now: number): string {
  const started = Date.parse(iso);
  if (Number.isNaN(started) || now - started < 60_000) return "az önce";
  return `${formatElapsed(minutesSince(iso, now))} önce`;
}

export function staffCallToViewModel(
  call: StaffCallPayload,
  now: number = Date.now(),
): WaiterCall {
  // Guests pick a fixed request label; anything else falls back to the type.
  const label = call.requestLabel ?? call.notes ?? "";
  const type = KNOWN_REQUEST_LABELS.has(label)
    ? (label as WaiterCallType)
    : CALL_TYPE_LABELS[call.type] ?? "Diğer";

  return {
    id: call.id,
    tableId: call.table.id,
    tableName: call.table.name,
    type,
    elapsed: relativeLabel(call.createdAt, now),
    createdAt: clockLabel(call.createdAt),
    status: CALL_STATUS_TO_VIEW[call.status] ?? "open",
  };
}

const TABLE_STATUS_TO_VIEW: Record<string, TableStatus> = {
  AVAILABLE: "available",
  OCCUPIED: "occupied",
  ORDERING: "ordering",
  WAITING: "waiting",
  DINING: "dining",
  WAITER_CALL: "waiter-call",
  BILL_REQUESTED: "bill-requested",
  CLEANING: "cleaning",
  INACTIVE: "inactive",
};

export function staffTableToViewModel(
  table: StaffTableResult,
  now: number = Date.now(),
): RestaurantTable {
  const activeOrder = table.activeOrder;
  return {
    id: table.id,
    name: table.name,
    status: table.isActive ? TABLE_STATUS_TO_VIEW[table.status] ?? "available" : "inactive",
    seats: table.seats,
    openedAt: activeOrder?.createdAt,
    activeMinutes: activeOrder ? minutesSince(activeOrder.createdAt, now) : undefined,
    total: activeOrder ? Number(activeOrder.total) : undefined,
    // QR access is independently pausable; table service and QR state must not
    // collapse into one switch.
    qrAvailable: !table.qrRevoked,
    lastActivity: relativeLabel(table.lastActivityAt, now),
    orderId: activeOrder?.id,
  };
}
