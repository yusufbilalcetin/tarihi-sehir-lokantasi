import type { JsonObject } from "@/db/schema";
import { DomainError } from "@/lib/api/domain-error";
import { Z_SNAPSHOT_VERSION, buildZSnapshot } from "@/lib/domain/cashier-report";
import { parseZSnapshot } from "@/lib/validation/cashier-report";
import {
  CASH_MOVEMENT_REASON_MAX_LENGTH,
  SHIFT_NOTE_MAX_LENGTH,
  SHIFT_OPERATOR_ROLES,
  SHIFT_SUPERVISOR_ROLES,
  calculateCashVariance,
  canRoleSuperviseShift,
  checkShiftClose,
  summarizeShiftMoney,
  type CashMovementType,
  type ShiftMoneySummary,
} from "@/lib/domain/cashier-shift";
import {
  InvalidCashCountError,
  summariseCashCount,
  totalForCurrency,
  type CountedDenomination,
} from "@/lib/domain/cash-denominations";
import { decimalToMinor, minorToDecimal } from "@/lib/domain/money";
import {
  authorizeRestaurantAccess,
  type RestaurantPrincipal,
} from "@/lib/domain/restaurant-scope";
import type { UserRole } from "@/lib/domain/status";
import type {
  CashCountRecord,
  CashDrawerMovementRecord,
  CashierShiftRepository,
  CashierShiftRecord,
  CashierShiftTransactionRepository,
  ShiftHistoryPage,
  ShiftHistoryRow,
  ShiftLedgerTotals,
} from "@/lib/repositories/cashier-shift-repository";

/**
 * Cash drawer accountability.
 *
 * Three invariants are load-bearing and are enforced here *and* in the
 * database, never in only one of the two:
 *
 * 1. One OPEN shift per register and one per cashier. Two concurrent open
 *    requests are decided by a partial unique index, not by a read-then-write
 *    check that a race can slip through.
 * 2. Every money write on a shift takes the shift's row lock first. That is
 *    what makes "close vs payment" safe: either the payment commits before the
 *    close and is counted, or it arrives after and is refused.
 * 3. A CLOSED shift is frozen. Its snapshot is never recomputed, so a refund
 *    issued tomorrow cannot retroactively change yesterday's counted drawer.
 */

export interface OpenShiftCommand {
  readonly cashRegisterId: string;
  readonly openingCash: string;
  /**
   * A physically counted drawer. When present it is authoritative: the server
   * recomputes every subtotal from its own denomination table and derives the
   * opening cash from the TRY total, so a typed figure cannot disagree with
   * what was counted. Absent means a shift opens the way it always has.
   */
  readonly cashCounts?: readonly {
    readonly currency: string;
    readonly denominationMinor: number;
    readonly count: number;
  }[];
  readonly requestId?: string;
}

export interface CloseShiftCommand {
  readonly shiftId: string;
  readonly countedCash: string;
  readonly note?: string;
  readonly requestId?: string;
}

export interface RecordMovementCommand {
  readonly shiftId: string;
  readonly type: CashMovementType;
  readonly amount: string;
  readonly reason: string;
  readonly note?: string;
  readonly requestId?: string;
}

export interface ShiftView {
  readonly id: string;
  readonly status: "OPEN" | "CLOSED";
  readonly register: { readonly id: string; readonly name: string };
  readonly openedBy: { readonly id: string; readonly name: string | null };
  readonly openedAt: string;
  readonly closedBy: { readonly id: string; readonly name: string | null } | null;
  readonly closedAt: string | null;
  readonly openingCash: string;
  /** Present only once the shift is closed; frozen at that moment. */
  readonly countedCash: string | null;
  readonly expectedCashAtClose: string | null;
  readonly cashVariance: string | null;
  readonly closeNote: string | null;
}

/**
 * A counted drawer as it is read back, grouped per currency.
 *
 * `null` for a shift opened before this feature, or one opened without a
 * count: history is never back-filled with a reconstructed breakdown, because
 * a plausible-looking invented drawer is worse than an honest absence.
 */
