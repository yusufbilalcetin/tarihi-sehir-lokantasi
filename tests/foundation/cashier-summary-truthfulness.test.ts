import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildCashierBills, summariseCashierMoney } from "../../lib/domain/cashier-queue";
import { calculateOrderBalance } from "../../lib/domain/financial-operations";
import type { Order, RestaurantTable } from "../../types";

/**
 * What the till says it is owed.
 *
 * The counter's headline figure summed `order.total` — the gross payable — so a
 * table that had already handed over most of its bill still counted for the
 * whole of it. The number was not a balance; it was a sales total wearing a
 * balance's label.
 *
 * The fix is not a second money engine on the client. Each order carries the
 * balance the server derived with `calculateOrderBalance`, and the counter adds
 * those up in minor units. Nothing here re-derives what is owed.
 */

const cashier = readFileSync(
  new URL("../../components/cashier/cashier-dashboard.tsx", import.meta.url),
  "utf8",
);

function table(id: string): RestaurantTable {
  return { id, name: `Masa ${id}`, status: "dining", seats: 4, qrAvailable: true, lastActivity: "az önce" } as RestaurantTable;
}

/** Builds the order exactly as the server would hand it over: balance included. */
function order(
  overrides: Partial<Order> & { id: string; total: number },
  payments: readonly { amount: string; refundedAmount: string; counted: boolean }[] = [],
): Order {
  const balance = calculateOrderBalance(overrides.total.toFixed(2), payments);
  return {
    orderNumber: `#${overrides.id}`,
    tableId: null,
    tableName: "Masa 1",
    createdAt: "19:00",
    elapsedMinutes: 10,
    status: "served",
    version: 1,
    items: [],
    outstanding: balance.outstanding,
    ...overrides,
  } as Order;
}

// --------------------------------------------- 1 + 2: the reported scenario

test("a part-paid order counts for what is left, not for what it cost", () => {
  // Order A: 1.000 payable, 800 already collected.
  const a = order({ id: "a", tableId: "t1", total: 1000 }, [
    { amount: "800.00", refundedAmount: "0.00", counted: true },
  ]);
  // Order B: 500 payable, nothing collected.
  const b = order({ id: "b", tableId: "t2", total: 500 }, []);

  assert.equal(a.outstanding, "200.00");
  assert.equal(b.outstanding, "500.00");

  const bills = buildCashierBills([table("t1"), table("t2")], [a, b], new Set());
  assert.equal(
    summariseCashierMoney(bills)?.toCollect,
    "700.00",
    "the headline was 1500 — the gross of both orders — while 800 was already in the drawer",
  );
});

// ------------------------------------------------------ 3: after a refund

test("a refund re-opens the balance and the headline follows it", () => {
  // 1.000 collected in full, then 300 handed back: the guest owes 300 again.
  const refunded = order({ id: "r", tableId: "t1", total: 1000 }, [
    { amount: "1000.00", refundedAmount: "300.00", counted: true },
  ]);
  assert.equal(refunded.outstanding, "300.00");
  assert.equal(
    summariseCashierMoney(buildCashierBills([table("t1")], [refunded], new Set()))?.toCollect,
    "300.00",
  );
});

// ------------------------------------------- 4: a settled order adds nothing

test("a settled order contributes nothing, and leaves the counter anyway", () => {
  // Paid in full. The server moves such an order to COMPLETED, which the
  // open-orders filter already excludes — but if one is ever still in hand,
  // it must add zero rather than its gross.
  const settled = order({ id: "s", tableId: "t1", total: 400 }, [
    { amount: "400.00", refundedAmount: "0.00", counted: true },
  ]);
  assert.equal(settled.outstanding, "0.00");

  const open = order({ id: "o", tableId: "t2", total: 250 }, []);
  assert.equal(
    summariseCashierMoney(
      buildCashierBills([table("t1"), table("t2")], [settled, open], new Set()),
    )?.toCollect,
    "250.00",
  );

  // A zero balance is not an unpaid bill, however it got onto the counter.
  assert.equal(
    summariseCashierMoney(
      buildCashierBills([table("t1"), table("t2")], [settled, open], new Set()),
    )?.unpaidCount,
    1,
  );

  // And a COMPLETED order is not on the counter at all.
  const completed = { ...settled, status: "completed" as const };
  assert.deepEqual(buildCashierBills([table("t1")], [completed], new Set()), []);
});

// ------------------------------------- 5: two orders, one table, still two

