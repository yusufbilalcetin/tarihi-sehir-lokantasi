import type { TableStatus, UserRole, WaiterCallType } from "./status";

/**
 * Moving a party is ordinary floor work, so a waiter may do it. Merging two
 * running tables and resetting a table are supervisory actions: both change how
 * a bill will be presented, so they stay with a manager.
 */
export const TABLE_TRANSFER_ROLES = [
  "ADMIN",
  "MANAGER",
  "WAITER",
] as const satisfies readonly UserRole[];

export const TABLE_MERGE_ROLES = ["ADMIN", "MANAGER"] as const satisfies readonly UserRole[];

export const TABLE_RESET_ROLES = ["ADMIN", "MANAGER"] as const satisfies readonly UserRole[];

export type TableOperation = "TRANSFER" | "MERGE" | "RESET";

const OPERATION_ROLES: Readonly<Record<TableOperation, readonly UserRole[]>> = {
  TRANSFER: TABLE_TRANSFER_ROLES,
  MERGE: TABLE_MERGE_ROLES,
  RESET: TABLE_RESET_ROLES,
};

export function canRoleRunTableOperation(role: UserRole, operation: TableOperation): boolean {
  return OPERATION_ROLES[operation].includes(role);
}

/** Order states that keep a table occupied, mirroring the floor read model. */
export const OPEN_ORDER_STATUSES = [
  "NEW",
  "CONFIRMED",
  "PREPARING",
  "READY",
  "SERVED",
] as const;

/**
 * Everything that must be clear before a table may be reset to AVAILABLE.
 *
 * All of these describe the table's *current* session. A historically closed
 * order is deliberately not represented here: a refund taken weeks after a
 * table was settled re-opens that order's ledger balance, and letting it block
 * the reset would strand the table forever.
 */
export interface TableResetBlockers {
  /** Orders still in the kitchen/service window (anything before SERVED). */
  readonly openOrderCount: number;
  /** Minor units still owed across the table's unclosed orders. */
  readonly outstandingBalanceMinor: number;
  readonly openCheckCount: number;
  readonly partiallyPaidCheckCount: number;
  readonly pendingPaymentCount: number;
  readonly openCallCount: number;
}

export type TableResetBlockReason =
  | "OPEN_ORDER"
  | "OUTSTANDING_BALANCE"
  | "OPEN_CHECK"
  | "PARTIAL_CHECK"
  | "PENDING_PAYMENT"
  | "OPEN_SERVICE_REQUEST";

/**
 * Reset is a cleanup of an already-settled table, never a way to make an open
 * bill disappear. A manager override is deliberately not offered: every blocker
 * below is a financial or service record, and the way to clear one is to
 * finish it. The order matters — the most financial reason is reported first.
 */
export function tableResetBlockReason(
  blockers: TableResetBlockers,
): TableResetBlockReason | null {
  if (blockers.openOrderCount > 0) return "OPEN_ORDER";
  if (blockers.outstandingBalanceMinor > 0) return "OUTSTANDING_BALANCE";
  if (blockers.partiallyPaidCheckCount > 0) return "PARTIAL_CHECK";
  if (blockers.openCheckCount > 0) return "OPEN_CHECK";
  if (blockers.pendingPaymentCount > 0) return "PENDING_PAYMENT";
  if (blockers.openCallCount > 0) return "OPEN_SERVICE_REQUEST";
  return null;
}

/**
 * A table's operational status is derived, never set by a client. These are the
 * only sources that decide it: an open bill request outranks a waiter call,
 * which outranks merely having a running order.
 */
export function deriveTableStatus(input: {
  readonly isActive: boolean;
  readonly openOrderCount: number;
  readonly activeCallTypes: readonly WaiterCallType[];
}): TableStatus {
  if (!input.isActive) return "INACTIVE";
  if (input.activeCallTypes.includes("BILL_REQUEST")) return "BILL_REQUESTED";
  if (input.activeCallTypes.includes("WAITER_CALL")) return "WAITER_CALL";
  return input.openOrderCount > 0 ? "OCCUPIED" : "AVAILABLE";
}

export const TABLE_RESET_BLOCK_MESSAGES: Readonly<Record<TableResetBlockReason, string>> = {
  OPEN_ORDER: "Bu masada açık sipariş bulunuyor.",
  OUTSTANDING_BALANCE: "Bu masada ödenmemiş bakiye bulunuyor.",
  PARTIAL_CHECK: "Bu masada kısmen ödenmiş bölünmüş hesap bulunuyor.",
  OPEN_CHECK: "Bu masada açık bölünmüş hesaplar bulunuyor.",
  PENDING_PAYMENT: "Bu masada bekleyen bir ödeme bulunuyor.",
  OPEN_SERVICE_REQUEST: "Bu masada açık bir servis isteği bulunuyor.",
};