export interface CashCountView {
  readonly phase: "OPENING" | "CLOSING";
  readonly currency: string;
  readonly totalMinor: number;
  readonly pieceCount: number;
  readonly lines: readonly {
    readonly denominationMinor: number;
    readonly pieceCount: number;
    readonly subtotalMinor: number;
  }[];
}

export interface ShiftDetailResult {
  readonly shift: ShiftView;
  /** Absent on a legacy shift; never invented. */
  readonly cashCounts: readonly CashCountView[] | null;
  /**
   * Live for an OPEN shift, historical for a CLOSED one. For a closed shift
   * `expectedCash` is the stored snapshot, never a recomputation.
   */
  readonly summary: ShiftMoneySummary;
  readonly movements: readonly CashDrawerMovementRecord[];
}

export interface CurrentShiftResult {
  /** The open shift's counted drawer, or null when it was opened without one. */
  readonly cashCounts?: readonly CashCountView[] | null;
  readonly shift: ShiftView | null;
  readonly summary: ShiftMoneySummary | null;
  readonly movements: readonly CashDrawerMovementRecord[];
  /** Registers this cashier could open a shift on. */
  readonly availableRegisters: readonly { readonly id: string; readonly name: string }[];
}

export interface CashierShiftServiceOptions {
  readonly clock?: () => Date;
}

function totalsToSummary(
  openingCash: string,
  totals: ShiftLedgerTotals,
): ShiftMoneySummary {
  return summarizeShiftMoney({ openingCash, ...totals });
}

function toView(row: ShiftHistoryRow | (CashierShiftRecord & Partial<ShiftHistoryRow>)): ShiftView {
  return {
    id: row.id,
    status: row.status,
    register: { id: row.cashRegisterId, name: row.registerNameSnapshot },
    openedBy: { id: row.openedByStaffId, name: row.openedByName ?? null },
    openedAt: row.openedAt.toISOString(),
    closedBy: row.closedByStaffId
      ? { id: row.closedByStaffId, name: row.closedByName ?? null }
      : null,
    closedAt: row.closedAt?.toISOString() ?? null,
    openingCash: row.openingCash,
    countedCash: row.countedCashAtClose,
    expectedCashAtClose: row.expectedCashAtClose,
    cashVariance: row.cashVariance,
    closeNote: row.closeNote,
  };
}

/** A foreign or missing shift is reported identically: it simply is not there. */
function shiftNotFound(): DomainError {
  return new DomainError("NOT_FOUND", "Vardiya bulunamadı.", { httpStatus: 404 });
}


/**
 * Group stored rows for display. Every figure here is the one the server wrote
 * at counting time — nothing is recomputed, so a later change to the
 * denomination table can never rewrite history.
 */
function toCashCountViews(
  rows: readonly CashCountRecord[],
): readonly CashCountView[] | null {
  if (rows.length === 0) return null;
  const grouped = new Map<string, CashCountView>();
  for (const row of rows) {
    const key = `${row.phase}:${row.currency}`;
    const existing = grouped.get(key);
    const line = {
      denominationMinor: row.denominationMinor,
      pieceCount: row.pieceCount,
      subtotalMinor: row.subtotalMinor,
    };
    if (existing) {
      grouped.set(key, {
        ...existing,
        totalMinor: existing.totalMinor + row.subtotalMinor,
        pieceCount: existing.pieceCount + row.pieceCount,
        lines: [...existing.lines, line],
      });
    } else {
      grouped.set(key, {
        phase: row.phase,
        currency: row.currency,
        totalMinor: row.subtotalMinor,
        pieceCount: row.pieceCount,
        lines: [line],
      });
    }
  }
  return [...grouped.values()];
}

export class CashierShiftService {
  private readonly clock: () => Date;

  constructor(
    private readonly repository: CashierShiftRepository,
    options: CashierShiftServiceOptions = {},
  ) {
    this.clock = options.clock ?? (() => new Date());
  }

