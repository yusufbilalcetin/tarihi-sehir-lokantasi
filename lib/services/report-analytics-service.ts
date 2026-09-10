import "server-only";

import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  ne,
  sql,
  type AnyColumn,
  type SQL,
} from "drizzle-orm";

import { getDb, type Database } from "@/db";
import {
  categories,
  orderItems,
  orders,
  paymentRefunds,
  payments,
  products,
  restaurantTables,
  staffProfiles,
  waiterCalls,
} from "@/db/schema";
import type { StaffPrincipal } from "@/lib/auth/foundation";
import { ORDER_CHANNEL_LABELS } from "@/lib/domain/display";
import {
  calculateTrend,
  weekdayLabel,
  type ResolvedReportRange,
} from "@/lib/domain/report-range";
import type {
  BusiestReport,
  FinanceReport,
  ProductReport,
  ProductSort,
  ProductReportRow,
  ReportSummary,
  ReportSummaryMetric,
  StaffReportRow,
  TableReportRow,
} from "@/lib/domain/report-contracts";
import {
  DEFAULT_REVIEW_THRESHOLDS,
  buildReviewReport,
  type ReviewReport,
  type StaffActivity,
} from "@/lib/domain/report-review";

/**
 * Every figure here is aggregated by PostgreSQL. Nothing streams whole tables
 * into the application: at a thousand orders a day a two-year period is
 * hundreds of thousands of rows, and the panel only ever needs the totals.
 */

/** Revenue counts orders that actually reached the guest. */
const REVENUE_ORDER_STATUSES = ["SERVED", "COMPLETED"] as const;

/**
 * Postgres renders timestamps in the restaurant's own day, not UTC.
 *
 * The zone is the restaurant's IANA name, taken from the range that already
 * bounded the period in it, and passed as a bound parameter -- never
 * interpolated. A bare offset must not be used here: `AT TIME ZONE '+03:00'`
 * is read with the POSIX sign convention and shifts UTC *back* three hours,
 * and a fixed `interval '3 hours'` is wrong for every zone that keeps daylight
 * saving. An IANA name is right on both sides of a clock change.
 */
function localTimeZone(range: ResolvedReportRange): SQL {
  return sql`${range.timeZone}`;
}

function money(value: unknown): string {
  return Number(value ?? 0).toFixed(2);
}

function minor(value: unknown): number {
  return Math.round(Number(value ?? 0) * 100);
}

export class ReportAnalyticsService {
  constructor(private readonly db: Database = getDb()) {}

