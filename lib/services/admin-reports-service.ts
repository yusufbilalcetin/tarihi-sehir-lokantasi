import "server-only";

import { and, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";

import { getDb, type Database } from "@/db";
import { orderItems, orders } from "@/db/schema";
import type { StaffPrincipal } from "@/lib/auth/foundation";

/** Cancelled orders never count toward revenue. */
const REVENUE_STATUSES = ["SERVED", "COMPLETED"] as const;

export interface AdminReportsResult {
  readonly totals: {
    readonly revenue: string;
    readonly orderCount: number;
    readonly averageOrder: string;
    readonly openOrderCount: number;
  };
  readonly daily: readonly { readonly date: string; readonly revenue: string; readonly orderCount: number }[];
  readonly hourly: readonly { readonly hour: number; readonly orderCount: number }[];
  readonly bestSellers: readonly {
    readonly productName: string;
    readonly quantity: number;
    readonly revenue: string;
  }[];
}

function money(value: unknown): string {
  return Number(value ?? 0).toFixed(2);
}

export class AdminReportsService {
  constructor(private readonly db: Database = getDb()) {}

  /** Fourteen days is enough for the admin charts and keeps the scan small. */
  async getReports(principal: StaffPrincipal, days = 14): Promise<AdminReportsResult> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const revenueScope = and(
      eq(orders.restaurantId, principal.restaurantId),
      inArray(orders.status, [...REVENUE_STATUSES]),
      gte(orders.createdAt, since),
    );

    const [totals, daily, hourly, bestSellers] = await Promise.all([
      this.db
        .select({
          revenue: sql<string>`coalesce(sum(${orders.total}), 0)`,
          orderCount: sql<number>`count(*)::int`,
        })
        .from(orders)
        .where(revenueScope),
      this.db
        .select({
          date: sql<string>`to_char(${orders.createdAt}, 'YYYY-MM-DD')`,
          revenue: sql<string>`coalesce(sum(${orders.total}), 0)`,
          orderCount: sql<number>`count(*)::int`,
        })
        .from(orders)
        .where(revenueScope)
        .groupBy(sql`to_char(${orders.createdAt}, 'YYYY-MM-DD')`)
        .orderBy(sql`to_char(${orders.createdAt}, 'YYYY-MM-DD')`),
      this.db
        .select({
          hour: sql<number>`extract(hour from ${orders.createdAt})::int`,
          orderCount: sql<number>`count(*)::int`,
        })
        .from(orders)
        .where(revenueScope)
        .groupBy(sql`extract(hour from ${orders.createdAt})`)
        .orderBy(sql`extract(hour from ${orders.createdAt})`),
      this.db
        .select({
          productName: orderItems.productNameSnapshot,
          quantity: sql<number>`sum(${orderItems.quantity})::int`,
          revenue: sql<string>`coalesce(sum(${orderItems.lineTotal}), 0)`,
        })
        .from(orderItems)
        .innerJoin(
          orders,
          and(eq(orders.restaurantId, orderItems.restaurantId), eq(orders.id, orderItems.orderId)),
        )
        // A cancelled line is not a sale, so it never reaches the best sellers.
        .where(and(revenueScope, ne(orderItems.status, "CANCELLED")))
        .groupBy(orderItems.productNameSnapshot)
        .orderBy(desc(sql`sum(${orderItems.quantity})`))
        .limit(8),
    ]);

    const openOrders = await this.db
      .select({ openOrderCount: sql<number>`count(*)::int` })
      .from(orders)
      .where(
        and(
          eq(orders.restaurantId, principal.restaurantId),
          inArray(orders.status, ["NEW", "CONFIRMED", "PREPARING", "READY"]),
        ),
      );

    const revenue = Number(totals[0]?.revenue ?? 0);
    const orderCount = totals[0]?.orderCount ?? 0;

    return {
      totals: {
        revenue: money(revenue),
        orderCount,
        averageOrder: money(orderCount ? revenue / orderCount : 0),
        openOrderCount: openOrders[0]?.openOrderCount ?? 0,
      },
      daily: daily.map((row) => ({
        date: row.date,
        revenue: money(row.revenue),
        orderCount: row.orderCount,
      })),
      hourly: hourly.map((row) => ({ hour: row.hour, orderCount: row.orderCount })),
      bestSellers: bestSellers.map((row) => ({
        productName: row.productName,
        quantity: row.quantity,
        revenue: money(row.revenue),
      })),
    };
  }
}
