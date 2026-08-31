import type { MethodTotals } from "../../lib/domain/cashier-report";
import type { RestaurantPrincipal } from "../../lib/domain/restaurant-scope";
import type {
  InsertAuditLogInput,
  InsertOutboxEventInput,
} from "../../lib/repositories/order-repository";
import type {
  CashDrawerMovementRecord,
  CashRegisterRecord,
  CashierShiftRecord,
  CashierShiftRepository,
  CashierShiftTransactionRepository,
  CloseShiftInput,
  InsertCashCountInput,
  InsertCashMovementInput,
  OpenShiftInput,
  ShiftHistoryPage,
  ShiftHistoryQuery,
  ShiftHistoryRow,
  ShiftLedgerTotals,
} from "../../lib/repositories/cashier-shift-repository";
import { CashierShiftService } from "../../lib/services/cashier-shift-service";

export const SHIFT_AT = new Date("2026-08-15T09:00:00.000Z");
export const RESTAURANT = "restaurant-a";

export function principal(
  role: RestaurantPrincipal["role"],
  userId = `user-${role.toLowerCase()}`,
): RestaurantPrincipal {
  return { userId, restaurantId: RESTAURANT, role, isActive: true };
}

export function methodTotals(
  cash = "0.00",
  card = "0.00",
  other = "0.00",
  counts: { cash?: number; card?: number; other?: number } = {},
): MethodTotals {
  return {
    CASH: { amount: cash, count: counts.cash ?? (cash === "0.00" ? 0 : 1) },
    CARD: { amount: card, count: counts.card ?? (card === "0.00" ? 0 : 1) },
    OTHER: { amount: other, count: counts.other ?? (other === "0.00" ? 0 : 1) },
  };
}

export const ZERO_TOTALS: ShiftLedgerTotals = {
  cashPayments: "0.00",
  cardPayments: "0.00",
  otherPayments: "0.00",
  paymentCount: 0,
  cashRefunds: "0.00",
  cardRefunds: "0.00",
  otherRefunds: "0.00",
  refundCount: 0,
  cashIn: "0.00",
  cashOut: "0.00",
  movementCount: 0,
  pendingPaymentCount: 0,
  paymentsByMethod: methodTotals(),
  refundsByMethod: methodTotals(),
};

/** Keeps the flat fields and the per-method maps in step, as SQL does. */
export function totalsWith(
  overrides: Partial<ShiftLedgerTotals> & {
    payments?: MethodTotals;
    refunds?: MethodTotals;
  },
): ShiftLedgerTotals {
  const paymentsByMethod = overrides.payments ?? ZERO_TOTALS.paymentsByMethod;
  const refundsByMethod = overrides.refunds ?? ZERO_TOTALS.refundsByMethod;
  return {
    ...ZERO_TOTALS,
    ...overrides,
    cashPayments: paymentsByMethod.CASH.amount,
    cardPayments: paymentsByMethod.CARD.amount,
    otherPayments: paymentsByMethod.OTHER.amount,
    paymentCount:
      paymentsByMethod.CASH.count + paymentsByMethod.CARD.count + paymentsByMethod.OTHER.count,
    cashRefunds: refundsByMethod.CASH.amount,
    cardRefunds: refundsByMethod.CARD.amount,
    otherRefunds: refundsByMethod.OTHER.amount,
    refundCount:
      refundsByMethod.CASH.count + refundsByMethod.CARD.count + refundsByMethod.OTHER.count,
    paymentsByMethod,
    refundsByMethod,
  };
}

export function openShift(overrides: Partial<CashierShiftRecord> = {}): CashierShiftRecord {
  return {
    id: "shift-1",
    cashRegisterId: "register-1",
    registerNameSnapshot: "Ana Kasa",
    openedByStaffId: "user-cashier",
    openedAt: SHIFT_AT,
    openingCash: "500.00",
    status: "OPEN",
    closedAt: null,
    closedByStaffId: null,
    countedCashAtClose: null,
    expectedCashAtClose: null,
    cashVariance: null,
    closeNote: null,
    zReportVersion: null,
    zReportGeneratedAt: null,
    zReportSnapshot: null,
    ...overrides,
  };
}

