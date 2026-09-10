import "server-only";

import { and, asc, eq, inArray, sql } from "drizzle-orm";

import type { Database } from "../../db";
import { fulfillmentRequests, orderItems, orders, restaurants } from "../../db/schema";
import type { FulfillmentWorkflowStatus } from "../domain/erp-workspaces";
import type { OrderChannel, OrderStatus } from "../domain/status";
import type {
  CustomerActiveOrderStatus,
  CustomerActiveOrderRecords,
  CustomerOrderQueryRepository,
  CustomerTrackedOrderRecord,
} from "./customer-order-query-repository";

const ACTIVE_ORDER_STATUSES = [
  "NEW",
  "CONFIRMED",
  "PREPARING",
  "READY",
  "SERVED",
] as const;

export class DrizzleCustomerOrderQueryRepository
  implements CustomerOrderQueryRepository
{
  constructor(private readonly db: Database) {}

  async findActiveByTable(
    restaurantId: string,
    tableId: string,
    sessionNonce: string,
  ): Promise<CustomerActiveOrderRecords> {
    const orderRows = await this.db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        status: sql<CustomerActiveOrderStatus>`${orders.status}`,
        notes: orders.notes,
        subtotal: orders.subtotal,
        serviceChargeTotal: orders.serviceChargeTotal,
        taxTotal: orders.taxTotal,
        total: orders.total,
        currency: restaurants.currency,
        createdAt: orders.createdAt,
        updatedAt: orders.updatedAt,
      })
      .from(orders)
      .innerJoin(
        restaurants,
        and(
          eq(restaurants.id, orders.restaurantId),
          eq(restaurants.isActive, true),
        ),
      )
      .where(
        and(
          eq(orders.restaurantId, restaurantId),
          eq(orders.tableId, tableId),
          // The sitting, not the table. `=` against a null column is null and
          // the row drops out, so a staff order and every pre-column row are
          // excluded without a second predicate — which is the fail-closed
          // behaviour the schema comment promises.
          eq(orders.customerSessionNonce, sessionNonce),
          inArray(orders.status, [...ACTIVE_ORDER_STATUSES]),
        ),
      )
      .orderBy(asc(orders.createdAt));

    if (!orderRows.length) return { orders: [], items: [] };
    const orderIds = orderRows.map((order) => order.id);
    const itemRows = await this.db
      .select({
        id: orderItems.id,
        orderId: orderItems.orderId,
        productId: orderItems.productId,
        productNameSnapshot: orderItems.productNameSnapshot,
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
          inArray(orderItems.orderId, orderIds),
        ),
      )
      .orderBy(asc(orderItems.orderId), asc(orderItems.sortOrder));
    return { orders: orderRows, items: itemRows };
  }

  async findTrackedOrder(
    restaurantId: string,
    orderId: string,
  ): Promise<CustomerTrackedOrderRecord | null> {
    // Both predicates matter: the id alone would read another restaurant's
    // order if a capability from one deployment ever reached another.
    const [order] = await this.db
      .select({
        orderNumber: orders.orderNumber,
        channel: sql<OrderChannel>`${orders.channel}`,
        status: sql<OrderStatus>`${orders.status}`,
        fulfillmentStatus: sql<FulfillmentWorkflowStatus | null>`${fulfillmentRequests.status}`,
        total: orders.total,
        currency: restaurants.currency,
        createdAt: orders.createdAt,
        updatedAt: orders.updatedAt,
      })
      .from(orders)
      .innerJoin(
        restaurants,
        and(eq(restaurants.id, orders.restaurantId), eq(restaurants.isActive, true)),
      )
      .leftJoin(
        fulfillmentRequests,
        and(
          eq(fulfillmentRequests.restaurantId, orders.restaurantId),
          eq(fulfillmentRequests.orderId, orders.id),
        ),
      )
      .where(and(eq(orders.restaurantId, restaurantId), eq(orders.id, orderId)))
      .limit(1);
    if (!order) return null;

    const items = await this.db
      .select({
        productNameSnapshot: orderItems.productNameSnapshot,
        quantity: orderItems.quantity,
        status: orderItems.status,
      })
      .from(orderItems)
      .where(and(eq(orderItems.restaurantId, restaurantId), eq(orderItems.orderId, orderId)))
      .orderBy(asc(orderItems.sortOrder));
    return { ...order, items };
  }
}
