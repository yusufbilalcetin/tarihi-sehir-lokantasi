import "server-only";

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { orders, restaurantTables, waiterCalls } from "@/db/schema";
import type {
  StaffTableRecord,
  StaffTableRepository,
} from "@/lib/repositories/staff-table-repository";

/** Statuses that still occupy the floor; COMPLETED/CANCELLED free the table. */
const OPEN_ORDER_STATUSES = ["NEW", "CONFIRMED", "PREPARING", "READY", "SERVED"] as const;

export class DrizzleStaffTableRepository implements StaffTableRepository {
  constructor(private readonly db: Database) {}

  listTables(restaurantId: string): Promise<readonly StaffTableRecord[]> {
    // One lateral join per table instead of a query per row keeps the floor
    // view a single round trip.
    const latestOrder = this.db
      .select({
        tableId: orders.tableId,
        id: orders.id,
        orderNumber: orders.orderNumber,
        total: orders.total,
        createdAt: orders.createdAt,
        rank: sql<number>`row_number() over (partition by ${orders.tableId} order by ${orders.createdAt} desc)`.as("rank"),
      })
      .from(orders)
      .where(
        and(
          eq(orders.restaurantId, restaurantId),
          inArray(orders.status, [...OPEN_ORDER_STATUSES]),
        ),
      )
      .as("latest_order");

    const openCalls = this.db
      .select({
        tableId: waiterCalls.tableId,
        openCallCount: sql<number>`count(*)::int`.as("open_call_count"),
      })
      .from(waiterCalls)
      .where(
        and(
          eq(waiterCalls.restaurantId, restaurantId),
          inArray(waiterCalls.status, ["OPEN", "ACKNOWLEDGED"]),
        ),
      )
      .groupBy(waiterCalls.tableId)
      .as("open_calls");

    return this.db
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
        activeOrderId: latestOrder.id,
        activeOrderNumber: latestOrder.orderNumber,
        activeOrderTotal: latestOrder.total,
        activeOrderCreatedAt: latestOrder.createdAt,
        openCallCount: sql<number>`coalesce(${openCalls.openCallCount}, 0)`,
      })
      .from(restaurantTables)
      .leftJoin(
        latestOrder,
        and(eq(latestOrder.tableId, restaurantTables.id), eq(latestOrder.rank, 1)),
      )
      .leftJoin(openCalls, eq(openCalls.tableId, restaurantTables.id))
      .where(eq(restaurantTables.restaurantId, restaurantId))
      .orderBy(asc(restaurantTables.tableNumber), desc(restaurantTables.createdAt));
  }
}
