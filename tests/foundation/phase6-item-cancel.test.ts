import assert from "node:assert/strict";
import test from "node:test";

import { DomainError } from "../../lib/api/domain-error";
import {
  canRoleCancelOrderItem,
  itemCancellationNeedsConfirmation,
  rolesAllowedToCancelItem,
} from "../../lib/domain/order-mutations";
import { line, order, principal, service, state } from "./phase6-order-fixtures";

const command = {
  orderId: "order-1",
  orderItemId: "item-1",
  reason: "Müşteri vazgeçti",
};

test("a waiter cancels a pending line and the row is kept, not deleted", async () => {
  const fixture = state();
  const result = await service(fixture).cancelItem(principal("WAITER"), command);

  assert.equal(result.status, "CANCELLED");
  assert.equal(result.previousStatus, "PENDING");
  assert.equal(fixture.cancelledItems.length, 1);
  assert.equal(fixture.cancelledItems[0]?.orderItemId, "item-1");
  // Soft cancellation: the repository is only ever asked to flip the status.
  assert.equal(fixture.cancelledItems[0]?.currentStatus, "PENDING");
});

test("the cancelled line leaves the order total", async () => {
  const fixture = state({
    order: order({
      items: [
        line({ id: "item-1", unitPrice: "250.00", quantity: 2 }),
        line({ id: "item-2", unitPrice: "100.00", quantity: 1 }),
      ],
      subtotal: "600.00",
      total: "660.00",
    }),
  });
  const result = await service(fixture).cancelItem(principal("WAITER"), command);

  // Only item-2 survives: 100.00 + 10% service fee.
  assert.equal(result.amounts.subtotal, "100.00");
  assert.equal(result.amounts.serviceCharge, "10.00");
  assert.equal(result.amounts.total, "110.00");
  assert.equal(fixture.amountUpdates[0]?.total, "110.00");
});

test("cancelling the last live line drops the order to zero, not below", async () => {
  const fixture = state();
  const result = await service(fixture).cancelItem(principal("WAITER"), command);
  assert.equal(result.amounts.subtotal, "0.00");
  assert.equal(result.amounts.total, "0.00");
});

test("a line the kitchen is cooking needs a manager", async () => {
  for (const status of ["PREPARING", "READY"] as const) {
    const waiterFixture = state({ order: order({ items: [line({ status })] }) });
    await assert.rejects(
      () => service(waiterFixture).cancelItem(principal("WAITER"), command),
      (error: unknown) => error instanceof DomainError && error.code === "FORBIDDEN",
      `a waiter must not cancel a ${status} line`,
    );
    assert.equal(waiterFixture.cancelledItems.length, 0);

    const managerFixture = state({ order: order({ items: [line({ status })] }) });
    const result = await service(managerFixture).cancelItem(principal("MANAGER"), command);
    assert.equal(result.previousStatus, status);
  }
});

test("a served line is not cancellable at all; it needs a void", async () => {
  const fixture = state({ order: order({ items: [line({ status: "SERVED" })] }) });
  for (const role of ["WAITER", "MANAGER", "ADMIN"] as const) {
    await assert.rejects(
      () => service(fixture).cancelItem(principal(role), command),
      (error: unknown) =>
        error instanceof DomainError && error.code === "ITEM_CANNOT_BE_CANCELLED",
    );
  }
  assert.equal(fixture.cancelledItems.length, 0);
});

test("an already cancelled line cannot be cancelled twice", async () => {
  const fixture = state({ order: order({ items: [line({ status: "CANCELLED" })] }) });
  await assert.rejects(
    () => service(fixture).cancelItem(principal("MANAGER"), command),
    (error: unknown) =>
      error instanceof DomainError && error.code === "ORDER_ITEM_ALREADY_CANCELLED",
  );
});

test("a settled order refuses item cancellation so the receipt cannot change", async () => {
  const completed = state({ order: order({ status: "COMPLETED" }) });
  await assert.rejects(
    () => service(completed).cancelItem(principal("ADMIN"), command),
    (error: unknown) =>
      error instanceof DomainError && error.code === "ORDER_ALREADY_COMPLETED",
  );

  // A paid order is refused even while its status still reads SERVED.
  const paid = state({ order: order({ status: "SERVED", hasSettledPayment: true }) });
  await assert.rejects(
    () => service(paid).cancelItem(principal("ADMIN"), command),
    (error: unknown) =>
      error instanceof DomainError && error.code === "ORDER_ALREADY_COMPLETED",
  );
  assert.equal(paid.cancelledItems.length, 0);
});

