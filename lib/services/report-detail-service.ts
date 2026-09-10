import "server-only";

import { and, asc, desc, eq, gte, inArray, lt, sql, type AnyColumn, type SQL } from "drizzle-orm";

import { getDb, type Database } from "@/db";
import {
  auditLogs,
  categories,
  orderEvents,
  orderItems,
  orders,
  paymentRefunds,
  payments,
  products,
  restaurantTables,
  staffProfiles,
} from "@/db/schema";
import type { StaffPrincipal } from "@/lib/auth/foundation";
import { DomainError } from "@/lib/api/domain-error";
import { calculateOrderBalance } from "@/lib/domain/financial-operations";
import {
  auditMirrorType,
  mergeTimeline,
  orderEventTitle,
  orderEventType,
  type OrderTimelineEntry,
} from "@/lib/domain/order-timeline";
import type {
  CategoryReportRow,
  KitchenReport,
  OrderTimelineReport,
  ProductDetailReport,
  ReviewDetailReport,
  ReviewDetailRow,
} from "@/lib/domain/report-contracts";
import { weekdayLabel, type ResolvedReportRange } from "@/lib/domain/report-range";

/** Drill-down reports. Aggregation stays in PostgreSQL, as in the summary service. */

/** See the note in report-analytics-service: the zone comes from the range. */
function localTimeZone(range: ResolvedReportRange): SQL {
  return sql`${range.timeZone}`;
}

function money(value: unknown): string {
  return Number(value ?? 0).toFixed(2);
}

export class ReportDetailService {
  constructor(private readonly db: Database = getDb()) {}

  private inRange(column: AnyColumn, range: { start: Date; endExclusive: Date }): SQL {
    return and(gte(column, range.start), lt(column, range.endExclusive)) as SQL;
  }