  async open(
    principal: RestaurantPrincipal | null | undefined,
    command: OpenShiftCommand,
  ): Promise<ShiftDetailResult> {
    const actor = this.authorize(principal, SHIFT_OPERATOR_ROLES, "Kasa açma");
    const openingMinor = decimalToMinor(command.openingCash, { allowNegative: true });
    if (openingMinor < 0) {
      throw new DomainError("VALIDATION_ERROR", "Açılış nakdi negatif olamaz.", {
        httpStatus: 400,
      });
    }

    /*
     * The counted drawer, priced by the server.
     *
     * Nothing the client computed is read. `summariseCashCount` rejects an
     * unknown currency, an unknown face value, a duplicated denomination and a
     * count that is negative, fractional or absurd, and it multiplies in integer
     * minor units so no total can drift. It runs before the transaction opens,
     * so a bad payload never gets as far as a shift row.
     */
    let countedLines: readonly CountedDenomination[] = [];
    let openingCash = command.openingCash;
    if (command.cashCounts) {
      try {
        const summary = summariseCashCount(
          command.cashCounts.map((entry) => ({
            currency: entry.currency,
            minorValue: entry.denominationMinor,
            count: entry.count,
          })),
        );
        countedLines = summary.lines;
        // TRY is the drawer's accounting currency, so its counted total is the
        // opening cash the rest of the system already understands. EUR and USD
        // are separate physical inventory and are never folded into it.
        openingCash = minorToDecimal(totalForCurrency(summary.totals, "TRY"));
      } catch (error) {
        throw new DomainError(
          "VALIDATION_ERROR",
          error instanceof InvalidCashCountError ? error.message : "Kasa sayımı geçersiz.",
          { httpStatus: 400 },
        );
      }
    }

    return this.repository.transaction(async (transaction) => {
      const register = await transaction.findRegisterForUpdate(
        actor.restaurantId,
        command.cashRegisterId,
      );
      if (!register) {
        throw new DomainError("NOT_FOUND", "Kasa bulunamadı.", { httpStatus: 404 });
      }
      if (!register.isActive || register.deletedAt) {
        throw new DomainError("CONFLICT", "Bu kasa kullanım dışı.", { httpStatus: 409 });
      }

      const own = await transaction.findOpenShiftByStaff(actor.restaurantId, actor.userId);
      if (own) {
        throw new DomainError("CASHIER_SHIFT_ALREADY_OPEN", "Zaten açık bir vardiyanız var.", {
          httpStatus: 409,
          details: { shiftId: own.id, registerId: own.cashRegisterId },
        });
      }

      const at = this.clock();
      // The partial unique indexes decide the race; a null return means another
      // request won it, which is a conflict rather than a server fault.
      const shift = await transaction.insertShift({
        restaurantId: actor.restaurantId,
        cashRegisterId: register.id,
        registerNameSnapshot: register.name,
        openedByStaffId: actor.userId,
        openingCash,
        at,
      });
      if (!shift) {
        throw new DomainError(
          "CASHIER_SHIFT_ALREADY_OPEN",
          "Bu kasada zaten açık bir vardiya var.",
          { httpStatus: 409 },
        );
      }

      // Same transaction as the shift row: a shift cannot exist with half a
      // drawer count, and a failed count write rolls the shift back with it.
      if (countedLines.length > 0) {
        await transaction.insertCashCounts({
          restaurantId: actor.restaurantId,
          shiftId: shift.id,
          phase: "OPENING",
          countedByStaffId: actor.userId,
          at,
          lines: countedLines.map((line) => ({
            currency: line.currency,
            denominationMinor: line.minorValue,
            pieceCount: line.count,
            subtotalMinor: line.subtotalMinor,
          })),
        });
      }

      const payload = {
        shiftId: shift.id,
        registerId: register.id,
        registerName: register.name,
        openedByStaffId: actor.userId,
        openingCash: shift.openingCash,
        openedAt: at.toISOString(),
      };
      await transaction.insertOutboxEvent({
        restaurantId: actor.restaurantId,
        aggregateType: "CASHIER_SHIFT",
        aggregateId: shift.id,
        eventType: "CASHIER_SHIFT_OPENED",
        payload,
      });
      await transaction.insertAuditLog({
        restaurantId: actor.restaurantId,
        actorUserId: actor.userId,
        action: "cashier_shift.opened",
        entityType: "CASHIER_SHIFT",
        entityId: shift.id,
        oldValue: null,
        newValue: { registerId: register.id, openingCash: shift.openingCash },
        metadata: { registerName: register.name },
        requestId: command.requestId,
      });

      const totals = await transaction.ledgerTotals(actor.restaurantId, shift.id);
      return {
        shift: toView(shift),
        // A drawer counted for this shift, or null on a legacy one. Read
        // back rather than recomputed, so history stays what was agreed.
        cashCounts: toCashCountViews(
          await this.repository.listCashCounts(actor.restaurantId, shift.id),
        ),
        summary: totalsToSummary(shift.openingCash, totals),
        movements: [],
      };
    });
  }

