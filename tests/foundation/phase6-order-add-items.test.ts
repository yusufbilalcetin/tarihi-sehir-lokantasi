import assert from "node:assert/strict";
import test from "node:test";

import { DomainError } from "../../lib/api/domain-error";
import {
  line,
  order,
  principal,
  product,
  service,
  state,
} from "./phase6-order-fixtures";

const command = {
  orderId: "order-1",
  items: [{ productId: "product-tea", quantity: 2 }],
  idempotencyKey: "add-items-key-1",
};

test("a later round is priced from the database, never from the request", async () => {
  const fixture = state();
  const result = await service(fixture).addItems(principal("WAITER"), {
    ...command,
    items: [{ productId: "product-tea", quantity: 2, price: "0.01" }],
  } as unknown as typeof command);

  assert.equal(fixture.insertedItems.length, 1);
  assert.equal(fixture.insertedItems[0]?.unitPrice, "40.00");
  assert.equal(fixture.insertedItems[0]?.lineTotal, "80.00");
  assert.equal(result.addedItems[0]?.unitPrice, "40.00");
});

test("the added line snapshots today's price while older lines keep theirs", async () => {
  // The order was sold at 250.00; the same product now costs 280.00.
  const fixture = state({
    order: order({ items: [line({ unitPrice: "250.00", quantity: 2 })] }),
    products: [product({ id: "product-soup", name: "Mercimek Corbasi", price: "280.00" })],
  });
  await service(fixture).addItems(principal("WAITER"), {
    ...command,
    items: [{ productId: "product-soup", quantity: 1 }],
  });

  assert.equal(fixture.insertedItems[0]?.unitPrice, "280.00");
  // 500.00 (old, untouched) + 280.00 (new) = 780.00
  assert.equal(fixture.amountUpdates[0]?.subtotal, "780.00");
});

test("totals are rebuilt at the rates the order was opened with", async () => {
  const fixture = state();
  const result = await service(fixture).addItems(principal("WAITER"), command);

  // 500.00 existing + 80.00 added = 580.00, service fee 10% = 58.00
  assert.equal(result.amounts.subtotal, "580.00");
  assert.equal(result.amounts.serviceCharge, "58.00");
  assert.equal(result.amounts.total, "638.00");
  assert.equal(fixture.amountUpdates[0]?.total, "638.00");
  // Version-guarded against the value read under the lock.
  assert.equal(fixture.amountUpdates[0]?.currentVersion, 3);
});

test("a cancelled line stays out of the recalculated subtotal", async () => {
  const fixture = state({
    order: order({
      items: [
        line({ id: "item-1", unitPrice: "250.00", quantity: 2 }),
        line({ id: "item-2", unitPrice: "100.00", quantity: 1, status: "CANCELLED" }),
      ],
    }),
  });
  const result = await service(fixture).addItems(principal("WAITER"), command);
  assert.equal(result.amounts.subtotal, "580.00");
});

test("new lines are appended after the existing ones", async () => {
  const fixture = state({
    order: order({ items: [line({ id: "item-1", sortOrder: 0 }), line({ id: "item-2", sortOrder: 1 })] }),
  });
  await service(fixture).addItems(principal("WAITER"), {
    ...command,
    items: [
      { productId: "product-tea", quantity: 1 },
      { productId: "product-tea", quantity: 2, note: "az şekerli" },
    ],
  });
  assert.deepEqual(
    fixture.insertedItems.map((item) => item.sortOrder),
    [2, 3],
  );
});

test("the order timeline, outbox and audit all record the addition", async () => {
  const fixture = state();
  await service(fixture).addItems(principal("WAITER"), { ...command, requestId: "req-9" });

  assert.equal(fixture.events[0]?.eventType, "ORDER_ITEMS_ADDED");
  assert.equal(fixture.events[0]?.userId, "user-waiter");
  assert.equal(fixture.outbox[0]?.eventType, "ORDER_ITEMS_ADDED");
  assert.equal(fixture.outbox[0]?.aggregateType, "ORDER");
  assert.equal(fixture.audits[0]?.action, "staff.order.items_added");
  assert.equal(fixture.audits[0]?.requestId, "req-9");
  assert.deepEqual(fixture.audits[0]?.oldValue, { subtotal: "500.00", total: "550.00" });
});