  /** The first real operation, so "since system start" needs no hard-coded date. */
  async findSystemStart(restaurantId: string): Promise<Date | null> {
    const rows = await this.db
      .select({ first: sql<string | null>`min(${orders.createdAt})` })
      .from(orders)
      .where(eq(orders.restaurantId, restaurantId));
    const first = rows[0]?.first;
    if (!first) return null;
    // A bare `min()` has no Drizzle column mapper, so the driver hands back a
    // timestamp string. Callers do date arithmetic on it, so it is converted
    // here rather than trusted to be a Date because the type says so.
    const parsed = new Date(first);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  /** Half-open period on any timestamp column: [start, endExclusive). */
  private inRange(column: AnyColumn, range: { start: Date; endExclusive: Date }): SQL {
    return and(gte(column, range.start), lt(column, range.endExclusive)) as SQL;
  }

  private async summaryFigures(
    restaurantId: string,
    period: { start: Date; endExclusive: Date },
  ) {
    const orderScope = and(
      eq(orders.restaurantId, restaurantId),
      this.inRange(orders.createdAt, period),
    );

    const [orderTotals, collected, refunded] = await Promise.all([
      this.db
        .select({
          grossSales: sql<string>`coalesce(sum(${orders.total}) filter (where ${orders.status} in ('SERVED','COMPLETED')), 0)`,
          orderCount: sql<number>`count(*)::int`,
          completed: sql<number>`count(*) filter (where ${orders.status} = 'COMPLETED')::int`,
          cancelled: sql<number>`count(*) filter (where ${orders.status} = 'CANCELLED')::int`,
          revenueOrders: sql<number>`count(*) filter (where ${orders.status} in ('SERVED','COMPLETED'))::int`,
          // The channel split rides on the same sum over the same scope, so
          // the three parts add up to grossSales by construction rather than
          // by a second query that could drift away from it.
          dineInSales: sql<string>`coalesce(sum(${orders.total}) filter (where ${orders.status} in ('SERVED','COMPLETED') and ${orders.channel} = 'DINE_IN'), 0)`,
          takeawaySales: sql<string>`coalesce(sum(${orders.total}) filter (where ${orders.status} in ('SERVED','COMPLETED') and ${orders.channel} = 'TAKEAWAY'), 0)`,
          deliverySales: sql<string>`coalesce(sum(${orders.total}) filter (where ${orders.status} in ('SERVED','COMPLETED') and ${orders.channel} = 'DELIVERY'), 0)`,
          dineInOrders: sql<number>`count(*) filter (where ${orders.status} in ('SERVED','COMPLETED') and ${orders.channel} = 'DINE_IN')::int`,
          takeawayOrders: sql<number>`count(*) filter (where ${orders.status} in ('SERVED','COMPLETED') and ${orders.channel} = 'TAKEAWAY')::int`,
          deliveryOrders: sql<number>`count(*) filter (where ${orders.status} in ('SERVED','COMPLETED') and ${orders.channel} = 'DELIVERY')::int`,
        })
        .from(orders)
        .where(orderScope),
      this.db
        .select({ gross: sql<string>`coalesce(sum(${payments.amount}), 0)` })
        .from(payments)
        .where(
          and(
            eq(payments.restaurantId, restaurantId),
            eq(payments.status, "COMPLETED"),
            this.inRange(payments.createdAt, period),
          ),
        ),
      this.db
        .select({ total: sql<string>`coalesce(sum(${paymentRefunds.amount}), 0)` })
        .from(paymentRefunds)
        .where(
          and(
            eq(paymentRefunds.restaurantId, restaurantId),
            eq(paymentRefunds.status, "COMPLETED"),
            this.inRange(paymentRefunds.createdAt, period),
          ),
        ),
    ]);

    const totals = orderTotals[0];
    const grossSales = Number(totals?.grossSales ?? 0);
    const revenueOrders = totals?.revenueOrders ?? 0;
    const grossCollected = Number(collected[0]?.gross ?? 0);
    const refunds = Number(refunded[0]?.total ?? 0);

    return {
      grossSales,
      grossCollected,
      refunds,
      netCollected: grossCollected - refunds,
      orderCount: totals?.orderCount ?? 0,
      completedOrderCount: totals?.completed ?? 0,
      cancelledOrderCount: totals?.cancelled ?? 0,
      averageCheck: revenueOrders > 0 ? grossSales / revenueOrders : 0,
      channels: {
        dineIn: { sales: Number(totals?.dineInSales ?? 0), orderCount: totals?.dineInOrders ?? 0 },
        takeaway: { sales: Number(totals?.takeawaySales ?? 0), orderCount: totals?.takeawayOrders ?? 0 },
        delivery: { sales: Number(totals?.deliverySales ?? 0), orderCount: totals?.deliveryOrders ?? 0 },
      },
    };
  }

  async getSummary(
    principal: StaffPrincipal,
    range: ResolvedReportRange,
  ): Promise<ReportSummary> {
    const current = await this.summaryFigures(principal.restaurantId, range);
    const previous = range.comparison
      ? await this.summaryFigures(principal.restaurantId, range.comparison)
      : null;

    const metric = (
      pick: (figures: typeof current) => number,
      asMoney = true,
    ): ReportSummaryMetric => {
      const value = pick(current);
      const before = previous ? pick(previous) : null;
      return {
        value: asMoney ? money(value) : String(Math.round(value)),
        previous: before === null ? null : asMoney ? money(before) : String(Math.round(before)),
        trend: before === null ? null : calculateTrend(value, before),
      };
    };

    return {
      range: {
        start: range.start.toISOString(),
        endExclusive: range.endExclusive.toISOString(),
        label: range.label,
      },
      comparisonLabel: range.comparison?.label ?? null,
      grossSales: metric((figures) => figures.grossSales),
      grossCollected: metric((figures) => figures.grossCollected),
      refunds: metric((figures) => figures.refunds),
      netCollected: metric((figures) => figures.netCollected),
      orderCount: metric((figures) => figures.orderCount, false),
      completedOrderCount: metric((figures) => figures.completedOrderCount, false),
      cancelledOrderCount: metric((figures) => figures.cancelledOrderCount, false),
      averageCheck: metric((figures) => figures.averageCheck),
      channels: [
        { label: ORDER_CHANNEL_LABELS.DINE_IN, sales: money(current.channels.dineIn.sales), orderCount: current.channels.dineIn.orderCount },
        { label: ORDER_CHANNEL_LABELS.TAKEAWAY, sales: money(current.channels.takeaway.sales), orderCount: current.channels.takeaway.orderCount },
        { label: ORDER_CHANNEL_LABELS.DELIVERY, sales: money(current.channels.delivery.sales), orderCount: current.channels.delivery.orderCount },
      ],
      profitAvailable: false,
    };
  }

  /**
   * Every product sold in the period — never a top-N. Names and prices come
   * from the order-item snapshots, so a later rename, re-price or soft delete
   * cannot rewrite a historical report.
   */
  async getProducts(
    principal: StaffPrincipal,
    range: ResolvedReportRange,
    options: {
      readonly search?: string;
      readonly sort?: ProductSort;
      readonly page?: number;
      readonly pageSize?: number;
      readonly includeZeroSales?: boolean;
    } = {},
  ): Promise<ProductReport> {
    const page = Math.max(1, options.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, options.pageSize ?? 50));
    const search = options.search?.trim();

    const predicates: SQL[] = [
      eq(orderItems.restaurantId, principal.restaurantId),
      this.inRange(orders.createdAt, range),
      inArray(orders.status, [...REVENUE_ORDER_STATUSES, "CANCELLED"]),
    ];
    if (search) {
      predicates.push(sql`${orderItems.productNameSnapshot} ilike ${`%${search}%`}`);
    }

    const sold = sql<number>`coalesce(sum(${orderItems.quantity}) filter (where ${orderItems.status} not in ('CANCELLED','VOIDED') and ${orders.status} <> 'CANCELLED'), 0)::int`;
    const gross = sql<string>`coalesce(sum(${orderItems.lineTotal}) filter (where ${orderItems.status} not in ('CANCELLED','VOIDED') and ${orders.status} <> 'CANCELLED'), 0)`;
    const cancelledQty = sql<number>`coalesce(sum(${orderItems.quantity}) filter (where ${orderItems.status} = 'CANCELLED' or ${orders.status} = 'CANCELLED'), 0)::int`;
    const cancelledAmount = sql<string>`coalesce(sum(${orderItems.lineTotal}) filter (where ${orderItems.status} = 'CANCELLED' or ${orders.status} = 'CANCELLED'), 0)`;
    const voidedQty = sql<number>`coalesce(sum(${orderItems.quantity}) filter (where ${orderItems.status} = 'VOIDED'), 0)::int`;
    const voidedAmount = sql<string>`coalesce(sum(${orderItems.lineTotal}) filter (where ${orderItems.status} = 'VOIDED'), 0)`;

    // Grouped by product identity *and* snapshot name: a rename keeps its
    // historical rows, and two different products that share a name never
    // collapse into one row.
    const grouped = this.db
      .select({
        productId: orderItems.productId,
        productName: orderItems.productNameSnapshot,
        categoryName: sql<string | null>`max(${categories.name})`,
        soldQuantity: sold,
        grossSales: gross,
        cancelledQuantity: cancelledQty,
        cancelledAmount,
        voidedQuantity: voidedQty,
        voidedAmount,
      })
      .from(orderItems)
      .innerJoin(
        orders,
        and(eq(orders.restaurantId, orderItems.restaurantId), eq(orders.id, orderItems.orderId)),
      )
      // Left joins: a soft-deleted or removed product must never drop its sales.
      .leftJoin(
        products,
        and(eq(products.restaurantId, orderItems.restaurantId), eq(products.id, orderItems.productId)),
      )
      .leftJoin(
        categories,
        and(eq(categories.restaurantId, products.restaurantId), eq(categories.id, products.categoryId)),
      )
      .where(and(...predicates))
      .groupBy(orderItems.productId, orderItems.productNameSnapshot);

    const rows = await grouped;
    const decorated = rows.map((row): ProductReportRow => {
      const grossValue = Number(row.grossSales);
      return {
        productId: row.productId,
        productName: row.productName,
        categoryName: row.categoryName,
        soldQuantity: row.soldQuantity,
        grossSales: money(grossValue),
        cancelledQuantity: row.cancelledQuantity,
        voidedQuantity: row.voidedQuantity,
        cancelledAmount: money(row.cancelledAmount),
        voidedAmount: money(row.voidedAmount),
        netSales: money(grossValue),
        averagePrice: money(row.soldQuantity > 0 ? grossValue / row.soldQuantity : 0),
      };
    });

    if (options.includeZeroSales) {
      decorated.push(...(await this.unsoldProducts(principal, decorated, search)));
    }

    // Sorting happens on the grouped result, which is bounded by the number of
    // distinct product names, not by the number of orders.
    const sorted = [...decorated].sort((left, right) => {
      switch (options.sort ?? "QUANTITY_DESC") {
        case "QUANTITY_ASC":
          return left.soldQuantity - right.soldQuantity;
        case "GROSS_DESC":
          return Number(right.grossSales) - Number(left.grossSales);
        case "NET_DESC":
          return Number(right.netSales) - Number(left.netSales);
        case "CANCELLED_DESC":
          return right.cancelledQuantity - left.cancelledQuantity;
        case "VOIDED_DESC":
          return right.voidedQuantity - left.voidedQuantity;
        case "NAME_ASC":
          return left.productName.localeCompare(right.productName, "tr");
        case "NAME_DESC":
          return right.productName.localeCompare(left.productName, "tr");
        default:
          return right.soldQuantity - left.soldQuantity;
      }
    });

    const offset = (page - 1) * pageSize;
    return {
      rows: sorted.slice(offset, offset + pageSize),
      total: sorted.length,
      page,
      pageSize,
    };
  }

