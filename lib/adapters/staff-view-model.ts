import type {
  OrderItemStatus as DomainOrderItemStatus,
  OrderStatus as DomainOrderStatus,
} from "@/lib/domain/status";
import type { StaffCallPayload } from "@/lib/api/endpoints";
import type { StaffOrderListResult } from "@/lib/services/staff-order-service";
import type { StaffTableResult } from "@/lib/services/staff-table-service";
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
    createdAt: clockFormatter.format(new Date(order.createdAt)),
    elapsedMinutes: minutesSince(order.createdAt, now),
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

function relativeLabel(iso: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (seconds < 60) return `${seconds} saniye önce`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} dakika önce`;
  return `${Math.floor(minutes / 60)} saat önce`;
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
    createdAt: clockFormatter.format(new Date(call.createdAt)),
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
    qrAvailable: table.isActive && !table.qrRevoked,
    lastActivity: relativeLabel(table.lastActivityAt, now),
    orderId: activeOrder?.id,
  };
}