test("two orders on one table stay two payable entities in the sum", () => {
  const first = order({ id: "o1", tableId: "t5", total: 300 }, [
    { amount: "100.00", refundedAmount: "0.00", counted: true },
  ]);
  const second = order({ id: "o2", tableId: "t5", total: 80 }, []);

  const bills = buildCashierBills([table("t5")], [first, second], new Set());
  assert.equal(bills.length, 2, "the two rounds were merged into one check");
  assert.equal(summariseCashierMoney(bills)?.toCollect, "280.00", "200 left on the first, 80 on the second");
});

// ------------------------------------ 6: tableless orders count the same way

test("takeaway and courier orders carry their balance into the same total", () => {
  const dineIn = order({ id: "d", tableId: "t1", tableName: "Masa t1", total: 200 }, [
    { amount: "50.00", refundedAmount: "0.00", counted: true },
  ]);
  const takeaway = order({ id: "p", tableId: null, tableName: "Paket Sipariş", total: 120 }, []);
  const courier = order({ id: "k", tableId: null, tableName: "Kurye Siparişi", total: 90 }, [
    { amount: "90.00", refundedAmount: "40.00", counted: true },
  ]);

  const bills = buildCashierBills([table("t1")], [dineIn, takeaway, courier], new Set());
  assert.equal(bills.length, 3);
  // 150 + 120 + 40
  assert.equal(summariseCashierMoney(bills)?.toCollect, "310.00");
  assert.equal(bills.filter((entry) => entry.table === null).length, 2);
});

// ------------------------- 7: no balance means no number claiming to be one

test("an order with no server balance makes the headline unavailable, never gross", () => {
  const known = order({ id: "k", tableId: "t1", total: 100 }, []);
  const unknown = { ...order({ id: "u", tableId: "t2", total: 900 }, []), outstanding: null };

  const bills = buildCashierBills([table("t1"), table("t2")], [known, unknown], new Set());
  assert.equal(
    summariseCashierMoney(bills),
    null,
    "a partial answer must not be presented as the balance",
  );
  // Never silently substituting the gross total for the missing one.
  assert.notEqual(summariseCashierMoney(bills)?.toCollect, "1000.00");
});

test("the sum is exact in minor units, not floating point", () => {
  const bills = buildCashierBills(
    [],
    [0.1, 0.2, 0.3, 70.07, 0.01].map((value, index) =>
      order({ id: `o${index}`, tableId: null, total: value }),
    ),
    new Set(),
  );
  assert.equal(summariseCashierMoney(bills)?.toCollect, "70.68");
});

// ------------------------------------------------------- the screen agrees

test("the counter reads the server balance and names the figure honestly", () => {
  assert.match(cashier, /summariseCashierMoney\(/, "the headline still sums something else");
  assert.doesNotMatch(
    cashier,
    /reduce\(\(sum, bill\) => sum \+ bill\.order\.total, 0\)/,
    "gross totals are not a balance",
  );
  // Asked for explicitly, so the kitchen and floor lists are not made to carry
  // money they have no use for.
  assert.match(cashier, /withBalance:\s*true/);
  // The label says what the server contract actually means.
  assert.doesNotMatch(cashier, /Toplam \{formatCurrency\(metrics\.outstanding\)\}/);
  assert.match(cashier, /Tahsil edilecek \$\{formatCurrency\(Number\(money\.toCollect\)\)\}/);
});

test("a credit balance is shown, not thrown", () => {
  // Paid ₺1000 in full, then a ₺100 line is voided: payable drops to 900 while
  // 1000 is already in the drawer, so the order owes ₺100 back. The balance is
  // signed, and the counter has to be able to add it up rather than crash on it.
  const credit = order({ id: "c", tableId: "t1", total: 900 }, [
    { amount: "1000.00", refundedAmount: "0.00", counted: true },
  ]);
  assert.equal(credit.outstanding, "-100.00");

  const owing = order({ id: "o", tableId: "t2", total: 250 }, []);
  const bills = buildCashierBills([table("t1"), table("t2")], [credit, owing], new Set());
  assert.doesNotThrow(() => summariseCashierMoney(bills));
  const money = summariseCashierMoney(bills);
  // Kept apart: 250 to collect, 100 to give back. Netting them to 150 would
  // report one guest's debt as another guest's credit and show neither.
  assert.equal(money?.toCollect, "250.00");
  assert.equal(money?.toRefund, "100.00");
  assert.equal(money?.unpaidCount, 1, "the credit row is not an unpaid bill");
  assert.equal(money?.creditCount, 1);
});