  /**
   * One product's performance in the period, built entirely from order-item
   * snapshots so a rename, re-price or catalog removal cannot rewrite history.
   */
  async getProductDetail(
    principal: StaffPrincipal,
    range: ResolvedReportRange,
    productId: string,
  ): Promise<ProductDetailReport> {
    const scope = and(
      eq(orderItems.restaurantId, principal.restaurantId),
      eq(orderItems.productId, productId),
      this.inRange(orders.createdAt, range),
    );
    const live = sql`${orderItems.status} not in ('CANCELLED','VOIDED') and ${orders.status} <> 'CANCELLED'`;
    const localTime = sql`(${orders.createdAt} at time zone ${localTimeZone(range)})`;

    const [totals, hourly, weekly, daily] = await Promise.all([
      this.db
        .select({
          productName: sql<string>`max(${orderItems.productNameSnapshot})`,
          categoryName: sql<string | null>`max(${categories.name})`,
          stillInCatalog: sql<number>`count(${products.id})::int`,
          soldQuantity: sql<number>`coalesce(sum(${orderItems.quantity}) filter (where ${live}), 0)::int`,
          grossSales: sql<string>`coalesce(sum(${orderItems.lineTotal}) filter (where ${live}), 0)`,
          cancelledQuantity: sql<number>`coalesce(sum(${orderItems.quantity}) filter (where ${orderItems.status} = 'CANCELLED' or ${orders.status} = 'CANCELLED'), 0)::int`,
          cancelledAmount: sql<string>`coalesce(sum(${orderItems.lineTotal}) filter (where ${orderItems.status} = 'CANCELLED' or ${orders.status} = 'CANCELLED'), 0)`,
          voidedQuantity: sql<number>`coalesce(sum(${orderItems.quantity}) filter (where ${orderItems.status} = 'VOIDED'), 0)::int`,
          voidedAmount: sql<string>`coalesce(sum(${orderItems.lineTotal}) filter (where ${orderItems.status} = 'VOIDED'), 0)`,
          orderCount: sql<number>`count(distinct ${orderItems.orderId})::int`,
        })
        .from(orderItems)
        .innerJoin(
          orders,
          and(eq(orders.restaurantId, orderItems.restaurantId), eq(orders.id, orderItems.orderId)),
        )
        // Left joins keep a removed product's history intact.
        .leftJoin(
          products,
          and(eq(products.restaurantId, orderItems.restaurantId), eq(products.id, orderItems.productId)),
        )
        .leftJoin(
          categories,
          and(eq(categories.restaurantId, products.restaurantId), eq(categories.id, products.categoryId)),
        )
        .where(scope),
      this.db
        .select({
          hour: sql<number>`extract(hour from ${localTime})::int`,
          quantity: sql<number>`coalesce(sum(${orderItems.quantity}) filter (where ${live}), 0)::int`,
        })
        .from(orderItems)
        .innerJoin(
          orders,
          and(eq(orders.restaurantId, orderItems.restaurantId), eq(orders.id, orderItems.orderId)),
        )
        .where(scope)
        // Grouped by output position, not by repeating the expression. The zone
        // is a bound parameter, and PostgreSQL binds each occurrence as its own
        // placeholder, so a repeated expression is not the *same* expression to
        // the grouping check and the query fails with 42803. The old fixed
        // `interval '3 hours'` was a literal, which is why it could be repeated.
        .groupBy(sql`1`),
      this.db
        .select({
          weekday: sql<number>`extract(dow from ${localTime})::int`,
          quantity: sql<number>`coalesce(sum(${orderItems.quantity}) filter (where ${live}), 0)::int`,
        })
        .from(orderItems)
        .innerJoin(
          orders,
          and(eq(orders.restaurantId, orderItems.restaurantId), eq(orders.id, orderItems.orderId)),
        )
        .where(scope)
        .groupBy(sql`1`),
      this.db
        .select({
          date: sql<string>`to_char(${localTime}, 'YYYY-MM-DD')`,
          quantity: sql<number>`coalesce(sum(${orderItems.quantity}) filter (where ${live}), 0)::int`,
          grossSales: sql<string>`coalesce(sum(${orderItems.lineTotal}) filter (where ${live}), 0)`,
          cancelledQuantity: sql<number>`coalesce(sum(${orderItems.quantity}) filter (where ${orderItems.status} = 'CANCELLED' or ${orders.status} = 'CANCELLED'), 0)::int`,
          voidedQuantity: sql<number>`coalesce(sum(${orderItems.quantity}) filter (where ${orderItems.status} = 'VOIDED'), 0)::int`,
        })
        .from(orderItems)
        .innerJoin(
          orders,
          and(eq(orders.restaurantId, orderItems.restaurantId), eq(orders.id, orderItems.orderId)),
        )
        .where(scope)
        .groupBy(sql`1`)
        .orderBy(sql`1`),
    ]);

    const row = totals[0];
    if (!row || !row.productName) {
      // A product from another tenant simply has no rows in this scope.
      throw new DomainError("NOT_FOUND", "Ürün bu dönemde bulunamadı.", { httpStatus: 404 });
    }

    const topHour = [...hourly].sort((left, right) => right.quantity - left.quantity)[0];
    const topWeekday = [...weekly].sort((left, right) => right.quantity - left.quantity)[0];
    const topDate = [...daily].sort((left, right) => right.quantity - left.quantity)[0];
    const gross = Number(row.grossSales);

    return {
      productId,
      productName: row.productName,
      categoryName: row.categoryName,
      removedFromCatalog: row.stillInCatalog === 0,
      soldQuantity: row.soldQuantity,
      grossSales: money(gross),
      cancelledQuantity: row.cancelledQuantity,
      cancelledAmount: money(row.cancelledAmount),
      voidedQuantity: row.voidedQuantity,
      voidedAmount: money(row.voidedAmount),
      netSales: money(gross),
      averagePrice: money(row.soldQuantity > 0 ? gross / row.soldQuantity : 0),
      orderCount: row.orderCount,
      busiestHour: topHour ? { hour: topHour.hour, quantity: topHour.quantity } : null,
      busiestWeekday: topWeekday
        ? { label: weekdayLabel(topWeekday.weekday), quantity: topWeekday.quantity }
        : null,
      busiestDate: topDate ? { date: topDate.date, quantity: topDate.quantity } : null,
      daily: daily.map((entry) => ({
        date: entry.date,
        quantity: entry.quantity,
        grossSales: money(entry.grossSales),
        cancelledQuantity: entry.cancelledQuantity,
        voidedQuantity: entry.voidedQuantity,
        netSales: money(entry.grossSales),
      })),
    };
  }

