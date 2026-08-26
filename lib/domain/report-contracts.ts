import type { Trend } from "./report-range";

/**
 * The shapes the report API speaks, kept out of the server-only service so the
 * admin panel and the request validators can import them without dragging a
 * database module into the browser bundle.
 */

/**
 * Advanced reporting is a management surface, never a service-floor one. Lives
 * here rather than in the route so tests and the admin UI can read it without
 * pulling in a server-only module.
 */
export const REPORT_ROLES = ["ADMIN", "MANAGER"] as const;

export const PRODUCT_SORTS = [
  "QUANTITY_DESC",
  "QUANTITY_ASC",
  "GROSS_DESC",
  "NET_DESC",
  "CANCELLED_DESC",
  "VOIDED_DESC",
  "NAME_ASC",
  "NAME_DESC",
] as const;

export type ProductSort = (typeof PRODUCT_SORTS)[number];

export interface ReportSummaryMetric {
  readonly value: string;
  readonly previous: string | null;
  readonly trend: Trend | null;
}

export interface ReportChannelRow {
  /** Already in words: "Masada", "Paket Sipariş", "Kurye Siparişi". */
  readonly label: string;
  readonly sales: string;
  readonly orderCount: number;
}

export interface ReportSummary {
  readonly range: { readonly start: string; readonly endExclusive: string; readonly label: string };
  readonly comparisonLabel: string | null;
  readonly grossSales: ReportSummaryMetric;
  readonly grossCollected: ReportSummaryMetric;
  readonly refunds: ReportSummaryMetric;
  readonly netCollected: ReportSummaryMetric;
  readonly orderCount: ReportSummaryMetric;
  readonly completedOrderCount: ReportSummaryMetric;
  readonly cancelledOrderCount: ReportSummaryMetric;
  readonly averageCheck: ReportSummaryMetric;
  /**
   * The same revenue, split by where the order came from. The three sales
   * figures sum to `grossSales`, because they are that sum partitioned rather
   * than a second count of it.
   */
  readonly channels: readonly ReportChannelRow[];
  /** True profit needs product cost data the system does not record yet. */
  readonly profitAvailable: false;
}

export interface ProductReportRow {
  /** Identity, so two products sharing a name stay separate rows. */
  readonly productId: string;
  readonly productName: string;
  readonly categoryName: string | null;
  readonly soldQuantity: number;
  readonly grossSales: string;
  readonly cancelledQuantity: number;
  readonly voidedQuantity: number;
  readonly cancelledAmount: string;
  readonly voidedAmount: string;
  readonly netSales: string;
  readonly averagePrice: string;
}

