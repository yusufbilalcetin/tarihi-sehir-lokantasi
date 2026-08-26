import "server-only";

import { and, asc, eq, inArray, sql } from "drizzle-orm";

import type { Database } from "@/db";
import {
  auditLogs,
  orderCheckItems,
  orderChecks,
  orderItems,
  orders,
  outboxEvents,
  payments,
} from "@/db/schema";
import type {
  CheckItemRecord,
  CheckOrderRecord,
  InsertCheckAllocationInput,
  InsertCheckInput,
  OrderCheckRecord,
  OrderCheckRepository,
  OrderCheckTransactionRepository,
} from "./order-check-repository";

type TransactionDatabase = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Checks that no longer count against a line's allocated quantity. */
const LIVE_CHECK_STATUSES = ["OPEN", "PAID"] as const;

class DrizzleOrderCheckTransactionRepository implements OrderCheckTransactionRepository {
  constructor(private readonly db: TransactionDatabase) {}

  async findOrderForUpdate(
    restaurantId: string,
    orderId: string,
  ): Promise<CheckOrderRecord | null> {
    const rows = await this.db
      .select({
        id: orders.id,
        restaurantId: orders.restaurantId,
        orderNumber: orders.orderNumber,
        status: orders.status,
        total: orders.total,
        tableId: orders.tableId,
        channel: orders.channel,
      })
      .from(orders)
      .where(and(eq(orders.restaurantId, restaurantId), eq(orders.id, orderId)))
      .for("update")
      .limit(1);
    return rows[0] ?? null;
  }

  async listBillableItems(
    restaurantId: string,
    orderId: string,
  ): Promise<readonly CheckItemRecord[]> {
    const allocated = this.db
      .select({
        orderItemId: orderCheckItems.orderItemId,
        allocated: sql<number>`sum(${orderCheckItems.quantity})::int`.as("allocated"),
      })
      .from(orderCheckItems)
      .innerJoin(
        orderChecks,
        and(
          eq(orderChecks.restaurantId, orderCheckItems.restaurantId),
          eq(orderChecks.id, orderCheckItems.checkId),
        ),
      )
      .where(
        and(
          eq(orderCheckItems.restaurantId, restaurantId),
          inArray(orderChecks.status, [...LIVE_CHECK_STATUSES]),
        ),
      )
      .groupBy(orderCheckItems.orderItemId)
      .as("allocated_quantities");

    return this.db
      .select({
        id: orderItems.id,
        productNameSnapshot: orderItems.productNameSnapshot,
        unitPrice: orderItems.unitPrice,
        quantity: orderItems.quantity,
        status: orderItems.status,
        allocatedQuantity: sql<number>`coalesce(${allocated.allocated}, 0)`,
      })
      .from(orderItems)
      .leftJoin(allocated, eq(allocated.orderItemId, orderItems.id))
      .where(
        and(eq(orderItems.restaurantId, restaurantId), eq(orderItems.orderId, orderId)),
      )
      .orderBy(asc(orderItems.sortOrder))
      .for("update", { of: orderItems });
  }

  private async hydrate(
    restaurantId: string,
    rows: readonly {
      id: string;
      orderId: string;
      label: string;
      status: "OPEN" | "PAID" | "CANCELLED";
      total: string;
      createdAt: Date;
      closedAt: Date | null;
    }[],
  ): Promise<readonly OrderCheckRecord[]> {
    if (rows.length === 0) return [];
    const checkIds = rows.map((row) => row.id);

    const allocations = await this.db
      .select({
        id: orderCheckItems.id,
        checkId: orderCheckItems.checkId,
        orderItemId: orderCheckItems.orderItemId,
        productNameSnapshot: orderItems.productNameSnapshot,
        quantity: orderCheckItems.quantity,
        unitPriceSnapshot: orderCheckItems.unitPriceSnapshot,
        lineTotal: orderCheckItems.lineTotal,
      })
      .from(orderCheckItems)
      .innerJoin(
        orderItems,
        and(
          eq(orderItems.restaurantId, orderCheckItems.restaurantId),
          eq(orderItems.id, orderCheckItems.orderItemId),
        ),
      )
      .where(
        and(
          eq(orderCheckItems.restaurantId, restaurantId),
          inArray(orderCheckItems.checkId, checkIds),
        ),
      );

    const collected = await this.db
      .select({
        checkId: payments.checkId,
        paid: sql<string>`coalesce(sum(${payments.amount}), 0)`,
        refunded: sql<string>`coalesce(sum(${payments.refundedAmount}), 0)`,
      })
      .from(payments)
      .where(
        and(
          eq(payments.restaurantId, restaurantId),
          eq(payments.status, "COMPLETED"),
          inArray(payments.checkId, checkIds),
        ),
      )
      .groupBy(payments.checkId);

    return rows.map((row) => ({
      id: row.id,
      orderId: row.orderId,
      label: row.label,
      status: row.status,
      total: row.total,
      createdAt: row.createdAt,
      closedAt: row.closedAt,
      items: allocations
        .filter((allocation) => allocation.checkId === row.id)
        .map((allocation) => ({
          id: allocation.id,
          orderItemId: allocation.orderItemId,
          productNameSnapshot: allocation.productNameSnapshot,
          quantity: allocation.quantity,
          unitPriceSnapshot: allocation.unitPriceSnapshot,
          lineTotal: allocation.lineTotal,
        })),
      paidTotal: collected.find((entry) => entry.checkId === row.id)?.paid ?? "0.00",
      refundedTotal: collected.find((entry) => entry.checkId === row.id)?.refunded ?? "0.00",
    }));
  }