/**
 * Models what the database guarantees: the partial unique indexes decide the
 * open-shift race, and only an OPEN row can be closed.
 */
export class FakeShiftRepository implements CashierShiftRepository {
  registers: CashRegisterRecord[] = [
    { id: "register-1", name: "Ana Kasa", code: "ANA", isActive: true, deletedAt: null },
    { id: "register-2", name: "Bar Kasa", code: "BAR", isActive: false, deletedAt: null },
  ];
  shifts: CashierShiftRecord[] = [];
  movements: CashDrawerMovementRecord[] = [];
  totals: ShiftLedgerTotals = { ...ZERO_TOTALS };
  outbox: InsertOutboxEventInput[] = [];
  audits: InsertAuditLogInput[] = [];
  closes: CloseShiftInput[] = [];
  /** What was counted into the drawer, in write order. */
  cashCounts: InsertCashCountInput[] = [];
  /** Set to make the denomination write fail, to test atomicity. */
  failCashCounts = false;
  private sequence = 0;

  private transactionRepository: CashierShiftTransactionRepository = {
    findRegisterForUpdate: async (restaurantId, registerId) =>
      restaurantId === RESTAURANT
        ? this.registers.find((register) => register.id === registerId) ?? null
        : null,
    findShiftForUpdate: async (restaurantId, shiftId) =>
      restaurantId === RESTAURANT
        ? this.shifts.find((shift) => shift.id === shiftId) ?? null
        : null,
    findOpenShiftByStaff: async (restaurantId, staffId) =>
      restaurantId === RESTAURANT
        ? this.shifts.find(
            (shift) => shift.openedByStaffId === staffId && shift.status === "OPEN",
          ) ?? null
        : null,
    insertShift: async (input: OpenShiftInput) => {
      // Both partial unique indexes, modelled.
      const clash = this.shifts.some(
        (shift) =>
          shift.status === "OPEN" &&
          (shift.cashRegisterId === input.cashRegisterId ||
            shift.openedByStaffId === input.openedByStaffId),
      );
      if (clash) return null;
      this.sequence += 1;
      const shift = openShift({
        id: `shift-${this.sequence}`,
        cashRegisterId: input.cashRegisterId,
        registerNameSnapshot: input.registerNameSnapshot,
        openedByStaffId: input.openedByStaffId,
        openedAt: input.at,
        openingCash: input.openingCash,
      });
      this.shifts.push(shift);
      return shift;
    },
    closeShift: async (input: CloseShiftInput) => {
      this.closes.push(input);
      const index = this.shifts.findIndex((shift) => shift.id === input.shiftId);
      // The UPDATE carries `status = 'OPEN'`; a second close matches nothing.
      if (index < 0 || this.shifts[index]!.status !== "OPEN") return null;
      const closed: CashierShiftRecord = {
        ...this.shifts[index]!,
        status: "CLOSED",
        closedAt: input.at,
        closedByStaffId: input.closedByStaffId,
        countedCashAtClose: input.countedCash,
        expectedCashAtClose: input.expectedCash,
        cashVariance: input.cashVariance,
        closeNote: input.closeNote,
        // Written by the same statement, exactly as the database does.
        zReportVersion: input.zReportVersion,
        zReportGeneratedAt: input.at,
        zReportSnapshot: input.zReportSnapshot,
      };
      this.shifts[index] = closed;
      return closed;
    },
    /**
     * Records what was written so a test can assert the drawer count landed in
     * the same transaction as the shift, and can make that write fail.
     */
    listCashCounts: async (restaurantId: string, shiftId: string) =>
      this.listCashCounts(restaurantId, shiftId),
    insertCashCounts: async (input: InsertCashCountInput) => {
      if (this.failCashCounts) throw new Error("cash count insert failed");
      this.cashCounts.push(input);
    },
    insertMovement: async (input: InsertCashMovementInput) => {
      const movement: CashDrawerMovementRecord = {
        id: `movement-${this.movements.length + 1}`,
        type: input.type,
        amount: input.amount,
        reason: input.reason,
        note: input.note,
        createdByStaffId: input.createdByStaffId,
        createdByName: null,
        createdAt: input.at,
      };
      this.movements.push(movement);
      return movement;
    },
    ledgerTotals: async () => this.totals,
    listMovements: async () => this.movements,
    findSnapshotContext: async () => ({
      restaurantName: "PHASE8B Restoran",
      openedByName: "Kasiyer",
      closedByName: "Kapatan",
    }),
    insertOutboxEvent: async (input) => {
      this.outbox.push(input);
    },
    insertAuditLog: async (input) => {
      this.audits.push(input);
    },
  };

