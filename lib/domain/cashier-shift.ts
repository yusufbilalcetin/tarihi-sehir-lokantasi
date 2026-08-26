import { addMoney, decimalToMinor, minorToDecimal, subtractMoney } from "./money";
import type { PaymentMethod, UserRole } from "./status";

/**
 * A cashier shift is an *accountability period*, not a table lifecycle and not
 * a sales period.
 *
 * Two distinctions carry the whole model:
 *
 * 1. **Collection, not sales.** An order opened during the lunch shift and paid
 *    during the dinner shift belongs to dinner's drawer. Attribution follows
 *    the money, never the order's creation time.
 * 2. **The drawer is physical.** Card takings belong to the shift because the
 *    cashier is accountable for them, but they never enter the expected
 *    physical cash — nothing went into the drawer.
 */

export const CASHIER_SHIFT_STATUSES = ["OPEN", "CLOSED"] as const;
export type CashierShiftStatus = (typeof CASHIER_SHIFT_STATUSES)[number];

export const CASH_MOVEMENT_TYPES = ["CASH_IN", "CASH_OUT"] as const;
export type CashMovementType = (typeof CASH_MOVEMENT_TYPES)[number];

/** Who may run a till: the cashier, and supervisors covering for one. */
export const SHIFT_OPERATOR_ROLES = [
  "ADMIN",
  "MANAGER",
  "CASHIER",
] as const satisfies readonly UserRole[];

/** Who may close somebody else's shift, or manage registers. */
export const SHIFT_SUPERVISOR_ROLES = [
  "ADMIN",
  "MANAGER",
] as const satisfies readonly UserRole[];

export const CASH_MOVEMENT_REASON_MAX_LENGTH = 120;
export const SHIFT_NOTE_MAX_LENGTH = 500;

export function canRoleOperateShift(role: UserRole): boolean {
  return (SHIFT_OPERATOR_ROLES as readonly UserRole[]).includes(role);
}

export function canRoleSuperviseShift(role: UserRole): boolean {
  return (SHIFT_SUPERVISOR_ROLES as readonly UserRole[]).includes(role);
}

/** Only cash physically passes through the drawer. */
export function affectsDrawer(method: PaymentMethod): boolean {
  return method === "CASH";
}

export interface ShiftMethodTotals {
  readonly cash: string;
  readonly card: string;
  readonly other: string;
  readonly total: string;
}

export interface ShiftCashInputs {
  readonly openingCash: string;
  /** COMPLETED cash collections attributed to this shift. */
  readonly cashPayments: string;
  /** Refunds *issued by* this shift whose original payment was cash. */
  readonly cashRefunds: string;
  readonly cashIn: string;
  readonly cashOut: string;
}

/**
 * The one formula for what should physically be in the drawer.
 *
 *   opening + cash collected − cash refunded + cash in − cash out
 *
 * Card money is deliberately absent: it never entered the drawer, so it can
 * neither raise nor lower what the cashier is expected to count.
 */
export function calculateExpectedCash(inputs: ShiftCashInputs): string {
  const positive = addMoney(
    decimalToMinor(inputs.openingCash),
    decimalToMinor(inputs.cashPayments),
    decimalToMinor(inputs.cashIn),
  );
  const negative = addMoney(
    decimalToMinor(inputs.cashRefunds),
    decimalToMinor(inputs.cashOut),
  );
  // Allowed to go negative: a drawer emptied by a large cash-out is a real
  // (and reportable) state, not an input error to be clamped away.
  return minorToDecimal(subtractMoney(positive, negative));
}

/** counted − expected. Negative means the drawer is short. */
export function calculateCashVariance(countedCash: string, expectedCash: string): string {
  return minorToDecimal(
    subtractMoney(
      decimalToMinor(countedCash),
      decimalToMinor(expectedCash, { allowNegative: true }),
    ),
  );
}

export function isZeroMoney(value: string): boolean {
  return decimalToMinor(value, { allowNegative: true }) === 0;
}

export type ShiftCloseFailure =
  | "COUNTED_CASH_NEGATIVE"
  | "VARIANCE_NOTE_REQUIRED"
  | "SUPERVISOR_NOTE_REQUIRED";

export interface ShiftCloseCheckInput {
  readonly countedCash: string;
  readonly expectedCash: string;
  readonly note: string | null | undefined;
  /** True when the closer is not the person who opened the shift. */
  readonly closingOnBehalf: boolean;
}

/**
 * A shift may close with a discrepancy — refusing would strand the till — but
 * never silently. A non-zero variance, or a supervisor closing somebody else's
 * shift, must carry an explanation.
 */
export function checkShiftClose(input: ShiftCloseCheckInput): ShiftCloseFailure | null {
  if (decimalToMinor(input.countedCash, { allowNegative: true }) < 0) {
    return "COUNTED_CASH_NEGATIVE";
  }
  const note = input.note?.trim() ?? "";
  const variance = calculateCashVariance(input.countedCash, input.expectedCash);
  if (!isZeroMoney(variance) && note.length === 0) return "VARIANCE_NOTE_REQUIRED";
  if (input.closingOnBehalf && note.length === 0) return "SUPERVISOR_NOTE_REQUIRED";
  return null;
}

export interface ShiftSummaryInput extends ShiftCashInputs {
  readonly cardPayments: string;
  readonly otherPayments: string;
  readonly cardRefunds: string;
  readonly otherRefunds: string;
  readonly paymentCount: number;
  readonly refundCount: number;
}

export interface ShiftMoneySummary {
  readonly openingCash: string;
  readonly payments: ShiftMethodTotals;
  readonly refunds: ShiftMethodTotals;
  readonly cashIn: string;
  readonly cashOut: string;
  readonly expectedCash: string;
  /** Everything collected this shift, before refunds, all methods. */
  readonly grossCollected: string;
  /** Gross minus everything refunded this shift. Not profit. */
  readonly netCollected: string;
  readonly paymentCount: number;
  readonly refundCount: number;
}

/**
 * The shift's money position. `netCollected` is collection minus refunds and
 * is emphatically **not** profit: there is no cost or inventory model behind
 * it, so nothing here may ever be labelled as margin.
 */
export function summarizeShiftMoney(input: ShiftSummaryInput): ShiftMoneySummary {
  const paymentTotal = addMoney(
    decimalToMinor(input.cashPayments),
    decimalToMinor(input.cardPayments),
    decimalToMinor(input.otherPayments),
  );
  const refundTotal = addMoney(
    decimalToMinor(input.cashRefunds),
    decimalToMinor(input.cardRefunds),
    decimalToMinor(input.otherRefunds),
  );

  return {
    openingCash: input.openingCash,
    payments: {
      cash: input.cashPayments,
      card: input.cardPayments,
      other: input.otherPayments,
      total: minorToDecimal(paymentTotal),
    },
    refunds: {
      cash: input.cashRefunds,
      card: input.cardRefunds,
      other: input.otherRefunds,
      total: minorToDecimal(refundTotal),
    },
    cashIn: input.cashIn,
    cashOut: input.cashOut,
    expectedCash: calculateExpectedCash(input),
    grossCollected: minorToDecimal(paymentTotal),
    netCollected: minorToDecimal(subtractMoney(paymentTotal, refundTotal)),
    paymentCount: input.paymentCount,
    refundCount: input.refundCount,
  };
}
