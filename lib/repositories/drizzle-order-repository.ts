import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";

import {
  claimIdempotencyRow,
  completeIdempotencyRow,
  restartIdempotencyRow,
} from "./drizzle-idempotency";
import type { Database } from "../../db";
import {
  auditLogs,
  fulfillmentRequests,
  categories,
  orderEvents,
  orderItems,
  orders,
  outboxEvents,
  payments,
  products,
  restaurantCounters,
  restaurants,
  restaurantSettings,
  restaurantTables,
} from "../../db/schema";
import { enqueueKitchenTickets } from "../services/kitchen-print";
import type {
  AdvanceOrderItemsInput,
  CancelOrderItemInput,
  ClaimIdempotencyInput,
  IdempotencyClaim,
  InsertOrderEventInput,
  InsertAuditLogInput,
  InsertOrderItemRecordInput,
  InsertOrderRecordInput,
  InsertOutboxEventInput,
  KitchenPrintEvent,
  MutableOrderWithItems,
  OrderContextRecord,
  OrderProductRecord,
  OrderRepository,
  OrderTransactionRepository,
  RestartIdempotencyInput,
  UpdateOrderAmountsInput,
  UpdateOrderStatusInput,
  VoidOrderItemInput,
} from "./order-repository";

type TransactionDatabase = Parameters<Parameters<Database["transaction"]>[0]>[0];

class DrizzleOrderTransactionRepository implements OrderTransactionRepository {
  constructor(private readonly db: TransactionDatabase) {}

  // The three below delegate to `drizzle-idempotency`, which the cash drawer
  // uses too. Same protocol, one implementation.
  async claimIdempotency(input: ClaimIdempotencyInput): Promise<IdempotencyClaim> {
    return claimIdempotencyRow(this.db, input);
  }

  async restartIdempotency(input: RestartIdempotencyInput): Promise<void> {
    return restartIdempotencyRow(this.db, input);
  }

  async completeIdempotency(
    input: Parameters<OrderTransactionRepository["completeIdempotency"]>[0],
  ): Promise<void> {
    return completeIdempotencyRow(this.db, input);
  }

  async findOrderContext(restaurantId: string, tableId: string | null): Promise<OrderContextRecord | null> {
    // A guest ordering takeaway has a restaurant but no table, so the context
    // is read from the restaurant instead of through one. The settings are the
    // same settings either way, which is the point: one price list, one tax
    // rate, one set of limits, whichever door the order came in through.
    if (tableId === null) return this.findRestaurantOrderContext(restaurantId);
    const rows = await this.db
      .select({
        restaurantId: restaurants.id,
        restaurantName: restaurants.name,
        restaurantIsActive: restaurants.isActive,
        currency: restaurants.currency,
        timezone: restaurants.timezone,
        tableId: restaurantTables.id,
        tableName: restaurantTables.name,
        tableNumber: restaurantTables.tableNumber,
        tableIsActive: restaurantTables.isActive,
        tableTokenVersion: restaurantTables.qrTokenVersion,
        tableTokenRevokedAt: restaurantTables.qrTokenRevokedAt,
        orderingEnabled: sql<boolean>`coalesce(${restaurantSettings.orderingEnabled}, false)`,
        waiterApprovalRequired: sql<boolean>`coalesce(${restaurantSettings.waiterApprovalRequired}, true)`,
        customerNotesEnabled: sql<boolean>`coalesce(${restaurantSettings.customerNotesEnabled}, false)`,
        serviceFeeRate: sql<string>`coalesce(${restaurantSettings.serviceFeeRate}, '0.00')`,
        taxRate: sql<string>`coalesce(${restaurantSettings.taxRate}, '0.00')`,
        maxItemQuantity: sql<number>`coalesce(${restaurantSettings.maxItemQuantity}, 20)`,
        orderNotesMaxLength: sql<number>`coalesce(${restaurantSettings.orderNotesMaxLength}, 500)`,
      })
      .from(restaurantTables)
      .innerJoin(restaurants, eq(restaurants.id, restaurantTables.restaurantId))
      .leftJoin(restaurantSettings, eq(restaurantSettings.restaurantId, restaurants.id))
      .where(
        and(
          eq(restaurantTables.restaurantId, restaurantId),
          eq(restaurantTables.id, tableId),
        ),
      )
      .for("share", { of: [restaurantTables, restaurants] })
      .limit(1);
    return rows[0] ?? null;
  }

