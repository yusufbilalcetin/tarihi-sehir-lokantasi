import assert from "node:assert/strict";
import { test } from "node:test";

import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";

import * as schema from "../../db/schema";
import {
  AUTO_DELETABLE_TABLES,
  DATA_RETENTION,
  MAINTENANCE_BATCH,
  MAINTENANCE_OPERATIONS,
  PROTECTED_TABLES,
  RETENTION_BY_TABLE,
  assertBatchSize,
  assertMaxBatches,
  retentionOf,
} from "../../lib/config/data-retention";
import { CAPACITY_HORIZON_YEARS, estimateCapacity } from "../../lib/domain/data-capacity";

/**
 * Phase 7F — the retention policy is a safety boundary, so it is tested like
 * one. The point of this file is that a future edit which quietly moves
 * `payments` (or any other history table) onto the auto-delete allow-list fails
 * here, long before it can run against a real database.
 */

const schemaTables = (Object.values(schema) as unknown[])
  .filter((value): value is PgTable => is(value, PgTable))
  .map((table) => getTableName(table))
  .sort();

/** Every table whose loss would change a financial or historical answer. */
const MUST_NEVER_AUTO_DELETE = [
  "orders",
  "order_items",
  "payments",
  "payment_refunds",
  "order_checks",
  "order_check_items",
  "audit_logs",
  "order_events",
  "waiter_calls",
  "kitchen_tickets",
  "restaurants",
  "staff_profiles",
  "categories",
  "products",
  "restaurant_tables",
  "restaurant_counters",
  "restaurant_settings",
  // Phase 8A cash accountability. A shift's counted drawer and its variance
  // exist nowhere else, so neither table may ever become cleanable.
  "cash_registers",
  "cashier_shifts",
  "cash_drawer_movements",
  // Phase 8C printing. Print history is the evidence for what reached a
  // printer, including every reprint and its reason.
  "printer_agents",
  "restaurant_printers",
  "printer_routes",
  "print_jobs",
  "print_job_attempts",
  // Phase 38 ERP. Quantity, cost, procurement, people and customer ledgers are
  // business history; their master rows are referenced by that history.
  "warehouses", "inventory_items", "stock_movements", "stock_counts", "stock_count_lines",
  "recipe_versions", "recipe_ingredients", "production_batches", "waste_records",
  "suppliers", "supplier_items", "purchase_orders", "purchase_order_items",
  "goods_receipts", "goods_receipt_items", "supplier_invoices", "supplier_payments",
  "attendance_records", "staff_schedules", "payroll_entries", "customer_feedback",
  "reservations", "fulfillment_requests", "fulfillment_request_items",
  "customer_accounts", "customer_order_links",
  "loyalty_ledger", "popular_product_snapshots", "integration_connections",
  "external_transactions",
] as const;

test("every public table is classified exactly once", () => {
  // The count is asserted deliberately: a new table must be classified, not
  // silently inherit a default. Phase 7F shipped 20; Phase 8A added three and
  // Phase 8C five more for printing; Phase 38 adds 29 ERP tables and Phase 39
  // the fulfillment line items.
  assert.equal(schemaTables.length, 58, `expected 58 tables, found ${schemaTables.length}`);
  assert.equal(
    DATA_RETENTION.length,
    RETENTION_BY_TABLE.size,
    "a table is declared twice in the retention policy",
  );
  assert.deepEqual(
    DATA_RETENTION.map((policy) => policy.table).sort(),
    schemaTables,
    "the retention policy and the schema disagree about which tables exist",
  );
});

test("financial and history tables can never be auto-deleted", () => {
  for (const table of MUST_NEVER_AUTO_DELETE) {
    const policy = retentionOf(table);
    assert.equal(
      policy.autoDelete.mode,
      "NEVER",
      `${table} must never carry an automatic deletion policy`,
    );
    assert.ok(
      !AUTO_DELETABLE_TABLES.includes(table),
      `${table} leaked onto the automatic deletion allow-list`,
    );
    assert.ok(
      PROTECTED_TABLES.includes(table),
      `${table} must appear on the deny-list`,
    );
    // A NEVER policy without a stated reason is how a table quietly loses its
    // protection during a later refactor.
    assert.ok(
      policy.autoDelete.mode === "NEVER" && policy.autoDelete.reason.length > 20,
      `${table} must record why it is retained`,
    );
  }
});

test("the auto-delete allow-list is exactly the three technical tables", () => {
  assert.deepEqual(
    [...AUTO_DELETABLE_TABLES].sort(),
    ["api_rate_limits", "idempotency_keys", "outbox_events"],
    "the set of auto-deletable tables changed",
  );
  assert.equal(
    AUTO_DELETABLE_TABLES.length + PROTECTED_TABLES.length,
    schemaTables.length,
    "every table is either deletable or protected, never neither",
  );
});

