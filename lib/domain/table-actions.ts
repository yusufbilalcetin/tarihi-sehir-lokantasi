import {
  canRoleTransitionOrderStatus,
  type OrderStatus,
  type UserRole,
  type WaiterCallType,
} from "./status";

/**
 * The six table-card shortcuts. Ids are stable; the Turkish labels are the ones
 * the waiter panel has always shown and are part of the operator's muscle
 * memory, so they stay fixed here rather than being derived per state.
 */
export const TABLE_QUICK_ACTION_IDS = [
  "add-order",
  "confirm-order",
  "mark-served",
  "waiter-call",
  "bill-request",
  "table-note",
] as const;

export type TableQuickActionId = (typeof TABLE_QUICK_ACTION_IDS)[number];

/** Roles allowed to open an order on a guest's behalf. */
export const ORDER_CREATOR_ROLES = [
  "ADMIN",
  "MANAGER",
  "WAITER",
] as const satisfies readonly UserRole[];

/** Roles allowed to open or clear a service request. Mirrors StaffCallService. */
export const CALL_HANDLER_ROLES = [
  "ADMIN",
  "MANAGER",
  "WAITER",
  "CASHIER",
] as const satisfies readonly UserRole[];

export const TABLE_NOTE_LABEL = "Masa notu";

const CALL_ACTION_TYPES: Readonly<Record<string, WaiterCallType>> = {
  "waiter-call": "WAITER_CALL",
  "bill-request": "BILL_REQUEST",
  "table-note": "OTHER",
};

export interface TableQuickActionOrder {
  readonly id: string;
  readonly status: OrderStatus;
}

export interface TableQuickActionCall {
  readonly id: string;
  readonly type: WaiterCallType;
}

export interface TableQuickActionContext {
  readonly role: UserRole;
  readonly tableActive: boolean;
  /** Server-resolved active order for the table, or null when none is open. */
  readonly order: TableQuickActionOrder | null;
  /** Calls in OPEN or ACKNOWLEDGED state for this table only. */
  readonly openCalls: readonly TableQuickActionCall[];
}

export type TableQuickActionIntent =
  | { readonly kind: "CREATE_ORDER" }
  | { readonly kind: "ORDER_STATUS"; readonly orderId: string; readonly nextStatus: OrderStatus }
  | { readonly kind: "CREATE_CALL"; readonly callType: WaiterCallType }
  | { readonly kind: "RESOLVE_CALL"; readonly callId: string; readonly callType: WaiterCallType };

export interface TableQuickAction {
  readonly id: TableQuickActionId;
  readonly enabled: boolean;
  /** Operator-facing explanation shown on the disabled control. */
  readonly disabledReason: string | null;
  readonly intent: TableQuickActionIntent;
}

function callIntent(
  id: TableQuickActionId,
  context: TableQuickActionContext,
): TableQuickActionIntent {
  const callType = CALL_ACTION_TYPES[id];
  const open = context.openCalls.find((call) => call.type === callType);
  return open
    ? { kind: "RESOLVE_CALL", callId: open.id, callType }
    : { kind: "CREATE_CALL", callType };
}

function callAvailability(
  intent: TableQuickActionIntent,
  role: UserRole,
): string | null {
  if (!CALL_HANDLER_ROLES.includes(role as (typeof CALL_HANDLER_ROLES)[number])) {
    return "Servis isteklerini yönetme yetkiniz yok.";
  }
  // A cashier's scope is the bill, matching the service-layer restriction.
  const callType = intent.kind === "CREATE_CALL" || intent.kind === "RESOLVE_CALL"
    ? intent.callType
    : null;
  if (role === "CASHIER" && callType !== "BILL_REQUEST") {
    return "Kasa yalnızca hesap taleplerini yönetebilir.";
  }
  return null;
}

function orderStatusAction(
  id: TableQuickActionId,
  context: TableQuickActionContext,
  nextStatus: Extract<OrderStatus, "CONFIRMED" | "SERVED">,
  emptyReason: string,
  wrongStageReason: string,
): TableQuickAction {
  const order = context.order;
  const intent: TableQuickActionIntent = {
    kind: "ORDER_STATUS",
    orderId: order?.id ?? "",
    nextStatus,
  };
  if (!order) return { id, enabled: false, disabledReason: emptyReason, intent };
  if (!canRoleTransitionOrderStatus(context.role, order.status, nextStatus)) {
    return { id, enabled: false, disabledReason: wrongStageReason, intent };
  }
  return { id, enabled: true, disabledReason: null, intent };
}

/**
 * One policy for the six shortcuts, shared by the table card and the Phase 5
 * tests. The API re-derives every rule server-side; this only decides what the
 * panel offers so a waiter is not sent into a request the server will reject.
 */
export function resolveTableQuickActions(
  context: TableQuickActionContext,
): readonly TableQuickAction[] {
  const inactive = !context.tableActive ? "Masa servis dışı." : null;

  return TABLE_QUICK_ACTION_IDS.map((id): TableQuickAction => {
    if (id === "add-order") {
      const intent: TableQuickActionIntent = { kind: "CREATE_ORDER" };
      if (inactive) return { id, enabled: false, disabledReason: inactive, intent };
      if (!ORDER_CREATOR_ROLES.includes(context.role as (typeof ORDER_CREATOR_ROLES)[number])) {
        return { id, enabled: false, disabledReason: "Sipariş açma yetkiniz yok.", intent };
      }
      return { id, enabled: true, disabledReason: null, intent };
    }

    if (id === "confirm-order" || id === "mark-served") {
      const action = id === "confirm-order"
        ? orderStatusAction(
            id,
            context,
            "CONFIRMED",
            "Onaylanacak sipariş yok.",
            "Sipariş bu aşamada onaylanamaz.",
          )
        : orderStatusAction(
            id,
            context,
            "SERVED",
            "Servis edilecek sipariş yok.",
            "Sipariş henüz servise hazır değil.",
          );
      return inactive ? { ...action, enabled: false, disabledReason: inactive } : action;
    }

    const intent = callIntent(id, context);
    const reason = inactive ?? callAvailability(intent, context.role);
    return { id, enabled: !reason, disabledReason: reason, intent };
  });
}