  /**
   * Category performance. Categories carry no historical name snapshot, so the
   * label is the current catalog one while every figure stays historical.
   */
  async getCategories(
    principal: StaffPrincipal,
    range: ResolvedReportRange,
  ): Promise<readonly CategoryReportRow[]> {
    const live = sql`${orderItems.status} not in ('CANCELLED','VOIDED') and ${orders.status} <> 'CANCELLED'`;

    const rows = await this.db
      .select({
        categoryId: categories.id,
        categoryName: sql<string | null>`max(${categories.name})`,
        soldQuantity: sql<number>`coalesce(sum(${orderItems.quantity}) filter (where ${live}), 0)::int`,
        orderCount: sql<number>`count(distinct ${orderItems.orderId})::int`,
        grossSales: sql<string>`coalesce(sum(${orderItems.lineTotal}) filter (where ${live}), 0)`,
        cancelledQuantity: sql<number>`coalesce(sum(${orderItems.quantity}) filter (where ${orderItems.status} = 'CANCELLED' or ${orders.status} = 'CANCELLED'), 0)::int`,
        voidedQuantity: sql<number>`coalesce(sum(${orderItems.quantity}) filter (where ${orderItems.status} = 'VOIDED'), 0)::int`,
      })
      .from(orderItems)
      .innerJoin(
        orders,
        and(eq(orders.restaurantId, orderItems.restaurantId), eq(orders.id, orderItems.orderId)),
      )
      .leftJoin(
        products,
        and(eq(products.restaurantId, orderItems.restaurantId), eq(products.id, orderItems.productId)),
      )
      // A deleted category must not drop its historical sales; the row simply
      // falls into the "unknown category" bucket.
      .leftJoin(
        categories,
        and(eq(categories.restaurantId, products.restaurantId), eq(categories.id, products.categoryId)),
      )
      .where(
        and(
          eq(orderItems.restaurantId, principal.restaurantId),
          this.inRange(orders.createdAt, range),
        ),
      )
      .groupBy(categories.id);

    const total = rows.reduce((sum, row) => sum + Number(row.grossSales), 0);

    return rows
      .map((row): CategoryReportRow => {
        const gross = Number(row.grossSales);
        return {
          categoryId: row.categoryId,
          categoryName: row.categoryName ?? "Eski / silinmiş kategori",
          soldQuantity: row.soldQuantity,
          orderCount: row.orderCount,
          grossSales: money(gross),
          cancelledQuantity: row.cancelledQuantity,
          voidedQuantity: row.voidedQuantity,
          netSales: money(gross),
          // Guarded so an empty period never yields NaN or Infinity.
          share: total > 0 ? Math.round((gross / total) * 1000) / 10 : 0,
          averagePrice: money(row.soldQuantity > 0 ? gross / row.soldQuantity : 0),
        };
      })
      .sort((left, right) => Number(right.grossSales) - Number(left.grossSales));
  }