  async listChecks(restaurantId: string, orderId: string) {
    const rows = await this.db
      .select({
        id: orderChecks.id,
        orderId: orderChecks.orderId,
        label: orderChecks.label,
        status: orderChecks.status,
        total: orderChecks.total,
        createdAt: orderChecks.createdAt,
        closedAt: orderChecks.closedAt,
      })
      .from(orderChecks)
      .where(and(eq(orderChecks.restaurantId, restaurantId), eq(orderChecks.orderId, orderId)))
      .orderBy(asc(orderChecks.createdAt));
    return this.hydrate(restaurantId, rows);
  }

  async findCheckForUpdate(restaurantId: string, checkId: string) {
    const rows = await this.db
      .select({
        id: orderChecks.id,
        orderId: orderChecks.orderId,
        label: orderChecks.label,
        status: orderChecks.status,
        total: orderChecks.total,
        createdAt: orderChecks.createdAt,
        closedAt: orderChecks.closedAt,
      })
      .from(orderChecks)
      .where(and(eq(orderChecks.restaurantId, restaurantId), eq(orderChecks.id, checkId)))
      .for("update")
      .limit(1);
    const [hydrated] = await this.hydrate(restaurantId, rows);
    return hydrated ?? null;
  }

  async insertCheck(input: InsertCheckInput): Promise<{ id: string }> {
    const rows = await this.db
      .insert(orderChecks)
      .values({
        restaurantId: input.restaurantId,
        orderId: input.orderId,
        label: input.label,
        status: "OPEN",
        total: input.total,
        createdByUserId: input.createdByUserId,
        createdAt: input.at,
        updatedAt: input.at,
      })
      .returning({ id: orderChecks.id });
    if (!rows[0]) throw new Error("Check insert returned no record.");
    return rows[0];
  }

  async insertCheckAllocation(input: InsertCheckAllocationInput): Promise<void> {
    await this.db.insert(orderCheckItems).values({
      restaurantId: input.restaurantId,
      checkId: input.checkId,
      orderItemId: input.orderItemId,
      quantity: input.quantity,
      unitPriceSnapshot: input.unitPriceSnapshot,
      lineTotal: input.lineTotal,
      createdAt: input.at,
    });
  }

  async updateCheckDetails(
    restaurantId: string,
    checkId: string,
    details: { label: string; total: string; at: Date },
  ): Promise<void> {
    await this.db
      .update(orderChecks)
      .set({ label: details.label, total: details.total, updatedAt: details.at })
      .where(and(eq(orderChecks.restaurantId, restaurantId), eq(orderChecks.id, checkId)));
  }

  async cancelCheck(restaurantId: string, checkId: string, at: Date): Promise<boolean> {
    const rows = await this.db
      .update(orderChecks)
      .set({ status: "CANCELLED", closedAt: at, updatedAt: at })
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

  async deleteCheckAllocations(restaurantId: string, checkId: string): Promise<void> {
    await this.db
      .delete(orderCheckItems)
      .where(
        and(
          eq(orderCheckItems.restaurantId, restaurantId),
          eq(orderCheckItems.checkId, checkId),
        ),
      );
  }

  async insertOutbox(input: Parameters<OrderCheckTransactionRepository["insertOutbox"]>[0]) {
    await this.db.insert(outboxEvents).values(input);
  }

  async insertAudit(input: Parameters<OrderCheckTransactionRepository["insertAudit"]>[0]) {
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

export class DrizzleOrderCheckRepository implements OrderCheckRepository {
  constructor(private readonly db: Database) {}

  transaction<TResult>(
    work: (repository: OrderCheckTransactionRepository) => Promise<TResult>,
  ): Promise<TResult> {
    return this.db.transaction((transaction) =>
      work(new DrizzleOrderCheckTransactionRepository(transaction)),
    );
  }
}
