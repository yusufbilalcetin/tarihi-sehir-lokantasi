import { addMoney, decimalToMinor, minorToDecimal } from "./money";
import { summarizeShiftMoney, type ShiftMoneySummary } from "./cashier-shift";
import { PAYMENT_METHODS, type PaymentMethod } from "./status";

/**
 * Operational cash reports.
 *
 * **These are not fiscal documents.** There is no ÖKC, no fiscal printer, no
 * e-Arşiv and no tax integration behind them. An X report is the restaurant's
 * own live view of a drawer; a Z report is its own final record of one closed
 * shift. Neither may ever be presented as an official/tax Z report.
 *
 * Two distinctions carry the whole design:
 *
 * 1. **X is derived, Z is stored.** X is recomputed from live rows every time
 *    and changes as the shift goes on. Z is written once, inside the closing
 *    transaction, and is never recomputed — a refund taken tomorrow belongs to
 *    tomorrow's drawer and must not move yesterday's report.
 * 2. **Collection, not sales.** Both report what one cashier collected, not
 *    what the restaurant sold. An order opened at lunch and paid at dinner is
 *    dinner's collection.
 */

export const CASHIER_REPORT_TYPES = ["X", "Z"] as const;
export type CashierReportType = (typeof CASHIER_REPORT_TYPES)[number];

/**
 * Snapshot schema version. Bump it when the stored shape changes so historical
 * rows keep parsing under the reader they were written for.
 */
export const Z_SNAPSHOT_VERSION = 1;

/** Shown on every rendered and exported report; never softened. */
export const NON_FISCAL_DISCLAIMER =
  "Bu rapor operasyonel kasa mutabakatıdır; mali cihaz/ÖKC Z raporu değildir.";

export interface MethodBreakdownRow {
  readonly method: PaymentMethod;
  readonly amount: string;
  readonly count: number;
}

export interface MethodTotal {
  readonly amount: string;
  readonly count: number;
}

export type MethodTotals = Readonly<Record<PaymentMethod, MethodTotal>>;

/**
 * Built from the payment-method enum rather than a hand-written list, so a
 * method added later appears in every report without touching this file.
 */
export function toMethodBreakdown(totals: MethodTotals): readonly MethodBreakdownRow[] {
  return PAYMENT_METHODS.map((method) => ({
    method,
    amount: totals[method]?.amount ?? "0.00",
    count: totals[method]?.count ?? 0,
  }));
}

export function sumBreakdown(rows: readonly MethodBreakdownRow[]): string {
  return minorToDecimal(addMoney(...rows.map((row) => decimalToMinor(row.amount))));
}

export function countBreakdown(rows: readonly MethodBreakdownRow[]): number {
  return rows.reduce((total, row) => total + row.count, 0);
}

export interface ShiftReportIdentity {
  readonly restaurantId: string;
  readonly restaurantNameSnapshot: string;
  readonly registerId: string;
  readonly registerNameSnapshot: string;
  readonly shiftId: string;
  readonly openedByStaffId: string;
  readonly openedByNameSnapshot: string | null;
  readonly openedAt: string;
}

export interface XReport extends ShiftReportIdentity {
  readonly reportType: "X";
  readonly shiftStatus: "OPEN";
  readonly generatedAt: string;
  /** Whole minutes the drawer has been open at `generatedAt`. */
  readonly openDurationMinutes: number;
  readonly openingCash: string;
  readonly paymentMethodBreakdown: readonly MethodBreakdownRow[];
  readonly grossCollected: string;
  readonly paymentCount: number;
  readonly refundMethodBreakdown: readonly MethodBreakdownRow[];
  readonly totalRefunds: string;
  readonly refundCount: number;
  readonly netCollected: string;
  readonly cashIn: string;
  readonly cashOut: string;
  readonly movementCount: number;
  readonly expectedCash: string;
  readonly nonFiscalNotice: string;
}

export interface ZReportSnapshot extends ShiftReportIdentity {
  readonly reportType: "Z";
  readonly version: number;
  readonly closedByStaffId: string;
  readonly closedByNameSnapshot: string | null;
  readonly closedAt: string;
  readonly generatedAt: string;
  readonly openingCash: string;
  readonly paymentMethodBreakdown: readonly MethodBreakdownRow[];
  readonly grossCollected: string;
  readonly paymentCount: number;
  readonly refundMethodBreakdown: readonly MethodBreakdownRow[];
  readonly totalRefunds: string;
  readonly refundCount: number;
  readonly netCollected: string;
  readonly cashIn: string;
  readonly cashOut: string;
  readonly movementCount: number;
  readonly expectedCash: string;
  readonly countedCash: string;
  readonly cashVariance: string;
  /** True when a supervisor closed somebody else's drawer. */
  readonly managerOverride: boolean;
  readonly closeNote: string | null;
  readonly nonFiscalNotice: string;
}