  /**
   * Kitchen activity, derived from the item status events the panel already
   * writes. `kitchen_tickets` is deliberately not used: nothing in the system
   * populates it, so reading it would produce confident zeros.
   */
  async getKitchen(
    principal: StaffPrincipal,
    range: ResolvedReportRange,
  ): Promise<KitchenReport> {
    const restaurantId = principal.restaurantId;
    const status = sql`${orderEvents.payload}->>'status'`;
    const localTime = sql`(${orderEvents.createdAt} at time zone ${localTimeZone(range)})`;
    const scope = and(
      eq(orderEvents.restaurantId, restaurantId),
      eq(orderEvents.eventType, "ORDER_ITEM_STATUS_CHANGED"),
      this.inRange(orderEvents.createdAt, range),
    );

    const [actors, busiest, durations, topProducts, distinct] = await Promise.all([
      // The person who starts preparation and the one who marks it ready are
      // often different, so the two are counted separately.
      this.db
        .select({
          staffId: orderEvents.userId,
          staffName: sql<string | null>`max(${staffProfiles.name})`,
          isActive: sql<boolean | null>`bool_or(${staffProfiles.isActive})`,
          started: sql<number>`count(*) filter (where ${status} = 'PREPARING')::int`,
          readied: sql<number>`count(*) filter (where ${status} = 'READY')::int`,
        })
        .from(orderEvents)
        .leftJoin(
          staffProfiles,
          and(
            eq(staffProfiles.restaurantId, orderEvents.restaurantId),
            eq(staffProfiles.id, orderEvents.userId),
          ),
        )
        .where(scope)
        .groupBy(orderEvents.userId),
      this.db
        .select({
          hour: sql<number>`extract(hour from ${localTime})::int`,
          weekday: sql<number>`extract(dow from ${localTime})::int`,
          count: sql<number>`count(*)::int`,
        })
        .from(orderEvents)
        .where(and(scope, sql`${status} = 'READY'`))
        .groupBy(sql`1`, sql`2`),
      // Pair each item's PREPARING with its READY inside the period. A missing
      // or inverted pair is excluded rather than guessed at.
      this.db
        .select({
          samples: sql<number>`count(*)::int`,
          averageSeconds: sql<number>`coalesce(avg(seconds), 0)::float`,
          medianSeconds: sql<number>`coalesce(percentile_cont(0.5) within group (order by seconds), 0)::float`,
          p90Seconds: sql<number>`coalesce(percentile_cont(0.9) within group (order by seconds), 0)::float`,
        })
        .from(
          sql`(
            select extract(epoch from (ready.created_at - started.created_at)) as seconds
            from ${orderEvents} started
            join ${orderEvents} ready
              on ready.restaurant_id = started.restaurant_id
             and ready.payload->>'orderItemId' = started.payload->>'orderItemId'
             and ready.payload->>'status' = 'READY'
             and ready.event_type = 'ORDER_ITEM_STATUS_CHANGED'
             and ready.created_at > started.created_at
            where started.restaurant_id = ${restaurantId}
              and started.event_type = 'ORDER_ITEM_STATUS_CHANGED'
              and started.payload->>'status' = 'PREPARING'
              and started.created_at >= ${range.start.toISOString()}::timestamptz
              and started.created_at < ${range.endExclusive.toISOString()}::timestamptz
          ) as prepared`,
        ),
      this.db
        .select({
          productName: sql<string>`${orderEvents.payload}->>'productName'`,
          preparedQuantity: sql<number>`count(*)::int`,
        })
        .from(orderEvents)
        .where(and(scope, sql`${status} = 'READY'`))
        .groupBy(sql`${orderEvents.payload}->>'productName'`)
        .orderBy(desc(sql`count(*)`))
        .limit(20),
      // Counted separately, because the list above is capped at 20 rows.
      this.db
        .select({
          count: sql<number>`count(distinct ${orderEvents.payload}->>'productName')::int`,
        })
        .from(orderEvents)
        .where(and(scope, sql`${status} = 'READY'`)),
    ]);

    const readyEvents = actors.reduce((total, row) => total + row.readied, 0);
    const durationRow = durations[0];
    const hourTotals = new Map<number, number>();
    const weekdayTotals = new Map<number, number>();
    for (const row of busiest) {
      hourTotals.set(row.hour, (hourTotals.get(row.hour) ?? 0) + row.count);
      weekdayTotals.set(row.weekday, (weekdayTotals.get(row.weekday) ?? 0) + row.count);
    }
    const topHour = [...hourTotals.entries()].sort((left, right) => right[1] - left[1])[0];
    const topWeekday = [...weekdayTotals.entries()].sort((left, right) => right[1] - left[1])[0];

    return {
      staff: actors
        .filter((row): row is typeof row & { staffId: string } => Boolean(row.staffId))
        .map((row) => ({
          staffId: row.staffId,
          staffName: row.staffName ?? "Bilinmiyor",
          isActive: row.isActive ?? false,
          startedPreparationCount: row.started,
          markedReadyCount: row.readied,
        })),
      preparedItemCount: readyEvents,
      distinctProductCount: distinct[0]?.count ?? 0,
      busiestHour: topHour ? { hour: topHour[0], count: topHour[1] } : null,
      busiestWeekday: topWeekday
        ? { label: weekdayLabel(topWeekday[0]), count: topWeekday[1] }
        : null,
      duration:
        durationRow && durationRow.samples > 0
          ? {
              supported: true,
              value: {
                averageSeconds: Math.round(durationRow.averageSeconds),
                medianSeconds: Math.round(durationRow.medianSeconds),
                p90Seconds: Math.round(durationRow.p90Seconds),
                sampleCount: durationRow.samples,
                excludedSamples: Math.max(0, readyEvents - durationRow.samples),
              },
            }
          : {
              supported: false,
              reason:
                "Hazırlama başlangıç/bitiş geçmişi bu dönem için eşleştirilebilir şekilde kaydedilmemiş.",
            },
      topProducts: topProducts
        .filter((row) => Boolean(row.productName))
        .map((row) => ({
          productName: row.productName,
          preparedQuantity: row.preparedQuantity,
        })),
    };
  }

