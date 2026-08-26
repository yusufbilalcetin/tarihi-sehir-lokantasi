import "server-only";

import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  or,
  sql,
  type AnyColumn,
  type SQL,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { Database } from "@/db";
import {
  auditLogs,
  cashDrawerMovements,
  cashRegisters,
  cashierShifts,
  orderItems,
  orders,
  outboxEvents,
  paymentRefunds,
  payments,
  restaurants,
  staffProfiles,
} from "@/db/schema";
import { PAYMENT_METHODS, type PaymentMethod } from "@/lib/domain/status";
import type {
  InsertAuditLogInput,
  InsertOutboxEventInput,
} from "./order-repository";
import type {
  CashDrawerMovementRecord,
  CashRegisterRecord,
  CashierShiftRecord,
  CashierShiftRepository,
  CashierShiftTransactionRepository,
  CloseShiftInput,
  DailyExceptionRow,
  DailyGroupTotals,
  DailyMoneyTotals,
  DailyShiftRow,
  DailyWindow,
  InsertCashMovementInput,
  OpenShiftInput,
  ShiftHistoryPage,
  ShiftHistoryQuery,
  ShiftHistoryRow,
  ShiftLedgerTotals,
  ShiftSnapshotContext,
} from "./cashier-shift-repository";

type TransactionDatabase = Parameters<Parameters<Database["transaction"]>[0]>[0];
type AnyDatabase = Database | TransactionDatabase;

const SHIFT_SELECTION = {
  id: cashierShifts.id,
  cashRegisterId: cashierShifts.cashRegisterId,
  registerNameSnapshot: cashierShifts.registerNameSnapshot,
  openedByStaffId: cashierShifts.openedByStaffId,
  openedAt: cashierShifts.openedAt,
  openingCash: cashierShifts.openingCash,
  status: cashierShifts.status,
  closedAt: cashierShifts.closedAt,
  closedByStaffId: cashierShifts.closedByStaffId,
  countedCashAtClose: cashierShifts.countedCashAtClose,
  expectedCashAtClose: cashierShifts.expectedCashAtClose,
  cashVariance: cashierShifts.cashVariance,
  closeNote: cashierShifts.closeNote,
  zReportVersion: cashierShifts.zReportVersion,
  zReportGeneratedAt: cashierShifts.zReportGeneratedAt,
  zReportSnapshot: cashierShifts.zReportSnapshot,
} as const;

const REGISTER_SELECTION = {
  id: cashRegisters.id,
  name: cashRegisters.name,
  code: cashRegisters.code,
  isActive: cashRegisters.isActive,
  deletedAt: cashRegisters.deletedAt,
} as const;

const MOVEMENT_SELECTION = {
  id: cashDrawerMovements.id,
  type: cashDrawerMovements.type,
  amount: cashDrawerMovements.amount,
  reason: cashDrawerMovements.reason,
  note: cashDrawerMovements.note,
  createdByStaffId: cashDrawerMovements.createdByStaffId,
  createdAt: cashDrawerMovements.createdAt,
} as const;

const openerProfile = alias(staffProfiles, "opener_profile");
const closerProfile = alias(staffProfiles, "closer_profile");

const ZERO = "0.00";

/** Zeroed per-method totals, so a method with no rows is still present. */
function emptyMethodTotals(): Record<PaymentMethod, { amount: string; count: number }> {
  return Object.fromEntries(
    PAYMENT_METHODS.map((method) => [method, { amount: ZERO, count: 0 }]),
  ) as Record<PaymentMethod, { amount: string; count: number }>;
}

/**
 * One `sum`/`count` pair per payment method, built from the enum rather than a
 * hand-written list so a method added later is aggregated automatically.
 *
 * Every money aggregate is cast to `numeric(12, 2)`. Without it the `0` in
 * `coalesce(sum(...), 0)` is an *integer* literal, so an empty aggregate comes
 * back as the string `"0"` while every populated one comes back as `"0.00"`
 * shaped money. That inconsistency would be frozen into a Z snapshot and shown
 * in a report, so the scale is pinned in SQL rather than patched per reader.
 */