  private async findRestaurantOrderContext(restaurantId: string): Promise<OrderContextRecord | null> {
    const rows = await this.db
      .select({
        restaurantId: restaurants.id,
        restaurantName: restaurants.name,
        restaurantIsActive: restaurants.isActive,
        currency: restaurants.currency,
        timezone: restaurants.timezone,
        tableId: sql<string | null>`null::uuid`,
        tableName: sql<string | null>`null::text`,
        tableNumber: sql<number | null>`null::int`,
        tableIsActive: sql<boolean | null>`null::boolean`,
        tableTokenVersion: sql<number | null>`null::int`,
        tableTokenRevokedAt: sql<Date | null>`null::timestamptz`,
        orderingEnabled: sql<boolean>`coalesce(${restaurantSettings.orderingEnabled}, false)`,
        waiterApprovalRequired: sql<boolean>`coalesce(${restaurantSettings.waiterApprovalRequired}, true)`,
        customerNotesEnabled: sql<boolean>`coalesce(${restaurantSettings.customerNotesEnabled}, false)`,
        serviceFeeRate: sql<string>`coalesce(${restaurantSettings.serviceFeeRate}, '0.00')`,
        taxRate: sql<string>`coalesce(${restaurantSettings.taxRate}, '0.00')`,
        maxItemQuantity: sql<number>`coalesce(${restaurantSettings.maxItemQuantity}, 20)`,
        orderNotesMaxLength: sql<number>`coalesce(${restaurantSettings.orderNotesMaxLength}, 500)`,
      })
      .from(restaurants)
      .leftJoin(restaurantSettings, eq(restaurantSettings.restaurantId, restaurants.id))
      .where(eq(restaurants.id, restaurantId))
      .for("share", { of: [restaurants] })
      .limit(1);
    return rows[0] ?? null;
  }

  async findOrderProducts(restaurantId: string, productIds: readonly string[]): Promise<readonly OrderProductRecord[]> {
    if (productIds.length === 0) return [];
    return this.db
      .select({
        id: products.id,
        restaurantId: products.restaurantId,
        name: products.name,
        price: products.price,
        isActive: products.isActive,
        isAvailable: products.isAvailable,
        deletedAt: products.deletedAt,
        categoryIsActive: categories.isActive,
        categoryDeletedAt: categories.deletedAt,
      })
      .from(products)
      .innerJoin(
        categories,
        and(
          eq(categories.restaurantId, products.restaurantId),
          eq(categories.id, products.categoryId),
        ),
      )
      .where(
        and(
          eq(products.restaurantId, restaurantId),
          inArray(products.id, [...productIds]),
        ),
      )
      .for("share", { of: [products, categories] });
  }

  async allocateOrderSequence(restaurantId: string): Promise<bigint> {
    const rows = await this.db
      .insert(restaurantCounters)
      .values({ restaurantId, counterName: "ORDER", currentValue: BigInt(1) })
      .onConflictDoUpdate({
        target: [restaurantCounters.restaurantId, restaurantCounters.counterName],
        set: {
          currentValue: sql`${restaurantCounters.currentValue} + 1`,
          updatedAt: new Date(),
        },
      })
      .returning({ currentValue: restaurantCounters.currentValue });
    if (!rows[0]) throw new Error("Order sequence could not be allocated.");
    return rows[0].currentValue;
  }

  async insertOrder(input: InsertOrderRecordInput): Promise<{ readonly id: string }> {
    const rows = await this.db.insert(orders).values(input).returning({ id: orders.id });
    if (!rows[0]) throw new Error("Order insert returned no record.");
    return rows[0];
  }