  /**
   * Closing takes the shift lock, so any collection or refund already in flight
   * for this shift finishes first and is included in the snapshot, and anything
   * that arrives afterwards finds a CLOSED shift and is refused.
   */
  async close(
    principal: RestaurantPrincipal | null | undefined,
    command: CloseShiftCommand,
  ): Promise<ShiftDetailResult> {
    const actor = this.authorize(principal, SHIFT_OPERATOR_ROLES, "Kasa kapatma");

    return this.repository.transaction(async (transaction) => {
      const shift = await transaction.findShiftForUpdate(actor.restaurantId, command.shiftId);
      if (!shift) throw shiftNotFound();
      if (shift.status === "CLOSED") {
        throw new DomainError("CASHIER_SHIFT_CLOSED", "Bu vardiya zaten kapatılmış.", {
          httpStatus: 409,
          details: { shiftId: shift.id },
        });
      }

      const closingOnBehalf = shift.openedByStaffId !== actor.userId;
      if (closingOnBehalf && !canRoleSuperviseShift(actor.role)) {
        // A cashier is told the same thing about a colleague's shift as about
        // one that does not exist.
        throw shiftNotFound();
      }

      const totals = await transaction.ledgerTotals(actor.restaurantId, shift.id);
      if (totals.pendingPaymentCount > 0) {
        throw new DomainError(
          "CASHIER_SHIFT_HAS_PENDING_PAYMENT",
          "Bu vardiyada bekleyen bir ödeme var; kasa kapatılamaz.",
          { httpStatus: 409, details: { pendingPaymentCount: totals.pendingPaymentCount } },
        );
      }

      const summary = totalsToSummary(shift.openingCash, totals);
      const note = command.note?.trim() ?? "";
      if (note.length > SHIFT_NOTE_MAX_LENGTH) {
        throw new DomainError("VALIDATION_ERROR", "Açıklama çok uzun.", { httpStatus: 400 });
      }

      const failure = checkShiftClose({
        countedCash: command.countedCash,
        expectedCash: summary.expectedCash,
        note,
        closingOnBehalf,
      });
      if (failure === "COUNTED_CASH_NEGATIVE") {
        throw new DomainError("VALIDATION_ERROR", "Sayılan nakit negatif olamaz.", {
          httpStatus: 400,
        });
      }
      if (failure === "VARIANCE_NOTE_REQUIRED") {
        throw new DomainError(
          "CASHIER_SHIFT_NOTE_REQUIRED",
          "Kasa farkı bulunduğu için açıklama zorunludur.",
          {
            httpStatus: 400,
            details: {
              expectedCash: summary.expectedCash,
              countedCash: command.countedCash,
              cashVariance: calculateCashVariance(command.countedCash, summary.expectedCash),
            },
          },
        );
      }
      if (failure === "SUPERVISOR_NOTE_REQUIRED") {
        throw new DomainError(
          "CASHIER_SHIFT_NOTE_REQUIRED",
          "Başka bir personelin vardiyasını kapatırken açıklama zorunludur.",
          { httpStatus: 400 },
        );
      }

      const at = this.clock();
      const cashVariance = calculateCashVariance(command.countedCash, summary.expectedCash);

      // The operational Z report is built here, from the very summary this
      // close is deciding on, and written in the same statement. There is no
      // window in which a shift is CLOSED without its report, and the report is
      // never recomputed afterwards from rows that may have moved.
      const context = await transaction.findSnapshotContext(
        actor.restaurantId,
        shift.openedByStaffId,
        actor.userId,
      );
      const snapshot = buildZSnapshot(
        {
          identity: {
            restaurantId: actor.restaurantId,
            restaurantNameSnapshot: context.restaurantName,
            registerId: shift.cashRegisterId,
            registerNameSnapshot: shift.registerNameSnapshot,
            shiftId: shift.id,
            openedByStaffId: shift.openedByStaffId,
            openedByNameSnapshot: context.openedByName,
            openedAt: shift.openedAt.toISOString(),
          },
          summary,
          paymentsByMethod: totals.paymentsByMethod,
          refundsByMethod: totals.refundsByMethod,
          movementCount: totals.movementCount,
          closedByStaffId: actor.userId,
          closedByNameSnapshot: context.closedByName,
          closedAt: at.toISOString(),
          countedCash: command.countedCash,
          cashVariance,
          closeNote: note.length > 0 ? note : null,
        },
        at,
      );
      // Validated before it is stored: a snapshot that cannot be read back is
      // worse than a failed close.
      parseZSnapshot(snapshot);

      const closed = await transaction.closeShift({
        restaurantId: actor.restaurantId,
        shiftId: shift.id,
        closedByStaffId: actor.userId,
        countedCash: command.countedCash,
        expectedCash: summary.expectedCash,
        cashVariance,
        closeNote: note.length > 0 ? note : null,
        zReportVersion: Z_SNAPSHOT_VERSION,
        zReportSnapshot: snapshot as unknown as JsonObject,
        at,
      });
      if (!closed) {
        // The status predicate did not match: somebody closed it first.
        throw new DomainError("CASHIER_SHIFT_CLOSED", "Bu vardiya zaten kapatılmış.", {
          httpStatus: 409,
        });
      }

      const payload = {
        shiftId: shift.id,
        registerId: shift.cashRegisterId,
        registerName: shift.registerNameSnapshot,
        openedByStaffId: shift.openedByStaffId,
        closedByStaffId: actor.userId,
        expectedCash: summary.expectedCash,
        countedCash: command.countedCash,
        cashVariance,
        closedAt: at.toISOString(),
      };
      await transaction.insertOutboxEvent({
        restaurantId: actor.restaurantId,
        aggregateType: "CASHIER_SHIFT",
        aggregateId: shift.id,
        eventType: "CASHIER_SHIFT_CLOSED",
        payload,
      });
      await transaction.insertAuditLog({
        restaurantId: actor.restaurantId,
        actorUserId: actor.userId,
        // A supervisor closing somebody else's till is its own auditable act.
        action: closingOnBehalf
          ? "cashier_shift.closed_by_supervisor"
          : "cashier_shift.closed",
        entityType: "CASHIER_SHIFT",
        entityId: shift.id,
        oldValue: { status: "OPEN", openedByStaffId: shift.openedByStaffId },
        newValue: {
          status: "CLOSED",
          expectedCash: summary.expectedCash,
          countedCash: command.countedCash,
          cashVariance,
        },
        metadata: {
          registerName: shift.registerNameSnapshot,
          grossCollected: summary.grossCollected,
          netCollected: summary.netCollected,
          note: note.length > 0 ? note : null,
        },
        requestId: command.requestId,
      });

      // Read through the transaction, never `this.repository`: the runtime pool
      // holds one connection, so an outer query here would wait for the very
      // connection this transaction is holding and hang the request forever.
      const movements = await transaction.listMovements(actor.restaurantId, shift.id);
      const counts = await transaction.listCashCounts(actor.restaurantId, shift.id);
      return {
        shift: toView({ ...closed }),
        // Read on this connection for the same reason movements are.
        cashCounts: toCashCountViews(counts),
        // The stored snapshot is authoritative from here on.
        summary: { ...summary, expectedCash: closed.expectedCashAtClose ?? summary.expectedCash },
        movements,
      };
    });
  }