  /**
   * Live catalog products that sold nothing in the period. They are a catalog
   * fact rather than a sales fact, so every figure is a real zero.
   */
  private async unsoldProducts(
    principal: StaffPrincipal,
    sold: readonly ProductReportRow[],
    search: string | undefined,
  ): Promise<ProductReportRow[]> {
    const soldIds = new Set(sold.map((row) => row.productId));
    const rows = await this.db
      .select({
        productId: products.id,
        productName: products.name,
        categoryName: sql<string | null>`${categories.name}`,
      })
      .from(products)
      .leftJoin(
        categories,
        and(eq(categories.restaurantId, products.restaurantId), eq(categories.id, products.categoryId)),
      )
      .where(
        and(
          eq(products.restaurantId, principal.restaurantId),
          isNull(products.deletedAt),
          ...(search ? [sql`${products.name} ilike ${`%${search}%`}`] : []),
        ),
      );

    return rows
      .filter((row) => !soldIds.has(row.productId))
      .map((row) => ({
        productId: row.productId,
        productName: row.productName,
        categoryName: row.categoryName,
        soldQuantity: 0,
        grossSales: money(0),
        cancelledQuantity: 0,
        voidedQuantity: 0,
        cancelledAmount: money(0),
        voidedAmount: money(0),
        netSales: money(0),
        averagePrice: money(0),
      }));
  }

