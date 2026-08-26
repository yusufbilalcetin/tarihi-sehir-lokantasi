import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../../db/migrations/0013_phase38_erp_core.sql", import.meta.url), "utf8");

test("Phase 38 migration is additive and protects every ERP table from direct browser access", () => {
  assert.doesNotMatch(migration, /\bDROP\s+(?:TABLE|COLUMN|TYPE)\b/i);
  assert.match(migration, /REVOKE ALL ON TABLE[\s\S]+FROM anon, authenticated/);
  for (const table of ["inventory_items", "stock_movements", "recipe_versions", "production_batches", "suppliers", "purchase_orders", "supplier_invoices", "attendance_records", "reservations", "loyalty_ledger", "integration_connections"]) {
    assert.match(migration, new RegExp(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`));
  }
});

test("Phase 38 tenant references are composite and critical writes are idempotent", () => {
  assert.match(migration, /FOREIGN KEY \("restaurant_id", "inventory_item_id"\)/);
  assert.match(migration, /FOREIGN KEY \("restaurant_id", "supplier_id"\)/);
  assert.match(migration, /FOREIGN KEY \("restaurant_id", "staff_id"\)/);
  for (const key of ["stock_movements_restaurant_idempotency_key", "production_batches_restaurant_idempotency_key", "goods_receipts_restaurant_idempotency_key", "supplier_payments_restaurant_idempotency_key", "loyalty_ledger_restaurant_idempotency_key", "external_transactions_restaurant_idempotency_key"]) {
    assert.match(migration, new RegExp(key));
  }
});

test("quantity and money columns have controlled database precision", () => {
  assert.match(migration, /numeric\(18, 6\)/);
  assert.match(migration, /numeric\(14, 2\)/);
  assert.doesNotMatch(migration, /double precision|real\b/i);
});
