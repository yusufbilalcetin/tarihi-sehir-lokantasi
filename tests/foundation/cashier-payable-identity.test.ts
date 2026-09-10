import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildCashierBills,
  resolveCashierSelection,
  sortCashierBills,
  type CashierBill,
} from "../../lib/domain/cashier-queue";
import type { Order, RestaurantTable } from "../../types";

/**
 * What the counter collects is an ORDER, never a table.
 *
 * The queue used to be built by walking the table list and taking the first
 * served order on each, keyed for selection by `table.id`. Three things fell
 * out of that, all of them money:
 *
 *  - a table's second served round was counted but never selectable;
 *  - a takeaway or courier order, which belongs to no table, could not appear
 *    at the till at all;
 *  - settling one order silently handed the payment panel to the next order on
 *    the same table, because the table id still matched.
 *
 * TABLE, ORDER, CHECK and LEDGER stay four different things. This file holds
 * the first two apart.
 */

const cashier = readFileSync(
  new URL("../../components/cashier/cashier-dashboard.tsx", import.meta.url),
  "utf8",
);

function table(id: string, name = `Masa ${id}`): RestaurantTable {
  return { id, name, status: "dining", seats: 4, qrAvailable: true, lastActivity: "az önce" } as RestaurantTable;
}

function order(overrides: Partial<Order> & { id: string }): Order {
  return {
    orderNumber: `#${overrides.id}`,
    tableId: null,
    tableName: "Masa 1",
    createdAt: "19:00",
    elapsedMinutes: 10,
    status: "served",
    total: 100,
    version: 1,
    items: [],
    ...overrides,
  } as Order;
}

// ------------------------------------- P0-A: two rounds, one table, two bills

test("both served rounds on one table are separately selectable", () => {
  const tables = [table("t5")];
  const first = order({ id: "o1", tableId: "t5", tableName: "Masa t5", total: 300, elapsedMinutes: 40 });
  const second = order({ id: "o2", tableId: "t5", tableName: "Masa t5", total: 80, elapsedMinutes: 5 });

  const bills = buildCashierBills(tables, [first, second], new Set());
  assert.equal(bills.length, 2, "the second round was invisible at the till");
  assert.deepEqual(
    bills.map((entry) => entry.order.id).sort(),
    ["o1", "o2"],
    "two orders are two bills — never merged into one",
  );
  // Each is reachable on its own identity.
  assert.equal(resolveCashierSelection(bills, "o2").bill?.order.id, "o2");
  assert.equal(resolveCashierSelection(bills, "o1").bill?.order.id, "o1");
  // And they are still two separate orders, not one summed check.
  assert.deepEqual(bills.map((entry) => entry.order.total).sort((a, b) => a - b), [80, 300]);
});

test("settling one round does not hand the panel to the other round", () => {
  const tables = [table("t5")];
  const first = order({ id: "o1", tableId: "t5", total: 300 });
  const second = order({ id: "o2", tableId: "t5", total: 80 });

  const before = buildCashierBills(tables, [first, second], new Set());
  assert.equal(resolveCashierSelection(before, "o1").reason, "explicit");

  // o1 is collected and leaves the open list. The table is still there, and so
  // is o2 — which is exactly when the panel used to swap under the cashier's
  // hand while still reading "explicit".
  const after = buildCashierBills(tables, [second], new Set());
  const selection = resolveCashierSelection(after, "o1");
  assert.equal(selection.bill, null);
  assert.equal(selection.reason, "gone", "a settled order must clear the panel, not point at its neighbour");
});

// ------------------------------ P0-B: takeaway and courier have no table

test("a takeaway or courier order reaches the till without inventing a table", () => {
  const takeaway = order({ id: "o-pkt", tableId: null, tableName: "Paket Sipariş", total: 240 });
  const courier = order({ id: "o-kur", tableId: null, tableName: "Kurye Siparişi", total: 180 });

  // No tables at all: a restaurant with only counter trade still has money to take.
  const bills = buildCashierBills([], [takeaway, courier], new Set());
  assert.equal(bills.length, 2, "tableless orders could not be collected at all");

  for (const entry of bills) {
    assert.equal(entry.table, null, "a tableless order must not be given a fake table");
    assert.equal(entry.billRequested, false, "there is no table to request a bill from");
  }
  // The channel is already in words on the order; the till reads that, and does
  // not reach for `table.name`.
  assert.deepEqual(
    bills.map((entry) => entry.order.tableName).sort(),
    ["Kurye Siparişi", "Paket Sipariş"],
  );
  assert.equal(resolveCashierSelection(bills, "o-kur").bill?.order.id, "o-kur");
});

test("dine-in and tableless orders share one queue, ranked by the same rule", () => {
  const tables = [table("t3")];
  const bills = buildCashierBills(
    tables,
    [
      order({ id: "dine", tableId: "t3", tableName: "Masa t3", elapsedMinutes: 10 }),
      order({ id: "pkt", tableId: null, tableName: "Paket Sipariş", elapsedMinutes: 30 }),
    ],
    new Set(["t3"]),
  );
  // The dine-in guest asked for the bill, so they outrank a longer-waiting
  // takeaway — the existing rule, applied across both kinds.
  assert.deepEqual(sortCashierBills(bills).map((entry) => entry.order.id), ["dine", "pkt"]);
  assert.equal(bills.find((entry) => entry.order.id === "dine")?.billRequested, true);
});

// ------------------------------------------- only payable orders are listed

test("only a served order is on the counter", () => {
  const tables = [table("t1")];
  const bills = buildCashierBills(
    tables,
    [
      order({ id: "cooking", tableId: "t1", status: "preparing" }),
      order({ id: "ready", tableId: "t1", status: "ready" }),
      order({ id: "payable", tableId: "t1", status: "served" }),
    ],
    new Set(),
  );
  assert.deepEqual(bills.map((entry) => entry.order.id), ["payable"]);
});

test("the ranking is stable and keyed on the order, not the table", () => {
  const make = (id: string, elapsedMinutes: number, billRequested = false): CashierBill => ({
    table: table("same"),
    order: order({ id, tableId: "same", elapsedMinutes }),
    billRequested,
  });
  const tied = [make("z", 10), make("y", 10)];
  assert.deepEqual(sortCashierBills(tied).map((b) => b.order.id), ["y", "z"]);
  assert.deepEqual(sortCashierBills([...tied].reverse()).map((b) => b.order.id), ["y", "z"]);
});

// -------------------------------------------------- the screen agrees

test("the counter selects, keys and labels by the order it is collecting", () => {
  assert.match(cashier, /buildCashierBills\(/, "the queue must be derived in the tested domain");
  assert.match(cashier, /selectedOrderId/, "selection still keyed by table");
  assert.doesNotMatch(cashier, /selectedTableId/, "a table id cannot identify a payment");
  // No fake table anywhere: the label comes from the order's own place words.
  assert.doesNotMatch(
    cashier,
    /selectedBill\.table\.name/,
    "a tableless order has no table.name to read",
  );
});