  async getBusiest(
    principal: StaffPrincipal,
    range: ResolvedReportRange,
  ): Promise<BusiestReport> {
    const scope = and(
      eq(orders.restaurantId, principal.restaurantId),
      this.inRange(orders.createdAt, range),
      inArray(orders.status, [...REVENUE_ORDER_STATUSES]),
    );
    const localTime = sql`(${orders.createdAt} at time zone ${localTimeZone(range)})`;

    const [hourly, weekday, daily] = await Promise.all([
      this.db
        .select({
          hour: sql<number>`extract(hour from ${localTime})::int`,
          orderCount: sql<number>`count(*)::int`,
          sales: sql<string>`coalesce(sum(${orders.total}), 0)`,
        })
        .from(orders)
        .where(scope)
        // Grouped by output position, not by repeating the expression. The zone
        // is a bound parameter, and PostgreSQL binds each occurrence as its own
        // placeholder, so a repeated expression is not the *same* expression to
        // the grouping check and the query fails with 42803. The old fixed
        // `interval '3 hours'` was a literal, which is why it could be repeated.
        .groupBy(sql`1`)
        .orderBy(sql`1`),
      this.db
        .select({
          weekday: sql<number>`extract(dow from ${localTime})::int`,
          orderCount: sql<number>`count(*)::int`,
          sales: sql<string>`coalesce(sum(${orders.total}), 0)`,
        })
        .from(orders)
        .where(scope)
        .groupBy(sql`1`)
        .orderBy(sql`1`),
      this.db
        .select({
          date: sql<string>`to_char(${localTime}, 'YYYY-MM-DD')`,
          orderCount: sql<number>`count(*)::int`,
          grossSales: sql<string>`coalesce(sum(${orders.total}), 0)`,
        })
        .from(orders)
        .where(scope)
        .groupBy(sql`1`)
        .orderBy(sql`1`),
    ]);

    const paymentLocal = sql`(${payments.createdAt} at time zone ${localTimeZone(range)})`;
    const refundLocal = sql`(${paymentRefunds.createdAt} at time zone ${localTimeZone(range)})`;
    const [dailyCollected, dailyRefunded] = await Promise.all([
      this.db
        .select({
          date: sql<string>`to_char(${paymentLocal}, 'YYYY-MM-DD')`,
          collected: sql<string>`coalesce(sum(${payments.amount}), 0)`,
        })
        .from(payments)
        .where(
          and(
            eq(payments.restaurantId, principal.restaurantId),
            eq(payments.status, "COMPLETED"),
            this.inRange(payments.createdAt, range),
          ),
        )
        .groupBy(sql`1`),
      this.db
        .select({
          date: sql<string>`to_char(${refundLocal}, 'YYYY-MM-DD')`,
          refunds: sql<string>`coalesce(sum(${paymentRefunds.amount}), 0)`,
        })
        .from(paymentRefunds)
        .where(
          and(
            eq(paymentRefunds.restaurantId, principal.restaurantId),
            eq(paymentRefunds.status, "COMPLETED"),
            this.inRange(paymentRefunds.createdAt, range),
          ),
        )
        .groupBy(sql`1`),
    ]);

    const topHour = [...hourly].sort((left, right) => right.orderCount - left.orderCount)[0];
    const topWeekday = [...weekday].sort((left, right) => right.orderCount - left.orderCount)[0];
    const topDate = [...daily].sort((left, right) => right.orderCount - left.orderCount)[0];

    return {
      hourly: hourly.map((row) => ({
        hour: row.hour,
        orderCount: row.orderCount,
        sales: money(row.sales),
      })),
      busiestHour: topHour
        ? { hour: topHour.hour, orderCount: topHour.orderCount, sales: money(topHour.sales) }
        : null,
      weekday: weekday.map((row) => ({
        weekday: row.weekday,
        label: weekdayLabel(row.weekday),
        orderCount: row.orderCount,
        sales: money(row.sales),
        averageCheck: money(row.orderCount > 0 ? Number(row.sales) / row.orderCount : 0),
      })),
      busiestWeekday: topWeekday
        ? {
            label: weekdayLabel(topWeekday.weekday),
            orderCount: topWeekday.orderCount,
            sales: money(topWeekday.sales),
          }
        : null,
      busiestDate: topDate
        ? { date: topDate.date, orderCount: topDate.orderCount, sales: money(topDate.grossSales) }
        : null,
      daily: daily.map((row) => {
        const collected = Number(
          dailyCollected.find((entry) => entry.date === row.date)?.collected ?? 0,
        );
        const refunds = Number(
          dailyRefunded.find((entry) => entry.date === row.date)?.refunds ?? 0,
        );
        return {
          date: row.date,
          orderCount: row.orderCount,
          grossSales: money(row.grossSales),
          collected: money(collected),
          refunds: money(refunds),
          netCollected: money(collected - refunds),
        };
      }),
    };
  }