  async recordMovement(
    principal: RestaurantPrincipal | null | undefined,
    command: RecordMovementCommand,
  ): Promise<{ readonly movement: CashDrawerMovementRecord; readonly summary: ShiftMoneySummary }> {
    const actor = this.authorize(principal, SHIFT_OPERATOR_ROLES, "Kasa hareketi");

    const amountMinor = decimalToMinor(command.amount, { allowNegative: true });
    if (amountMinor <= 0) {
      throw new DomainError("VALIDATION_ERROR", "Tutar sıfırdan büyük olmalıdır.", {
        httpStatus: 400,
      });
    }
    const reason = command.reason.trim();
    if (reason.length === 0 || reason.length > CASH_MOVEMENT_REASON_MAX_LENGTH) {
      throw new DomainError("VALIDATION_ERROR", "Geçerli bir gerekçe girin.", {
        httpStatus: 400,
      });
    }

    return this.repository.transaction(async (transaction) => {
      const shift = await transaction.findShiftForUpdate(actor.restaurantId, command.shiftId);
      if (!shift) throw shiftNotFound();
      if (shift.status === "CLOSED") {
        throw new DomainError(
          "CASHIER_SHIFT_CLOSED",
          "Kapatılmış vardiyaya kasa hareketi eklenemez.",
          { httpStatus: 409 },
        );
      }
      // A cashier owns only their own drawer; a supervisor may act on any open
      // shift in their restaurant.
      if (shift.openedByStaffId !== actor.userId && !canRoleSuperviseShift(actor.role)) {
        throw shiftNotFound();
      }

      const at = this.clock();
      const movement = await transaction.insertMovement({
        restaurantId: actor.restaurantId,
        cashierShiftId: shift.id,
        type: command.type,
        amount: command.amount,
        reason,
        note: command.note?.trim() || null,
        createdByStaffId: actor.userId,
        at,
      });

      const payload = {
        shiftId: shift.id,
        movementId: movement.id,
        type: command.type,
        amount: command.amount,
        reason,
        createdAt: at.toISOString(),
      };
      await transaction.insertOutboxEvent({
        restaurantId: actor.restaurantId,
        aggregateType: "CASHIER_SHIFT",
        aggregateId: shift.id,
        eventType: "CASH_DRAWER_MOVEMENT_RECORDED",
        payload,
      });
      await transaction.insertAuditLog({
        restaurantId: actor.restaurantId,
        actorUserId: actor.userId,
        action:
          command.type === "CASH_IN" ? "cash_drawer.cash_in" : "cash_drawer.cash_out",
        entityType: "CASH_DRAWER_MOVEMENT",
        entityId: movement.id,
        oldValue: null,
        newValue: { type: command.type, amount: command.amount },
        metadata: { shiftId: shift.id, reason, note: command.note?.trim() || null },
        requestId: command.requestId,
      });

      const totals = await transaction.ledgerTotals(actor.restaurantId, shift.id);
      return { movement, summary: totalsToSummary(shift.openingCash, totals) };
    });
  }