test("an unknown line id is not found", async () => {
  const fixture = state();
  await assert.rejects(
    () =>
      service(fixture).cancelItem(principal("WAITER"), { ...command, orderItemId: "item-x" }),
    (error: unknown) => error instanceof DomainError && error.code === "ORDER_ITEM_NOT_FOUND",
  );
});

test("an order from another restaurant is not found", async () => {
  const fixture = state();
  await assert.rejects(
    () =>
      service(fixture).cancelItem(
        { ...principal("MANAGER"), restaurantId: "restaurant-2" },
        command,
      ),
    (error: unknown) => error instanceof DomainError && error.code === "ORDER_NOT_FOUND",
  );
});

test("a losing race on the line status is a conflict, not a silent no-op", async () => {
  const fixture = state({ itemCancelFails: true });
  await assert.rejects(
    () => service(fixture).cancelItem(principal("WAITER"), command),
    (error: unknown) => error instanceof DomainError && error.code === "CONFLICT",
  );
  assert.equal(fixture.amountUpdates.length, 0);
});

test("the reason is validated and reaches the audit record", async () => {
  const fixture = state();
  await service(fixture).cancelItem(principal("WAITER"), {
    ...command,
    reason: "Ürün tükendi",
    reasonNote: "  mutfak bildirdi  ",
    requestId: "req-3",
  });

  assert.equal(fixture.audits[0]?.action, "order.item.cancelled");
  assert.equal(fixture.audits[0]?.metadata?.reason, "Ürün tükendi");
  assert.equal(fixture.audits[0]?.metadata?.reasonNote, "mutfak bildirdi");
  assert.equal(fixture.audits[0]?.metadata?.totalBefore, "550.00");
  assert.equal(fixture.audits[0]?.metadata?.totalAfter, "0.00");
  assert.equal(fixture.audits[0]?.requestId, "req-3");
  assert.equal(fixture.events[0]?.eventType, "ORDER_ITEM_CANCELLED");
  assert.equal(fixture.outbox[0]?.eventType, "ORDER_ITEM_CANCELLED");
  assert.equal(fixture.outbox[0]?.aggregateType, "ORDER_ITEM");
});

test("an unknown reason and an unexplained \"Diğer\" are both rejected", async () => {
  const unknown = state();
  await assert.rejects(
    () => service(unknown).cancelItem(principal("WAITER"), { ...command, reason: "Canım istedi" }),
    (error: unknown) => error instanceof DomainError && error.code === "VALIDATION_ERROR",
  );

  const other = state();
  await assert.rejects(
    () => service(other).cancelItem(principal("WAITER"), { ...command, reason: "Diğer" }),
    (error: unknown) => error instanceof DomainError && error.code === "VALIDATION_ERROR",
  );
  assert.equal(other.cancelledItems.length, 0);

  const explained = state();
  await service(explained).cancelItem(principal("WAITER"), {
    ...command,
    reason: "Diğer",
    reasonNote: "masa değişti",
  });
  assert.equal(explained.cancelledItems.length, 1);
});

test("an over-long explanation is rejected before anything is written", async () => {
  const fixture = state();
  await assert.rejects(
    () =>
      service(fixture).cancelItem(principal("WAITER"), {
        ...command,
        reasonNote: "x".repeat(301),
      }),
    (error: unknown) => error instanceof DomainError && error.code === "VALIDATION_ERROR",
  );
  assert.equal(fixture.cancelledItems.length, 0);
});

test("the cancellation policy is one shared table the panel can read", () => {
  assert.deepEqual(rolesAllowedToCancelItem("PENDING"), ["ADMIN", "MANAGER", "WAITER"]);
  assert.deepEqual(rolesAllowedToCancelItem("PREPARING"), ["ADMIN", "MANAGER"]);
  assert.deepEqual(rolesAllowedToCancelItem("SERVED"), []);
  assert.equal(canRoleCancelOrderItem("WAITER", "PENDING"), true);
  assert.equal(canRoleCancelOrderItem("WAITER", "READY"), false);
  assert.equal(canRoleCancelOrderItem("KITCHEN", "PENDING"), false);
  assert.equal(itemCancellationNeedsConfirmation("PENDING"), false);
  assert.equal(itemCancellationNeedsConfirmation("READY"), true);
});