  async getFinance(
    principal: StaffPrincipal,
    range: ResolvedReportRange,
  ): Promise<FinanceReport> {
    const restaurantId = principal.restaurantId;
    const paymentScope = and(
      eq(payments.restaurantId, restaurantId),
      eq(payments.status, "COMPLETED"),
      this.inRange(payments.createdAt, range),
    );
    const refundScope = and(
      eq(paymentRefunds.restaurantId, restaurantId),
      eq(paymentRefunds.status, "COMPLETED"),
      this.inRange(paymentRefunds.createdAt, range),
    );

    const [methods, cashierPayments, cashierRefunds, orderCancels, itemCancels, voids, refundStats, refundReasons, largestRefunds] =
      await Promise.all([
        this.db
          .select({
            method: payments.method,
            count: sql<number>`count(*)::int`,
            gross: sql<string>`coalesce(sum(${payments.amount}), 0)`,
            refunds: sql<string>`coalesce(sum(${payments.refundedAmount}), 0)`,
          })
          .from(payments)
          .where(paymentScope)
          .groupBy(payments.method),
        this.db
          .select({
            staffId: payments.createdByUserId,
            staffName: sql<string>`max(${staffProfiles.name})`,
            isActive: sql<boolean>`bool_or(${staffProfiles.isActive})`,
            count: sql<number>`count(*)::int`,
            gross: sql<string>`coalesce(sum(${payments.amount}), 0)`,
            cash: sql<string>`coalesce(sum(${payments.amount}) filter (where ${payments.method} = 'CASH'), 0)`,
            card: sql<string>`coalesce(sum(${payments.amount}) filter (where ${payments.method} = 'CARD'), 0)`,
            other: sql<string>`coalesce(sum(${payments.amount}) filter (where ${payments.method} = 'OTHER'), 0)`,
          })
          .from(payments)
          .leftJoin(
            staffProfiles,
            and(
              eq(staffProfiles.restaurantId, payments.restaurantId),
              eq(staffProfiles.id, payments.createdByUserId),
            ),
          )
          .where(paymentScope)
          .groupBy(payments.createdByUserId),
        // Refunds are attributed to whoever issued them, not to the original
        // collector; the two are often different people.
        this.db
          .select({
            staffId: paymentRefunds.createdByUserId,
            count: sql<number>`count(*)::int`,
            amount: sql<string>`coalesce(sum(${paymentRefunds.amount}), 0)`,
          })
          .from(paymentRefunds)
          .where(refundScope)
          .groupBy(paymentRefunds.createdByUserId),
        this.db
          .select({ count: sql<number>`count(*)::int` })
          .from(orders)
          .where(
            and(
              eq(orders.restaurantId, restaurantId),
              eq(orders.status, "CANCELLED"),
              this.inRange(orders.createdAt, range),
            ),
          ),
        this.db
          .select({
            count: sql<number>`count(*)::int`,
            amount: sql<string>`coalesce(sum(${orderItems.lineTotal}), 0)`,
          })
          .from(orderItems)
          .innerJoin(
            orders,
            and(eq(orders.restaurantId, orderItems.restaurantId), eq(orders.id, orderItems.orderId)),
          )
          .where(
            and(
              eq(orderItems.restaurantId, restaurantId),
              eq(orderItems.status, "CANCELLED"),
              ne(orders.status, "CANCELLED"),
              this.inRange(orders.createdAt, range),
            ),
          ),
        this.db
          .select({
            reason: sql<string>`coalesce(${orderItems.voidReasonCode}::text, 'OTHER')`,
            count: sql<number>`count(*)::int`,
            amount: sql<string>`coalesce(sum(${orderItems.lineTotal}), 0)`,
          })
          .from(orderItems)
          .where(
            and(
              eq(orderItems.restaurantId, restaurantId),
              eq(orderItems.status, "VOIDED"),
              this.inRange(orderItems.voidedAt, range),
            ),
          )
          .groupBy(sql`coalesce(${orderItems.voidReasonCode}::text, 'OTHER')`),
        this.db
          .select({
            count: sql<number>`count(*)::int`,
            amount: sql<string>`coalesce(sum(${paymentRefunds.amount}), 0)`,
          })
          .from(paymentRefunds)
          .where(refundScope),
        this.db
          .select({
            reason: sql<string>`${paymentRefunds.reasonCode}::text`,
            count: sql<number>`count(*)::int`,
            amount: sql<string>`coalesce(sum(${paymentRefunds.amount}), 0)`,
          })
          .from(paymentRefunds)
          .where(refundScope)
          .groupBy(paymentRefunds.reasonCode),
        this.db
          .select({
            amount: paymentRefunds.amount,
            reason: sql<string>`${paymentRefunds.reasonCode}::text`,
            at: paymentRefunds.createdAt,
            staffName: sql<string>`coalesce(${staffProfiles.name}, 'Bilinmiyor')`,
          })
          .from(paymentRefunds)
          .leftJoin(
            staffProfiles,
            and(
              eq(staffProfiles.restaurantId, paymentRefunds.restaurantId),
              eq(staffProfiles.id, paymentRefunds.createdByUserId),
            ),
          )
          .where(refundScope)
          .orderBy(desc(paymentRefunds.amount))
          .limit(10),
      ]);

    const grossAll = methods.reduce((total, row) => total + Number(row.gross), 0);
    const refundTotal = Number(refundStats[0]?.amount ?? 0);
    const refundCount = refundStats[0]?.count ?? 0;
    const voidCount = voids.reduce((total, row) => total + row.count, 0);
    const voidAmount = voids.reduce((total, row) => total + Number(row.amount), 0);

    return {
      paymentMethods: methods.map((row) => {
        const gross = Number(row.gross);
        const refunds = Number(row.refunds);
        return {
          method: row.method,
          count: row.count,
          gross: money(gross),
          refunds: money(refunds),
          net: money(gross - refunds),
          share: grossAll > 0 ? Math.round((gross / grossAll) * 1000) / 10 : 0,
        };
      }),
      cashiers: cashierPayments.map((row) => {
        const refund = cashierRefunds.find((entry) => entry.staffId === row.staffId);
        const gross = Number(row.gross);
        const refunds = Number(refund?.amount ?? 0);
        return {
          staffId: row.staffId,
          staffName: row.staffName ?? "Bilinmiyor",
          isActive: row.isActive ?? false,
          paymentCount: row.count,
          gross: money(gross),
          cash: money(row.cash),
          card: money(row.card),
          other: money(row.other),
          refundCount: refund?.count ?? 0,
          refunds: money(refunds),
          net: money(gross - refunds),
          averagePayment: money(row.count > 0 ? gross / row.count : 0),
        };
      }),
      cancellations: {
        orderCount: orderCancels[0]?.count ?? 0,
        itemCount: itemCancels[0]?.count ?? 0,
        itemAmount: money(itemCancels[0]?.amount ?? 0),
      },
      voids: {
        count: voidCount,
        amount: money(voidAmount),
        byReason: voids.map((row) => ({
          reason: row.reason,
          count: row.count,
          amount: money(row.amount),
        })),
      },
      refunds: {
        count: refundCount,
        amount: money(refundTotal),
        average: money(refundCount > 0 ? refundTotal / refundCount : 0),
        byReason: refundReasons.map((row) => ({
          reason: row.reason,
          count: row.count,
          amount: money(row.amount),
        })),
        largest: largestRefunds.map((row) => ({
          amount: money(row.amount),
          reason: row.reason,
          at: row.at.toISOString(),
          staffName: row.staffName,
        })),
      },
    };
  }

