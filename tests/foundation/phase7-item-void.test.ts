import assert from "node:assert/strict";
import test from "node:test";

import { DomainError } from "../../lib/api/domain-error";
import {
  canRoleVoidItem,
  isItemBillable,
  isItemVoidable,
} from "../../lib/domain/financial-operations";
import { line, order, principal, service, state } from "./phase6-order-fixtures";

const command = {
  orderId: "order-1",
  orderItemId: "item-1",
  reasonCode: "CUSTOMER_COMPLAINT",
};

function servedOrderState(overrides = {}) {
  return state({
    order: order({
      status: "SERVED",
      items: [line({ id: "item-1", status: "SERVED", unitPrice: "250.00", quantity: 2 })],
      ...overrides,
    }),
  });
}

test("a manager voids a served line and the row is kept, not deleted", async () => {
  const fixture = servedOrderState();
  const result = await service(fixture).voidItem(principal("MANAGER"), command);

  assert.equal(result.status, "VOIDED");
  assert.equal(result.previousStatus, "SERVED");
  assert.equal(fixture.voidedItems.length, 1);
  assert.equal(fixture.voidedItems[0]?.orderItemId, "item-1");
  assert.equal(fixture.voidedItems[0]?.currentStatus, "SERVED");
  // Who did it and why travel with the row, not only with the audit log.
  assert.equal(fixture.voidedItems[0]?.voidedBy, "user-manager");
  assert.equal(fixture.voidedItems[0]?.reasonCode, "CUSTOMER_COMPLAINT");
});

test("the voided line leaves the payable total", async () => {
  const fixture = state({
    order: order({
      status: "SERVED",
      items: [
        line({ id: "item-1", status: "SERVED", unitPrice: "250.00", quantity: 2 }),
        line({ id: "item-2", status: "SERVED", unitPrice: "100.00", quantity: 1 }),
      ],
      subtotal: "600.00",
      total: "660.00",
    }),
  });
  const result = await service(fixture).voidItem(principal("MANAGER"), command);

  // Only item-2 remains billable: 100.00 plus the order's own 10% service fee.
  assert.equal(result.amounts.subtotal, "100.00");
  assert.equal(result.amounts.total, "110.00");
  assert.equal(fixture.amountUpdates[0]?.total, "110.00");
  assert.equal(fixture.amountUpdates[0]?.currentVersion, 3);
});

test("only a served line can be voided; earlier stages are cancelled instead", async () => {
  for (const status of ["PENDING", "PREPARING", "READY"] as const) {
    const fixture = state({ order: order({ items: [line({ status })] }) });
    await assert.rejects(
      () => service(fixture).voidItem(principal("MANAGER"), command),
      (error: unknown) =>
        error instanceof DomainError && error.code === "ITEM_CANNOT_BE_VOIDED",
      `${status} must not be voidable`,
    );
    assert.equal(fixture.voidedItems.length, 0);
  }
});

test("an already voided line cannot be voided twice", async () => {
  const fixture = state({
    order: order({ status: "SERVED", items: [line({ status: "VOIDED" })] }),
  });
  await assert.rejects(
    () => service(fixture).voidItem(principal("MANAGER"), command),
    (error: unknown) =>
      error instanceof DomainError && error.code === "ORDER_ITEM_ALREADY_VOIDED",
  );
});

test("a paid order cannot be voided; it points at the refund flow", async () => {
  const paid = state({
    order: order({
      status: "SERVED",
      hasSettledPayment: true,
      items: [line({ status: "SERVED" })],
    }),
  });
  await assert.rejects(
    () => service(paid).voidItem(principal("MANAGER"), command),
    (error: unknown) =>
      error instanceof DomainError &&
      error.code === "PAYMENT_ALREADY_COMPLETED" &&
      error.message.includes("İade"),
  );
  assert.equal(paid.voidedItems.length, 0);

  const completed = state({
    order: order({ status: "COMPLETED", items: [line({ status: "SERVED" })] }),
  });
  await assert.rejects(
    () => service(completed).voidItem(principal("ADMIN"), command),
    (error: unknown) =>
      error instanceof DomainError && error.code === "PAYMENT_ALREADY_COMPLETED",
  );
});