  /** The cashier's own open shift, or the state needed to open one. */
  async current(
    principal: RestaurantPrincipal | null | undefined,
  ): Promise<CurrentShiftResult> {
    const actor = this.authorize(principal, SHIFT_OPERATOR_ROLES, "Kasa görüntüleme");

    const [shift, registers] = await Promise.all([
      this.repository.findOpenShiftByStaff(actor.restaurantId, actor.userId),
      this.repository.listOpenRegisters(actor.restaurantId),
    ]);
    const availableRegisters = registers.map((register) => ({
      id: register.id,
      name: register.name,
    }));
    if (!shift) {
      return { shift: null, summary: null, movements: [], availableRegisters };
    }

    const [totals, movements] = await Promise.all([
      this.repository.ledgerTotals(actor.restaurantId, shift.id),
      this.repository.listMovements(actor.restaurantId, shift.id),
    ]);
    return {
      shift: toView(shift),
      // A drawer counted for this shift, or null on a legacy one. Read
      // back rather than recomputed, so history stays what was agreed.
      cashCounts: toCashCountViews(
        await this.repository.listCashCounts(actor.restaurantId, shift.id),
      ),
      summary: totalsToSummary(shift.openingCash, totals),
      movements,
      availableRegisters,
    };
  }

  /**
   * One shift's detail. A cashier may read their own shifts; supervisors may
   * read any shift in their restaurant.
   */
  async detail(
    principal: RestaurantPrincipal | null | undefined,
    shiftId: string,
  ): Promise<ShiftDetailResult> {
    const actor = this.authorize(principal, SHIFT_OPERATOR_ROLES, "Vardiya görüntüleme");
    const shift = await this.repository.findShift(actor.restaurantId, shiftId);
    if (!shift) throw shiftNotFound();
    if (shift.openedByStaffId !== actor.userId && !canRoleSuperviseShift(actor.role)) {
      throw shiftNotFound();
    }

    const [totals, movements] = await Promise.all([
      this.repository.ledgerTotals(actor.restaurantId, shift.id),
      this.repository.listMovements(actor.restaurantId, shift.id),
    ]);
    const summary = totalsToSummary(shift.openingCash, totals);
    return {
      shift: toView(shift),
      // A drawer counted for this shift, or null on a legacy one. Read
      // back rather than recomputed, so history stays what was agreed.
      cashCounts: toCashCountViews(
        await this.repository.listCashCounts(actor.restaurantId, shift.id),
      ),
      // A closed shift reports the drawer it was counted against, not a figure
      // recomputed from rows that may have moved since.
      summary:
        shift.status === "CLOSED" && shift.expectedCashAtClose !== null
          ? { ...summary, expectedCash: shift.expectedCashAtClose }
          : summary,
      movements,
    };
  }

