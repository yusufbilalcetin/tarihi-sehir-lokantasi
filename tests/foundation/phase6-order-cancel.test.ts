import assert from "node:assert/strict";
import test from "node:test";

import { DomainError } from "../../lib/api/domain-error";
import { order, principal, service, state } from "./phase6-order-fixtures";

const command = { orderId: "order-1", reason: "Müşteri vazgeçti" };

test("a manager cancels a running order and the row is kept", async () => {
  const fixture = state();
  const result = await service(fixture).cancelOrder(principal("MANAGER"), command);

  assert.equal(result.status, "CANCELLED");
  assert.equal(result.previousStatus, "CONFIRMED");
  assert.equal(result.version, 4);
  assert.equal(fixture.statusUpdates.length, 1);
  assert.equal(fixture.statusUpdates[0]?.nextStatus, "CANCELLED");
  // Version-guarded against the row read under the lock.
  assert.equal(fixture.statusUpdates[0]?.currentVersion, 3);
});

test("cancellation writes the order event, outbox event and audit reason", async () => {
  const fixture = state();
  await service(fixture).cancelOrder(principal("MANAGER"), {
    ...command,
    reason: "Diğer",
    reasonNote: "çift kayıt",
    requestId: "req-7",
  });

  assert.equal(fixture.events[0]?.eventType, "ORDER_CANCELLED");
  assert.equal(fixture.events[0]?.userId, "user-manager");
  assert.equal(fixture.outbox[0]?.eventType, "ORDER_CANCELLED");
  assert.equal(fixture.audits[0]?.action, "order.cancelled");
  assert.equal(fixture.audits[0]?.metadata?.reason, "Diğer");
  assert.equal(fixture.audits[0]?.metadata?.reasonNote, "çift kayıt");
  assert.equal(fixture.audits[0]?.requestId, "req-7");
});

test("every pre-served stage can be cancelled", async () => {
  for (const status of ["NEW", "CONFIRMED", "PREPARING", "READY"] as const) {
    const fixture = state({ order: order({ status }) });
    const result = await service(fixture).cancelOrder(principal("ADMIN"), command);
    assert.equal(result.previousStatus, status);
  }
});

test("a served order is not cancellable through this path", async () => {
  const fixture = state({ order: order({ status: "SERVED" }) });
  await assert.rejects(
    () => service(fixture).cancelOrder(principal("ADMIN"), command),
    (error: unknown) =>
      error instanceof DomainError && error.code === "INVALID_STATUS_TRANSITION",
  );
  assert.equal(fixture.statusUpdates.length, 0);
});

test("a completed or paid order is refused; that needs a refund", async () => {
  const completed = state({ order: order({ status: "COMPLETED" }) });
  await assert.rejects(
    () => service(completed).cancelOrder(principal("ADMIN"), command),
    (error: unknown) =>
      error instanceof DomainError && error.code === "ORDER_ALREADY_COMPLETED",
  );

  const paid = state({ order: order({ status: "READY", hasSettledPayment: true }) });
  await assert.rejects(
    () => service(paid).cancelOrder(principal("ADMIN"), command),
    (error: unknown) =>
      error instanceof DomainError && error.code === "ORDER_ALREADY_COMPLETED",
  );
  assert.equal(paid.statusUpdates.length, 0);
});

test("an order with a payment in flight must settle that payment first", async () => {
  const fixture = state({ order: order({ hasPendingPayment: true }) });
  await assert.rejects(
    () => service(fixture).cancelOrder(principal("ADMIN"), command),
    (error: unknown) => error instanceof DomainError && error.code === "CONFLICT",
  );
  assert.equal(fixture.statusUpdates.length, 0);
});

test("an already cancelled order cannot be cancelled again", async () => {
  const fixture = state({ order: order({ status: "CANCELLED" }) });
  await assert.rejects(
    () => service(fixture).cancelOrder(principal("ADMIN"), command),
    (error: unknown) =>
      error instanceof DomainError && error.code === "INVALID_STATUS_TRANSITION",
  );
});

test("waiters, kitchen and cashiers cannot cancel a whole order", async () => {
  for (const role of ["WAITER", "KITCHEN", "CASHIER"] as const) {
    const fixture = state();
    await assert.rejects(
      () => service(fixture).cancelOrder(principal(role), command),
      (error: unknown) => error instanceof DomainError && error.code === "FORBIDDEN",
    );
    assert.equal(fixture.statusUpdates.length, 0);
  }
});

test("an order from another restaurant is not found", async () => {
  const fixture = state();
  await assert.rejects(
    () =>
      service(fixture).cancelOrder(
        { ...principal("MANAGER"), restaurantId: "restaurant-2" },
        command,
      ),
    (error: unknown) => error instanceof DomainError && error.code === "ORDER_NOT_FOUND",
  );
});

test("an anonymous caller is refused", async () => {
  const fixture = state();
  await assert.rejects(
    () => service(fixture).cancelOrder(null, command),
    (error: unknown) =>
      error instanceof DomainError && error.code === "AUTHENTICATION_REQUIRED",
  );
});