  /**
   * The real cancel / void / refund rows behind a review signal.
   *
   * The three sources live in different tables with different actor columns,
   * so the merge and the final slice happen here. What each source returns is
   * bounded in SQL: newest first, at most one page's worth plus everything
   * that could precede it. A row that belongs on the requested page is always
   * within its own source's newest `offset + pageSize`, so the page is exact
   * while the year-long report no longer materialises every cancel, void and
   * refund of the year in memory. The totals come from counts, not from the
   * length of the fetched rows.
   */
  async getReviewDetail(
    principal: StaffPrincipal,
    range: ResolvedReportRange,
    options: {
      readonly staffId?: string;
      readonly kind?: "CANCEL" | "VOID" | "REFUND";
      readonly page?: number;
      readonly pageSize?: number;
    } = {},
  ): Promise<ReviewDetailReport> {
    const restaurantId = principal.restaurantId;
    const page = Math.max(1, options.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, options.pageSize ?? 50));
    const offset = (page - 1) * pageSize;
    const window = offset + pageSize;
    const rows: ReviewDetailRow[] = [];
    let total = 0;

    const voidScope = and(
      eq(orderItems.restaurantId, restaurantId),
      eq(orderItems.status, "VOIDED"),
      this.inRange(orderItems.voidedAt, range),
      ...(options.staffId ? [eq(orderItems.voidedBy, options.staffId)] : []),
    );
    const refundScope = and(
      eq(paymentRefunds.restaurantId, restaurantId),
      eq(paymentRefunds.status, "COMPLETED"),
      this.inRange(paymentRefunds.createdAt, range),
      ...(options.staffId ? [eq(paymentRefunds.createdByUserId, options.staffId)] : []),
    );
    const cancelScope = and(
      eq(auditLogs.restaurantId, restaurantId),
      inArray(auditLogs.action, ["order.item.cancelled", "order.cancelled"]),
      this.inRange(auditLogs.createdAt, range),
      ...(options.staffId ? [eq(auditLogs.actorUserId, options.staffId)] : []),
    );