test("replaying the same key returns the first result without inserting again", async () => {
  const fixture = state();
  const staff = service(fixture);
  const first = await staff.addItems(principal("WAITER"), command);
  const second = await staff.addItems(principal("WAITER"), command);

  assert.equal(first.replayed, false);
  assert.equal(second.replayed, true);
  assert.equal(second.amounts.total, first.amounts.total);
  assert.deepEqual(
    second.addedItems.map((item) => item.productId),
    first.addedItems.map((item) => item.productId),
  );
  assert.equal(fixture.insertedItems.length, 1);
  assert.equal(fixture.amountUpdates.length, 1);
});

test("the same key with a different cart is a conflict", async () => {
  const fixture = state();
  const staff = service(fixture);
  await staff.addItems(principal("WAITER"), command);

  await assert.rejects(
    () =>
      staff.addItems(principal("WAITER"), {
        ...command,
        items: [{ productId: "product-tea", quantity: 5 }],
      }),
    (error: unknown) => error instanceof DomainError && error.code === "IDEMPOTENCY_CONFLICT",
  );
  assert.equal(fixture.insertedItems.length, 1);
});

test("a concurrent writer wins the version guard and this request is refused", async () => {
  const fixture = state({ amountUpdateFails: true });
  await assert.rejects(
    () => service(fixture).addItems(principal("WAITER"), command),
    (error: unknown) => error instanceof DomainError && error.code === "CONFLICT",
  );
  // The rollback leaves no half-applied round behind.
  assert.equal(fixture.insertedItems.length, 0);
  assert.equal(fixture.events.length, 0);
});

test("a sold-out product blocks the whole addition", async () => {
  const fixture = state({ products: [product({ isAvailable: false })] });
  await assert.rejects(
    () => service(fixture).addItems(principal("WAITER"), command),
    (error: unknown) => error instanceof DomainError && error.code === "PRODUCT_UNAVAILABLE",
  );
  assert.equal(fixture.insertedItems.length, 0);
});

test("a product from another restaurant is simply not found", async () => {
  const fixture = state({ products: [product({ restaurantId: "restaurant-2" })] });
  await assert.rejects(
    () => service(fixture).addItems(principal("WAITER"), command),
    (error: unknown) => error instanceof DomainError && error.code === "PRODUCT_NOT_FOUND",
  );
});

test("an order belonging to another restaurant is not found", async () => {
  const fixture = state();
  await assert.rejects(
    () =>
      service(fixture).addItems(
        { ...principal("WAITER"), restaurantId: "restaurant-2" },
        command,
      ),
    (error: unknown) => error instanceof DomainError && error.code === "ORDER_NOT_FOUND",
  );
});

test("a served, completed or cancelled order accepts no further items", async () => {
  for (const status of ["READY", "SERVED", "COMPLETED", "CANCELLED"] as const) {
    const fixture = state({ order: order({ status }) });
    await assert.rejects(
      () => service(fixture).addItems(principal("WAITER"), command),
      (error: unknown) => error instanceof DomainError && error.code === "ORDER_NOT_MUTABLE",
      `${status} must refuse new items`,
    );
    assert.equal(fixture.insertedItems.length, 0);
  }
});

test("a running order accepts items in every pre-ready stage", async () => {
  for (const status of ["NEW", "CONFIRMED", "PREPARING"] as const) {
    const fixture = state({ order: order({ status }) });
    const result = await service(fixture).addItems(principal("WAITER"), command);
    assert.equal(result.status, status);
    assert.equal(fixture.insertedItems.length, 1);
  }
});

test("kitchen and cashier roles cannot append to an order", async () => {
  for (const role of ["KITCHEN", "CASHIER"] as const) {
    const fixture = state();
    await assert.rejects(
      () => service(fixture).addItems(principal(role), command),
      (error: unknown) => error instanceof DomainError && error.code === "FORBIDDEN",
    );
    assert.equal(fixture.insertedItems.length, 0);
  }
});

test("an anonymous caller is refused before the transaction opens", async () => {
  const fixture = state();
  await assert.rejects(
    () => service(fixture).addItems(null, command),
    (error: unknown) =>
      error instanceof DomainError && error.code === "AUTHENTICATION_REQUIRED",
  );
  assert.equal(fixture.insertedItems.length, 0);
});