function methodAggregates(amountColumn: AnyColumn, methodColumn: AnyColumn) {
  const selection: Record<string, SQL<string> | SQL<number>> = {};
  for (const method of PAYMENT_METHODS) {
    selection[`amount_${method}`] = sql<string>`coalesce(sum(${amountColumn}) filter (where ${methodColumn} = ${method}), 0)::numeric(12, 2)`;
    selection[`count_${method}`] = sql<number>`count(*) filter (where ${methodColumn} = ${method})::int`;
  }
  return selection;
}

function readMethodTotals(
  row: Record<string, unknown> | undefined,
): Record<PaymentMethod, { amount: string; count: number }> {
  const totals = emptyMethodTotals();
  if (!row) return totals;
  for (const method of PAYMENT_METHODS) {
    totals[method] = {
      amount: String(row[`amount_${method}`] ?? ZERO),
      count: Number(row[`count_${method}`] ?? 0),
    };
  }
  return totals;
}

/**
 * All shift money is aggregated in one round trip, in SQL.
 *
 * The refund half joins back to `payments` on purpose: a refund row carries no
 * method of its own, so whether the money left the drawer is decided by the
 * method of the payment it reverses — even when that payment belongs to an
 * entirely different (already closed) shift.
 */
async function ledgerTotalsFor(
  db: AnyDatabase,
  restaurantId: string,
  shiftId: string,
): Promise<ShiftLedgerTotals> {
  // Four independent aggregates over the same shift. Awaiting them one at a
  // time cost four network round trips for one drawer view; issued together
  // they share one.
  const [[paymentRow], [pendingRow], [refundRow], [movementTotals]] = await Promise.all([
    db
      .select({
        ...methodAggregates(payments.amount, payments.method),
        pending: sql<number>`count(*) filter (where ${payments.status} = 'PENDING')::int`,
      })
      .from(payments)
      .where(
        and(
          eq(payments.restaurantId, restaurantId),
          eq(payments.cashierShiftId, shiftId),
          eq(payments.status, "COMPLETED"),
        ),
      ),
    // Pending collections are counted separately: they must block a close,
    // but they are not money in the drawer and never enter a total.
    db
      .select({ pending: sql<number>`count(*)::int` })
      .from(payments)
      .where(
        and(
          eq(payments.restaurantId, restaurantId),
          eq(payments.cashierShiftId, shiftId),
          eq(payments.status, "PENDING"),
        ),
      ),
    db
      .select(methodAggregates(paymentRefunds.amount, payments.method))
      .from(paymentRefunds)
      .innerJoin(
        payments,
        and(
          eq(payments.restaurantId, paymentRefunds.restaurantId),
          eq(payments.id, paymentRefunds.paymentId),
        ),
      )
      .where(
        and(
          eq(paymentRefunds.restaurantId, restaurantId),
          eq(paymentRefunds.cashierShiftId, shiftId),
          eq(paymentRefunds.status, "COMPLETED"),
        ),
      ),
    db
      .select({
        cashIn: sql<string>`coalesce(sum(${cashDrawerMovements.amount}) filter (where ${cashDrawerMovements.type} = 'CASH_IN'), 0)::numeric(12, 2)`,
        cashOut: sql<string>`coalesce(sum(${cashDrawerMovements.amount}) filter (where ${cashDrawerMovements.type} = 'CASH_OUT'), 0)::numeric(12, 2)`,
        count: sql<number>`count(*)::int`,
      })
      .from(cashDrawerMovements)
      .where(
        and(
          eq(cashDrawerMovements.restaurantId, restaurantId),
          eq(cashDrawerMovements.cashierShiftId, shiftId),
        ),
      ),
  ]);

  const paymentsByMethod = readMethodTotals(paymentRow as Record<string, unknown>);
  const refundsByMethod = readMethodTotals(refundRow as Record<string, unknown>);

  return {
    // Flat fields stay derived from the same aggregate the breakdown uses, so
    // the two can never disagree.
    cashPayments: paymentsByMethod.CASH.amount,
    cardPayments: paymentsByMethod.CARD.amount,
    otherPayments: paymentsByMethod.OTHER.amount,
    paymentCount: PAYMENT_METHODS.reduce(
      (total, method) => total + paymentsByMethod[method].count,
      0,
    ),
    cashRefunds: refundsByMethod.CASH.amount,
    cardRefunds: refundsByMethod.CARD.amount,
    otherRefunds: refundsByMethod.OTHER.amount,
    refundCount: PAYMENT_METHODS.reduce(
      (total, method) => total + refundsByMethod[method].count,
      0,
    ),
    cashIn: movementTotals?.cashIn ?? ZERO,
    cashOut: movementTotals?.cashOut ?? ZERO,
    movementCount: Number(movementTotals?.count ?? 0),
    pendingPaymentCount: Number(pendingRow?.pending ?? 0),
    paymentsByMethod,
    refundsByMethod,
  };
}