  async getTables(
    principal: StaffPrincipal,
    range: ResolvedReportRange,
  ): Promise<readonly TableReportRow[]> {
    // The per-table totals and the service-request counts are independent; one
    // round trip carries both.
    const [rows, calls] = await Promise.all([
      this.db
        .select({
          tableId: restaurantTables.id,
          tableName: restaurantTables.name,
          orderCount: sql<number>`count(${orders.id})::int`,
          completedOrderCount: sql<number>`count(*) filter (where ${orders.status} = 'COMPLETED')::int`,
          grossSales: sql<string>`coalesce(sum(${orders.total}) filter (where ${orders.status} in ('SERVED','COMPLETED')), 0)`,
          revenueOrders: sql<number>`count(*) filter (where ${orders.status} in ('SERVED','COMPLETED'))::int`,
        })
        .from(orders)
        .innerJoin(
          restaurantTables,
          and(
            eq(restaurantTables.restaurantId, orders.restaurantId),
            eq(restaurantTables.id, orders.tableId),
          ),
        )
        .where(
          and(
            eq(orders.restaurantId, principal.restaurantId),
            // This report answers "how did each table do", so it is dine-in by
            // definition. Takeaway and courier revenue is not missing from the
            // books — it is counted by channel in the sales report instead of
            // being pooled here into a table that does not exist.
            eq(orders.channel, "DINE_IN"),
            this.inRange(orders.createdAt, range),
          ),
        )
        .groupBy(restaurantTables.id, restaurantTables.name)
        .orderBy(desc(sql`count(${orders.id})`)),
      this.db
        .select({
          tableId: waiterCalls.tableId,
          count: sql<number>`count(*)::int`,
        })
        .from(waiterCalls)
        .where(
          and(
            eq(waiterCalls.restaurantId, principal.restaurantId),
            this.inRange(waiterCalls.createdAt, range),
          ),
        )
        .groupBy(waiterCalls.tableId),
    ]);

    return rows.map((row) => ({
      tableId: row.tableId,
      tableName: row.tableName,
      orderCount: row.orderCount,
      completedOrderCount: row.completedOrderCount,
      grossSales: money(row.grossSales),
      averageCheck: money(
        row.revenueOrders > 0 ? Number(row.grossSales) / row.revenueOrders : 0,
      ),
      callCount: calls.find((entry) => entry.tableId === row.tableId)?.count ?? 0,
    }));
  }

