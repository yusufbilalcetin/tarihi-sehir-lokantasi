export const USER_ROLES = [
  "ADMIN",
  "MANAGER",
  "WAITER",
  "KITCHEN",
  "CASHIER",
] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const UserRole = {
  ADMIN: "ADMIN",
  MANAGER: "MANAGER",
  WAITER: "WAITER",
  KITCHEN: "KITCHEN",
  CASHIER: "CASHIER",
} as const satisfies Record<UserRole, UserRole>;

export const ORDER_STATUSES = [
  "NEW",
  "CONFIRMED",
  "PREPARING",
  "READY",
  "SERVED",
  "COMPLETED",
  "CANCELLED",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * Where an order is served. Dine-in is the default because it is what the
 * restaurant did before takeaway and courier existed, and because every order
 * already in the database was one.
 */
export const ORDER_CHANNELS = ["DINE_IN", "TAKEAWAY", "DELIVERY"] as const;

export type OrderChannel = (typeof ORDER_CHANNELS)[number];

/** The channels that have no table, and must not be given one. */
export const TABLELESS_ORDER_CHANNELS: readonly OrderChannel[] = ["TAKEAWAY", "DELIVERY"];

export function orderRequiresTable(channel: OrderChannel): boolean {
  return channel === "DINE_IN";
}

export const OrderStatus = {
  NEW: "NEW",
  CONFIRMED: "CONFIRMED",
  PREPARING: "PREPARING",
  READY: "READY",
  SERVED: "SERVED",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
} as const satisfies Record<OrderStatus, OrderStatus>;

export const ORDER_ITEM_STATUSES = [
  "PENDING",
  "PREPARING",
  "READY",
  "SERVED",
  "CANCELLED",
  /** Served, then written off the bill. Distinct from never having been made. */
  "VOIDED",
] as const;

export type OrderItemStatus = (typeof ORDER_ITEM_STATUSES)[number];

export const OrderItemStatus = {
  PENDING: "PENDING",
  PREPARING: "PREPARING",
  READY: "READY",
  SERVED: "SERVED",
  CANCELLED: "CANCELLED",
  VOIDED: "VOIDED",
} as const satisfies Record<OrderItemStatus, OrderItemStatus>;

export const WAITER_CALL_TYPES = ["WAITER_CALL", "BILL_REQUEST", "OTHER"] as const;
export type WaiterCallType = (typeof WAITER_CALL_TYPES)[number];

export const WaiterCallType = {
  WAITER_CALL: "WAITER_CALL",
  BILL_REQUEST: "BILL_REQUEST",
  OTHER: "OTHER",
} as const satisfies Record<WaiterCallType, WaiterCallType>;

export const WAITER_CALL_STATUSES = [
  "OPEN",
  "ACKNOWLEDGED",
  "RESOLVED",
  "CANCELLED",
] as const;

export type WaiterCallStatus = (typeof WAITER_CALL_STATUSES)[number];

export const WaiterCallStatus = {
  OPEN: "OPEN",
  ACKNOWLEDGED: "ACKNOWLEDGED",
  RESOLVED: "RESOLVED",
  CANCELLED: "CANCELLED",
} as const satisfies Record<WaiterCallStatus, WaiterCallStatus>;

export const PAYMENT_STATUSES = [
  "PENDING",
  "COMPLETED",
  "FAILED",
  "REFUNDED",
  "CANCELLED",
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PaymentStatus = {
  PENDING: "PENDING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  REFUNDED: "REFUNDED",
  CANCELLED: "CANCELLED",
} as const satisfies Record<PaymentStatus, PaymentStatus>;

export const PAYMENT_METHODS = ["CASH", "CARD", "OTHER"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PaymentMethod = {
  CASH: "CASH",
  CARD: "CARD",
  OTHER: "OTHER",
} as const satisfies Record<PaymentMethod, PaymentMethod>;

export const TABLE_STATUSES = [
  "AVAILABLE",
  "OCCUPIED",
  "ORDERING",
  "WAITING",
  "DINING",
  "WAITER_CALL",
  "BILL_REQUESTED",
  "CLEANING",
  "INACTIVE",
] as const;

export type TableStatus = (typeof TABLE_STATUSES)[number];

export const TableStatus = {
  AVAILABLE: "AVAILABLE",
  OCCUPIED: "OCCUPIED",
  ORDERING: "ORDERING",
  WAITING: "WAITING",
  DINING: "DINING",
  WAITER_CALL: "WAITER_CALL",
  BILL_REQUESTED: "BILL_REQUESTED",
  CLEANING: "CLEANING",
  INACTIVE: "INACTIVE",
} as const satisfies Record<TableStatus, TableStatus>;

export const ORDER_EVENT_TYPES = [
  "ORDER_CREATED",
  "ORDER_CONFIRMED",
  "ORDER_PREPARING",
  "ORDER_READY",
  "ORDER_SERVED",
  "ORDER_COMPLETED",
  "ORDER_CANCELLED",
  "ORDER_ITEM_STATUS_CHANGED",
  "ORDER_ITEMS_ADDED",
  "ORDER_ITEM_CANCELLED",
  "ORDER_ITEM_VOIDED",
  "PAYMENT_RECORDED",
  "PAYMENT_REFUNDED",
  "CHECK_CREATED",
  "CHECK_PAID",
] as const;

export type OrderEventType = (typeof ORDER_EVENT_TYPES)[number];

export const KITCHEN_TICKET_STATUSES = [
  "NEW",
  "PREPARING",
  "READY",
  "CLOSED",
  "CANCELLED",
] as const;

export type KitchenTicketStatus = (typeof KITCHEN_TICKET_STATUSES)[number];

export type StatusTransitionMap<TStatus extends string> = Readonly<
  Record<TStatus, readonly TStatus[]>
>;

export const ORDER_STATUS_TRANSITIONS = {
  NEW: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PREPARING", "CANCELLED"],
  PREPARING: ["READY", "CANCELLED"],
  READY: ["SERVED", "CANCELLED"],
  SERVED: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
} as const satisfies StatusTransitionMap<OrderStatus>;

/**
 * The statuses an order can still move out of — what the kitchen and the floor
 * still owe a table. Derived from the transition map rather than listed again,
 * so a new stage cannot be forgotten here and quietly vanish from live screens.
 */
export const OPEN_ORDER_STATUSES: readonly OrderStatus[] = ORDER_STATUSES.filter(
  (status) => ORDER_STATUS_TRANSITIONS[status].length > 0,
);

export const ORDER_ITEM_STATUS_TRANSITIONS = {
  PENDING: ["PREPARING", "CANCELLED"],
  // The backward edges exist so the kitchen can correct its own mistake: a line
  // started by accident goes back to the queue, a line marked ready too early
  // goes back to the pass. They stop at SERVED — once the food has reached the
  // guest the correction is a void, not a status change.
  PREPARING: ["READY", "PENDING", "CANCELLED"],
  READY: ["SERVED", "PREPARING", "CANCELLED"],
  // A served line leaves the bill through a void, never through cancellation.
  SERVED: ["VOIDED"],
  CANCELLED: [],
  VOIDED: [],
} as const satisfies StatusTransitionMap<OrderItemStatus>;

/** The two corrections above, named so callers stop re-deriving them. */
export function isOrderItemRollback(
  current: OrderItemStatus,
  next: OrderItemStatus,
): boolean {
  return (
    (current === "PREPARING" && next === "PENDING") ||
    (current === "READY" && next === "PREPARING")
  );
}

export const WAITER_CALL_STATUS_TRANSITIONS = {
  OPEN: ["ACKNOWLEDGED", "RESOLVED", "CANCELLED"],
  ACKNOWLEDGED: ["RESOLVED", "CANCELLED"],
  RESOLVED: [],
  CANCELLED: [],
} as const satisfies StatusTransitionMap<WaiterCallStatus>;

export const PAYMENT_STATUS_TRANSITIONS = {
  PENDING: ["COMPLETED", "FAILED", "CANCELLED"],
  COMPLETED: ["REFUNDED"],
  FAILED: [],
  REFUNDED: [],
  CANCELLED: [],
} as const satisfies StatusTransitionMap<PaymentStatus>;

export type InvalidTransitionReason =
  | "SAME_STATUS"
  | "TERMINAL_STATUS"
  | "TRANSITION_NOT_ALLOWED";

export type StatusTransitionValidation<TStatus extends string> =
  | {
      valid: true;
      current: TStatus;
      next: TStatus;
    }
  | {
      valid: false;
      current: TStatus;
      next: TStatus;
      allowed: readonly TStatus[];
      reason: InvalidTransitionReason;
    };

export function validateStatusTransition<TStatus extends string>(
  transitions: StatusTransitionMap<TStatus>,
  current: TStatus,
  next: TStatus,
): StatusTransitionValidation<TStatus> {
  const allowed = transitions[current];

  if (current === next) {
    return { valid: false, current, next, allowed, reason: "SAME_STATUS" };
  }

  if (allowed.includes(next)) {
    return { valid: true, current, next };
  }

  return {
    valid: false,
    current,
    next,
    allowed,
    reason: allowed.length === 0 ? "TERMINAL_STATUS" : "TRANSITION_NOT_ALLOWED",
  };
}

export function canTransitionOrderStatus(current: OrderStatus, next: OrderStatus): boolean {
  return validateStatusTransition(ORDER_STATUS_TRANSITIONS, current, next).valid;
}

export function canTransitionOrderItemStatus(
  current: OrderItemStatus,
  next: OrderItemStatus,
): boolean {
  return validateStatusTransition(ORDER_ITEM_STATUS_TRANSITIONS, current, next).valid;
}

export function canTransitionWaiterCallStatus(
  current: WaiterCallStatus,
  next: WaiterCallStatus,
): boolean {
  return validateStatusTransition(WAITER_CALL_STATUS_TRANSITIONS, current, next).valid;
}

export function canTransitionPaymentStatus(
  current: PaymentStatus,
  next: PaymentStatus,
): boolean {
  return validateStatusTransition(PAYMENT_STATUS_TRANSITIONS, current, next).valid;
}

/**
 * Operational status permissions are edge-based, not destination-based. This
 * prevents a cashier from completing an order that has not been served and a
 * waiter from moving an order through kitchen-only preparation states.
 * It lives in the pure domain layer so panels can hide actions the API would
 * reject without duplicating the policy.
 */
export function canRoleTransitionOrderStatus(
  role: UserRole,
  current: OrderStatus,
  next: OrderStatus,
): boolean {
  if (!validateStatusTransition(ORDER_STATUS_TRANSITIONS, current, next).valid) return false;
  if (role === "ADMIN" || role === "MANAGER") return true;
  if (role === "WAITER") {
    return (current === "NEW" && next === "CONFIRMED") ||
      (current === "READY" && next === "SERVED");
  }
  if (role === "KITCHEN") {
    return (current === "CONFIRMED" && next === "PREPARING") ||
      (current === "PREPARING" && next === "READY");
  }
  return role === "CASHIER" && current === "SERVED" && next === "COMPLETED";
}

export function canRoleTransitionOrderItemStatus(
  role: UserRole,
  current: OrderItemStatus,
  next: OrderItemStatus,
): boolean {
  if (!validateStatusTransition(ORDER_ITEM_STATUS_TRANSITIONS, current, next).valid) return false;
  // Cancelling and voiding are financial corrections with their own endpoints,
  // reasons and role rules; the kitchen status route never performs them.
  if (next === "CANCELLED" || next === "VOIDED") return false;
  if (role === "ADMIN" || role === "MANAGER") return true;
  if (role === "KITCHEN") {
    return (current === "PENDING" && next === "PREPARING") ||
      (current === "PREPARING" && next === "READY") ||
      // Correcting its own preparation state is the kitchen's own business.
      isOrderItemRollback(current, next);
  }
  // The floor serves; it does not reach back into preparation, and neither
  // does the till.
  return role === "WAITER" && current === "READY" && next === "SERVED";
}

/** An item may only move while its parent order is in a compatible stage. */
export function isOrderStageCompatibleWithItemTransition(
  orderStatus: OrderStatus,
  current: OrderItemStatus,
  next: OrderItemStatus,
): boolean {
  if (current === "PENDING" && next === "PREPARING") {
    return orderStatus === "CONFIRMED" || orderStatus === "PREPARING";
  }
  if (current === "PREPARING" && next === "READY") {
    return orderStatus === "PREPARING" || orderStatus === "READY";
  }
  if (current === "READY" && next === "SERVED") {
    return orderStatus === "READY" || orderStatus === "SERVED";
  }
  // A correction is allowed wherever the order is still open in the kitchen or
  // on the floor. It is refused on a closed order by the caller, which is what
  // keeps a settled bill from moving.
  if (isOrderItemRollback(current, next)) {
    return (
      orderStatus === "CONFIRMED" ||
      orderStatus === "PREPARING" ||
      orderStatus === "READY" ||
      orderStatus === "SERVED"
    );
  }
  return false;
}

/**
 * Which kitchen column an order belongs in, derived from its lines.
 *
 * The order's own status answers "how far has this order got"; the board asks a
 * different question — "what does the kitchen still owe this table" — and only
 * the lines can answer it. A late line added to an order whose earlier lines are
 * ready pulls the ticket back into the queue, which is exactly what the pass
 * needs to see. Cancelled and voided lines are not kitchen work and are ignored.
 */
export function deriveKitchenStage(
  items: readonly { readonly status: OrderItemStatus }[],
): "PENDING" | "PREPARING" | "READY" | null {
  const live = items.filter(
    (item) => item.status !== "CANCELLED" && item.status !== "VOIDED",
  );
  const outstanding = live.filter((item) => item.status !== "SERVED");
  if (outstanding.length === 0) return null;
  if (outstanding.some((item) => item.status === "PENDING")) return "PENDING";
  if (outstanding.some((item) => item.status === "PREPARING")) return "PREPARING";
  return "READY";
}
