import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildAttentionQueue,
  buildReadyQueue,
  hasReadyFood,
  readyOrderItems,
} from "@/lib/domain/service-attention";
import type { Order, OrderItem, RestaurantTable } from "@/types";

/**
 * Half a ticket.
 *
 * A round is rarely finished all at once: the soup is at the pass while the
 * main is still on the stove, so the *order* stays PREPARING. Every waiter
 * surface used to key off that one status, which meant the plated line was
 * invisible until the whole ticket landed — the food went cold with no screen
 * saying so, and the waiter had no way to carry just that plate.
 */

function read(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

function item(overrides: Partial<OrderItem> & { id: string }): OrderItem {
  return {
    productId: `p-${overrides.id}`,
    productName: "Mercimek Çorbası",
    quantity: 1,
    unitPrice: 60,
    status: "pending",
    ...overrides,
  } as OrderItem;
}

function order(overrides: Partial<Order> & { id: string; tableId: string }): Order {
  return {
    orderNumber: "#1",
    tableName: "M1",
    createdAt: "19:00",
    elapsedMinutes: 4,
    status: "preparing",
    total: 100,
    version: 1,
    items: [],
    ...overrides,
  } as Order;
}

const half = order({
  id: "o-half",
  tableId: "t1",
  tableName: "Masa 1",
  status: "preparing",
  elapsedMinutes: 7,
  items: [
    item({ id: "i1", productName: "Mercimek Çorbası", quantity: 2, status: "ready" }),
    item({ id: "i2", productName: "Kuzu Tandır", status: "preparing" }),
    item({ id: "i3", productName: "Ayran", status: "cancelled" }),
  ],
});

// ------------------------------------------------------- the plated line

test("a plated line is ready food even while the rest of the ticket cooks", () => {
  assert.equal(hasReadyFood(half), true);
  assert.deepEqual(readyOrderItems(half).map((line) => line.id), ["i1"]);

  const nothingPlated = order({
    id: "o-cold",
    tableId: "t2",
    items: [item({ id: "i1", status: "preparing" }), item({ id: "i2", status: "pending" })],
  });
  assert.equal(hasReadyFood(nothingPlated), false);
  // A served line is food that already left the pass, not food waiting on it.
  assert.equal(
    hasReadyFood(order({ id: "o-done", tableId: "t3", items: [item({ id: "i1", status: "served" })] })),
    false,
  );
  // And an order carrying no line detail is still trusted to its own status.
  assert.equal(hasReadyFood(order({ id: "o-bare", tableId: "t4", status: "ready", items: [] })), true);
});

// ---------------------------------------------------------- the pass queue

test("a half-ready ticket reaches the pass queue, and names only the plated lines", () => {
  const queue = buildReadyQueue([half]);
  assert.equal(queue.length, 1, "the waiter was never told this food was waiting");
  assert.equal(queue[0]?.orderId, "o-half");
  assert.equal(
    queue[0]?.summary,
    "2× Mercimek Çorbası",
    "the queue must not send a waiter out with a plate that is still cooking",
  );
  assert.equal(queue[0]?.readyItemCount, 1);
  assert.equal(queue[0]?.partial, true, "the row has to say the rest is still coming");
});

test("a fully plated ticket is not marked partial", () => {
  const whole = order({
    id: "o-whole",
    tableId: "t5",
    status: "ready",
    items: [item({ id: "i1", status: "ready" }), item({ id: "i2", status: "ready" })],
  });
  const [entry] = buildReadyQueue([whole]);
  assert.equal(entry?.partial, false);
  assert.equal(entry?.readyItemCount, 2);
});

// ------------------------------------------------------ the attention queue

test("a half-ready ticket puts its table at the top of the attention queue", () => {
  const tables: readonly RestaurantTable[] = [
    { id: "t1", name: "Masa 1", status: "dining", seats: 4, qrAvailable: true, lastActivity: "az önce" },
    { id: "t9", name: "Masa 9", status: "bill-requested", seats: 2, qrAvailable: true, lastActivity: "az önce" },
  ];

  const queue = buildAttentionQueue(tables, [half]);
  assert.deepEqual(queue.map((entry) => entry.tableId), ["t1", "t9"]);
  assert.equal(queue[0]?.reason, "order-ready");
  assert.equal(queue[0]?.waitingMinutes, 7, "the clock is the plated order's, not the table's");
});

// -------------------------------------------- one plate, one serve command

test("the waiter serves the plated line on its own, with the version it saw", () => {
  const tableGrid = read("components/staff/table-grid.tsx");
  assert.match(
    tableGrid,
    /staffApi\.updateOrderItemStatus\(/,
    "the waiter has no way to serve a single line",
  );
  assert.match(
    tableGrid,
    /expectedOrderVersion:\s*(selectedOrder|order)\.version/,
    "a stale device must lose the race rather than serve food twice",
  );
  // The whole-order command still exists; it is not what a half ticket uses.
  assert.match(tableGrid, /staffApi\.updateOrderStatus\(/);
});

test("the floor counts half-ready tickets as ready food too", () => {
  const floor = read("components/staff/use-staff-floor.ts");
  assert.match(
    floor,
    /readyOrderCount:\s*orders\.filter\(hasReadyFood\)/,
    "the ready badge still counts whole orders only",
  );
});

// ------------------------------------------------ the words on the errand

test("the errand says how much of the round is actually up", () => {
  const tables: readonly RestaurantTable[] = [
    { id: "t1", name: "Masa 1", status: "dining", seats: 4, qrAvailable: true, lastActivity: "az önce" },
  ];

  // Half a round: "Sipariş hazır" would send the waiter for plates that are
  // still on the stove, so the row says what is actually on the pass.
  assert.equal(buildAttentionQueue(tables, [half])[0]?.label, "1 ürün hazır");

  const whole = order({
    id: "o-whole",
    tableId: "t1",
    status: "ready",
    items: [item({ id: "i1", status: "ready" }), item({ id: "i2", status: "ready" })],
  });
  assert.equal(buildAttentionQueue(tables, [whole])[0]?.label, "Sipariş hazır");
});

test("the orders tab shows where each line is, not just where the order is", () => {
  const list = read("components/staff/orders-list.tsx");
  assert.match(
    list,
    /<StatusBadge\s+status=\{item\.status/,
    "a plated line under a preparing order is invisible in the orders tab",
  );
});