    if (!options.kind || options.kind === "VOID") {
      const voidsQuery = this.db
        .select({
          id: orderItems.id,
          at: orderItems.voidedAt,
          staffId: orderItems.voidedBy,
          staffName: sql<string | null>`${staffProfiles.name}`,
          staffRole: sql<string | null>`${staffProfiles.role}`,
          tableName: sql<string | null>`${restaurantTables.name}`,
          orderId: orders.id,
          orderNumber: orders.orderNumber,
          productName: orderItems.productNameSnapshot,
          amount: orderItems.lineTotal,
          reason: sql<string | null>`${orderItems.voidReasonCode}::text`,
        })
        .from(orderItems)
        .innerJoin(
          orders,
          and(eq(orders.restaurantId, orderItems.restaurantId), eq(orders.id, orderItems.orderId)),
        )
        .leftJoin(
          restaurantTables,
          and(
            eq(restaurantTables.restaurantId, orders.restaurantId),
            eq(restaurantTables.id, orders.tableId),
          ),
        )
        .leftJoin(
          staffProfiles,
          and(
            eq(staffProfiles.restaurantId, orderItems.restaurantId),
            eq(staffProfiles.id, orderItems.voidedBy),
          ),
        )
        .where(voidScope)
        .orderBy(desc(orderItems.voidedAt))
        .limit(window);
      const [voids, [voidCount]] = await Promise.all([
        voidsQuery,
        this.db.select({ total: sql<number>`count(*)::int` }).from(orderItems).where(voidScope),
      ]);
      total += Number(voidCount?.total ?? 0);

      for (const row of voids) {
        rows.push({
          id: `void-${row.id}`,
          at: (row.at ?? new Date(0)).toISOString(),
          kind: "VOID",
          staffName: row.staffName ?? "Bilinmiyor",
          staffRole: row.staffRole ?? "—",
          tableName: row.tableName,
          orderId: row.orderId,
          orderNumber: row.orderNumber,
          productName: row.productName,
          amount: money(row.amount),
          reason: row.reason,
          note: null,
        });
      }
    }

    if (!options.kind || options.kind === "REFUND") {
      const refundsQuery = this.db
        .select({
          id: paymentRefunds.id,
          at: paymentRefunds.createdAt,
          staffName: sql<string | null>`${staffProfiles.name}`,
          staffRole: sql<string | null>`${staffProfiles.role}`,
          tableName: sql<string | null>`${restaurantTables.name}`,
          orderId: orders.id,
          orderNumber: orders.orderNumber,
          amount: paymentRefunds.amount,
          reason: sql<string>`${paymentRefunds.reasonCode}::text`,
          note: paymentRefunds.note,
        })
        .from(paymentRefunds)
        .innerJoin(
          orders,
          and(
            eq(orders.restaurantId, paymentRefunds.restaurantId),
            eq(orders.id, paymentRefunds.orderId),
          ),
        )
        .leftJoin(
          restaurantTables,
          and(
            eq(restaurantTables.restaurantId, orders.restaurantId),
            eq(restaurantTables.id, orders.tableId),
          ),
        )
        .leftJoin(
          staffProfiles,
          and(
            eq(staffProfiles.restaurantId, paymentRefunds.restaurantId),
            eq(staffProfiles.id, paymentRefunds.createdByUserId),
          ),
        )
        .where(refundScope)
        .orderBy(desc(paymentRefunds.createdAt))
        .limit(window);
      const [refunds, [refundCount]] = await Promise.all([
        refundsQuery,
        this.db
          .select({ total: sql<number>`count(*)::int` })
          .from(paymentRefunds)
          .where(refundScope),
      ]);
      total += Number(refundCount?.total ?? 0);

      for (const row of refunds) {
        rows.push({
          id: `refund-${row.id}`,
          at: row.at.toISOString(),
          kind: "REFUND",
          staffName: row.staffName ?? "Bilinmiyor",
          staffRole: row.staffRole ?? "—",
          tableName: row.tableName,
          orderId: row.orderId,
          orderNumber: row.orderNumber,
          productName: null,
          amount: money(row.amount),
          reason: row.reason,
          note: row.note,
        });
      }
    }

