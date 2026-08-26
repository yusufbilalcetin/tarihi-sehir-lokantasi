import { redactString } from "@/lib/security/redaction";
import type { ClaimedOutboxEvent } from "@/lib/repositories/outbox-repository";
import type { RepositoryJsonObject, RepositoryJsonValue } from "@/lib/repositories/order-repository";

const EVENT_NAME = /^[A-Z][A-Z0-9_]{2,99}$/;
const AGGREGATE_NAME = /^[A-Z][A-Z0-9_]{1,79}$/;

const ORDER_FIELDS = [
  "orderId",
  "orderNumber",
  "tableId",
  "tableNumber",
  "status",
  "previousStatus",
  "version",
  "total",
  "currency",
  "updatedAt",
] as const;

const ORDER_ITEM_FIELDS = [
  "scope",
  "orderId",
  "orderNumber",
  "tableId",
  "orderItemId",
  "productName",
  "previousStatus",
  "status",
  "total",
  "currency",
  "version",
  "updatedAt",
] as const;

const ORDER_ITEMS_ADDED_FIELDS = [
  "orderId",
  "orderNumber",
  "tableId",
  "status",
  "addedItemCount",
  "total",
  "currency",
  "version",
  "updatedAt",
] as const;

/** A money signal, not a receipt: balances and ids, no method or actor. */
const PAYMENT_FIELDS = [
  "orderId",
  "orderNumber",
  "tableId",
  "tableNumber",
  "checkId",
  "status",
  "previousStatus",
  "version",
  "total",
  "paidTotal",
  "outstanding",
  "updatedAt",
] as const;

const CHECK_FIELDS = [
  "orderId",
  "orderNumber",
  "tableId",
  "checkId",
  "checkCount",
  "status",
  "mode",
  "updatedAt",
] as const;

/** Table moves publish ids and numbers only; no guest or money detail. */
const TABLE_FIELDS = [
  "tableId",
  "tableNumber",
  "sourceTableId",
  "sourceTableNumber",
  "targetTableId",
  "targetTableNumber",
  "movedOrderCount",
  "status",
  "updatedAt",
] as const;

const CALL_FIELDS = [
  "callId",
  "type",
  "status",
  "tableId",
  "tableName",
  "tableNumber",
  "createdAt",
  "resolvedAt",
] as const;

const PRODUCT_FIELDS = [
  "productId",
  "categoryId",
  "name",
  "isActive",
  "isAvailable",
  "isFeatured",
  "version",
  "updatedAt",
] as const;

const CATEGORY_FIELDS = [
  "categoryId",
  "name",
  "isActive",
  "updatedAt",
] as const;

const SAFE_FIELDS_BY_EVENT: Readonly<Record<string, readonly string[]>> = {
  ORDER_CREATED: ORDER_FIELDS,
  ORDER_CONFIRMED: ORDER_FIELDS,
  ORDER_PREPARING: ORDER_FIELDS,
  ORDER_READY: ORDER_FIELDS,
  ORDER_SERVED: ORDER_FIELDS,
  ORDER_COMPLETED: ORDER_FIELDS,
  ORDER_CANCELLED: ORDER_FIELDS,
  ORDER_ITEM_STATUS_CHANGED: ORDER_ITEM_FIELDS,
  ORDER_ITEM_CANCELLED: ORDER_ITEM_FIELDS,
  ORDER_ITEM_VOIDED: ORDER_ITEM_FIELDS,
  ORDER_ITEMS_ADDED: ORDER_ITEMS_ADDED_FIELDS,
  // Money events carry balances and ids only; never a method, actor or receipt.
  PAYMENT_RECORDED: PAYMENT_FIELDS,
  PAYMENT_REFUNDED: PAYMENT_FIELDS,
  CHECK_CREATED: CHECK_FIELDS,
  CHECK_UPDATED: CHECK_FIELDS,
  CHECK_PAID: PAYMENT_FIELDS,
  TABLE_TRANSFERRED: TABLE_FIELDS,
  TABLES_MERGED: TABLE_FIELDS,
  TABLE_RESET: TABLE_FIELDS,
  TABLE_NOTE_ADDED: CALL_FIELDS,
  WAITER_CALLED: CALL_FIELDS,
  WAITER_CALL_ACKNOWLEDGED: CALL_FIELDS,
  WAITER_CALL_RESOLVED: CALL_FIELDS,
  BILL_REQUESTED: CALL_FIELDS,
  BILL_REQUEST_ACKNOWLEDGED: CALL_FIELDS,
  BILL_REQUEST_RESOLVED: CALL_FIELDS,
  PRODUCT_CREATED: PRODUCT_FIELDS,
  PRODUCT_UPDATED: PRODUCT_FIELDS,
  PRODUCT_AVAILABILITY_CHANGED: PRODUCT_FIELDS,
  PRODUCT_ARCHIVED: PRODUCT_FIELDS,
  CATEGORY_UPDATED: CATEGORY_FIELDS,
};

export interface SafeRealtimeEventEnvelope {
  /** Stable id lets clients de-duplicate at-least-once outbox delivery. */
  readonly eventId: string;
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly occurredAt: string;
  /** Explicit event allowlists prevent whole database rows from escaping. */
  readonly data: RepositoryJsonObject;
}

function safeScalar(value: RepositoryJsonValue): RepositoryJsonValue | undefined {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  if (typeof value === "string") return redactString(value).slice(0, 512);
  return undefined;
}

export function projectRealtimePayload(
  eventType: string,
  payload: RepositoryJsonObject,
): RepositoryJsonObject {
  const allowedFields = SAFE_FIELDS_BY_EVENT[eventType] ?? [];
  const projected: RepositoryJsonObject = {};
  for (const key of allowedFields) {
    const value = payload[key];
    if (value === undefined) continue;
    const safeValue = safeScalar(value);
    if (safeValue !== undefined) projected[key] = safeValue;
  }
  return projected;
}

export function createSafeRealtimeEnvelope(
  event: ClaimedOutboxEvent,
): SafeRealtimeEventEnvelope {
  if (!EVENT_NAME.test(event.eventType)) {
    throw new TypeError("Outbox event type is not safe for Realtime.");
  }
  if (!AGGREGATE_NAME.test(event.aggregateType)) {
    throw new TypeError("Outbox aggregate type is not safe for Realtime.");
  }

  return {
    eventId: event.id,
    eventType: event.eventType,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    occurredAt: event.createdAt.toISOString(),
    data: projectRealtimePayload(event.eventType, event.payload),
  };
}
