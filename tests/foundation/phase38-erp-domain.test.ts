import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregatePopularProducts,
  classifyMenuItem,
  contributionMetrics,
  convertQuantity,
  evaluateStockBalance,
  forecastPortions,
  loyaltyBalance,
  parseFixedDecimal,
  payableBalance,
  payrollNetPayable,
  productionConsumption,
  quantityToAtoms,
  rangesOverlap,
  recipeCostMinor,
  remainingProductionPortions,
  requiresTable,
  weightedAverageUnitCost,
  workedMinutes,
} from "../../lib/domain/erp";
import { TestPaymentTerminalAdapter } from "../../lib/integrations/erp-adapters";

test("fixed decimal parsing rejects precision loss and exponent notation", () => {
  assert.equal(parseFixedDecimal("12,500000", 6), 12_500_000n);
  assert.throws(() => parseFixedDecimal("1.0000001", 6));
  assert.throws(() => parseFixedDecimal("1e3", 6));
});

test("mass and volume conversions are exact", () => {
  assert.equal(convertQuantity("1.8", "KG", "G"), "1800.000000");
  assert.equal(convertQuantity("12.5", "L", "ML"), "12500.000000");
  assert.equal(quantityToAtoms("180", "G"), quantityToAtoms("0.18", "KG"));
  assert.throws(() => convertQuantity("1", "KG", "L"));
  assert.throws(() => convertQuantity("1", "PACKAGE", "UNIT"));
});

test("negative stock is a warning by default and blockable by policy", () => {
  assert.deepEqual(evaluateStockBalance(5n, -8n), { nextAtoms: -3n, warning: true });
  assert.throws(() => evaluateStockBalance(5n, -8n, "BLOCK"));
  assert.deepEqual(evaluateStockBalance(5n, 2n, "BLOCK"), { nextAtoms: 7n, warning: false });
});

test("weighted average cost uses total value without floating point", () => {
  const cost = weightedAverageUnitCost({
    existingAtoms: 10_000_000n,
    existingValueMinor: 10_000n,
    receivedAtoms: 5_000_000n,
    receivedValueMinor: 7_500n,
  });
  assert.equal(cost, 1_167n);
  assert.throws(() => weightedAverageUnitCost({ existingAtoms: 0n, existingValueMinor: 0n, receivedAtoms: 0n, receivedValueMinor: 0n }));
});

test("recipe costing produces portion cost and honest contribution", () => {
  const portionCost = recipeCostMinor([
    { quantityAtoms: 1_800_000n, unitCostMicrosPerAtom: 50_000n },
    { quantityAtoms: 500_000n, unitCostMicrosPerAtom: 10_000n },
  ], 10n);
  assert.equal(portionCost, 9_500n);
  assert.deepEqual(contributionMetrics(27_550n, 9_240n), {
    contributionMinor: 18_310n,
    foodCostBasisPoints: 3_354n,
  });
  assert.equal(contributionMetrics(0n, 0n).foodCostBasisPoints, null);
});

test("production consumption scales recipe once with exact rounding", () => {
  assert.deepEqual(productionConsumption([
    { inventoryItemId: "beef", batchQuantityAtoms: 1_800_000n },
    { inventoryItemId: "onion", batchQuantityAtoms: 500_000n },
  ], 10n, 40n), [
    { inventoryItemId: "beef", quantityAtoms: 7_200_000n, batchQuantityAtoms: 7_200_000n },
    { inventoryItemId: "onion", quantityAtoms: 2_000_000n, batchQuantityAtoms: 2_000_000n },
  ]);
});

test("remaining production distinguishes sales, waste, staff meal and complimentary", () => {
  assert.equal(remainingProductionPortions({ prepared: 80n, sold: 63n, waste: 3n }), 14n);
  assert.equal(remainingProductionPortions({ prepared: 80n, sold: 60n, waste: 3n, staffMeal: 2n, complimentary: 1n }), 14n);
});

test("supplier payable supports partial payments", () => {
  assert.equal(payableBalance(100_000n, [20_000n, 30_000n]), 50_000n);
  assert.equal(payableBalance(100_000n, [100_000n]), 0n);
});

test("forecast is explainable, recent weighted and ignores sold-out-censored days", () => {
  assert.equal(forecastPortions([
    { portions: 75n, soldOut: false, recencyRank: 0 },
    { portions: 81n, soldOut: false, recencyRank: 1 },
    { portions: 20n, soldOut: true, recencyRank: 2 },
    { portions: 78n, soldOut: false, recencyRank: 2 },
    { portions: 72n, soldOut: false, recencyRank: 3 },
  ]), 77n);
  assert.equal(forecastPortions([{ portions: 10n, soldOut: false, recencyRank: 0 }]), null);
});

