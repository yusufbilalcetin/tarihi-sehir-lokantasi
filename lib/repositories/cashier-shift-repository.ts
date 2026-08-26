import type { MethodTotals } from "@/lib/domain/cashier-report";
import type {
  CashMovementType,
  CashierShiftStatus,
} from "@/lib/domain/cashier-shift";
import type { JsonObject } from "@/db/schema";
import type {
  InsertAuditLogInput,
  InsertOutboxEventInput,
} from "./order-repository";

export interface CashRegisterRecord {
  readonly id: string;
  readonly name: string;
  readonly code: string;
  readonly isActive: boolean;
  readonly deletedAt: Date | null;
}

export interface CashierShiftRecord {
  readonly id: string;
  readonly cashRegisterId: string;
  readonly registerNameSnapshot: string;
  readonly openedByStaffId: string;
  readonly openedAt: Date;
  readonly openingCash: string;
  readonly status: CashierShiftStatus;
  readonly closedAt: Date | null;
  readonly closedByStaffId: string | null;
  readonly countedCashAtClose: string | null;
  readonly expectedCashAtClose: string | null;
  readonly cashVariance: string | null;
  readonly closeNote: string | null;
  /** Null for shifts closed before Phase 8B; never back-filled. */
  readonly zReportVersion: number | null;
  readonly zReportGeneratedAt: Date | null;
  readonly zReportSnapshot: JsonObject | null;
}

/** Money the database has attributed to one shift, aggregated in SQL. */
export interface ShiftLedgerTotals {
  readonly cashPayments: string;
  readonly cardPayments: string;
  readonly otherPayments: string;
  readonly paymentCount: number;
  /**
   * Refunds *issued by* this shift, split by the method of the payment they
   * reverse — the refund tables carry no method of their own.
   */
  readonly cashRefunds: string;
  readonly cardRefunds: string;
  readonly otherRefunds: string;
  readonly refundCount: number;
  readonly cashIn: string;
  readonly cashOut: string;
  readonly movementCount: number;
  /** Collections still in flight; a shift with any of these cannot close. */
  readonly pendingPaymentCount: number;
  /**
   * Per-method amounts *and* counts from the same aggregate the flat totals
   * above come from, so a report breakdown always sums to its own gross.
   */
  readonly paymentsByMethod: MethodTotals;
  readonly refundsByMethod: MethodTotals;
}

/** Names frozen into a Z snapshot, read once inside the closing transaction. */
export interface ShiftSnapshotContext {
  readonly restaurantName: string;
  readonly openedByName: string | null;
  readonly closedByName: string | null;
}

export interface CashDrawerMovementRecord {
  readonly id: string;
  readonly type: CashMovementType;
  readonly amount: string;
  readonly reason: string;
  readonly note: string | null;
  readonly createdByStaffId: string;
  readonly createdByName: string | null;
  readonly createdAt: Date;
}

export interface OpenShiftInput {
  readonly restaurantId: string;
  readonly cashRegisterId: string;
  readonly registerNameSnapshot: string;
  readonly openedByStaffId: string;
  readonly openingCash: string;
  readonly at: Date;
}

export interface CloseShiftInput {
  readonly restaurantId: string;
  readonly shiftId: string;
  readonly closedByStaffId: string;
  readonly countedCash: string;
  readonly expectedCash: string;
  readonly cashVariance: string;
  readonly closeNote: string | null;
  /**
   * Written in the same statement as the close, so a shift can never be CLOSED
   * without its Z report.
   */
  readonly zReportVersion: number;
  readonly zReportSnapshot: JsonObject;
  readonly at: Date;
}

export interface InsertCashMovementInput {
  readonly restaurantId: string;
  readonly cashierShiftId: string;
  readonly type: CashMovementType;
  readonly amount: string;
  readonly reason: string;
  readonly note: string | null;
  readonly createdByStaffId: string;
  readonly at: Date;
}

export interface ShiftHistoryQuery {
  readonly restaurantId: string;
  readonly status?: CashierShiftStatus;
  readonly cashRegisterId?: string;
  readonly openedByStaffId?: string;
  readonly from?: Date;
  readonly to?: Date;
  readonly page: number;
  readonly pageSize: number;
}

export interface ShiftHistoryRow extends CashierShiftRecord {
  readonly openedByName: string | null;
  readonly closedByName: string | null;
}

