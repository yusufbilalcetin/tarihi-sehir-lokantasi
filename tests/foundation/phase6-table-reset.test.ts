import assert from "node:assert/strict";
import test from "node:test";

import { DomainError } from "../../lib/api/domain-error";
import { tableResetBlockReason } from "../../lib/domain/table-operations";
import { call, openOrder, principal, service, state, table } from "./phase6-table-fixtures";

const command = { tableId: "table-3" };

/** A settled table: nothing open, nothing unpaid, no request waiting. */
function settledTable() {
  return state({
    tables: [table({ id: "table-3", currentStatus: "CLEANING" })],
    ordersByTable: { "table-3": [] },
    callsByTable: { "table-3": [] },
  });
}

test("a settled table is cleared back to available", async () => {
  const fixture = settledTable();
  const result = await service(fixture).reset(principal("MANAGER"), command);

  assert.equal(result.table.status, "AVAILABLE");
  assert.deepEqual(fixture.statusUpdates, [{ tableId: "table-3", status: "AVAILABLE" }]);
});

test("an open order blocks the reset", async () => {
  const fixture = settledTable();
  fixture.ordersByTable["table-3"] = [openOrder({ status: "PREPARING" })];

  await assert.rejects(
    () => service(fixture).reset(principal("MANAGER"), command),
    (error: unknown) =>
      error instanceof DomainError &&
      error.code === "TABLE_RESET_BLOCKED" &&
      error.message.includes("açık sipariş"),
  );
  assert.equal(fixture.statusUpdates.length, 0);
});

test("a served but unpaid order blocks the reset", async () => {
  const fixture = settledTable();
  fixture.ordersByTable["table-3"] = [openOrder({ status: "SERVED", total: "550.00" })];

  await assert.rejects(
    () => service(fixture).reset(principal("MANAGER"), command),
    (error: unknown) =>
      error instanceof DomainError && error.code === "TABLE_RESET_BLOCKED",
  );
  assert.equal(fixture.statusUpdates.length, 0);
});

test("a payment still in flight blocks the reset", async () => {
  const fixture = settledTable();
  fixture.pendingPaymentsByTable["table-3"] = 1;

  await assert.rejects(
    () => service(fixture).reset(principal("MANAGER"), command),
    (error: unknown) =>
      error instanceof DomainError && error.code === "TABLE_RESET_BLOCKED",
  );
});

test("an open service request blocks the reset", async () => {
  const fixture = settledTable();
  fixture.callsByTable["table-3"] = [call()];

  await assert.rejects(
    () => service(fixture).reset(principal("MANAGER"), command),
    (error: unknown) =>
      error instanceof DomainError &&
      error.code === "TABLE_RESET_BLOCKED" &&
      error.message.includes("servis isteği"),
  );
});

test("reset never writes a payment or closes an order itself", async () => {
  const fixture = settledTable();
  await service(fixture).reset(principal("ADMIN"), command);

  // The only write is the table's own status; nothing financial is touched.
  assert.deepEqual(fixture.movedOrders, []);
  assert.deepEqual(fixture.resolvedCalls, []);
  assert.equal(fixture.statusUpdates.length, 1);
});

test("waiters, kitchen and cashiers cannot reset a table", async () => {
  for (const role of ["WAITER", "KITCHEN", "CASHIER"] as const) {
    const fixture = settledTable();
    await assert.rejects(
      () => service(fixture).reset(principal(role), command),
      (error: unknown) => error instanceof DomainError && error.code === "FORBIDDEN",
    );
    assert.equal(fixture.statusUpdates.length, 0);
  }
});

test("a table of another restaurant is not found", async () => {
  const fixture = settledTable();
  await assert.rejects(
    () => service(fixture).reset(principal("MANAGER"), { tableId: "table-of-restaurant-2" }),
    (error: unknown) => error instanceof DomainError && error.code === "TABLE_NOT_FOUND",
  );
});

test("an out-of-service table resets to inactive, not available", async () => {
  const fixture = state({
    tables: [table({ id: "table-3", isActive: false, currentStatus: "OCCUPIED" })],
    ordersByTable: { "table-3": [] },
    callsByTable: { "table-3": [] },
  });
  const result = await service(fixture).reset(principal("MANAGER"), command);
  assert.equal(result.table.status, "INACTIVE");
});

test("the reset writes its outbox event and audit record", async () => {
  const fixture = settledTable();
  await service(fixture).reset(principal("MANAGER"), { ...command, requestId: "req-11" });

  assert.equal(fixture.outbox[0]?.eventType, "TABLE_RESET");
  assert.equal(fixture.outbox[0]?.aggregateType, "TABLE");
  assert.equal(fixture.audits[0]?.action, "table.reset");
  assert.deepEqual(fixture.audits[0]?.oldValue, { status: "CLEANING" });
  assert.deepEqual(fixture.audits[0]?.newValue, { status: "AVAILABLE" });
  assert.equal(fixture.audits[0]?.requestId, "req-11");
});

test("the blocker policy reports the most financial reason first", () => {
  assert.equal(
    tableResetBlockReason({
      openOrderCount: 0,
      outstandingBalanceMinor: 0,
      openCheckCount: 0,
      partiallyPaidCheckCount: 0,
      pendingPaymentCount: 0,
      openCallCount: 0,
    }),
    null,
  );
  assert.equal(
    tableResetBlockReason({
      openOrderCount: 1,
      outstandingBalanceMinor: 1,
      openCheckCount: 1,
      partiallyPaidCheckCount: 1,
      pendingPaymentCount: 1,
      openCallCount: 1,
    }),
    "OPEN_ORDER",
  );
  assert.equal(
    tableResetBlockReason({
      openOrderCount: 0,
      outstandingBalanceMinor: 0,
      openCheckCount: 0,
      partiallyPaidCheckCount: 0,
      pendingPaymentCount: 0,
      openCallCount: 2,
    }),
    "OPEN_SERVICE_REQUEST",
  );
});