export interface ProductReport {
  readonly rows: readonly ProductReportRow[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export interface BusiestReport {
  readonly hourly: readonly {
    readonly hour: number;
    readonly orderCount: number;
    readonly sales: string;
  }[];
  readonly busiestHour:
    | { readonly hour: number; readonly orderCount: number; readonly sales: string }
    | null;
  readonly weekday: readonly {
    readonly weekday: number;
    readonly label: string;
    readonly orderCount: number;
    readonly sales: string;
    readonly averageCheck: string;
  }[];
  readonly busiestWeekday:
    | { readonly label: string; readonly orderCount: number; readonly sales: string }
    | null;
  readonly busiestDate:
    | { readonly date: string; readonly orderCount: number; readonly sales: string }
    | null;
  readonly daily: readonly {
    readonly date: string;
    readonly orderCount: number;
    readonly grossSales: string;
    readonly collected: string;
    readonly refunds: string;
    readonly netCollected: string;
  }[];
}

export interface FinanceReport {
  readonly paymentMethods: readonly {
    readonly method: string;
    readonly count: number;
    readonly gross: string;
    readonly refunds: string;
    readonly net: string;
    readonly share: number;
  }[];
  readonly cashiers: readonly {
    readonly staffId: string | null;
    readonly staffName: string;
    readonly isActive: boolean;
    readonly paymentCount: number;
    readonly gross: string;
    readonly cash: string;
    readonly card: string;
    readonly other: string;
    readonly refundCount: number;
    readonly refunds: string;
    readonly net: string;
    readonly averagePayment: string;
  }[];
  readonly cancellations: {
    readonly orderCount: number;
    readonly itemCount: number;
    readonly itemAmount: string;
  };
  readonly voids: {
    readonly count: number;
    readonly amount: string;
    readonly byReason: readonly {
      readonly reason: string;
      readonly count: number;
      readonly amount: string;
    }[];
  };
  readonly refunds: {
    readonly count: number;
    readonly amount: string;
    readonly average: string;
    readonly byReason: readonly {
      readonly reason: string;
      readonly count: number;
      readonly amount: string;
    }[];
    readonly largest: readonly {
      readonly amount: string;
      readonly reason: string;
      readonly at: string;
      readonly staffName: string;
    }[];
  };
}

export interface TableReportRow {
  readonly tableId: string;
  readonly tableName: string;
  readonly orderCount: number;
  readonly completedOrderCount: number;
  readonly grossSales: string;
  readonly averageCheck: string;
  readonly callCount: number;
}

export interface StaffReportRow {
  readonly staffId: string;
  readonly staffName: string;
  readonly role: string;
  readonly isActive: boolean;
  readonly createdOrderCount: number;
  readonly createdOrderRevenue: string;
  readonly cancelledItemCount: number;
  readonly voidedItemCount: number;
  readonly resolvedCallCount: number;
}

export interface ProductDetailReport {
  readonly productId: string;
  readonly productName: string;
  readonly categoryName: string | null;
  /** True when the product no longer exists in the current catalog. */
  readonly removedFromCatalog: boolean;
  readonly soldQuantity: number;
  readonly grossSales: string;
  readonly cancelledQuantity: number;
  readonly cancelledAmount: string;
  readonly voidedQuantity: number;
  readonly voidedAmount: string;
  readonly netSales: string;
  readonly averagePrice: string;
  readonly orderCount: number;
  readonly busiestHour: { readonly hour: number; readonly quantity: number } | null;
  readonly busiestWeekday: { readonly label: string; readonly quantity: number } | null;
  readonly busiestDate: { readonly date: string; readonly quantity: number } | null;
  readonly daily: readonly {
    readonly date: string;
    readonly quantity: number;
    readonly grossSales: string;
    readonly cancelledQuantity: number;
    readonly voidedQuantity: number;
    readonly netSales: string;
  }[];
}

export interface CategoryReportRow {
  readonly categoryId: string | null;
  /** Current catalog label; category names carry no historical snapshot. */
  readonly categoryName: string;
  readonly soldQuantity: number;
  readonly orderCount: number;
  readonly grossSales: string;
  readonly cancelledQuantity: number;
  readonly voidedQuantity: number;
  readonly netSales: string;
  readonly share: number;
  readonly averagePrice: string;
}

/** A metric the recorded history can genuinely support, or an honest refusal. */
export type KitchenMetric<TValue> =
  | { readonly supported: true; readonly value: TValue }
  | { readonly supported: false; readonly reason: string };

export interface KitchenStaffRow {
  readonly staffId: string;
  readonly staffName: string;
  readonly isActive: boolean;
  readonly startedPreparationCount: number;
  readonly markedReadyCount: number;
}

export interface KitchenReport {
  readonly staff: readonly KitchenStaffRow[];
  readonly preparedItemCount: number;
  readonly distinctProductCount: number;
  readonly busiestHour: { readonly hour: number; readonly count: number } | null;
  readonly busiestWeekday: { readonly label: string; readonly count: number } | null;
  readonly duration: KitchenMetric<{
    readonly averageSeconds: number;
    readonly medianSeconds: number;
    readonly p90Seconds: number;
    readonly sampleCount: number;
    /** Pairs dropped for a missing or inverted timestamp. */
    readonly excludedSamples: number;
  }>;
  readonly topProducts: readonly {
    readonly productName: string;
    readonly preparedQuantity: number;
  }[];
}

export interface ReviewDetailRow {
  readonly id: string;
  readonly at: string;
  readonly kind: "CANCEL" | "VOID" | "REFUND";
  readonly staffName: string;
  readonly staffRole: string;
  readonly tableName: string | null;
  readonly orderId: string | null;
  readonly orderNumber: string | null;
  readonly productName: string | null;
  readonly amount: string;
  readonly reason: string | null;
  readonly note: string | null;
}

export interface ReviewDetailReport {
  readonly rows: readonly ReviewDetailRow[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export interface OrderTimelineReport {
  readonly order: {
    readonly id: string;
    readonly orderNumber: string;
    readonly tableName: string;
    readonly status: string;
    readonly createdAt: string;
    readonly total: string;
    readonly grossCollected: string;
    readonly refunds: string;
    readonly netCollected: string;
    readonly outstanding: string;
  };
  readonly entries: readonly import("./order-timeline").OrderTimelineEntry[];
}