test("each conditional policy maps to an implemented operation with a sane cutoff", () => {
  const operations = new Set<string>();
  for (const table of AUTO_DELETABLE_TABLES) {
    const policy = retentionOf(table).autoDelete;
    assert.equal(policy.mode, "CONDITIONAL");
    if (policy.mode !== "CONDITIONAL") return;
    assert.ok(
      MAINTENANCE_OPERATIONS.includes(policy.operation),
      `${table} names an unimplemented operation`,
    );
    assert.ok(!operations.has(policy.operation), `${policy.operation} is claimed twice`);
    operations.add(policy.operation);
    assert.ok(
      Number.isInteger(policy.graceDays) && policy.graceDays >= 0 && policy.graceDays <= 365,
      `${table} has an implausible grace period`,
    );
    assert.ok(policy.condition.length > 20, `${table} must state its cleanup condition`);
  }
  assert.equal(
    operations.size,
    MAINTENANCE_OPERATIONS.length,
    "an implemented operation has no policy behind it",
  );
});

test("the outbox policy protects undelivered events in writing", () => {
  const policy = retentionOf("outbox_events").autoDelete;
  assert.equal(policy.mode, "CONDITIONAL");
  if (policy.mode !== "CONDITIONAL") return;
  assert.ok(policy.condition.includes("PUBLISHED"), "only published events may be removed");
  for (const state of ["PENDING", "FAILED", "dead-lettered"]) {
    assert.ok(policy.condition.includes(state), `${state} events must be named as protected`);
  }
});

test("batch bounds reject extremes rather than trusting the caller", () => {
  assert.equal(assertBatchSize(MAINTENANCE_BATCH.default), MAINTENANCE_BATCH.default);
  assert.equal(assertBatchSize(MAINTENANCE_BATCH.minimum), MAINTENANCE_BATCH.minimum);
  assert.equal(assertBatchSize(MAINTENANCE_BATCH.maximum), MAINTENANCE_BATCH.maximum);
  for (const invalid of [0, -1, 1.5, Number.NaN, MAINTENANCE_BATCH.maximum + 1]) {
    assert.throws(() => assertBatchSize(invalid), TypeError, `batch size ${invalid} was accepted`);
  }
  assert.equal(assertMaxBatches(1), 1);
  for (const invalid of [0, -3, 2.5, MAINTENANCE_BATCH.maximumMaxBatches + 1]) {
    assert.throws(() => assertMaxBatches(invalid), TypeError, `maxBatches ${invalid} was accepted`);
  }
});

test("an unknown table has no implicit policy", () => {
  assert.throws(() => retentionOf("orders_archive_2030"), /No policy is declared/);
});

test("the capacity model scales linearly and never invents bytes", () => {
  const input = {
    ordersPerDay: 100,
    averageItemsPerOrder: 4,
    averageEventsPerOrder: 6,
    averagePaymentsPerOrder: 1.2,
    averageCallsPerDay: 30,
    averageAuditRowsPerOrder: 2,
    years: 1,
  };

  const oneYear = estimateCapacity(input);
  const orders = oneYear.tables.find((table) => table.table === "orders")!;
  const items = oneYear.tables.find((table) => table.table === "order_items")!;
  assert.equal(orders.rows, 100 * 365);
  assert.equal(items.rows, 100 * 4 * 365);
  assert.equal(oneYear.bytesUnknown, true, "no measured row size means no byte figure");
  assert.equal(oneYear.totalEstimatedBytes, null);
  assert.equal(orders.estimatedBytes, null);

  for (const years of CAPACITY_HORIZON_YEARS) {
    const horizon = estimateCapacity({ ...input, years });
    assert.equal(
      horizon.totalRows,
      oneYear.totalRows * years,
      `the ${years}-year model must be the one-year model times ${years}`,
    );
  }

  const measured = estimateCapacity(
    { ...input, years: 2 },
    { orders: 200, order_items: 120, order_events: 150, payments: 180, audit_logs: 400, waiter_calls: 90 },
  );
  assert.equal(measured.bytesUnknown, false);
  assert.equal(
    measured.tables.find((table) => table.table === "orders")!.estimatedBytes,
    100 * 365 * 2 * 200,
  );
  assert.ok((measured.totalEstimatedBytes ?? 0) > 0);
});

test("the capacity model refuses nonsense input instead of guessing", () => {
  const base = {
    ordersPerDay: 10,
    averageItemsPerOrder: 3,
    averageEventsPerOrder: 4,
    averagePaymentsPerOrder: 1,
    averageCallsPerDay: 2,
    averageAuditRowsPerOrder: 1,
    years: 5,
  };
  assert.throws(() => estimateCapacity({ ...base, ordersPerDay: -1 }), TypeError);
  assert.throws(() => estimateCapacity({ ...base, years: Number.NaN }), TypeError);
});