async function snapshotContextFor(
  db: AnyDatabase,
  restaurantId: string,
  openedByStaffId: string,
  closedByStaffId: string,
): Promise<ShiftSnapshotContext> {
  const [restaurant] = await db
    .select({ name: restaurants.name })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);
  const staff = await db
    .select({ id: staffProfiles.id, name: staffProfiles.name })
    .from(staffProfiles)
    .where(
      and(
        eq(staffProfiles.restaurantId, restaurantId),
        inArray(staffProfiles.id, [...new Set([openedByStaffId, closedByStaffId])]),
      ),
    );
  const nameOf = (id: string): string | null =>
    staff.find((row) => row.id === id)?.name ?? null;

  return {
    restaurantName: restaurant?.name ?? "",
    openedByName: nameOf(openedByStaffId),
    closedByName: nameOf(closedByStaffId),
  };
}

async function listMovementsFor(
  db: AnyDatabase,
  restaurantId: string,
  shiftId: string,
): Promise<readonly CashDrawerMovementRecord[]> {
  return db
    .select({
      ...MOVEMENT_SELECTION,
      createdByName: sql<string | null>`${staffProfiles.name}`,
    })
    .from(cashDrawerMovements)
    .leftJoin(
      staffProfiles,
      and(
        eq(staffProfiles.restaurantId, cashDrawerMovements.restaurantId),
        eq(staffProfiles.id, cashDrawerMovements.createdByStaffId),
      ),
    )
    .where(
      and(
        eq(cashDrawerMovements.restaurantId, restaurantId),
        eq(cashDrawerMovements.cashierShiftId, shiftId),
      ),
    )
    .orderBy(asc(cashDrawerMovements.createdAt), asc(cashDrawerMovements.id));
}

