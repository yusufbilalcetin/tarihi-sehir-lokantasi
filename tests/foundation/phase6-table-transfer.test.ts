import assert from "node:assert/strict";
import test from "node:test";

import { DomainError } from "../../lib/api/domain-error";
import { deriveTableStatus } from "../../lib/domain/table-operations";
import { call, openOrder, principal, service, state, table } from "./phase6-table-fixtures";

const command = { sourceTableId: "table-3", targetTableId: "table-8" };

test("a waiter moves the party and every open order lands on the target", async () => {
  const fixture = state();
  const result = await service(fixture).transfer(principal("WAITER"), command);

  assert.deepEqual(result.movedOrderIds, ["order-1"]);
  assert.deepEqual(fixture.movedOrders, [
    { orderIds: ["order-1"], targetTableId: "table-8" },
  ]);
  assert.equal(result.target.id, "table-8");
});

test("the target becomes occupied and the source is released", async () => {
  const fixture = state();
  await service(fixture).transfer(principal("WAITER"), command);

  assert.deepEqual(fixture.statusUpdates, [
    { tableId: "table-8", status: "OCCUPIED" },
    { tableId: "table-3", status: "AVAILABLE" },
  ]);
});

test("open requests travel with the party", async () => {
  const fixture = state({
    callsByTable: { "table-3": [call({ id: "call-1", type: "WAITER_CALL" })], "table-8": [] },
  });
  const result = await service(fixture).transfer(principal("WAITER"), command);

  assert.deepEqual(result.movedCallIds, ["call-1"]);
  assert.deepEqual(fixture.movedCalls, [{ callId: "call-1", targetTableId: "table-8" }]);
  // A moved waiter call repaints the target, not merely occupies it.
  assert.deepEqual(fixture.statusUpdates[0], { tableId: "table-8", status: "WAITER_CALL" });
});

test("an occupied target is refused and points at the merge operation", async () => {
  const fixture = state({
    ordersByTable: { "table-3": [openOrder()], "table-8": [openOrder({ id: "order-9" })] },
  });
  await assert.rejects(
    () => service(fixture).transfer(principal("WAITER"), command),
    (error: unknown) =>
      error instanceof DomainError &&
      error.code === "TABLE_TARGET_OCCUPIED" &&
      error.message.includes("birleştirme"),
  );
  assert.equal(fixture.movedOrders.length, 0);
});

test("a target holding only an open request is also refused", async () => {
  const fixture = state({
    callsByTable: { "table-3": [], "table-8": [call({ id: "call-target" })] },
  });
  await assert.rejects(
    () => service(fixture).transfer(principal("WAITER"), command),
    (error: unknown) => error instanceof DomainError && error.code === "TABLE_TARGET_OCCUPIED",
  );
});

test("moving a table with nothing on it is refused", async () => {
  const fixture = state({ ordersByTable: { "table-3": [], "table-8": [] } });
  await assert.rejects(
    () => service(fixture).transfer(principal("WAITER"), command),
    (error: unknown) =>
      error instanceof DomainError && error.code === "TABLE_TRANSFER_CONFLICT",
  );
});

test("an out-of-service target cannot receive a party", async () => {
  const fixture = state({
    tables: [table({ id: "table-3" }), table({ id: "table-8", isActive: false })],
  });
  await assert.rejects(
    () => service(fixture).transfer(principal("WAITER"), command),
    (error: unknown) => error instanceof DomainError && error.code === "TABLE_INACTIVE",
  );
  assert.equal(fixture.movedOrders.length, 0);
});

test("a table of another restaurant is never visible to this tenant", async () => {
  const fixture = state();
  await assert.rejects(
    () =>
      service(fixture).transfer(principal("WAITER"), {
        ...command,
        targetTableId: "table-of-restaurant-2",
      }),
    (error: unknown) => error instanceof DomainError && error.code === "TABLE_NOT_FOUND",
  );
  assert.equal(fixture.movedOrders.length, 0);
});

test("moving a table onto itself is rejected before any lock is taken", async () => {
  const fixture = state();
  await assert.rejects(
    () =>
      service(fixture).transfer(principal("WAITER"), {
        sourceTableId: "table-3",
        targetTableId: "table-3",
      }),
    (error: unknown) => error instanceof DomainError && error.code === "VALIDATION_ERROR",
  );
  assert.equal(fixture.statusUpdates.length, 0);
});

test("a concurrent change under the lock aborts instead of moving a subset", async () => {
  const fixture = state({
    ordersByTable: {
      "table-3": [openOrder({ id: "order-1" }), openOrder({ id: "order-2" })],
      "table-8": [],
    },
    moveOrdersReturnsFewer: true,
  });
  await assert.rejects(
    () => service(fixture).transfer(principal("WAITER"), command),
    (error: unknown) =>
      error instanceof DomainError && error.code === "TABLE_TRANSFER_CONFLICT",
  );
  // Rollback: no status change and no event escaped the failed transaction.
  assert.equal(fixture.statusUpdates.length, 0);
  assert.equal(fixture.outbox.length, 0);
});

test("kitchen and cashier roles cannot move a table", async () => {
  for (const role of ["KITCHEN", "CASHIER"] as const) {
    const fixture = state();
    await assert.rejects(
      () => service(fixture).transfer(principal(role), command),
      (error: unknown) => error instanceof DomainError && error.code === "FORBIDDEN",
    );
    assert.equal(fixture.movedOrders.length, 0);
  }
});

test("the transfer writes one outbox event and one audit record", async () => {
  const fixture = state();
  await service(fixture).transfer(principal("WAITER"), { ...command, requestId: "req-4" });

  assert.equal(fixture.outbox.length, 1);
  assert.equal(fixture.outbox[0]?.eventType, "TABLE_TRANSFERRED");
  assert.equal(fixture.outbox[0]?.aggregateType, "TABLE");
  assert.equal(fixture.outbox[0]?.payload.movedOrderCount, 1);
  assert.equal(fixture.audits[0]?.action, "table.transferred");
  assert.equal(fixture.audits[0]?.actorUserId, "user-waiter");
  assert.equal(fixture.audits[0]?.requestId, "req-4");
});

test("table status is derived from real sources, never set by a client", () => {
  assert.equal(
    deriveTableStatus({ isActive: true, openOrderCount: 0, activeCallTypes: [] }),
    "AVAILABLE",
  );
  assert.equal(
    deriveTableStatus({ isActive: true, openOrderCount: 2, activeCallTypes: [] }),
    "OCCUPIED",
  );
  assert.equal(
    deriveTableStatus({ isActive: true, openOrderCount: 1, activeCallTypes: ["WAITER_CALL"] }),
    "WAITER_CALL",
  );
  // A bill request outranks a waiter call.
  assert.equal(
    deriveTableStatus({
      isActive: true,
      openOrderCount: 1,
      activeCallTypes: ["WAITER_CALL", "BILL_REQUEST"],
    }),
    "BILL_REQUESTED",
  );
  assert.equal(
    deriveTableStatus({ isActive: false, openOrderCount: 5, activeCallTypes: [] }),
    "INACTIVE",
  );
  // A table note is not a service call and does not repaint the table.
  assert.equal(
    deriveTableStatus({ isActive: true, openOrderCount: 0, activeCallTypes: ["OTHER"] }),
    "AVAILABLE",
  );
});