  transaction<TResult>(
    work: (repository: CashierShiftTransactionRepository) => Promise<TResult>,
  ): Promise<TResult> {
    return work(this.transactionRepository);
  }

  private withNames(shift: CashierShiftRecord): ShiftHistoryRow {
    return { ...shift, openedByName: "Kasiyer", closedByName: null };
  }

  async findShift(restaurantId: string, shiftId: string) {
    if (restaurantId !== RESTAURANT) return null;
    const shift = this.shifts.find((candidate) => candidate.id === shiftId);
    return shift ? this.withNames(shift) : null;
  }

  async findOpenShiftByStaff(restaurantId: string, staffId: string) {
    if (restaurantId !== RESTAURANT) return null;
    const shift = this.shifts.find(
      (candidate) => candidate.openedByStaffId === staffId && candidate.status === "OPEN",
    );
    return shift ? this.withNames(shift) : null;
  }

  async ledgerTotals() {
    return this.totals;
  }

  async listMovements() {
    return this.movements;
  }

  /** Reads back what insertCashCounts recorded, scoped the way the real one is. */
  async listCashCounts(restaurantId: string, shiftId: string) {
    return this.cashCounts
      .filter((entry) => entry.restaurantId === restaurantId && entry.shiftId === shiftId)
      .flatMap((entry) =>
        entry.lines.map((line) => ({
          phase: entry.phase,
          currency: line.currency,
          denominationMinor: line.denominationMinor,
          pieceCount: line.pieceCount,
          subtotalMinor: line.subtotalMinor,
        })),
      );
  }

  async listShifts(query: ShiftHistoryQuery): Promise<ShiftHistoryPage> {
    const rows = this.shifts
      .filter((shift) => !query.status || shift.status === query.status)
      .filter(
        (shift) => !query.openedByStaffId || shift.openedByStaffId === query.openedByStaffId,
      )
      .filter(
        (shift) => !query.cashRegisterId || shift.cashRegisterId === query.cashRegisterId,
      )
      .map((shift) => this.withNames(shift));
    return { rows, total: rows.length, page: query.page, pageSize: query.pageSize };
  }

  async listOpenRegisters() {
    return this.registers.filter((register) => register.isActive && !register.deletedAt);
  }

  async findRestaurantName() {
    return "PHASE8B Restoran";
  }

  // The daily report is aggregated in SQL and is exercised against real
  // PostgreSQL; the fake only needs to satisfy the interface here.
  async dailyTotals() {
    return {
      paymentsByMethod: this.totals.paymentsByMethod,
      refundsByMethod: this.totals.refundsByMethod,
      cashIn: this.totals.cashIn,
      cashOut: this.totals.cashOut,
      movementCount: this.totals.movementCount,
    };
  }

  async dailyByRegister() {
    return [];
  }

  async dailyByCashier() {
    return [];
  }

  async dailyShifts() {
    return [];
  }

  async dailyExceptions() {
    return [];
  }
}

export function shiftService(repository: FakeShiftRepository): CashierShiftService {
  return new CashierShiftService(repository, { clock: () => SHIFT_AT });
}
