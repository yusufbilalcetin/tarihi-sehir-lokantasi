/**
 * Long-term row-growth model for the append-heavy tables.
 *
 * This deliberately produces *row counts* from inputs the operator supplies.
 * It does not invent a restaurant's volume, and it does not pretend to know how
 * many bytes a row costs: `averageRowBytes` must be measured on a populated
 * database (see docs/long-term-capacity.md) before any storage figure here can
 * be treated as more than an order of magnitude.
 */

export interface CapacityInput {
  readonly ordersPerDay: number;
  readonly averageItemsPerOrder: number;
  readonly averageEventsPerOrder: number;
  readonly averagePaymentsPerOrder: number;
  /** Waiter calls plus bill requests per day. */
  readonly averageCallsPerDay: number;
  /** Audited mutations per order (voids, cancels, edits, payments). */
  readonly averageAuditRowsPerOrder: number;
  readonly years: number;
}

export interface CapacityTableEstimate {
  readonly table: string;
  readonly rowsPerYear: number;
  readonly rows: number;
  /** Only present when a measured average row size was supplied. */
  readonly estimatedBytes: number | null;
}

export interface CapacityEstimate {
  readonly input: CapacityInput;
  readonly tables: readonly CapacityTableEstimate[];
  readonly totalRows: number;
  readonly totalEstimatedBytes: number | null;
  /**
   * True when no measured row sizes were supplied, so every byte figure is
   * absent rather than guessed.
   */
  readonly bytesUnknown: boolean;
}

const DAYS_PER_YEAR = 365;

function positive(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`[Capacity] ${name} must be a non-negative finite number.`);
  }
  return value;
}

/**
 * `averageRowBytes` maps a table name to a measured average row width in bytes
 * (`avg(pg_column_size(t.*))`). Tables missing from it report `null` bytes.
 * Index storage is not included; measure it separately with
 * `pg_indexes_size` — on this schema it is frequently larger than the heap.
 */
export function estimateCapacity(
  input: CapacityInput,
  averageRowBytes: Readonly<Record<string, number>> = {},
): CapacityEstimate {
  const ordersPerYear =
    positive(input.ordersPerDay, "ordersPerDay") * DAYS_PER_YEAR;
  const years = positive(input.years, "years");

  const perYear: Readonly<Record<string, number>> = {
    orders: ordersPerYear,
    order_items:
      ordersPerYear * positive(input.averageItemsPerOrder, "averageItemsPerOrder"),
    order_events:
      ordersPerYear * positive(input.averageEventsPerOrder, "averageEventsPerOrder"),
    payments:
      ordersPerYear * positive(input.averagePaymentsPerOrder, "averagePaymentsPerOrder"),
    audit_logs:
      ordersPerYear * positive(input.averageAuditRowsPerOrder, "averageAuditRowsPerOrder"),
    waiter_calls: positive(input.averageCallsPerDay, "averageCallsPerDay") * DAYS_PER_YEAR,
  };

  const tables = Object.entries(perYear).map(([table, rowsPerYear]) => {
    const rows = Math.round(rowsPerYear * years);
    const bytes = averageRowBytes[table];
    return {
      table,
      rowsPerYear: Math.round(rowsPerYear),
      rows,
      estimatedBytes: typeof bytes === "number" && bytes > 0 ? Math.round(rows * bytes) : null,
    };
  });

  const totalRows = tables.reduce((sum, table) => sum + table.rows, 0);
  const bytesUnknown = tables.some((table) => table.estimatedBytes === null);

  return {
    input,
    tables,
    totalRows,
    totalEstimatedBytes: bytesUnknown
      ? null
      : tables.reduce((sum, table) => sum + (table.estimatedBytes ?? 0), 0),
    bytesUnknown,
  };
}

/** The horizons Phase 7F is asked to answer for. */
export const CAPACITY_HORIZON_YEARS = [2, 5, 10] as const;
