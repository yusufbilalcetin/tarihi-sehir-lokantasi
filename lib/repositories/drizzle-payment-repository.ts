import "server-only";

import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";

import { OPEN_ORDER_STATUSES } from "@/lib/domain/status";
import type { Database } from "@/db";
import {
  auditLogs,
  cashierShifts,
  orderChecks,
  orderEvents,
  orders,
  outboxEvents,
  paymentRefunds,
  payments,
  restaurantTables,
} from "@/db/schema";
import type {
  InsertAuditLogInput,
  InsertOrderEventInput,
  InsertOutboxEventInput,
} from "./order-repository";
import type {
  ActiveCashierShiftRecord,
  CheckBalanceRecord,
  CompleteOrderInput,
  InsertPaymentInput,
  InsertRefundInput,
  PayableOrderRecord,
  PaymentRecord,
  PaymentRepository,
  PaymentTransactionRepository,
  RefundRecord,
} from "./payment-repository";

type TransactionDatabase = Parameters<Parameters<Database["transaction"]>[0]>[0];

const PAYMENT_SELECTION = {
  id: payments.id,
  orderId: payments.orderId,
  checkId: payments.checkId,
  amount: payments.amount,
  refundedAmount: payments.refundedAmount,
  method: payments.method,
  status: payments.status,
  idempotencyKeyHash: sql<string | null>`${payments.metadata}->>'idempotencyKeyHash'`,
  processedAt: payments.processedAt,
  createdAt: payments.createdAt,
} as const;

const REFUND_SELECTION = {
  id: paymentRefunds.id,
  paymentId: paymentRefunds.paymentId,
  orderId: paymentRefunds.orderId,
  amount: paymentRefunds.amount,
  reasonCode: paymentRefunds.reasonCode,
  note: paymentRefunds.note,
  createdAt: paymentRefunds.createdAt,
} as const;

class DrizzlePaymentTransactionRepository implements PaymentTransactionRepository {
  constructor(private readonly db: TransactionDatabase) {}