export interface ShiftHistoryPage {
  readonly rows: readonly ShiftHistoryRow[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export interface CashierShiftTransactionRepository {
  findRegisterForUpdate(
    restaurantId: string,
    registerId: string,
  ): Promise<CashRegisterRecord | null>;
  /**
   * Locks the shift row. Every write that changes a shift's money — a payment,
   * a refund, a drawer movement, the close itself — takes this lock first, so
   * a close can never miss a collection that was already in flight.
   */
  findShiftForUpdate(
    restaurantId: string,
    shiftId: string,
  ): Promise<CashierShiftRecord | null>;
  findOpenShiftByStaff(
    restaurantId: string,
    staffId: string,
  ): Promise<CashierShiftRecord | null>;
  insertShift(input: OpenShiftInput): Promise<CashierShiftRecord | null>;
  closeShift(input: CloseShiftInput): Promise<CashierShiftRecord | null>;
  insertMovement(input: InsertCashMovementInput): Promise<CashDrawerMovementRecord>;
  ledgerTotals(restaurantId: string, shiftId: string): Promise<ShiftLedgerTotals>;
  /**
   * Present on the transaction repository as well as the read one: a caller
   * inside a transaction must never reach for the outer connection, because
   * the runtime pool holds a single connection and the open transaction owns
   * it. Doing so deadlocks the request forever.
   */
  listMovements(
    restaurantId: string,
    shiftId: string,
  ): Promise<readonly CashDrawerMovementRecord[]>;
  findSnapshotContext(
    restaurantId: string,
    openedByStaffId: string,
    closedByStaffId: string,
  ): Promise<ShiftSnapshotContext>;
  insertOutboxEvent(input: InsertOutboxEventInput): Promise<void>;
  insertAuditLog(input: InsertAuditLogInput): Promise<void>;
}

/**
 * A restaurant-local calendar day, resolved to the UTC instants it actually
 * spans. Every daily figure is filtered on the *transaction* timestamp, so a
 * shift running past midnight splits across two days exactly as the money did.
 */
export interface DailyWindow {
  readonly restaurantId: string;
  readonly start: Date;
  readonly endExclusive: Date;
  readonly cashRegisterId?: string;
  readonly cashierId?: string;
}

export interface DailyMoneyTotals {
  readonly paymentsByMethod: MethodTotals;
  readonly refundsByMethod: MethodTotals;
  readonly cashIn: string;
  readonly cashOut: string;
  readonly movementCount: number;
}

export interface DailyGroupTotals extends DailyMoneyTotals {
  readonly groupId: string;
  readonly groupName: string;
}

export interface DailyShiftRow {
  readonly id: string;
  readonly cashRegisterId: string;
  readonly registerNameSnapshot: string;
  readonly openedByStaffId: string;
  readonly openedByName: string | null;
  readonly openedAt: Date;
  readonly closedAt: Date | null;
  readonly status: CashierShiftStatus;
  readonly expectedCashAtClose: string | null;
  readonly countedCashAtClose: string | null;
  readonly cashVariance: string | null;
  readonly hasZReport: boolean;
}

/** VOID and CANCEL are order-level corrections with no shift attribution. */
export interface DailyExceptionRow {
  readonly kind: "VOID" | "CANCEL";
  readonly count: number;
  readonly amount: string;
}

export interface CashierShiftRepository {
  transaction<TResult>(
    work: (repository: CashierShiftTransactionRepository) => Promise<TResult>,
  ): Promise<TResult>;
  /** Read-only paths do not need a transaction and must not take locks. */
  findShift(restaurantId: string, shiftId: string): Promise<ShiftHistoryRow | null>;
  findOpenShiftByStaff(
    restaurantId: string,
    staffId: string,
  ): Promise<ShiftHistoryRow | null>;
  ledgerTotals(restaurantId: string, shiftId: string): Promise<ShiftLedgerTotals>;
  listMovements(
    restaurantId: string,
    shiftId: string,
  ): Promise<readonly CashDrawerMovementRecord[]>;
  listShifts(query: ShiftHistoryQuery): Promise<ShiftHistoryPage>;
  listOpenRegisters(restaurantId: string): Promise<readonly CashRegisterRecord[]>;
  findRestaurantName(restaurantId: string): Promise<string | null>;
  /** Every daily figure below is aggregated in SQL, never in the browser. */
  dailyTotals(window: DailyWindow): Promise<DailyMoneyTotals>;
  dailyByRegister(window: DailyWindow): Promise<readonly DailyGroupTotals[]>;
  dailyByCashier(window: DailyWindow): Promise<readonly DailyGroupTotals[]>;
  dailyShifts(window: DailyWindow): Promise<readonly DailyShiftRow[]>;
  dailyExceptions(window: DailyWindow): Promise<readonly DailyExceptionRow[]>;
}
