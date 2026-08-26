import {
  addMoney,
  applyBasisPoints,
  minorToDecimal,
  percentageToBasisPoints,
  type MoneyMinor,
} from "./money";
import type { OrderItemStatus, OrderStatus, UserRole } from "./status";

/**
 * A round may still grow while the kitchen has not finished it. Once an order
 * is READY the remaining work is service, and once it is SERVED it is waiting
 * to be paid, so a later request becomes a new order on the same table rather
 * than a silent rewind of this one's status.
 */
export const ORDER_ADD_ITEM_STATUSES = [
  "NEW",
  "CONFIRMED",
  "PREPARING",
] as const satisfies readonly OrderStatus[];

export function canAddItemsToOrder(status: OrderStatus): boolean {
  return (ORDER_ADD_ITEM_STATUSES as readonly OrderStatus[]).includes(status);
}

/** Roles allowed to append items to an existing order. */
export const ORDER_ITEM_ADDER_ROLES = [
  "ADMIN",
  "MANAGER",
  "WAITER",
] as const satisfies readonly UserRole[];

export function canRoleAddOrderItems(role: UserRole): boolean {
  return (ORDER_ITEM_ADDER_ROLES as readonly UserRole[]).includes(role);
}

/**
 * Cancelling a line the kitchen has not touched is an ordinary service
 * correction. Once food is being cooked or is plated the cancellation carries a
 * cost, so it needs a manager. A served line is no longer a cancellation at
 * all — it needs a void/refund, which this phase deliberately does not build.
 */
const ITEM_CANCEL_ROLES: Readonly<Record<OrderItemStatus, readonly UserRole[]>> = {
  PENDING: ["ADMIN", "MANAGER", "WAITER"],
  PREPARING: ["ADMIN", "MANAGER"],
  READY: ["ADMIN", "MANAGER"],
  // A served line leaves the bill through the Phase 7 void flow instead.
  SERVED: [],
  CANCELLED: [],
  VOIDED: [],
};

export function rolesAllowedToCancelItem(status: OrderItemStatus): readonly UserRole[] {
  return ITEM_CANCEL_ROLES[status];
}

export function canRoleCancelOrderItem(role: UserRole, status: OrderItemStatus): boolean {
  return ITEM_CANCEL_ROLES[status].includes(role);
}

/** A stage whose cancellation the panel should confirm before sending. */
export function itemCancellationNeedsConfirmation(status: OrderItemStatus): boolean {
  return status === "PREPARING" || status === "READY";
}

/**
 * Whole-order cancellation follows the same forward-only status map: an order
 * that has been served is settled through payment or a future void, never
 * through this path.
 */
export const ORDER_CANCELLABLE_STATUSES = [
  "NEW",
  "CONFIRMED",
  "PREPARING",
  "READY",
] as const satisfies readonly OrderStatus[];

export function isOrderCancellable(status: OrderStatus): boolean {
  return (ORDER_CANCELLABLE_STATUSES as readonly OrderStatus[]).includes(status);
}

export const ORDER_CANCELLER_ROLES = [
  "ADMIN",
  "MANAGER",
] as const satisfies readonly UserRole[];

export function canRoleCancelOrder(role: UserRole): boolean {
  return (ORDER_CANCELLER_ROLES as readonly UserRole[]).includes(role);
}

/** Preset reasons the panel offers; free text stays allowed but bounded. */
export const CANCELLATION_REASONS = [
  "Müşteri vazgeçti",
  "Yanlış ürün girildi",
  "Ürün tükendi",
  "Mutfak hazırlayamadı",
  "Diğer",
] as const;

export type CancellationReason = (typeof CANCELLATION_REASONS)[number];

export const CANCELLATION_NOTE_MAX_LENGTH = 300;

export interface OrderAmountLine {
  readonly lineTotalMinor: MoneyMinor | number;
  readonly cancelled: boolean;
}

export interface OrderAmounts {
  readonly subtotal: string;
  readonly serviceCharge: string;
  readonly tax: string;
  readonly total: string;
}

/**
 * The single place order money is derived. Cancelled lines contribute nothing,
 * and the rates are the ones the order was opened with, so a later settings
 * change never re-prices an order that is already running.
 */
export function calculateOrderAmounts(
  lines: readonly OrderAmountLine[],
  serviceFeeRate: string,
  taxRate: string,
): OrderAmounts {
  const subtotalMinor = addMoney(
    ...lines.filter((line) => !line.cancelled).map((line) => line.lineTotalMinor),
  );
  const serviceChargeMinor = applyBasisPoints(
    subtotalMinor,
    percentageToBasisPoints(serviceFeeRate),
  );
  const taxBaseMinor = addMoney(subtotalMinor, serviceChargeMinor);
  const taxMinor = applyBasisPoints(taxBaseMinor, percentageToBasisPoints(taxRate));

  return {
    subtotal: minorToDecimal(subtotalMinor),
    serviceCharge: minorToDecimal(serviceChargeMinor),
    tax: minorToDecimal(taxMinor),
    total: minorToDecimal(addMoney(taxBaseMinor, taxMinor)),
  };
}