    if (!options.kind || options.kind === "CANCEL") {
      // Item cancellation records no actor column, so the audit log is the
      // only place the acting staff member is preserved.
      const cancelsQuery = this.db
        .select({
          id: auditLogs.id,
          at: auditLogs.createdAt,
          staffName: sql<string | null>`${staffProfiles.name}`,
          staffRole: sql<string | null>`${staffProfiles.role}`,
          entityId: auditLogs.entityId,
          metadata: auditLogs.metadata,
        })
        .from(auditLogs)
        .leftJoin(
          staffProfiles,
          and(
            eq(staffProfiles.restaurantId, auditLogs.restaurantId),
            eq(staffProfiles.id, auditLogs.actorUserId),
          ),
        )
        .where(cancelScope)
        .orderBy(desc(auditLogs.createdAt))
        .limit(window);
      const [cancels, [cancelCount]] = await Promise.all([
        cancelsQuery,
        this.db.select({ total: sql<number>`count(*)::int` }).from(auditLogs).where(cancelScope),
      ]);
      total += Number(cancelCount?.total ?? 0);

      for (const row of cancels) {
        const metadata = (row.metadata ?? {}) as Record<string, unknown>;
        rows.push({
          id: `cancel-${row.id}`,
          at: row.at.toISOString(),
          kind: "CANCEL",
          staffName: row.staffName ?? "Bilinmiyor",
          staffRole: row.staffRole ?? "—",
          tableName: null,
          orderId: typeof metadata.orderId === "string" ? metadata.orderId : null,
          orderNumber:
            typeof metadata.orderNumber === "string" ? metadata.orderNumber : null,
          productName:
            typeof metadata.productName === "string" ? metadata.productName : null,
          amount: money(metadata.totalBefore ?? 0),
          reason: typeof metadata.reason === "string" ? metadata.reason : null,
          note: typeof metadata.reasonNote === "string" ? metadata.reasonNote : null,
        });
      }
    }

