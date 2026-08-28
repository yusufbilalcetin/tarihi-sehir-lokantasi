import "server-only";

import { and, asc, desc, eq, inArray } from "drizzle-orm";

import type { Database } from "@/db";
import { orderItems, orders, restaurantTables, waiterCalls } from "@/db/schema";
import type {
  StaffTableRecord,
  StaffTableRepository,
} from "@/lib/repositories/staff-table-repository";

/** Statuses that still occupy the floor; COMPLETED/CANCELLED free the table. */
const OPEN_ORDER_STATUSES = ["NEW", "CONFIRMED", "PREPARING", "READY", "SERVED"] as const;

export class DrizzleStaffTableRepository implements StaffTableRepository {
  constructor(private readonly db: Database) {}

  async listTables(restaurantId: string): Promise<readonly StaffTableRecord[]> {
    // These are bounded set queries for the whole restaurant, never one query
    // per table. Calls and orders can run together; items follow only after the
    // open order ids are known.
    const [tableRows, orderRows, callRows] = await Promise.all([
      this.db
        .select({
          id: restaurantTables.id,
          name: restaurantTables.name,
          tableNumber: restaurantTables.tableNumber,
          seats: restaurantTables.seats,
          isActive: restaurantTables.isActive,
          currentStatus: restaurantTables.currentStatus,
          qrTokenVersion: restaurantTables.qrTokenVersion,
          qrTokenRevokedAt: restaurantTables.qrTokenRevokedAt,
          updatedAt: restaurantTables.updatedAt,
        })
        .from(restaurantTables)
        .where(eq(restaurantTables.restaurantId, restaurantId))
        .orderBy(asc(restaurantTables.tableNumber), desc(restaurantTables.createdAt)),
      this.db
      .select({
        tableId: orders.tableId,
        id: orders.id,
        orderNumber: orders.orderNumber,
        status: orders.status,
        total: orders.total,
        createdAt: orders.createdAt,
        updatedAt: orders.updatedAt,
      })
      .from(orders)
      .where(
        and(
          eq(orders.restaurantId, restaurantId),
          inArray(orders.status, [...OPEN_ORDER_STATUSES]),
        ),
      )
      .orderBy(desc(orders.createdAt)),
      this.db
      .select({
        tableId: waiterCalls.tableId,
        id: waiterCalls.id,
        type: waiterCalls.type,
        status: waiterCalls.status,
        requestLabel: waiterCalls.requestLabel,
        createdAt: waiterCalls.createdAt,
        updatedAt: waiterCalls.updatedAt,
      })
      .from(waiterCalls)
      .where(
        and(
          eq(waiterCalls.restaurantId, restaurantId),
          inArray(waiterCalls.status, ["OPEN", "ACKNOWLEDGED"]),
        ),
      )
      .orderBy(desc(waiterCalls.createdAt)),
    ]);

    const orderIds = orderRows.map((order) => order.id);
    const itemRows = orderIds.length
      ? await this.db
          .select({
            id: orderItems.id,
            orderId: orderItems.orderId,
            productName: orderItems.productNameSnapshot,
            quantity: orderItems.quantity,
            status: orderItems.status,
          })
          .from(orderItems)
          .where(
            and(
              eq(orderItems.restaurantId, restaurantId),
              inArray(orderItems.orderId, orderIds),
            ),
          )
          .orderBy(asc(orderItems.sortOrder), asc(orderItems.createdAt))
      : [];

    const itemsByOrder = Map.groupBy(itemRows, (item) => item.orderId);
    const ordersByTable = Map.groupBy(
      orderRows.filter((order): order is typeof order & { tableId: string } => Boolean(order.tableId)),
      (order) => order.tableId,
    );
    const callsByTable = Map.groupBy(callRows, (call) => call.tableId);

    return tableRows.map((table) => ({
      ...table,
      activeOrders: (ordersByTable.get(table.id) ?? []).map((order) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        total: order.total,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        items: (itemsByOrder.get(order.id) ?? []).map(({ orderId: _orderId, ...item }) => item),
      })),
      activeCalls: (callsByTable.get(table.id) ?? []).map(({ tableId: _tableId, ...call }) => call),
    }));
  }
}