  /**
   * Staff attribution is deliberately explicit: an order is counted once for
   * the person who opened it, never again for whoever confirmed or served it,
   * so summing the column can never inflate revenue.
   */
  async getStaff(
    principal: StaffPrincipal,
    range: ResolvedReportRange,
  ): Promise<readonly StaffReportRow[]> {
    const restaurantId = principal.restaurantId;

    const [created, voided, resolvedCalls, profiles] = await Promise.all([
      this.db
        .select({
          staffId: orders.createdByUserId,
          count: sql<number>`count(*)::int`,
          revenue: sql<string>`coalesce(sum(${orders.total}) filter (where ${orders.status} in ('SERVED','COMPLETED')), 0)`,
        })
        .from(orders)
        .where(
          and(
            eq(orders.restaurantId, restaurantId),
            eq(orders.createdByType, "STAFF"),
            this.inRange(orders.createdAt, range),
          ),
        )
        .groupBy(orders.createdByUserId),
      this.db
        .select({
          staffId: orderItems.voidedBy,
          count: sql<number>`count(*)::int`,
        })
        .from(orderItems)
        .where(
          and(
            eq(orderItems.restaurantId, restaurantId),
            eq(orderItems.status, "VOIDED"),
            this.inRange(orderItems.voidedAt, range),
          ),
        )
        .groupBy(orderItems.voidedBy),
      this.db
        .select({
          staffId: waiterCalls.resolvedBy,
          count: sql<number>`count(*)::int`,
        })
        .from(waiterCalls)
        .where(
          and(
            eq(waiterCalls.restaurantId, restaurantId),
            eq(waiterCalls.status, "RESOLVED"),
            this.inRange(waiterCalls.resolvedAt, range),
          ),
        )
        .groupBy(waiterCalls.resolvedBy),
      // Inactive profiles are kept: a departed member must not erase history.
      this.db
        .select({
          id: staffProfiles.id,
          name: staffProfiles.name,
          role: staffProfiles.role,
          isActive: staffProfiles.isActive,
        })
        .from(staffProfiles)
        .where(eq(staffProfiles.restaurantId, restaurantId)),
    ]);

    return profiles
      .map((profile): StaffReportRow => {
        const createdRow = created.find((entry) => entry.staffId === profile.id);
        return {
          staffId: profile.id,
          staffName: profile.name,
          role: profile.role,
          isActive: profile.isActive,
          createdOrderCount: createdRow?.count ?? 0,
          createdOrderRevenue: money(createdRow?.revenue ?? 0),
          // Item cancellation records no actor column, so it is reported at the
          // restaurant level in the finance report rather than per person.
          cancelledItemCount: 0,
          voidedItemCount: voided.find((entry) => entry.staffId === profile.id)?.count ?? 0,
          resolvedCallCount:
            resolvedCalls.find((entry) => entry.staffId === profile.id)?.count ?? 0,
        };
      })
      .filter(
        (row) =>
          row.createdOrderCount > 0 ||
          row.voidedItemCount > 0 ||
          row.resolvedCallCount > 0 ||
          row.isActive,
      );
  }

