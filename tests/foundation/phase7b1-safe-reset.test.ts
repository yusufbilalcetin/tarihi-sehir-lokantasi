import assert from "node:assert/strict";
import test from "node:test";

import { DomainError } from "../../lib/api/domain-error";
import { openOrder, principal, service, state, table } from "./phase6-table-fixtures";

const command = { tableId: "table-3" };

/** A table whose only order is served and fully collected. */
function settledTable() {
  const fixture = state({
    tables: [table({ id: "table-3", currentStatus: "OCCUPIED" })],
    ordersByTable: {
      "table-3": [openOrder({ id: "order-1", status: "SERVED", total: "1500.00" })],
    },
    callsByTable: { "table-3": [] },
  });
  fixture.paidByOrder["order-1"] = "1500.00";
  return fixture;
}

test("a fully collected table still resets normally", async () => {
  const fixture = settledTable();
  const result = await service(fixture).reset(principal("MANAGER"), command);
  assert.equal(result.table.status, "AVAILABLE");
  assert.deepEqual(fixture.statusUpdates, [{ tableId: "table-3", status: "AVAILABLE" }]);
});

test("a part-paid table cannot be reset", async () => {
  const fixture = settledTable();
  // 500 of 1500 collected; a COMPLETED payment row is not a settled bill.
  fixture.paidByOrder["order-1"] = "500.00";

  await assert.rejects(
    () => service(fixture).reset(principal("MANAGER"), command),
    (error: unknown) =>
      error instanceof DomainError &&
      error.code === "TABLE_RESET_BLOCKED" &&
      error.message.includes("ödenmemiş bakiye"),
  );
  assert.equal(fixture.statusUpdates.length, 0);
});

test("the block reason carries the outstanding figure", async () => {
  const fixture = settledTable();
  fixture.paidByOrder["order-1"] = "500.00";

  await assert.rejects(
    () => service(fixture).reset(principal("MANAGER"), command),
    (error: unknown) =>
      error instanceof DomainError &&
      typeof error.details === "object" &&
      error.details !== null &&
      (error.details as Record<string, unknown>).reason === "OUTSTANDING_BALANCE" &&
      (error.details as Record<string, unknown>).outstanding === "1000.00",
  );
});

test("a refund that re-opens the balance blocks the reset while the order is live", async () => {
  const fixture = settledTable();
  fixture.refundedByOrder["order-1"] = "300.00";

  await assert.rejects(
    () => service(fixture).reset(principal("MANAGER"), command),
    (error: unknown) =>
      error instanceof DomainError && error.code === "TABLE_RESET_BLOCKED",
  );
});

test("a historical closed order never blocks the table, even after a refund", async () => {
  // A COMPLETED order is not in the unclosed set at all, so a refund taken
  // weeks later cannot strand the table.
  const fixture = state({
    tables: [table({ id: "table-3", currentStatus: "CLEANING" })],
    ordersByTable: { "table-3": [] },
    callsByTable: { "table-3": [] },
  });

  const result = await service(fixture).reset(principal("MANAGER"), command);
  assert.equal(result.table.status, "AVAILABLE");
});

test("an open split check blocks the reset", async () => {
  const fixture = settledTable();
  fixture.checksByTable["table-3"] = [
    {
      id: "check-1",
      orderId: "order-1",
      label: "Hesap 1",
      status: "OPEN",
      total: "500.00",
      paidTotal: "0.00",
    },
  ];

  await assert.rejects(
    () => service(fixture).reset(principal("MANAGER"), command),
    (error: unknown) =>
      error instanceof DomainError &&
      error.code === "TABLE_RESET_BLOCKED" &&
      error.message.includes("bölünmüş hesaplar"),
  );
});

test("a partly paid check is reported before a merely open one", async () => {
  const fixture = settledTable();
  fixture.checksByTable["table-3"] = [
    {
      id: "check-1",
      orderId: "order-1",
      label: "Hesap 1",
      status: "OPEN",
      total: "500.00",
      paidTotal: "200.00",
    },
    {
      id: "check-2",
      orderId: "order-1",
      label: "Hesap 2",
      status: "OPEN",
      total: "1000.00",
      paidTotal: "0.00",
    },
  ];

  await assert.rejects(
    () => service(fixture).reset(principal("MANAGER"), command),
    (error: unknown) =>
      error instanceof DomainError &&
      error.message.includes("kısmen ödenmiş") &&
      typeof error.details === "object" &&
      error.details !== null &&
      (error.details as Record<string, unknown>).reason === "PARTIAL_CHECK",
  );
});

test("an unserved order still blocks before any money is considered", async () => {
  const fixture = settledTable();
  fixture.ordersByTable["table-3"] = [
    openOrder({ id: "order-1", status: "PREPARING", total: "1500.00" }),
  ];

  await assert.rejects(
    () => service(fixture).reset(principal("MANAGER"), command),
    (error: unknown) =>
      error instanceof DomainError &&
      typeof error.details === "object" &&
      error.details !== null &&
      (error.details as Record<string, unknown>).reason === "OPEN_ORDER",
  );
});

test("a payment still in flight blocks the reset", async () => {
  const fixture = settledTable();
  fixture.pendingPaymentsByTable["table-3"] = 1;

  await assert.rejects(
    () => service(fixture).reset(principal("MANAGER"), command),
    (error: unknown) =>
      error instanceof DomainError &&
      typeof error.details === "object" &&
      error.details !== null &&
      (error.details as Record<string, unknown>).reason === "PENDING_PAYMENT",
  );
});

test("no override exists: a blocked reset writes nothing at all", async () => {
  const fixture = settledTable();
  fixture.paidByOrder["order-1"] = "0.00";

  await assert.rejects(
    () => service(fixture).reset(principal("ADMIN"), command),
    (error: unknown) => error instanceof DomainError && error.code === "TABLE_RESET_BLOCKED",
  );
  assert.equal(fixture.statusUpdates.length, 0);
  assert.equal(fixture.outbox.length, 0);
  assert.equal(fixture.audits.length, 0);
});
