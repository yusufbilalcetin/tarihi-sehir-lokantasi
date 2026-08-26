import assert from "node:assert/strict";
import test from "node:test";

import { DomainError } from "../../lib/api/domain-error";
import { call, openOrder, principal, service, state, table } from "./phase6-table-fixtures";

const command = { sourceTableId: "table-3", targetTableId: "table-8" };

/** Both tables running: the case a transfer refuses and a merge exists for. */
function occupiedPair() {
  return state({
    ordersByTable: {
      "table-3": [openOrder({ id: "order-120", orderNumber: "ORD-000120" })],
      "table-8": [openOrder({ id: "order-121", orderNumber: "ORD-000121" })],
    },
    tables: [
      table({ id: "table-3", tableNumber: 3 }),
      table({ id: "table-8", tableNumber: 8 }),
    ],
  });
}

test("a manager merges two running tables", async () => {
  const fixture = occupiedPair();
  const result = await service(fixture).merge(principal("MANAGER"), command);

  assert.deepEqual(result.movedOrderIds, ["order-120"]);
  assert.equal(result.target.id, "table-8");
});

test("orders keep their own ids and numbers instead of being rewritten", async () => {
  const fixture = occupiedPair();
  await service(fixture).merge(principal("MANAGER"), command);

  // The move only ever rewrites table_id; nothing collapses two orders into one.
  assert.deepEqual(fixture.movedOrders, [
    { orderIds: ["order-120"], targetTableId: "table-8" },
  ]);
  const movedOrders = fixture.audits[0]?.metadata?.movedOrders;
  assert.deepEqual(movedOrders, [
    { id: "order-120", orderNumber: "ORD-000120", status: "CONFIRMED" },
  ]);
});

test("a request type the target already has open is resolved, not duplicated", async () => {
  const fixture = occupiedPair();
  fixture.callsByTable = {
    "table-3": [call({ id: "call-source", type: "BILL_REQUEST" })],
    "table-8": [call({ id: "call-target", type: "BILL_REQUEST" })],
  };
  const result = await service(fixture).merge(principal("MANAGER"), command);

  // The database allows one active request per (table, type).
  assert.deepEqual(result.resolvedCallIds, ["call-source"]);
  assert.deepEqual(result.movedCallIds, []);
  assert.deepEqual(fixture.resolvedCalls, ["call-source"]);
  assert.equal(fixture.movedCalls.length, 0);
});

test("a request type the target does not have simply moves across", async () => {
  const fixture = occupiedPair();
  fixture.callsByTable = {
    "table-3": [call({ id: "call-source", type: "WAITER_CALL" })],
    "table-8": [call({ id: "call-target", type: "BILL_REQUEST" })],
  };
  const result = await service(fixture).merge(principal("MANAGER"), command);

  assert.deepEqual(result.movedCallIds, ["call-source"]);
  assert.deepEqual(result.resolvedCallIds, []);
  // A bill request on the target still outranks the moved waiter call.
  assert.deepEqual(fixture.statusUpdates[0], { tableId: "table-8", status: "BILL_REQUESTED" });
});

test("two source requests of the same type cannot both land on the target", async () => {
  const fixture = occupiedPair();
  fixture.callsByTable = {
    "table-3": [
      call({ id: "call-a", type: "WAITER_CALL" }),
      call({ id: "call-b", type: "WAITER_CALL" }),
    ],
    "table-8": [],
  };
  const result = await service(fixture).merge(principal("MANAGER"), command);

  assert.deepEqual(result.movedCallIds, ["call-a"]);
  assert.deepEqual(result.resolvedCallIds, ["call-b"]);
});

test("a source with nothing running is refused", async () => {
  const fixture = state({
    ordersByTable: { "table-3": [], "table-8": [openOrder()] },
  });
  await assert.rejects(
    () => service(fixture).merge(principal("MANAGER"), command),
    (error: unknown) => error instanceof DomainError && error.code === "TABLE_MERGE_CONFLICT",
  );
});

test("a table of another restaurant cannot be merged in", async () => {
  const fixture = occupiedPair();
  await assert.rejects(
    () =>
      service(fixture).merge(principal("MANAGER"), {
        ...command,
        sourceTableId: "table-of-restaurant-2",
      }),
    (error: unknown) => error instanceof DomainError && error.code === "TABLE_NOT_FOUND",
  );
  assert.equal(fixture.movedOrders.length, 0);
});

test("a concurrent merge of the same source aborts instead of splitting it", async () => {
  const fixture = occupiedPair();
  fixture.ordersByTable["table-3"] = [
    openOrder({ id: "order-120" }),
    openOrder({ id: "order-122" }),
  ];
  fixture.moveOrdersReturnsFewer = true;

  await assert.rejects(
    () => service(fixture).merge(principal("MANAGER"), command),
    (error: unknown) => error instanceof DomainError && error.code === "TABLE_MERGE_CONFLICT",
  );
  assert.equal(fixture.statusUpdates.length, 0);
  assert.equal(fixture.outbox.length, 0);
});

test("a waiter cannot merge; that stays a supervisory action", async () => {
  for (const role of ["WAITER", "KITCHEN", "CASHIER"] as const) {
    const fixture = occupiedPair();
    await assert.rejects(
      () => service(fixture).merge(principal(role), command),
      (error: unknown) => error instanceof DomainError && error.code === "FORBIDDEN",
    );
    assert.equal(fixture.movedOrders.length, 0);
  }
});

test("the merge writes its own event name and audit action", async () => {
  const fixture = occupiedPair();
  await service(fixture).merge(principal("MANAGER"), command);

  assert.equal(fixture.outbox[0]?.eventType, "TABLES_MERGED");
  assert.equal(fixture.audits[0]?.action, "table.merged");
  assert.equal(fixture.audits[0]?.entityId, "table-8");
});

test("the merged target stays occupied while the source is released", async () => {
  const fixture = occupiedPair();
  await service(fixture).merge(principal("MANAGER"), command);
  assert.deepEqual(fixture.statusUpdates, [
    { tableId: "table-8", status: "OCCUPIED" },
    { tableId: "table-3", status: "AVAILABLE" },
  ]);
});
