import {
  addMoney,
  decimalToMinor,
  minorToDecimal,
  subtractMoney,
  type MoneyMinor,
} from "./money";
import type { OrderItemStatus, UserRole } from "./status";

/**
 * Void and refund are different corrections and are deliberately kept apart.
 *
 * VOID removes a line from a bill that has not been settled. The food may well
 * have been served; the guest is simply not going to pay for it.
 *
 * REFUND returns money that has already been collected. It never edits the
 * original payment — it is a second, opposite financial record.
 */

export const VOID_REASON_CODES = [
  "CUSTOMER_COMPLAINT",
  "WRONG_ITEM",
  "QUALITY_ISSUE",
  "STAFF_ERROR",
  "MANAGER_COMP",
  "OTHER",
] as const;

export type VoidReasonCode = (typeof VOID_REASON_CODES)[number];

export const REFUND_REASON_CODES = [
  "CUSTOMER_COMPLAINT",
  "WRONG_CHARGE",
  "QUALITY_ISSUE",
  "STAFF_ERROR",
  "OVERPAYMENT",
  "OTHER",
] as const;

export type RefundReasonCode = (typeof REFUND_REASON_CODES)[number];

export const FINANCIAL_NOTE_MAX_LENGTH = 300;

/** Voiding writes off food that was already produced, so it stays supervisory. */
export const VOID_ROLES = ["ADMIN", "MANAGER"] as const satisfies readonly UserRole[];

/**
 * A cashier may return money at the counter, which is where complaints surface.
 * Waiters and kitchen never touch settled money.
 */
export const REFUND_ROLES = [
  "ADMIN",
  "MANAGER",
  "CASHIER",
] as const satisfies readonly UserRole[];

export function canRoleVoidItem(role: UserRole): boolean {
  return (VOID_ROLES as readonly UserRole[]).includes(role);
}

/** Only a line that actually reached the guest can be voided off the bill. */
export function isItemVoidable(status: OrderItemStatus): boolean {
  return status === "SERVED";
}

/** A line that never reached the guest is cancelled, not voided. */
export function isItemBillable(status: OrderItemStatus): boolean {
  return status !== "CANCELLED" && status !== "VOIDED";
}

export interface PaymentLedgerEntry {
  /** Major-unit decimal exactly as stored. */
  readonly amount: string;
  readonly refundedAmount: string;
  readonly counted: boolean;
}

export interface OrderBalance {
  readonly payableTotal: string;
  readonly paidTotal: string;
  readonly refundedTotal: string;
  /** payable − (paid − refunded); zero means the order may close. */
  readonly outstanding: string;
  readonly settled: boolean;
}

/**
 * The single place an order's money position is derived. Refunds give money
 * back, which re-opens the balance: a fully refunded order is outstanding
 * again, exactly as it would be on paper.
 */
export function calculateOrderBalance(
  payableTotal: string,
  payments: readonly PaymentLedgerEntry[],
): OrderBalance {
  const payableMinor = decimalToMinor(payableTotal);
  const counted = payments.filter((payment) => payment.counted);
  const paidMinor = addMoney(...counted.map((payment) => decimalToMinor(payment.amount)));
  const refundedMinor = addMoney(
    ...counted.map((payment) => decimalToMinor(payment.refundedAmount)),
  );
  const netMinor = subtractMoney(paidMinor, refundedMinor);
  const outstandingMinor = subtractMoney(payableMinor, netMinor);

  return {
    payableTotal: minorToDecimal(payableMinor),
    paidTotal: minorToDecimal(paidMinor),
    refundedTotal: minorToDecimal(refundedMinor),
    outstanding: minorToDecimal(outstandingMinor),
    settled: outstandingMinor <= 0,
  };
}

/** What is still returnable on one payment: amount minus what already went back. */
export function refundableAmount(payment: {
  readonly amount: string;
  readonly refundedAmount: string;
}): string {
  return minorToDecimal(
    subtractMoney(decimalToMinor(payment.amount), decimalToMinor(payment.refundedAmount)),
  );
}

export type MoneyGuardFailure =
  | "NOT_POSITIVE"
  | "EXCEEDS_BALANCE"
  | "EXCEEDS_REFUNDABLE";

/** A collection may never take more than the order still owes. */
export function checkPaymentAmount(
  requested: string,
  outstanding: string,
): MoneyGuardFailure | null {
  const requestedMinor = decimalToMinor(requested);
  if (requestedMinor <= 0) return "NOT_POSITIVE";
  return requestedMinor > decimalToMinor(outstanding) ? "EXCEEDS_BALANCE" : null;
}

/** A refund may never return more than that payment still holds. */
export function checkRefundAmount(
  requested: string,
  refundable: string,
): MoneyGuardFailure | null {
  const requestedMinor = decimalToMinor(requested);
  if (requestedMinor <= 0) return "NOT_POSITIVE";
  return requestedMinor > decimalToMinor(refundable) ? "EXCEEDS_REFUNDABLE" : null;
}

/**
 * Splits an amount across N shares without losing a single minor unit: the
 * remainder is handed out one unit at a time to the earliest shares, so
 * 100.00 over three people becomes 33.34 / 33.33 / 33.33.
 */
export function splitEvenly(total: string, shares: number): readonly string[] {
  if (!Number.isSafeInteger(shares) || shares < 1 || shares > 50) {
    throw new RangeError("Share count must be between 1 and 50.");
  }
  const totalMinor = decimalToMinor(total);
  const base = Math.floor(totalMinor / shares);
  const remainder = totalMinor - base * shares;

  return Array.from({ length: shares }, (_unused, index) =>
    minorToDecimal((base + (index < remainder ? 1 : 0)) as MoneyMinor),
  );
}

export interface CheckAllocationLine {
  readonly orderItemId: string;
  readonly quantity: number;
  readonly unitPrice: string;
}

/** A check's own subtotal, derived from what it was allocated. */
export function calculateAllocationTotal(
  lines: readonly CheckAllocationLine[],
): string {
  return minorToDecimal(
    addMoney(
      ...lines.map((line) => (decimalToMinor(line.unitPrice) * line.quantity) as MoneyMinor),
    ),
  );
}

export type AllocationFailure =
  | "ITEM_NOT_BILLABLE"
  | "QUANTITY_NOT_POSITIVE"
  | "QUANTITY_EXCEEDS_AVAILABLE";

export interface AllocatableItem {
  readonly orderItemId: string;
  readonly status: OrderItemStatus;
  readonly quantity: number;
  /** Already handed to other checks. */
  readonly allocatedQuantity: number;
}

/**
 * A line may be shared across checks — two of three portions here, one there —
 * but the allocated quantities can never exceed what the guest actually
 * ordered, and a cancelled or voided line is not billable at all.
 */
export function checkAllocation(
  item: AllocatableItem,
  requestedQuantity: number,
): AllocationFailure | null {
  if (!isItemBillable(item.status)) return "ITEM_NOT_BILLABLE";
  if (!Number.isSafeInteger(requestedQuantity) || requestedQuantity < 1) {
    return "QUANTITY_NOT_POSITIVE";
  }
  return item.allocatedQuantity + requestedQuantity > item.quantity
    ? "QUANTITY_EXCEEDS_AVAILABLE"
    : null;
}