class DrizzleCashierShiftTransactionRepository
  implements CashierShiftTransactionRepository
{
  constructor(private readonly db: TransactionDatabase) {}

  async findRegisterForUpdate(
    restaurantId: string,
    registerId: string,
  ): Promise<CashRegisterRecord | null> {
    const rows = await this.db
      .select(REGISTER_SELECTION)
      .from(cashRegisters)
      .where(
        and(eq(cashRegisters.restaurantId, restaurantId), eq(cashRegisters.id, registerId)),
      )
      .for("update")
      .limit(1);
    return rows[0] ?? null;
  }

  async findShiftForUpdate(
    restaurantId: string,
    shiftId: string,
  ): Promise<CashierShiftRecord | null> {
    const rows = await this.db
      .select(SHIFT_SELECTION)
      .from(cashierShifts)
      .where(
        and(eq(cashierShifts.restaurantId, restaurantId), eq(cashierShifts.id, shiftId)),
      )
      .for("update")
      .limit(1);
    return rows[0] ?? null;
  }

  async findOpenShiftByStaff(
    restaurantId: string,
    staffId: string,
  ): Promise<CashierShiftRecord | null> {
    const rows = await this.db
      .select(SHIFT_SELECTION)
      .from(cashierShifts)
      .where(
        and(
          eq(cashierShifts.restaurantId, restaurantId),
          eq(cashierShifts.openedByStaffId, staffId),
          eq(cashierShifts.status, "OPEN"),
        ),
      )
      .for("update")
      .limit(1);
    return rows[0] ?? null;
  }

  async insertShift(input: OpenShiftInput): Promise<CashierShiftRecord | null> {
    const rows = await this.db
      .insert(cashierShifts)
      .values({
        restaurantId: input.restaurantId,
        cashRegisterId: input.cashRegisterId,
        registerNameSnapshot: input.registerNameSnapshot,
        openedByStaffId: input.openedByStaffId,
        openedAt: input.at,
        openingCash: input.openingCash,
        status: "OPEN",
        createdAt: input.at,
        updatedAt: input.at,
      })
      // Either partial unique index (one open shift per register, one per
      // cashier) may reject this; both mean "somebody already opened it".
      .onConflictDoNothing()
      .returning(SHIFT_SELECTION);
    return rows[0] ?? null;
  }

  async closeShift(input: CloseShiftInput): Promise<CashierShiftRecord | null> {
    const rows = await this.db
      .update(cashierShifts)
      .set({
        status: "CLOSED",
        closedAt: input.at,
        closedByStaffId: input.closedByStaffId,
        countedCashAtClose: input.countedCash,
        expectedCashAtClose: input.expectedCash,
        cashVariance: input.cashVariance,
        closeNote: input.closeNote,
        // Same statement as the close: a CLOSED shift without its Z report
        // cannot exist, not even for an instant.
        zReportVersion: input.zReportVersion,
        zReportGeneratedAt: input.at,
        zReportSnapshot: input.zReportSnapshot,
        updatedAt: input.at,
      })
      .where(
        and(
          eq(cashierShifts.restaurantId, input.restaurantId),
          eq(cashierShifts.id, input.shiftId),
          // Only an OPEN shift can be closed; a second close matches nothing,
          // so a duplicate Z snapshot is impossible.
          eq(cashierShifts.status, "OPEN"),
        ),
      )
      .returning(SHIFT_SELECTION);
    return rows[0] ?? null;
  }

  async insertMovement(
    input: InsertCashMovementInput,
  ): Promise<CashDrawerMovementRecord> {
    const rows = await this.db
      .insert(cashDrawerMovements)
      .values({
        restaurantId: input.restaurantId,
        cashierShiftId: input.cashierShiftId,
        type: input.type,
        amount: input.amount,
        reason: input.reason,
        note: input.note,
        createdByStaffId: input.createdByStaffId,
        createdAt: input.at,
      })
      .returning(MOVEMENT_SELECTION);
    const movement = rows[0];
    if (!movement) throw new Error("Cash drawer movement could not be recorded.");
    return { ...movement, createdByName: null };
  }

  ledgerTotals(restaurantId: string, shiftId: string): Promise<ShiftLedgerTotals> {
    return ledgerTotalsFor(this.db, restaurantId, shiftId);
  }

  listMovements(
    restaurantId: string,
    shiftId: string,
  ): Promise<readonly CashDrawerMovementRecord[]> {
    return listMovementsFor(this.db, restaurantId, shiftId);
  }

  findSnapshotContext(
    restaurantId: string,
    openedByStaffId: string,
    closedByStaffId: string,
  ): Promise<ShiftSnapshotContext> {
    return snapshotContextFor(this.db, restaurantId, openedByStaffId, closedByStaffId);
  }

  async insertOutboxEvent(input: InsertOutboxEventInput): Promise<void> {
    await this.db.insert(outboxEvents).values(input);
  }

  async insertAuditLog(input: InsertAuditLogInput): Promise<void> {
    await this.db.insert(auditLogs).values({
      restaurantId: input.restaurantId,
      actorUserId: input.actorUserId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      oldValue: input.oldValue,
      newValue: input.newValue,
      metadata: input.metadata ?? {},
      requestId: input.requestId,
    });
  }
}

export class DrizzleCashierShiftRepository implements CashierShiftRepository {
  constructor(private readonly db: Database) {}

  transaction<TResult>(
    work: (repository: CashierShiftTransactionRepository) => Promise<TResult>,
  ): Promise<TResult> {
    return this.db.transaction((transaction) =>
      work(new DrizzleCashierShiftTransactionRepository(transaction)),
    );
  }