export interface ShiftReportInput {
  readonly identity: ShiftReportIdentity;
  readonly summary: ShiftMoneySummary;
  readonly paymentsByMethod: MethodTotals;
  readonly refundsByMethod: MethodTotals;
  readonly movementCount: number;
}

function shared(input: ShiftReportInput) {
  const paymentMethodBreakdown = toMethodBreakdown(input.paymentsByMethod);
  const refundMethodBreakdown = toMethodBreakdown(input.refundsByMethod);
  return {
    ...input.identity,
    openingCash: input.summary.openingCash,
    paymentMethodBreakdown,
    // Taken from the same aggregate the breakdown came from, so the invariant
    // "breakdown sums to gross" is structural rather than hopeful.
    grossCollected: input.summary.grossCollected,
    paymentCount: input.summary.paymentCount,
    refundMethodBreakdown,
    totalRefunds: input.summary.refunds.total,
    refundCount: input.summary.refundCount,
    netCollected: input.summary.netCollected,
    cashIn: input.summary.cashIn,
    cashOut: input.summary.cashOut,
    movementCount: input.movementCount,
    expectedCash: input.summary.expectedCash,
    nonFiscalNotice: NON_FISCAL_DISCLAIMER,
  };
}

export function buildXReport(
  input: ShiftReportInput,
  generatedAt: Date,
): XReport {
  const openedAt = Date.parse(input.identity.openedAt);
  return {
    reportType: "X",
    shiftStatus: "OPEN",
    generatedAt: generatedAt.toISOString(),
    openDurationMinutes: Number.isNaN(openedAt)
      ? 0
      : Math.max(0, Math.floor((generatedAt.getTime() - openedAt) / 60_000)),
    ...shared(input),
  };
}

export interface ZReportInput extends ShiftReportInput {
  readonly closedByStaffId: string;
  readonly closedByNameSnapshot: string | null;
  readonly closedAt: string;
  readonly countedCash: string;
  readonly cashVariance: string;
  readonly closeNote: string | null;
}

/**
 * Built once, inside the closing transaction, from the same summary the close
 * itself used. Nothing here is ever recomputed on read.
 */
export function buildZSnapshot(input: ZReportInput, generatedAt: Date): ZReportSnapshot {
  return {
    reportType: "Z",
    version: Z_SNAPSHOT_VERSION,
    closedByStaffId: input.closedByStaffId,
    closedByNameSnapshot: input.closedByNameSnapshot,
    closedAt: input.closedAt,
    generatedAt: generatedAt.toISOString(),
    countedCash: input.countedCash,
    cashVariance: input.cashVariance,
    managerOverride: input.closedByStaffId !== input.identity.openedByStaffId,
    closeNote: input.closeNote,
    ...shared(input),
  };
}

/** Reassembles the money summary from the ledger totals, without new maths. */
export function summaryFromMethodTotals(input: {
  readonly openingCash: string;
  readonly paymentsByMethod: MethodTotals;
  readonly refundsByMethod: MethodTotals;
  readonly cashIn: string;
  readonly cashOut: string;
}): ShiftMoneySummary {
  const payments = toMethodBreakdown(input.paymentsByMethod);
  const refunds = toMethodBreakdown(input.refundsByMethod);
  return summarizeShiftMoney({
    openingCash: input.openingCash,
    cashPayments: input.paymentsByMethod.CASH.amount,
    cardPayments: input.paymentsByMethod.CARD.amount,
    otherPayments: input.paymentsByMethod.OTHER.amount,
    cashRefunds: input.refundsByMethod.CASH.amount,
    cardRefunds: input.refundsByMethod.CARD.amount,
    otherRefunds: input.refundsByMethod.OTHER.amount,
    cashIn: input.cashIn,
    cashOut: input.cashOut,
    paymentCount: countBreakdown(payments),
    refundCount: countBreakdown(refunds),
  });
}

export class UnsupportedSnapshotVersionError extends Error {
  constructor(readonly version: unknown) {
    super(`Unsupported Z report snapshot version: ${String(version)}`);
    this.name = "UnsupportedSnapshotVersionError";
  }
}