  async getReviewAlerts(
    principal: StaffPrincipal,
    range: ResolvedReportRange,
  ): Promise<ReviewReport> {
    // None of the three depends on the others' results.
    const [staff, refunds, voidAmounts] = await Promise.all([
        this.getStaff(principal, range),
      this.db
        .select({
          staffId: paymentRefunds.createdByUserId,
          count: sql<number>`count(*)::int`,
          amount: sql<string>`coalesce(sum(${paymentRefunds.amount}), 0)`,
        })
        .from(paymentRefunds)
        .where(
          and(
            eq(paymentRefunds.restaurantId, principal.restaurantId),
            eq(paymentRefunds.status, "COMPLETED"),
            this.inRange(paymentRefunds.createdAt, range),
          ),
        )
        .groupBy(paymentRefunds.createdByUserId),
      this.db
        .select({
          staffId: orderItems.voidedBy,
          amount: sql<string>`coalesce(sum(${orderItems.lineTotal}), 0)`,
        })
        .from(orderItems)
        .where(
          and(
            eq(orderItems.restaurantId, principal.restaurantId),
            eq(orderItems.status, "VOIDED"),
            this.inRange(orderItems.voidedAt, range),
          ),
        )
        .groupBy(orderItems.voidedBy),
    ]);

    const activity: StaffActivity[] = staff.map((row) => {
      const refund = refunds.find((entry) => entry.staffId === row.staffId);
      return {
        staffId: row.staffId,
        staffName: row.staffName,
        role: row.role,
        isActive: row.isActive,
        totalActions:
          row.createdOrderCount + row.voidedItemCount + row.resolvedCallCount + (refund?.count ?? 0),
        cancelCount: row.cancelledItemCount,
        voidCount: row.voidedItemCount,
        refundCount: refund?.count ?? 0,
        cancelledAmountMinor: 0,
        voidedAmountMinor: minor(
          voidAmounts.find((entry) => entry.staffId === row.staffId)?.amount ?? 0,
        ),
        refundedAmountMinor: minor(refund?.amount ?? 0),
      };
    });

    return buildReviewReport(activity, DEFAULT_REVIEW_THRESHOLDS);
  }
}