  /**
   * Shift history, always paginated. A cashier sees only their own shifts;
   * the filter is applied server-side and cannot be widened by the client.
   */
  async history(
    principal: RestaurantPrincipal | null | undefined,
    query: {
      readonly status?: "OPEN" | "CLOSED";
      readonly cashRegisterId?: string;
      readonly openedByStaffId?: string;
      readonly from?: Date;
      readonly to?: Date;
      readonly page: number;
      readonly pageSize: number;
    },
  ): Promise<ShiftHistoryPage> {
    const actor = this.authorize(principal, SHIFT_OPERATOR_ROLES, "Vardiya geçmişi");
    const supervisor = canRoleSuperviseShift(actor.role);

    return this.repository.listShifts({
      restaurantId: actor.restaurantId,
      status: query.status,
      cashRegisterId: query.cashRegisterId,
      openedByStaffId: supervisor ? query.openedByStaffId : actor.userId,
      from: query.from,
      to: query.to,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  private authorize(
    principal: RestaurantPrincipal | null | undefined,
    allowedRoles: readonly UserRole[],
    action: string,
  ): RestaurantPrincipal {
    const decision = authorizeRestaurantAccess(principal, principal?.restaurantId ?? "", {
      allowedRoles,
    });
    if (decision.allowed) return decision.principal;
    const authenticationFailure = decision.reason === "AUTHENTICATION_REQUIRED";
    throw new DomainError(
      authenticationFailure ? "AUTHENTICATION_REQUIRED" : "FORBIDDEN",
      authenticationFailure ? "Oturum açmanız gerekiyor." : `${action} yetkiniz yok.`,
      { httpStatus: authenticationFailure ? 401 : 403 },
    );
  }
}

export { SHIFT_SUPERVISOR_ROLES };
export type { CashierShiftTransactionRepository };