  async insertFulfillmentRequest(
    input: Parameters<OrderTransactionRepository["insertFulfillmentRequest"]>[0],
  ): Promise<{ readonly id: string }> {
    const rows = await this.db
      .insert(fulfillmentRequests)
      .values({
        restaurantId: input.restaurantId,
        orderId: input.orderId,
        channel: input.channel,
        // The guest has placed the order; it is no longer a draft.
        status: "PLACED",
        customerName: input.customerName,
        contact: input.contact,
        address: input.address,
        deliveryNotes: input.deliveryNotes,
        idempotencyKey: input.idempotencyKey,
      })
      .returning({ id: fulfillmentRequests.id });
    if (!rows[0]) throw new Error("Fulfillment request insert returned no record.");
    return rows[0];
  }

  async insertOrderItems(inputs: readonly InsertOrderItemRecordInput[]): Promise<void> {
    if (inputs.length) await this.db.insert(orderItems).values([...inputs]);
  }

  async markTableWaiting(restaurantId: string, tableId: string): Promise<void> {
    await this.db
      .update(restaurantTables)
      .set({ currentStatus: "WAITING", updatedAt: new Date() })
      .where(
        and(
          eq(restaurantTables.restaurantId, restaurantId),
          eq(restaurantTables.id, tableId),
        ),
      );
  }

  async findOrderWithItemsForUpdate(
    restaurantId: string,
    orderId: string,
  ): Promise<MutableOrderWithItems | null> {
    const orderRows = await this.db
      .select({
        id: orders.id,
        restaurantId: orders.restaurantId,
        tableId: orders.tableId,
        channel: orders.channel,
        orderNumber: orders.orderNumber,
        status: orders.status,
        version: orders.version,
        subtotal: orders.subtotal,
        serviceChargeTotal: orders.serviceChargeTotal,
        taxTotal: orders.taxTotal,
        total: orders.total,
        serviceFeeRate: orders.serviceFeeRate,
        taxRate: orders.taxRate,
        currency: restaurants.currency,
        settingsServiceFeeRate: sql<
          string | null
        >`coalesce(${restaurantSettings.serviceFeeRate}, '0.00')`,
        settingsTaxRate: sql<string | null>`coalesce(${restaurantSettings.taxRate}, '0.00')`,
      })
      .from(orders)
      .innerJoin(restaurants, eq(restaurants.id, orders.restaurantId))
      .leftJoin(restaurantSettings, eq(restaurantSettings.restaurantId, orders.restaurantId))
      .where(and(eq(orders.restaurantId, restaurantId), eq(orders.id, orderId)))
      .for("update", { of: orders })
      .limit(1);
    const order = orderRows[0];
    if (!order) return null;

    const items = await this.db
      .select({
        id: orderItems.id,
        orderId: orderItems.orderId,
        productId: orderItems.productId,
        productNameSnapshot: orderItems.productNameSnapshot,
        unitPrice: orderItems.unitPrice,
        quantity: orderItems.quantity,
        lineTotal: orderItems.lineTotal,
        status: orderItems.status,
        sortOrder: orderItems.sortOrder,
      })
      .from(orderItems)
      .where(and(eq(orderItems.restaurantId, restaurantId), eq(orderItems.orderId, orderId)))
      .orderBy(orderItems.sortOrder)
      .for("update");

    const paymentRows = await this.db
      .select({ status: payments.status })
      .from(payments)
      .where(and(eq(payments.restaurantId, restaurantId), eq(payments.orderId, orderId)));

    return {
      id: order.id,
      restaurantId: order.restaurantId,
      tableId: order.tableId,
      channel: order.channel,
      orderNumber: order.orderNumber,
      status: order.status,
      version: order.version,
      subtotal: order.subtotal,
      serviceChargeTotal: order.serviceChargeTotal,
      taxTotal: order.taxTotal,
      total: order.total,
      // A pre-Phase-6 order carries no frozen rate; fall back to settings.
      serviceFeeRate: order.serviceFeeRate ?? order.settingsServiceFeeRate,
      taxRate: order.taxRate ?? order.settingsTaxRate,
      currency: order.currency,
      hasSettledPayment: paymentRows.some(
        (payment) => payment.status === "COMPLETED" || payment.status === "REFUNDED",
      ),
      hasPendingPayment: paymentRows.some((payment) => payment.status === "PENDING"),
      items,
    };
  }

