import "server-only";

import { and, asc, count, eq, inArray, sql } from "drizzle-orm";

import type { Database } from "@/db";
import {
  auditLogs,
  orderChecks,
  orders,
  outboxEvents,
  payments,
  restaurantTables,
  waiterCalls,
} from "@/db/schema";
import { OPEN_ORDER_STATUSES } from "@/lib/domain/table-operations";
import type { TableStatus } from "@/lib/domain/status";
import type {
  TableCheckBalanceRecord,
  TableOrderBalanceRecord,
  TableOperationAuditInput,
  TableOperationCallRecord,
  TableOperationOrderRecord,
  TableOperationOutboxInput,
  TableOperationTableRecord,
  TableOperationsRepository,
  TableOperationsTransactionRepository,
} from "./table-operations-repository";

type TransactionDatabase = Parameters<Parameters<Database["transaction"]>[0]>[0];

const ACTIVE_CALL_STATUSES = ["OPEN", "ACKNOWLEDGED"] as const;

class DrizzleTableOperationsTransactionRepository
  implements TableOperationsTransactionRepository
{
  constructor(private readonly db: TransactionDatabase) {}

  async findTablesForUpdate(
    restaurantId: string,
    tableIds: readonly string[],
  ): Promise<readonly TableOperationTableRecord[]> {
    if (tableIds.length === 0) return [];
    return this.db
      .select({
        id: restaurantTables.id,
        name: restaurantTables.name,
        tableNumber: restaurantTables.tableNumber,
        isActive: restaurantTables.isActive,
        currentStatus: restaurantTables.currentStatus,
      })
      .from(restaurantTables)
      .where(
        and(
          eq(restaurantTables.restaurantId, restaurantId),
          inArray(restaurantTables.id, [...tableIds]),
        ),
      )
      // A stable lock order across concurrent transfers avoids deadlocks.
      .orderBy(asc(restaurantTables.id))
      .for("update");
  }

  async listOpenOrders(
    restaurantId: string,
    tableId: string,
  ): Promise<readonly TableOperationOrderRecord[]> {
    return this.db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        status: orders.status,
        total: orders.total,
      })
      .from(orders)
      .where(
        and(
          eq(orders.restaurantId, restaurantId),
          eq(orders.tableId, tableId),
          inArray(orders.status, [...OPEN_ORDER_STATUSES]),
        ),
      )
      .orderBy(asc(orders.createdAt))
      .for("update");
  }

  async listUnclosedOrderBalances(
    restaurantId: string,
    tableId: string,
  ): Promise<readonly TableOrderBalanceRecord[]> {
    const collected = this.db
      .select({
        orderId: payments.orderId,
        paid: sql<string>`sum(${payments.amount})`.as("paid_total"),
        refunded: sql<string>`sum(${payments.refundedAmount})`.as("refunded_total"),
      })
      .from(payments)
      .where(
        and(eq(payments.restaurantId, restaurantId), eq(payments.status, "COMPLETED")),
      )
      .groupBy(payments.orderId)
      .as("collected_totals");

    return this.db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        status: orders.status,
        total: orders.total,
        paidTotal: sql<string>`coalesce(${collected.paid}, 0)`,
        refundedTotal: sql<string>`coalesce(${collected.refunded}, 0)`,
      })
      .from(orders)
      .leftJoin(collected, eq(collected.orderId, orders.id))
      .where(
        and(
          eq(orders.restaurantId, restaurantId),
          eq(orders.tableId, tableId),
          // COMPLETED and CANCELLED orders are historically closed.
          inArray(orders.status, [...OPEN_ORDER_STATUSES]),
        ),
      );
  }

  async listOpenChecks(
    restaurantId: string,
    tableId: string,
  ): Promise<readonly TableCheckBalanceRecord[]> {
    const collected = this.db
      .select({
        checkId: payments.checkId,
        paid: sql<string>`sum(${payments.amount})`.as("check_paid"),
      })
      .from(payments)
      .where(
        and(eq(payments.restaurantId, restaurantId), eq(payments.status, "COMPLETED")),
      )
      .groupBy(payments.checkId)
      .as("check_totals");

    return this.db
      .select({
        id: orderChecks.id,
        orderId: orderChecks.orderId,
        label: orderChecks.label,
        status: orderChecks.status,
        total: orderChecks.total,
        paidTotal: sql<string>`coalesce(${collected.paid}, 0)`,
      })
      .from(orderChecks)
      .innerJoin(
        orders,
        and(eq(orders.restaurantId, orderChecks.restaurantId), eq(orders.id, orderChecks.orderId)),
      )
      .leftJoin(collected, eq(collected.checkId, orderChecks.id))
      .where(
        and(
          eq(orderChecks.restaurantId, restaurantId),
          eq(orders.tableId, tableId),
          eq(orderChecks.status, "OPEN"),
          inArray(orders.status, [...OPEN_ORDER_STATUSES]),
        ),
      );
  }

  async countPendingPayments(restaurantId: string, tableId: string): Promise<number> {
    const rows = await this.db
      .select({ total: count() })
      .from(payments)
      .innerJoin(
        orders,
        and(eq(orders.restaurantId, payments.restaurantId), eq(orders.id, payments.orderId)),
      )
      .where(
        and(
          eq(payments.restaurantId, restaurantId),
          eq(orders.tableId, tableId),
          eq(payments.status, "PENDING"),
        ),
      );
    return rows[0]?.total ?? 0;
  }

  async listActiveCalls(
    restaurantId: string,
    tableId: string,
  ): Promise<readonly TableOperationCallRecord[]> {
    return this.db
      .select({
        id: waiterCalls.id,
        type: waiterCalls.type,
        status: waiterCalls.status,
      })
      .from(waiterCalls)
      .where(
        and(
          eq(waiterCalls.restaurantId, restaurantId),
          eq(waiterCalls.tableId, tableId),
          inArray(waiterCalls.status, [...ACTIVE_CALL_STATUSES]),
        ),
      )
      .orderBy(asc(waiterCalls.createdAt))
      .for("update");
  }

  async moveOrders(
    restaurantId: string,
    orderIds: readonly string[],
    targetTableId: string,
    at: Date,
  ): Promise<number> {
    if (orderIds.length === 0) return 0;
    const rows = await this.db
      .update(orders)
      .set({ tableId: targetTableId, updatedAt: at })
      .where(
        and(
          eq(orders.restaurantId, restaurantId),
          inArray(orders.id, [...orderIds]),
          inArray(orders.status, [...OPEN_ORDER_STATUSES]),
        ),
      )
      .returning({ id: orders.id });
    return rows.length;
  }

  async moveCall(
    restaurantId: string,
    callId: string,
    targetTableId: string,
    at: Date,
  ): Promise<boolean> {
    const rows = await this.db
      .update(waiterCalls)
      .set({ tableId: targetTableId, updatedAt: at })
      .where(and(eq(waiterCalls.restaurantId, restaurantId), eq(waiterCalls.id, callId)))
      .returning({ id: waiterCalls.id });
    return Boolean(rows[0]);
  }

  async resolveCall(
    restaurantId: string,
    callId: string,
    actorStaffId: string,
    at: Date,
  ): Promise<boolean> {
    const rows = await this.db
      .update(waiterCalls)
      .set({ status: "RESOLVED", resolvedAt: at, resolvedBy: actorStaffId, updatedAt: at })
      .where(
        and(
          eq(waiterCalls.restaurantId, restaurantId),
          eq(waiterCalls.id, callId),
          inArray(waiterCalls.status, [...ACTIVE_CALL_STATUSES]),
        ),
      )
      .returning({ id: waiterCalls.id });
    return Boolean(rows[0]);
  }

  async setTableStatus(
    restaurantId: string,
    tableId: string,
    status: TableStatus,
    at: Date,
  ): Promise<void> {
    await this.db
      .update(restaurantTables)
      .set({ currentStatus: status, updatedAt: at })
      .where(
        and(eq(restaurantTables.restaurantId, restaurantId), eq(restaurantTables.id, tableId)),
      );
  }

  async insertOutbox(input: TableOperationOutboxInput): Promise<void> {
    await this.db.insert(outboxEvents).values(input);
  }

  async insertAudit(input: TableOperationAuditInput): Promise<void> {
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

export class DrizzleTableOperationsRepository implements TableOperationsRepository {
  constructor(private readonly db: Database) {}

  transaction<TResult>(
    work: (repository: TableOperationsTransactionRepository) => Promise<TResult>,
  ): Promise<TResult> {
    return this.db.transaction((transaction) =>
      work(new DrizzleTableOperationsTransactionRepository(transaction)),
    );
  }
}
