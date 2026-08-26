import assert from "node:assert/strict";
import test from "node:test";

import {
  createOrderInputSchema,
  createProductInputSchema,
  createWaiterCallInputSchema,
  moneyDecimalSchema,
  tableTokenSchema,
  updateProductInputSchema,
  validateSchema,
} from "../../lib/validation";

const tableToken = "A".repeat(43);

function validOrder() {
  return {
    idempotencyKey: "order-click-123",
    items: [{ productId: "product-1", quantity: 2, note: "Soğansız" }],
  };
}

test("table token validation rejects short sequential identifiers", () => {
  assert.equal(tableTokenSchema.safeParse(tableToken).success, true);
  assert.equal(tableTokenSchema.safeParse("12").success, false);
  assert.equal(tableTokenSchema.safeParse("table-12").success, false);
});

test("order validation accepts session-scoped items but rejects client prices and raw tokens", () => {
  assert.equal(createOrderInputSchema.safeParse(validOrder()).success, true);
  assert.equal(
    createOrderInputSchema.safeParse({
      ...validOrder(),
      items: [{ productId: "product-1", quantity: 2, price: "0.01" }],
    }).success,
    false,
  );
  assert.equal(
    createOrderInputSchema.safeParse({
      ...validOrder(),
      tableToken,
    }).success,
    false,
  );
  assert.equal(
    createOrderInputSchema.safeParse({
      ...validOrder(),
      items: [{ productId: "product-1", quantity: 0 }],
    }).success,
    false,
  );
});

test("duplicate order lines with the same note are rejected", () => {
  const result = createOrderInputSchema.safeParse({
    ...validOrder(),
    items: [
      { productId: "product-1", quantity: 1, note: "Soğansız" },
      { productId: "product-1", quantity: 2, note: "Soğansız" },
    ],
  });

  assert.equal(result.success, false);
});

test("waiter calls use canonical types and bounded notes", () => {
  assert.equal(
    createWaiterCallInputSchema.safeParse({ type: "BILL_REQUEST" }).success,
    true,
  );
  assert.equal(
    createWaiterCallInputSchema.safeParse({ type: "Hesap istiyor" }).success,
    false,
  );
  assert.equal(
    createWaiterCallInputSchema.safeParse({
      type: "OTHER",
      notes: "x".repeat(501),
    }).success,
    false,
  );
  assert.equal(
    createWaiterCallInputSchema.safeParse({ tableToken, type: "WAITER_CALL" }).success,
    false,
  );
});

test("admin prices are exact decimal strings, never binary floats", () => {
  assert.equal(moneyDecimalSchema.safeParse("280.50").success, true);
  assert.equal(moneyDecimalSchema.safeParse("280.555").success, false);
  assert.equal(moneyDecimalSchema.safeParse(280.5).success, false);

  const productResult = createProductInputSchema.safeParse({
    categoryId: "category-1",
    name: "Mercimek Çorbası",
    slug: "mercimek-corbasi",
    price: "120.00",
  });
  assert.equal(productResult.success, true);

  const updateResult = updateProductInputSchema.safeParse({ productId: "product-1" });
  assert.equal(updateResult.success, true);
  if (updateResult.success) assert.deepEqual(updateResult.data, { productId: "product-1" });
});

test("validation helper returns API-friendly issue paths", () => {
  const result = validateSchema(createOrderInputSchema, {
    ...validOrder(),
    items: [{ productId: "product-1", quantity: 0 }],
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.equal(result.issues.some((issue) => issue.path === "items.0.quantity"), true);
  }
});
