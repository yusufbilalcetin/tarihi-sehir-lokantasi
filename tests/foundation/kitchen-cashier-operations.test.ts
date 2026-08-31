import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  KITCHEN_ATTENTION_MINUTES,
  KITCHEN_LATE_MINUTES,
  TICKET_URGENCY_LABELS,
  collectTicketNotes,
  resolveTicketUrgency,
  sortKitchenTickets,
  ticketHasNotes,
} from "@/lib/domain/kitchen-board";
import {
  resolveCashierSelection,
  sortCashierBills,
  type CashierBill,
} from "@/lib/domain/cashier-queue";
import type { Order, RestaurantTable } from "@/types";

function read(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

const kitchenBoard = read("components/kitchen/kitchen-board.tsx");
// The ticket became its own module so a phone, a tablet and a pass screen
// all render the identical card; these contracts moved with it.
const kitchenTicket = read("components/kitchen/kitchen-ticket.tsx");
const cashier = read("components/cashier/cashier-dashboard.tsx");

function order(overrides: Partial<Order> & { id: string }): Order {
  return {
    orderNumber: "#1",
    tableId: "t1",
    tableName: "Masa 1",
    createdAt: "19:00",
    elapsedMinutes: 0,
    status: "preparing",
    total: 100,
    items: [],
    ...overrides,
  } as Order;
}

/* ================================================================ kitchen == */

test("the oldest ticket is read first, and the order is stable across polls", () => {
  // The feed arrives newest-first under a row limit, which is the right query
  // and the wrong reading order: it buried the most urgent ticket at the
  // bottom of the lane.
  const feed = [
    order({ id: "c", elapsedMinutes: 1 }),
    order({ id: "a", elapsedMinutes: 22 }),
    order({ id: "b", elapsedMinutes: 9 }),
  ];
  assert.deepEqual(
    sortKitchenTickets(feed).map((ticket) => ticket.id),
    ["a", "b", "c"],
  );

  // Two tickets from the same second must not swap places between refreshes.
  const tied = [
    order({ id: "z", elapsedMinutes: 5 }),
    order({ id: "y", elapsedMinutes: 5 }),
  ];
  assert.deepEqual(sortKitchenTickets(tied).map((t) => t.id), ["y", "z"]);
  assert.deepEqual(
    sortKitchenTickets([...tied].reverse()).map((t) => t.id),
    ["y", "z"],
    "the lane reorders itself when nothing changed",
  );

  // And it does not mutate the feed it was handed.
  const source = [order({ id: "m", elapsedMinutes: 1 }), order({ id: "n", elapsedMinutes: 2 })];
  sortKitchenTickets(source);
  assert.deepEqual(source.map((t) => t.id), ["m", "n"]);
});

test("ticket urgency has three named steps, so colour is never the only signal", () => {
  assert.equal(resolveTicketUrgency(0), "on-time");
  assert.equal(resolveTicketUrgency(KITCHEN_ATTENTION_MINUTES - 1), "on-time");
  assert.equal(resolveTicketUrgency(KITCHEN_ATTENTION_MINUTES), "attention");
  assert.equal(resolveTicketUrgency(KITCHEN_LATE_MINUTES - 1), "attention");
  assert.equal(resolveTicketUrgency(KITCHEN_LATE_MINUTES), "late");
  assert.equal(resolveTicketUrgency(999), "late");

  for (const key of ["on-time", "attention", "late"] as const) {
    assert.ok(TICKET_URGENCY_LABELS[key].length > 0, `${key} has no word`);
  }
  // The board renders the word beside the clock, not just a colour.
  assert.match(kitchenTicket, /TICKET_URGENCY_LABELS\.late/);
  assert.match(kitchenTicket, /\{urgency\.label\}/);
});

test("the note a guest wrote on the whole order reaches the kitchen", () => {
  // This was the defect: the board rendered item notes only, so an order-level
  // note ("no onions", "a child is eating") was collected and never shown.
  const withOrderNote = order({
    id: "o",
    note: "  Çocuk için acısız  ",
    items: [
      { id: "i1", productId: "p1", productName: "Köfte", quantity: 1, unitPrice: 10, status: "pending", note: "az pişmiş" },
      { id: "i2", productId: "p2", productName: "Ayran", quantity: 2, unitPrice: 5, status: "pending" },
    ],
  } as Partial<Order> & { id: string });

  const notes = collectTicketNotes(withOrderNote);
  assert.equal(notes.orderNote, "Çocuk için acısız", "the order note was dropped or left untrimmed");
  assert.deepEqual(notes.itemNotes, [{ productName: "Köfte", note: "az pişmiş" }]);
  assert.equal(ticketHasNotes(withOrderNote), true);

  // Blank and whitespace-only notes are not notes.
  assert.equal(collectTicketNotes(order({ id: "b", note: "   " })).orderNote, null);
  assert.equal(ticketHasNotes(order({ id: "n" })), false);

  // A cancelled line's note is not an instruction any more.
  const cancelled = order({
    id: "c",
    items: [
      { id: "i", productId: "p", productName: "İptal", quantity: 1, unitPrice: 1, status: "cancelled", note: "boş" },
    ],
  } as Partial<Order> & { id: string });
  assert.deepEqual(collectTicketNotes(cancelled).itemNotes, []);

  // And the board actually renders it, above the lines.
  assert.match(kitchenTicket, /ticketNotes\.orderNote \?/);
  assert.match(kitchenTicket, /Sipariş notu/);
  assert.ok(
    kitchenTicket.indexOf("ticketNotes.orderNote") <
      kitchenTicket.indexOf("sipariş kalemleri"),
    "the order note renders below the lines it governs",
  );
});

test("the controls a cook taps most clear 44px", () => {
  // The advance and undo controls were 32px, the two most-used targets on a
  // touch KDS.
  assert.match(kitchenTicket, /className="h-11 min-w-16 px-3 text-sm font-bold"/);
  assert.match(kitchenTicket, /className="size-11 shrink-0 p-0 text-muted-foreground/);
  assert.doesNotMatch(kitchenTicket, /className="h-8 px-2/, "an item control went back under 44px");
  // The order-level primary stays the largest thing on the ticket.
  assert.match(kitchenTicket, /className=\{cn\("h-12 w-full text-base font-bold"/);
});

test("undo is confirmed and says why; advancing a ticket is not slowed down", () => {
  // Destructive-ish steps capture a reason, ordinary progress does not.
  assert.match(kitchenBoard, /ROLLBACK_REASONS/);
  assert.match(kitchenBoard, /Ürünü geri al/);
  assert.match(kitchenBoard, /rollbackReason/);
  assert.doesNotMatch(
    kitchenBoard,
    /confirm\(["'`]?Hazır/,
    "marking a ticket ready grew a confirmation and slowed the pass down",
  );
});

test("the kitchen board still stacks to one column on a phone", () => {
  assert.match(kitchenBoard, /className="grid gap-3[^"]*lg:grid-cols-3/);
  assert.doesNotMatch(kitchenBoard, /(sm|md):grid-cols-3/, "three lanes before lg is a side-scrolling board");
});

/* ================================================================ cashier == */

function table(id: string, name = `Masa ${id}`): RestaurantTable {
  return { id, name, status: "dining", seats: 4, qrAvailable: true, lastActivity: "az önce" } as RestaurantTable;
}

function bill(id: string, elapsedMinutes: number, billRequested = false): CashierBill {
  return {
    table: table(id),
    order: order({ id: `o-${id}`, tableId: id, elapsedMinutes, status: "served" }),
    billRequested,
  };
}

test("whoever asked to pay is at the top of the counter", () => {
  // The list used to render in table order while only the fallback selection
  // preferred a requester, so a guest who pressed "hesap" sat below three
  // tables who had not.
  const queue = sortCashierBills([
    bill("a", 30),
    bill("b", 5, true),
    bill("c", 40),
    bill("d", 20, true),
  ]);
  assert.deepEqual(
    queue.map((entry) => entry.table.id),
    ["d", "b", "c", "a"],
    "requesters first, then the longest wait",
  );

  // Stable when nothing changed.
  const tied = [bill("z", 10), bill("y", 10)];
  assert.deepEqual(sortCashierBills(tied).map((b) => b.table.id), ["y", "z"]);
  assert.deepEqual(sortCashierBills([...tied].reverse()).map((b) => b.table.id), ["y", "z"]);
  assert.match(cashier, /sortCashierBills\(/);
});

test("a check that leaves the counter never hands its payment panel to another table", () => {
  const bills = [bill("a", 10, true), bill("b", 5)];

  // An explicit choice is honoured.
  assert.deepEqual(resolveCashierSelection(bills, "b"), { bill: bills[1], reason: "explicit" });

  // Nothing chosen: the top of the queue is offered.
  assert.deepEqual(resolveCashierSelection(bills, null), { bill: bills[0], reason: "auto" });

  // The important one. The chosen table settled elsewhere between polls: the
  // panel clears rather than silently pointing at somebody else's money.
  const after = resolveCashierSelection(bills, "missing-table");
  assert.equal(after.bill, null);
  assert.equal(after.reason, "gone");

  assert.deepEqual(resolveCashierSelection([], "a"), { bill: null, reason: "empty" });
  assert.deepEqual(resolveCashierSelection([], null), { bill: null, reason: "empty" });
});

test("the counter tells the cashier when their selection was lost", () => {
  assert.match(cashier, /selection\.reason === "gone"/);
  assert.match(cashier, /Seçili hesap artık açık değil/);
  assert.match(cashier, /Hesap listesine dön/);
  // And it is not confused with an empty counter.
  assert.match(cashier, /Açık hesap bulunmuyor/);
});

test("payment cannot be fired twice and success waits for the server", () => {
  // The guard, the replay key, and the ordering of the success signals.
  assert.match(cashier, /if \(!selectedBill \|\| collecting \|\| !shiftOpen\) return;/);
  assert.match(cashier, /setCollecting\(true\)/);
  assert.match(cashier, /newIdempotencyKey\(\)/);
  const collect = cashier.slice(cashier.indexOf("async function takePayment"));
  const awaitIndex = collect.indexOf("await paymentApi.collect");
  const successIndex = collect.indexOf('playSound("payment-success")');
  assert.ok(awaitIndex > -1 && successIndex > awaitIndex, "success is signalled before the server answers");
  // A rejected collection never plays the success sound or shows a paid state.
  const cat = collect.slice(collect.indexOf("} catch (error)"), collect.indexOf("} finally"));
  assert.doesNotMatch(cat, /payment-success/);
  assert.doesNotMatch(cat, /setLastPaid/);
});

test("the till only offers the payment methods the API actually accepts", () => {
  // No button exists for a tender the backend cannot record.
  assert.match(cashier, /API_PAYMENT_METHOD: Record<PaymentMethod, "CASH" \| "CARD" \| "OTHER">/);
  for (const method of ["cash", "card", "other"]) {
    assert.match(cashier, new RegExp(`id: "${method}"`), `${method} is not offered`);
  }
  // Collection is refused without an open drawer, in the UI as well as the API.
  assert.match(cashier, /shiftOpen/);
});

test("the money panel's own controls stay large enough to hit", () => {
  // The sticky wrapper owns the spacing now; the button keeps its height.
  assert.match(cashier, /className="h-12 w-full bg-burgundy/);
  assert.match(cashier, /className="mt-2 h-11 w-full font-semibold"/);
  assert.match(cashier, /className="h-12 min-w-52 text-base font-bold"/);
});

test("a wide pass screen shows more tickets instead of stretching them", () => {
  // Each lane is ~620px on a 24-inch display; one ticket per row wastes half
  // of it. Two-up only once the lane can hold two readable tickets.
  assert.match(kitchenBoard, /grid content-start gap-3[^"]*2xl:grid-cols-2/);
  assert.match(kitchenBoard, /className="2xl:col-span-2"/, "the empty lane sits in half a column");
  // The three lanes themselves stay three: they are stages, not a ticket grid.
  assert.doesNotMatch(kitchenBoard, /lg:grid-cols-4|xl:grid-cols-4/);
});