  /** Opener and closer are two different staff rows, so the table is aliased. */
  private historySelection() {
    return this.db
      .select({
        ...SHIFT_SELECTION,
        openedByName: sql<string | null>`${openerProfile.name}`,
        closedByName: sql<string | null>`${closerProfile.name}`,
      })
      .from(cashierShifts)
      .leftJoin(
        openerProfile,
        and(
          eq(openerProfile.restaurantId, cashierShifts.restaurantId),
          eq(openerProfile.id, cashierShifts.openedByStaffId),
        ),
      )
      .leftJoin(
        closerProfile,
        and(
          eq(closerProfile.restaurantId, cashierShifts.restaurantId),
          eq(closerProfile.id, cashierShifts.closedByStaffId),
        ),
      );
  }

  async findShift(restaurantId: string, shiftId: string): Promise<ShiftHistoryRow | null> {
    const rows = await this.historySelection()
      .where(
        and(eq(cashierShifts.restaurantId, restaurantId), eq(cashierShifts.id, shiftId)),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async findOpenShiftByStaff(
    restaurantId: string,
    staffId: string,
  ): Promise<ShiftHistoryRow | null> {
    const rows = await this.historySelection()
      .where(
        and(
          eq(cashierShifts.restaurantId, restaurantId),
          eq(cashierShifts.openedByStaffId, staffId),
          eq(cashierShifts.status, "OPEN"),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  ledgerTotals(restaurantId: string, shiftId: string): Promise<ShiftLedgerTotals> {
    return ledgerTotalsFor(this.db, restaurantId, shiftId);
  }

  listMovements(
    restaurantId: string,
    shiftId: string,
  ): Promise<readonly CashDrawerMovementRecord[]> {
    return listMovementsFor(this.db, restaurantId, shiftId);
  }

  async listShifts(query: ShiftHistoryQuery): Promise<ShiftHistoryPage> {
    const predicates = [
      eq(cashierShifts.restaurantId, query.restaurantId),
      ...(query.status ? [eq(cashierShifts.status, query.status)] : []),
      ...(query.cashRegisterId
        ? [eq(cashierShifts.cashRegisterId, query.cashRegisterId)]
        : []),
      ...(query.openedByStaffId
        ? [eq(cashierShifts.openedByStaffId, query.openedByStaffId)]
        : []),
      ...(query.from ? [gte(cashierShifts.openedAt, query.from)] : []),
      ...(query.to ? [lt(cashierShifts.openedAt, query.to)] : []),
    ];
    const where = and(...predicates);

    const [counted] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(cashierShifts)
      .where(where);

    // Server-side pagination with a stable tie-break, so page 2 can never
    // repeat or skip a row that shares an opened_at with another.
    const rows = await this.historySelection()
      .where(where)
      .orderBy(desc(cashierShifts.openedAt), desc(cashierShifts.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    return {
      rows,
      total: Number(counted?.total ?? 0),
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  listOpenRegisters(restaurantId: string): Promise<readonly CashRegisterRecord[]> {
    return this.db
      .select(REGISTER_SELECTION)
      .from(cashRegisters)
      .where(
        and(
          eq(cashRegisters.restaurantId, restaurantId),
          eq(cashRegisters.isActive, true),
          sql`${cashRegisters.deletedAt} is null`,
        ),
      )
      .orderBy(asc(cashRegisters.name));
  }

  async findRestaurantName(restaurantId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ name: restaurants.name })
      .from(restaurants)
      .where(eq(restaurants.id, restaurantId))
      .limit(1);
    return row?.name ?? null;
  }

  /**
   * Daily scoping runs on the *transaction* timestamp, joined to the shift only
   * to honour a register/cashier filter. A shift that crosses midnight
   * therefore contributes each collection to the day it actually happened on,
   * instead of dumping its whole take on the day it closed.
   *
   * The window bounds arrive as typed `Date` values through the query builder,
   * never as raw SQL parameters, so the driver keeps their timestamptz type.
   */
  private paymentScope(window: DailyWindow) {
    return and(
      eq(payments.restaurantId, window.restaurantId),
      eq(payments.status, "COMPLETED"),
      gte(payments.createdAt, window.start),
      lt(payments.createdAt, window.endExclusive),
      ...(window.cashRegisterId || window.cashierId
        ? [
            sql`exists (
              select 1 from ${cashierShifts}
              where ${cashierShifts.id} = ${payments.cashierShiftId}
                and ${cashierShifts.restaurantId} = ${payments.restaurantId}
                ${window.cashRegisterId ? sql`and ${cashierShifts.cashRegisterId} = ${window.cashRegisterId}` : sql``}
                ${window.cashierId ? sql`and ${cashierShifts.openedByStaffId} = ${window.cashierId}` : sql``}
            )`,
          ]
        : []),
    );
  }

  private refundScope(window: DailyWindow) {
    return and(
      eq(paymentRefunds.restaurantId, window.restaurantId),
      eq(paymentRefunds.status, "COMPLETED"),
      gte(paymentRefunds.createdAt, window.start),
      lt(paymentRefunds.createdAt, window.endExclusive),
      ...(window.cashRegisterId || window.cashierId
        ? [
            sql`exists (
              select 1 from ${cashierShifts}
              where ${cashierShifts.id} = ${paymentRefunds.cashierShiftId}
                and ${cashierShifts.restaurantId} = ${paymentRefunds.restaurantId}
                ${window.cashRegisterId ? sql`and ${cashierShifts.cashRegisterId} = ${window.cashRegisterId}` : sql``}
                ${window.cashierId ? sql`and ${cashierShifts.openedByStaffId} = ${window.cashierId}` : sql``}
            )`,
          ]
        : []),
    );
  }

  private movementScope(window: DailyWindow) {
    return and(
      eq(cashDrawerMovements.restaurantId, window.restaurantId),
      gte(cashDrawerMovements.createdAt, window.start),
      lt(cashDrawerMovements.createdAt, window.endExclusive),
      ...(window.cashRegisterId || window.cashierId
        ? [
            sql`exists (
              select 1 from ${cashierShifts}
              where ${cashierShifts.id} = ${cashDrawerMovements.cashierShiftId}
                and ${cashierShifts.restaurantId} = ${cashDrawerMovements.restaurantId}
                ${window.cashRegisterId ? sql`and ${cashierShifts.cashRegisterId} = ${window.cashRegisterId}` : sql``}
                ${window.cashierId ? sql`and ${cashierShifts.openedByStaffId} = ${window.cashierId}` : sql``}
            )`,
          ]
        : []),
    );
  }

  async dailyTotals(window: DailyWindow): Promise<DailyMoneyTotals> {
    const [paymentRow] = await this.db
      .select(methodAggregates(payments.amount, payments.method))
      .from(payments)
      .where(this.paymentScope(window));

    const [refundRow] = await this.db
      .select(methodAggregates(paymentRefunds.amount, payments.method))
      .from(paymentRefunds)
      .innerJoin(
        payments,
        and(
          eq(payments.restaurantId, paymentRefunds.restaurantId),
          eq(payments.id, paymentRefunds.paymentId),
        ),
      )
      .where(this.refundScope(window));

    const [movementRow] = await this.db
      .select({
        cashIn: sql<string>`coalesce(sum(${cashDrawerMovements.amount}) filter (where ${cashDrawerMovements.type} = 'CASH_IN'), 0)::numeric(12, 2)`,
        cashOut: sql<string>`coalesce(sum(${cashDrawerMovements.amount}) filter (where ${cashDrawerMovements.type} = 'CASH_OUT'), 0)::numeric(12, 2)`,
        count: sql<number>`count(*)::int`,
      })
      .from(cashDrawerMovements)
      .where(this.movementScope(window));

    return {
      paymentsByMethod: readMethodTotals(paymentRow as Record<string, unknown>),
      refundsByMethod: readMethodTotals(refundRow as Record<string, unknown>),
      cashIn: movementRow?.cashIn ?? ZERO,
      cashOut: movementRow?.cashOut ?? ZERO,
      movementCount: Number(movementRow?.count ?? 0),
    };
  }

  /** Per-register and per-cashier use one shared shape; only the key differs. */
  private async dailyGrouped(
    window: DailyWindow,
    key: "register" | "cashier",
  ): Promise<readonly DailyGroupTotals[]> {
    const idColumn =
      key === "register" ? cashierShifts.cashRegisterId : cashierShifts.openedByStaffId;
    const nameColumn =
      key === "register"
        ? cashierShifts.registerNameSnapshot
        : sql<string>`coalesce(${openerProfile.name}, '')`;

    const paymentRows = await this.db
      .select({
        groupId: sql<string>`${idColumn}`,
        groupName: nameColumn,
        ...methodAggregates(payments.amount, payments.method),
      })
      .from(payments)
      .innerJoin(
        cashierShifts,
        and(
          eq(cashierShifts.restaurantId, payments.restaurantId),
          eq(cashierShifts.id, payments.cashierShiftId),
        ),
      )
      .leftJoin(
        openerProfile,
        and(
          eq(openerProfile.restaurantId, cashierShifts.restaurantId),
          eq(openerProfile.id, cashierShifts.openedByStaffId),
        ),
      )
      .where(this.paymentScope(window))
      .groupBy(idColumn, nameColumn);

    const refundRows = await this.db
      .select({
        groupId: sql<string>`${idColumn}`,
        ...methodAggregates(paymentRefunds.amount, payments.method),
      })
      .from(paymentRefunds)
      .innerJoin(
        payments,
        and(
          eq(payments.restaurantId, paymentRefunds.restaurantId),
          eq(payments.id, paymentRefunds.paymentId),
        ),
      )
      .innerJoin(
        cashierShifts,
        and(
          eq(cashierShifts.restaurantId, paymentRefunds.restaurantId),
          eq(cashierShifts.id, paymentRefunds.cashierShiftId),
        ),
      )
      .where(this.refundScope(window))
      .groupBy(idColumn);

    const movementRows = await this.db
      .select({
        groupId: sql<string>`${idColumn}`,
        cashIn: sql<string>`coalesce(sum(${cashDrawerMovements.amount}) filter (where ${cashDrawerMovements.type} = 'CASH_IN'), 0)::numeric(12, 2)`,
        cashOut: sql<string>`coalesce(sum(${cashDrawerMovements.amount}) filter (where ${cashDrawerMovements.type} = 'CASH_OUT'), 0)::numeric(12, 2)`,
        count: sql<number>`count(*)::int`,
      })
      .from(cashDrawerMovements)
      .innerJoin(
        cashierShifts,
        and(
          eq(cashierShifts.restaurantId, cashDrawerMovements.restaurantId),
          eq(cashierShifts.id, cashDrawerMovements.cashierShiftId),
        ),
      )
      .where(this.movementScope(window))
      .groupBy(idColumn);

    const groups = new Map<string, DailyGroupTotals>();
    const ensure = (groupId: string, groupName: string): DailyGroupTotals => {
      const existing = groups.get(groupId);
      if (existing) return existing;
      const created: DailyGroupTotals = {
        groupId,
        groupName,
        paymentsByMethod: emptyMethodTotals(),
        refundsByMethod: emptyMethodTotals(),
        cashIn: ZERO,
        cashOut: ZERO,
        movementCount: 0,
      };
      groups.set(groupId, created);
      return created;
    };

    for (const row of paymentRows) {
      const record = row as Record<string, unknown>;
      const group = ensure(String(record.groupId), String(record.groupName ?? ""));
      groups.set(group.groupId, { ...group, paymentsByMethod: readMethodTotals(record) });
    }
    for (const row of refundRows) {
      const record = row as Record<string, unknown>;
      const group = ensure(String(record.groupId), "");
      groups.set(group.groupId, { ...group, refundsByMethod: readMethodTotals(record) });
    }
    for (const row of movementRows) {
      const group = ensure(String(row.groupId), "");
      groups.set(group.groupId, {
        ...group,
        cashIn: row.cashIn,
        cashOut: row.cashOut,
        movementCount: Number(row.count ?? 0),
      });
    }
    return [...groups.values()].sort((left, right) =>
      left.groupName.localeCompare(right.groupName, "tr"),
    );
  }

  dailyByRegister(window: DailyWindow): Promise<readonly DailyGroupTotals[]> {
    return this.dailyGrouped(window, "register");
  }

  dailyByCashier(window: DailyWindow): Promise<readonly DailyGroupTotals[]> {
    return this.dailyGrouped(window, "cashier");
  }

  /** Shifts that overlap the day at all: opened, closed or still running. */
  async dailyShifts(window: DailyWindow): Promise<readonly DailyShiftRow[]> {
    return this.db
      .select({
        id: cashierShifts.id,
        cashRegisterId: cashierShifts.cashRegisterId,
        registerNameSnapshot: cashierShifts.registerNameSnapshot,
        openedByStaffId: cashierShifts.openedByStaffId,
        openedByName: sql<string | null>`${openerProfile.name}`,
        openedAt: cashierShifts.openedAt,
        closedAt: cashierShifts.closedAt,
        status: cashierShifts.status,
        expectedCashAtClose: cashierShifts.expectedCashAtClose,
        countedCashAtClose: cashierShifts.countedCashAtClose,
        cashVariance: cashierShifts.cashVariance,
        hasZReport: sql<boolean>`${cashierShifts.zReportSnapshot} is not null`,
      })
      .from(cashierShifts)
      .leftJoin(
        openerProfile,
        and(
          eq(openerProfile.restaurantId, cashierShifts.restaurantId),
          eq(openerProfile.id, cashierShifts.openedByStaffId),
        ),
      )
      .where(
        and(
          eq(cashierShifts.restaurantId, window.restaurantId),
          lt(cashierShifts.openedAt, window.endExclusive),
          // Typed operators, never a raw fragment: a `Date` interpolated into
          // raw SQL carries no column type and the driver cannot bind it.
          or(
            isNull(cashierShifts.closedAt),
            gte(cashierShifts.closedAt, window.start),
          ),
          ...(window.cashRegisterId
            ? [eq(cashierShifts.cashRegisterId, window.cashRegisterId)]
            : []),
          ...(window.cashierId
            ? [eq(cashierShifts.openedByStaffId, window.cashierId)]
            : []),
        ),
      )
      .orderBy(desc(cashierShifts.openedAt), desc(cashierShifts.id));
  }

  /**
   * VOID and CANCEL are order-level corrections with no cash-shift foreign key,
   * so they are reported for the day as a whole and never attributed to a
   * drawer. They do not move expected cash either way.
   */
  async dailyExceptions(window: DailyWindow): Promise<readonly DailyExceptionRow[]> {
    const [voided] = await this.db
      .select({
        count: sql<number>`count(*)::int`,
        amount: sql<string>`coalesce(sum(${orderItems.lineTotal}), 0)::numeric(12, 2)`,
      })
      .from(orderItems)
      .where(
        and(
          eq(orderItems.restaurantId, window.restaurantId),
          gte(orderItems.voidedAt, window.start),
          lt(orderItems.voidedAt, window.endExclusive),
        ),
      );
    const [cancelled] = await this.db
      .select({
        count: sql<number>`count(*)::int`,
        amount: sql<string>`coalesce(sum(${orderItems.lineTotal}), 0)::numeric(12, 2)`,
      })
      .from(orderItems)
      .innerJoin(
        orders,
        and(
          eq(orders.restaurantId, orderItems.restaurantId),
          eq(orders.id, orderItems.orderId),
        ),
      )
      .where(
        and(
          eq(orderItems.restaurantId, window.restaurantId),
          gte(orderItems.cancelledAt, window.start),
          lt(orderItems.cancelledAt, window.endExclusive),
        ),
      );

    return [
      { kind: "VOID", count: Number(voided?.count ?? 0), amount: voided?.amount ?? ZERO },
      {
        kind: "CANCEL",
        count: Number(cancelled?.count ?? 0),
        amount: cancelled?.amount ?? ZERO,
      },
    ];
  }
}
