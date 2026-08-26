import "server-only";

import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";

import { OPEN_ORDER_STATUSES } from "../domain/status";
import type { Database } from "../../db";
import {
  auditLogs,
  orderEvents,
  orderItems,
  orders,
  outboxEvents,
  restaurants,
  restaurantTables,
} from "../../db/schema";
import type { InsertAuditLogInput } from "./order-repository";
import type {
  MutableOrderItemRecord,
  StaffOrderListFilters,
  StaffOrderListRecord,
  StaffOrderRepository,
  StaffOrderTransactionRepository,
  UpdateOrderItemStatusRecordInput,
} from "./staff-order-repository";

type TransactionDatabase = Parameters<Parameters<Database["transaction"]>[0]>[0];

class DrizzleStaffOrderTransactionRepository implements StaffOrderTransactionRepository {
  constructor(private readonly db: TransactionDatabase) {}

  async findOrderItemForUpdate(
    restaurantId: string,
    orderItemId: string,
  ): Promise<MutableOrderItemRecord | null> {
    const rows = await this.db
      .select({
        id: orderItems.id,
        restaurantId: orderItems.restaurantId,
        orderId: orderItems.orderId,
        orderNumber: orders.orderNumber,
        orderStatus: orders.status,
        productName: orderItems.productNameSnapshot,
        status: orderItems.status,
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
          eq(orderItems.restaurantId, restaurantId),
          eq(orderItems.id, orderItemId),
        ),
      )
      .for("update", { of: [orderItems, orders] })
      .limit(1);
    return rows[0] ?? null;
  }

  async updateOrderItemStatus(input: UpdateOrderItemStatusRecordInput): Promise<boolean> {
    const rows = await this.db
      .update(orderItems)
      .set({
        status: input.nextStatus,
        updatedAt: input.at,
        ...(input.nextStatus === "CANCELLED" ? { cancelledAt: input.at } : {}),
      })
      .where(
        and(
          eq(orderItems.restaurantId, input.restaurantId),
          eq(orderItems.id, input.orderItemId),
          eq(orderItems.status, input.currentStatus),
        ),
      )
      .returning({ id: orderItems.id });
    return Boolean(rows[0]);
  }

  async insertOrderEvent(
    input: Parameters<StaffOrderTransactionRepository["insertOrderEvent"]>[0],
  ): Promise<void> {
    await this.db.insert(orderEvents).values(input);
  }

  async insertOutboxEvent(
    input: Parameters<StaffOrderTransactionRepository["insertOutboxEvent"]>[0],
  ): Promise<void> {
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

export class DrizzleStaffOrderRepository implements StaffOrderRepository {
  constructor(private readonly db: Database) {}

  async listOrders(
    restaurantId: string,
    filters: StaffOrderListFilters,
  ): Promise<readonly StaffOrderListRecord[]> {
    const predicates: SQL[] = [eq(orders.restaurantId, restaurantId)];
    if (filters.status) predicates.push(eq(orders.status, filters.status));
    // Applied before the limit, which is the whole point: filtering settled
    // orders out in the browser still lets them consume the rows a live screen
    // was allowed to fetch.
    if (filters.openOnly) {
      predicates.push(inArray(orders.status, [...OPEN_ORDER_STATUSES]));
    }
    if (filters.tableId) predicates.push(eq(orders.tableId, filters.tableId));
    if (filters.date) {
      predicates.push(
        sql`(${orders.createdAt} at time zone ${restaurants.timezone})::date = ${filters.date}::date`,
      );
    }

    const headers = await this.db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        status: orders.status,
        tableId: orders.tableId,
        channel: orders.channel,
        tableName: restaurantTables.name,
        tableNumber: restaurantTables.tableNumber,
        subtotal: orders.subtotal,
        serviceChargeTotal: orders.serviceChargeTotal,
        taxTotal: orders.taxTotal,
        total: orders.total,
        notes: orders.notes,
        createdAt: orders.createdAt,
        updatedAt: orders.updatedAt,
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
      .innerJoin(restaurants, eq(restaurants.id, orders.restaurantId))
      .where(and(...predicates))
      .orderBy(desc(orders.createdAt), desc(orders.id))
      .limit(filters.limit);

    if (headers.length === 0) return [];
    const ids = headers.map((order) => order.id);
    const itemRows = await this.db
      .select({
        id: orderItems.id,
        orderId: orderItems.orderId,
        productName: orderItems.productNameSnapshot,
        unitPrice: orderItems.unitPrice,
        quantity: orderItems.quantity,
        lineTotal: orderItems.lineTotal,
        notes: orderItems.notes,
        status: orderItems.status,
        sortOrder: orderItems.sortOrder,
      })
      .from(orderItems)
      .where(
        and(
          eq(orderItems.restaurantId, restaurantId),
          inArray(orderItems.orderId, ids),
        ),
      )
      .orderBy(asc(orderItems.orderId), asc(orderItems.sortOrder), asc(orderItems.id));

    const itemsByOrder = new Map<string, typeof itemRows>();
    for (const item of itemRows) {
      const items = itemsByOrder.get(item.orderId);
      if (items) items.push(item);
      else itemsByOrder.set(item.orderId, [item]);
    }

    return headers.map((order) => ({
      ...order,
      items: (itemsByOrder.get(order.id) ?? []).map((item) => ({
        id: item.id,
        productName: item.productName,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        lineTotal: item.lineTotal,
        notes: item.notes,
        status: item.status,
        sortOrder: item.sortOrder,
      })),
    }));
  }

  transaction<TResult>(
    work: (repository: StaffOrderTransactionRepository) => Promise<TResult>,
  ): Promise<TResult> {
    return this.db.transaction((transaction) =>
      work(new DrizzleStaffOrderTransactionRepository(transaction)),
    );
  }
}