    rows.sort((left, right) => Date.parse(right.at) - Date.parse(left.at));
    return {
      rows: rows.slice(offset, window),
      total,
      page,
      pageSize,
    };
  }

  /** One order's history, assembled from the records the system already keeps. */
  async getOrderTimeline(
    principal: StaffPrincipal,
    orderId: string,
  ): Promise<OrderTimelineReport> {
    const restaurantId = principal.restaurantId;

    const orderRows = await this.db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        status: orders.status,
        createdAt: orders.createdAt,
        total: orders.total,
        tableName: sql<string | null>`${restaurantTables.name}`,
      })
      .from(orders)
      .leftJoin(
        restaurantTables,
        and(
          eq(restaurantTables.restaurantId, orders.restaurantId),
          eq(restaurantTables.id, orders.tableId),
        ),
      )
      .where(and(eq(orders.restaurantId, restaurantId), eq(orders.id, orderId)))
      .limit(1);

    const order = orderRows[0];
    if (!order) {
      // A foreign order is simply absent from this tenant's scope.
      throw new DomainError("ORDER_NOT_FOUND", "Sipariş bulunamadı.", { httpStatus: 404 });
    }

    const [events, audits, paymentRows, refundRows] = await Promise.all([
      this.db
        .select({
          id: orderEvents.id,
          at: orderEvents.createdAt,
          eventType: orderEvents.eventType,
          payload: orderEvents.payload,
          actorName: sql<string | null>`${staffProfiles.name}`,
          actorRole: sql<string | null>`${staffProfiles.role}`,
        })
        .from(orderEvents)
        .leftJoin(
          staffProfiles,
          and(
            eq(staffProfiles.restaurantId, orderEvents.restaurantId),
            eq(staffProfiles.id, orderEvents.userId),
          ),
        )
        .where(
          and(eq(orderEvents.restaurantId, restaurantId), eq(orderEvents.orderId, orderId)),
        )
        .orderBy(asc(orderEvents.createdAt)),
      this.db
        .select({
          id: auditLogs.id,
          at: auditLogs.createdAt,
          action: auditLogs.action,
          metadata: auditLogs.metadata,
          actorName: sql<string | null>`${staffProfiles.name}`,
          actorRole: sql<string | null>`${staffProfiles.role}`,
        })
        .from(auditLogs)
        .leftJoin(
          staffProfiles,
          and(
            eq(staffProfiles.restaurantId, auditLogs.restaurantId),
            eq(staffProfiles.id, auditLogs.actorUserId),
          ),
        )
        .where(
          and(
            eq(auditLogs.restaurantId, restaurantId),
            sql`(${auditLogs.metadata}->>'orderId' = ${orderId} or ${auditLogs.entityId} = ${orderId})`,
          ),
        )
        .orderBy(asc(auditLogs.createdAt)),
      this.db
        .select({
          id: payments.id,
          at: payments.createdAt,
          amount: payments.amount,
          refundedAmount: payments.refundedAmount,
          method: payments.method,
          status: payments.status,
          actorName: sql<string | null>`${staffProfiles.name}`,
          actorRole: sql<string | null>`${staffProfiles.role}`,
        })
        .from(payments)
        .leftJoin(
          staffProfiles,
          and(
            eq(staffProfiles.restaurantId, payments.restaurantId),
            eq(staffProfiles.id, payments.createdByUserId),
          ),
        )
        .where(and(eq(payments.restaurantId, restaurantId), eq(payments.orderId, orderId)))
        .orderBy(asc(payments.createdAt)),
      this.db
        .select({
          id: paymentRefunds.id,
          at: paymentRefunds.createdAt,
          amount: paymentRefunds.amount,
          reason: sql<string>`${paymentRefunds.reasonCode}::text`,
          note: paymentRefunds.note,
          actorName: sql<string | null>`${staffProfiles.name}`,
          actorRole: sql<string | null>`${staffProfiles.role}`,
        })
        .from(paymentRefunds)
        .leftJoin(
          staffProfiles,
          and(
            eq(staffProfiles.restaurantId, paymentRefunds.restaurantId),
            eq(staffProfiles.id, paymentRefunds.createdByUserId),
          ),
        )
        .where(
          and(
            eq(paymentRefunds.restaurantId, restaurantId),
            eq(paymentRefunds.orderId, orderId),
          ),
        )
        .orderBy(asc(paymentRefunds.createdAt)),
    ]);

    const entries: OrderTimelineEntry[] = [];

    for (const row of events) {
      const payload = (row.payload ?? {}) as Record<string, unknown>;
      entries.push({
        id: `event-${row.id}`,
        at: row.at.toISOString(),
        type: orderEventType(row.eventType),
        title: orderEventTitle(row.eventType),
        description: typeof payload.status === "string" ? String(payload.status) : null,
        actorName: row.actorName,
        actorRole: row.actorRole,
        amount: typeof payload.total === "string" ? payload.total : null,
        productName: typeof payload.productName === "string" ? payload.productName : null,
        reason: null,
        source: "ORDER_EVENT",
      });
    }

    for (const row of audits) {
      const metadata = (row.metadata ?? {}) as Record<string, unknown>;
      entries.push({
        id: `audit-${row.id}`,
        at: row.at.toISOString(),
        type: auditMirrorType(row.action) ?? row.action,
        title: row.action,
        description: null,
        actorName: row.actorName,
        actorRole: row.actorRole,
        amount: typeof metadata.amount === "string" ? metadata.amount : null,
        productName: typeof metadata.productName === "string" ? metadata.productName : null,
        reason:
          typeof metadata.reason === "string"
            ? metadata.reason
            : typeof metadata.reasonCode === "string"
              ? metadata.reasonCode
              : null,
        source: "AUDIT_LOG",
      });
    }

    for (const row of paymentRows) {
      entries.push({
        id: `payment-${row.id}`,
        at: row.at.toISOString(),
        type: "PAYMENT",
        title: `${row.method} tahsilat`,
        description: null,
        actorName: row.actorName,
        actorRole: row.actorRole,
        amount: money(row.amount),
        productName: null,
        reason: null,
        source: "PAYMENT",
      });
    }

    for (const row of refundRows) {
      entries.push({
        id: `refund-${row.id}`,
        at: row.at.toISOString(),
        type: "REFUND",
        title: "İade yapıldı",
        description: row.note,
        // Attributed to whoever issued the refund, not the original collector.
        actorName: row.actorName,
        actorRole: row.actorRole,
        amount: money(row.amount),
        productName: null,
        reason: row.reason,
        source: "REFUND",
      });
    }

    const balance = calculateOrderBalance(
      order.total,
      paymentRows.map((row) => ({
        amount: row.amount,
        refundedAmount: row.refundedAmount,
        counted: row.status === "COMPLETED",
      })),
    );

    return {
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        tableName: order.tableName ?? "—",
        status: order.status,
        createdAt: order.createdAt.toISOString(),
        total: money(order.total),
        grossCollected: balance.paidTotal,
        refunds: balance.refundedTotal,
        netCollected: money(Number(balance.paidTotal) - Number(balance.refundedTotal)),
        outstanding: balance.outstanding,
      },
      entries: mergeTimeline(entries),
    };
  }
}