  async updateOrderAmounts(input: UpdateOrderAmountsInput): Promise<boolean> {
    const rows = await this.db
      .update(orders)
      .set({
        subtotal: input.subtotal,
        serviceChargeTotal: input.serviceChargeTotal,
        taxTotal: input.taxTotal,
        total: input.total,
        version: input.currentVersion + 1,
        updatedAt: input.at,
      })
      .where(
        and(
          eq(orders.restaurantId, input.restaurantId),
          eq(orders.id, input.orderId),
          eq(orders.version, input.currentVersion),
        ),
      )
      .returning({ id: orders.id });
    return Boolean(rows[0]);
  }

  async cancelOrderItem(input: CancelOrderItemInput): Promise<boolean> {
    const rows = await this.db
      .update(orderItems)
      .set({ status: "CANCELLED", cancelledAt: input.at, updatedAt: input.at })
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

  async voidOrderItem(input: VoidOrderItemInput): Promise<boolean> {
    const rows = await this.db
      .update(orderItems)
      .set({
        status: "VOIDED",
        voidedAt: input.at,
        voidedBy: input.voidedBy,
        voidReasonCode: input.reasonCode as (typeof orderItems.$inferInsert)["voidReasonCode"],
        updatedAt: input.at,
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

  async advanceOrderItems(input: AdvanceOrderItemsInput): Promise<readonly string[]> {
    if (input.currentStatuses.length === 0) return [];
    const rows = await this.db
      .update(orderItems)
      .set({ status: input.nextStatus, updatedAt: input.at })
      .where(
        and(
          eq(orderItems.restaurantId, input.restaurantId),
          eq(orderItems.orderId, input.orderId),
          inArray(orderItems.status, [...input.currentStatuses]),
        ),
      )
      .returning({ id: orderItems.id });
    return rows.map((row) => row.id);
  }

  async updateOrderStatus(input: UpdateOrderStatusInput): Promise<boolean> {
    const timestampChanges = {
      ...(input.nextStatus === "CONFIRMED" ? { confirmedAt: input.at } : {}),
      ...(input.nextStatus === "PREPARING" ? { preparingAt: input.at } : {}),
      ...(input.nextStatus === "READY" ? { readyAt: input.at } : {}),
      ...(input.nextStatus === "SERVED" ? { servedAt: input.at } : {}),
      ...(input.nextStatus === "COMPLETED" ? { closedAt: input.at } : {}),
      ...(input.nextStatus === "CANCELLED" ? { cancelledAt: input.at, closedAt: input.at } : {}),
    };
    const rows = await this.db
      .update(orders)
      .set({
        status: input.nextStatus,
        version: input.currentVersion + 1,
        updatedAt: input.at,
        ...timestampChanges,
      })
      .where(
        and(
          eq(orders.restaurantId, input.restaurantId),
          eq(orders.id, input.orderId),
          eq(orders.status, input.currentStatus),
          eq(orders.version, input.currentVersion),
        ),
      )
      .returning({ id: orders.id });
    return Boolean(rows[0]);
  }

  async insertOrderEvent(input: InsertOrderEventInput): Promise<void> {
    await this.db.insert(orderEvents).values(input);
  }

  async insertOutboxEvent(input: InsertOutboxEventInput): Promise<void> {
    await this.db.insert(outboxEvents).values(input);
  }

  async enqueueKitchenPrint(
    event: KitchenPrintEvent,
  ): Promise<{ created: number; unrouted: number }> {
    // Runs on the order's own transaction: the ticket commits with the order,
    // and no printer is contacted here.
    const outcome = await enqueueKitchenTickets(this.db, event);
    return { created: outcome.created, unrouted: outcome.unrouted };
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

export class DrizzleOrderRepository implements OrderRepository {
  constructor(private readonly db: Database) {}

  transaction<TResult>(
    work: (repository: OrderTransactionRepository) => Promise<TResult>,
  ): Promise<TResult> {
    return this.db.transaction((transaction) =>
      work(new DrizzleOrderTransactionRepository(transaction)),
    );
  }
}