test("waiters, cashiers and kitchen cannot void", async () => {
  for (const role of ["WAITER", "CASHIER", "KITCHEN"] as const) {
    const fixture = servedOrderState();
    await assert.rejects(
      () => service(fixture).voidItem(principal(role), command),
      (error: unknown) => error instanceof DomainError && error.code === "FORBIDDEN",
    );
    assert.equal(fixture.voidedItems.length, 0);
  }
});

test("an order from another restaurant is not found", async () => {
  const fixture = servedOrderState();
  await assert.rejects(
    () =>
      service(fixture).voidItem(
        { ...principal("MANAGER"), restaurantId: "restaurant-2" },
        command,
      ),
    (error: unknown) => error instanceof DomainError && error.code === "ORDER_NOT_FOUND",
  );
});

test("an unknown line id is not found", async () => {
  const fixture = servedOrderState();
  await assert.rejects(
    () => service(fixture).voidItem(principal("MANAGER"), { ...command, orderItemId: "nope" }),
    (error: unknown) => error instanceof DomainError && error.code === "ORDER_ITEM_NOT_FOUND",
  );
});

test("a losing race on the line status is a conflict, not a silent no-op", async () => {
  const fixture = servedOrderState();
  fixture.itemCancelFails = true;
  await assert.rejects(
    () => service(fixture).voidItem(principal("MANAGER"), command),
    (error: unknown) => error instanceof DomainError && error.code === "CONFLICT",
  );
  assert.equal(fixture.amountUpdates.length, 0);
});

test("the reason is validated and an unexplained OTHER is refused", async () => {
  const unknown = servedOrderState();
  await assert.rejects(
    () => service(unknown).voidItem(principal("MANAGER"), { ...command, reasonCode: "BECAUSE" }),
    (error: unknown) => error instanceof DomainError && error.code === "VALIDATION_ERROR",
  );

  const other = servedOrderState();
  await assert.rejects(
    () => service(other).voidItem(principal("MANAGER"), { ...command, reasonCode: "OTHER" }),
    (error: unknown) => error instanceof DomainError && error.code === "VALIDATION_ERROR",
  );
  assert.equal(other.voidedItems.length, 0);

  const explained = servedOrderState();
  await service(explained).voidItem(principal("MANAGER"), {
    ...command,
    reasonCode: "OTHER",
    note: "ikram edildi",
  });
  assert.equal(explained.voidedItems.length, 1);
});

test("the void writes its own event, outbox entry and audit record", async () => {
  const fixture = servedOrderState();
  await service(fixture).voidItem(principal("MANAGER"), {
    ...command,
    reasonCode: "MANAGER_COMP",
    note: "  ikram  ",
    requestId: "req-12",
  });

  assert.equal(fixture.events[0]?.eventType, "ORDER_ITEM_VOIDED");
  assert.equal(fixture.events[0]?.userId, "user-manager");
  assert.equal(fixture.outbox[0]?.eventType, "ORDER_ITEM_VOIDED");
  assert.equal(fixture.audits[0]?.action, "order.item.voided");
  assert.equal(fixture.audits[0]?.metadata?.reasonCode, "MANAGER_COMP");
  assert.equal(fixture.audits[0]?.metadata?.note, "ikram");
  assert.equal(fixture.audits[0]?.metadata?.amount, "500.00");
  assert.equal(fixture.audits[0]?.metadata?.totalBefore, "550.00");
  assert.equal(fixture.audits[0]?.metadata?.totalAfter, "0.00");
  assert.equal(fixture.audits[0]?.requestId, "req-12");
});

test("the billable policy is one shared helper for cancelled and voided lines", () => {
  assert.equal(isItemBillable("SERVED"), true);
  assert.equal(isItemBillable("PENDING"), true);
  assert.equal(isItemBillable("CANCELLED"), false);
  assert.equal(isItemBillable("VOIDED"), false);
  assert.equal(isItemVoidable("SERVED"), true);
  assert.equal(isItemVoidable("READY"), false);
  assert.equal(canRoleVoidItem("MANAGER"), true);
  assert.equal(canRoleVoidItem("WAITER"), false);
});