test("menu engineering uses contribution and popularity as separate dimensions", () => {
  assert.equal(classifyMenuItem({ quantitySold: 100n, contributionMinor: 10_000n, popularityThreshold: 50n, contributionThresholdMinor: 5_000n }), "HIGH_PERFORMANCE");
  assert.equal(classifyMenuItem({ quantitySold: 100n, contributionMinor: 1_000n, popularityThreshold: 50n, contributionThresholdMinor: 5_000n }), "POPULAR_LOW_MARGIN");
  assert.equal(classifyMenuItem({ quantitySold: 10n, contributionMinor: 10_000n, popularityThreshold: 50n, contributionThresholdMinor: 5_000n }), "HIGH_MARGIN_LOW_DEMAND");
  assert.equal(classifyMenuItem({ quantitySold: 10n, contributionMinor: 1_000n, popularityThreshold: 50n, contributionThresholdMinor: 5_000n }), "LOW_PERFORMANCE");
});

test("popular aggregation is bounded and excludes cancelled and voided sales", () => {
  const now = new Date("2026-08-25T12:00:00.000Z");
  const result = aggregatePopularProducts([
    { productId: "soup", quantity: 3n, orderStatus: "COMPLETED", itemStatus: "SERVED", occurredAt: new Date("2026-08-24T12:00:00Z") },
    { productId: "soup", quantity: 99n, orderStatus: "CANCELLED", itemStatus: "SERVED", occurredAt: new Date("2026-08-24T12:00:00Z") },
    { productId: "kebab", quantity: 5n, orderStatus: "SERVED", itemStatus: "SERVED", occurredAt: new Date("2026-08-20T12:00:00Z") },
    { productId: "rice", quantity: 100n, orderStatus: "COMPLETED", itemStatus: "VOIDED", occurredAt: new Date("2026-08-20T12:00:00Z") },
    { productId: "old", quantity: 100n, orderStatus: "COMPLETED", itemStatus: "SERVED", occurredAt: new Date("2026-01-01T12:00:00Z") },
  ], now, 30);
  assert.deepEqual(result, [{ productId: "kebab", quantity: 5n }, { productId: "soup", quantity: 3n }]);
});

test("shift and reservation intervals use half-open overlap semantics", () => {
  const a = { startsAt: new Date("2026-08-25T09:00:00Z"), endsAt: new Date("2026-08-25T12:00:00Z") };
  assert.equal(rangesOverlap(a, { startsAt: new Date("2026-08-25T11:00:00Z"), endsAt: new Date("2026-08-25T13:00:00Z") }), true);
  assert.equal(rangesOverlap(a, { startsAt: new Date("2026-08-25T12:00:00Z"), endsAt: new Date("2026-08-25T14:00:00Z") }), false);
});

test("attendance derives duration from server timestamps", () => {
  assert.equal(workedMinutes(new Date("2026-08-25T09:00:00Z"), new Date("2026-08-25T18:00:00Z"), 60), 480);
  assert.equal(workedMinutes(new Date(), null), null);
});

test("payroll core calculates only supplied ledger inputs", () => {
  assert.equal(payrollNetPayable(100_000n, 5_000n, 10_000n), 95_000n);
  assert.throws(() => payrollNetPayable(100_000n, 0n, -1n));
});

test("loyalty is an append-only ledger, not a mutable balance", () => {
  assert.equal(loyaltyBalance([
    { type: "EARN", points: 100n },
    { type: "REDEEM", points: 30n },
    { type: "ADJUST", points: 5n },
    { type: "EXPIRE", points: 10n },
  ]), 65n);
});

test("guest dine-in remains table based while new channels do not claim a table", () => {
  assert.equal(requiresTable("DINE_IN"), true);
  assert.equal(requiresTable("TAKEAWAY"), false);
  assert.equal(requiresTable("DELIVERY"), false);
});

test("test terminal adapter is idempotent and explicitly non-production", async () => {
  const adapter = new TestPaymentTerminalAdapter();
  const input = { restaurantId: "r", requestedByStaffId: "s", idempotencyKey: "terminal-1", amountMinor: 100n, currency: "TRY" };
  const first = await adapter.initiate(input);
  const replay = await adapter.initiate(input);
  assert.equal(adapter.provider, "TEST_ONLY");
  assert.deepEqual(replay, first);
  assert.equal((await adapter.reconcile({ restaurantId: "r", businessDate: "2026-08-25" })).matched, 1);
});