  async findActiveShiftForUpdate(
    restaurantId: string,
    staffId: string,
  ): Promise<ActiveCashierShiftRecord | null> {
    const rows = await this.db
      .select({
        id: cashierShifts.id,
        cashRegisterId: cashierShifts.cashRegisterId,
        openedByStaffId: cashierShifts.openedByStaffId,
      })
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

  async findPayableOrderForUpdate(
    restaurantId: string,
    orderId: string,
  ): Promise<PayableOrderRecord | null> {
    const rows = await this.db
      .select({
        id: orders.id,
        restaurantId: orders.restaurantId,
        orderNumber: orders.orderNumber,
        status: orders.status,
        total: orders.total,
        version: orders.version,
        channel: orders.channel,
        tableId: restaurantTables.id,
        tableName: restaurantTables.name,
        tableNumber: restaurantTables.tableNumber,
      })
      .from(orders)
      // A takeaway or courier order has no table. An inner join here would
      // drop it from this query entirely rather than show it without one.
      .leftJoin(
        restaurantTables,
        and(
          eq(restaurantTables.restaurantId, orders.restaurantId),
          eq(restaurantTables.id, orders.tableId),
        ),
      )
      .where(and(eq(orders.restaurantId, restaurantId), eq(orders.id, orderId)))
      .for("update", { of: orders })
      .limit(1);
    return rows[0] ?? null;
  }

  async listPaymentsForOrder(
    restaurantId: string,
    orderId: string,
  ): Promise<readonly PaymentRecord[]> {
    return this.db
      .select(PAYMENT_SELECTION)
      .from(payments)
      .where(and(eq(payments.restaurantId, restaurantId), eq(payments.orderId, orderId)))
      .orderBy(asc(payments.createdAt))
      .for("update");
  }

  async findPaymentByIdempotencyKey(
    restaurantId: string,
    keyHash: string,
  ): Promise<PaymentRecord | null> {
    const rows = await this.db
      .select(PAYMENT_SELECTION)
      .from(payments)
      .where(
        and(
          eq(payments.restaurantId, restaurantId),
          sql`${payments.metadata}->>'idempotencyKeyHash' = ${keyHash}`,
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async findPaymentForUpdate(
    restaurantId: string,
    paymentId: string,
  ): Promise<PaymentRecord | null> {
    const rows = await this.db
      .select(PAYMENT_SELECTION)
      .from(payments)
      .where(and(eq(payments.restaurantId, restaurantId), eq(payments.id, paymentId)))
      .for("update")
      .limit(1);
    return rows[0] ?? null;
  }

  async findRefundByIdempotencyKey(
    restaurantId: string,
    keyHash: string,
  ): Promise<RefundRecord | null> {
    const rows = await this.db
      .select(REFUND_SELECTION)
      .from(paymentRefunds)
      .where(
        and(
          eq(paymentRefunds.restaurantId, restaurantId),
          sql`${paymentRefunds.metadata}->>'idempotencyKeyHash' = ${keyHash}`,
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async insertPayment(input: InsertPaymentInput): Promise<PaymentRecord | null> {
    const rows = await this.db
      .insert(payments)
      .values({
        restaurantId: input.restaurantId,
        orderId: input.orderId,
        checkId: input.checkId,
        cashierShiftId: input.cashierShiftId,
        amount: input.amount,
        method: input.method,
        status: "COMPLETED",
        createdByUserId: input.createdByUserId,
        metadata: { idempotencyKeyHash: input.idempotencyKeyHash },
        processedAt: input.at,
        createdAt: input.at,
        updatedAt: input.at,
      })
      // The idempotency unique index is the final guard if two retries race
      // past the order row lock through separate connections.
      .onConflictDoNothing()
      .returning(PAYMENT_SELECTION);
    return rows[0] ?? null;
  }

  async insertRefund(input: InsertRefundInput): Promise<RefundRecord | null> {
    const rows = await this.db
      .insert(paymentRefunds)
      .values({
        restaurantId: input.restaurantId,
        paymentId: input.paymentId,
        orderId: input.orderId,
        cashierShiftId: input.cashierShiftId,
        amount: input.amount,
        reasonCode: input.reasonCode as (typeof paymentRefunds.$inferInsert)["reasonCode"],
        note: input.note,
        status: "COMPLETED",
        createdByUserId: input.createdByUserId,
        metadata: { idempotencyKeyHash: input.idempotencyKeyHash },
        createdAt: input.at,
      })
      .onConflictDoNothing()
      .returning(REFUND_SELECTION);
    return rows[0] ?? null;
  }

  async addPaymentRefundedAmount(input: {
    restaurantId: string;
    paymentId: string;
    amount: string;
    at: Date;
  }): Promise<boolean> {
    // The table's own check constraint refuses to let refunds exceed the
    // payment, so this is a second, database-level guard on the arithmetic.
    const rows = await this.db
      .update(payments)
      .set({
        refundedAmount: sql`${payments.refundedAmount} + ${input.amount}`,
        updatedAt: input.at,
      })
      .where(
        and(eq(payments.restaurantId, input.restaurantId), eq(payments.id, input.paymentId)),
      )
      .returning({ id: payments.id });
    return Boolean(rows[0]);
  }

  async markTableOccupied(restaurantId: string, tableId: string, at: Date): Promise<void> {
    await this.db
      .update(restaurantTables)
      .set({ currentStatus: "OCCUPIED", updatedAt: at })
      .where(
        and(
          eq(restaurantTables.restaurantId, restaurantId),
          eq(restaurantTables.id, tableId),
        ),
      );
  }

  async findCheckForUpdate(
    restaurantId: string,
    checkId: string,
  ): Promise<CheckBalanceRecord | null> {
    const rows = await this.db
      .select({
        id: orderChecks.id,
        orderId: orderChecks.orderId,
        label: orderChecks.label,
        status: orderChecks.status,
        total: orderChecks.total,
      })
      .from(orderChecks)
      .where(and(eq(orderChecks.restaurantId, restaurantId), eq(orderChecks.id, checkId)))
      .for("update")
      .limit(1);
    const check = rows[0];
    if (!check) return null;

    const collected = await this.db
      .select({
        paid: sql<string>`coalesce(sum(${payments.amount}), 0)`,
        refunded: sql<string>`coalesce(sum(${payments.refundedAmount}), 0)`,
      })
      .from(payments)
      .where(
        and(
          eq(payments.restaurantId, restaurantId),
          eq(payments.checkId, checkId),
          eq(payments.status, "COMPLETED"),
        ),
      );
    return {
      ...check,
      paidTotal: collected[0]?.paid ?? "0.00",
      refundedTotal: collected[0]?.refunded ?? "0.00",
    };
  }

  async markCheckPaid(restaurantId: string, checkId: string, at: Date): Promise<boolean> {
    const rows = await this.db
      .update(orderChecks)
      .set({ status: "PAID", closedAt: at, updatedAt: at })
      .where(
        and(
          eq(orderChecks.restaurantId, restaurantId),
          eq(orderChecks.id, checkId),
          eq(orderChecks.status, "OPEN"),
        ),
      )
      .returning({ id: orderChecks.id });
    return Boolean(rows[0]);
  }

  async completeOrder(input: CompleteOrderInput): Promise<boolean> {
    const rows = await this.db
      .update(orders)
      .set({
        status: "COMPLETED",
        version: input.currentVersion + 1,
        closedAt: input.at,
        updatedAt: input.at,
      })
      .where(
        and(
          eq(orders.restaurantId, input.restaurantId),
          eq(orders.id, input.orderId),
          eq(orders.version, input.currentVersion),
          eq(orders.status, "SERVED"),
        ),
      )
      .returning({ id: orders.id });
    return rows.length > 0;
  }

  async hasOtherOpenOrders(
    restaurantId: string,
    tableId: string,
    excludeOrderId: string,
  ): Promise<boolean> {
    const rows = await this.db
      .select({ id: orders.id })
      .from(orders)
      .where(
        and(
          eq(orders.restaurantId, restaurantId),
          eq(orders.tableId, tableId),
          ne(orders.id, excludeOrderId),
          inArray(orders.status, [...OPEN_ORDER_STATUSES]),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async markTableAvailable(restaurantId: string, tableId: string, at: Date): Promise<void> {
    await this.db
      .update(restaurantTables)
      .set({ currentStatus: "AVAILABLE", updatedAt: at })
      .where(
        and(
          eq(restaurantTables.restaurantId, restaurantId),
          eq(restaurantTables.id, tableId),
        ),
      );
  }

  async insertOrderEvent(input: InsertOrderEventInput): Promise<void> {
    await this.db.insert(orderEvents).values(input);
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

export class DrizzlePaymentRepository implements PaymentRepository {
  constructor(private readonly db: Database) {}

  transaction<TResult>(
    work: (repository: PaymentTransactionRepository) => Promise<TResult>,
  ): Promise<TResult> {
    return this.db.transaction((transaction) =>
      work(new DrizzlePaymentTransactionRepository(transaction)),
    );
  }
}
