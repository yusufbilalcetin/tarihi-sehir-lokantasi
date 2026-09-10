import { addMoney, decimalToMinor, minorToDecimal } from "@/lib/domain/money";
import type { Order, RestaurantTable } from "@/types";

/**
 * Which check a cashier is looking at, and in what order the queue is offered.
 *
 * This is money, so the rules are stated once, are pure, and are tested. The
 * counter derives no amount here — totals come from the server ledger. All this
 * decides is ordering and selection.
 */

export interface CashierBill {
  /**
   * Where the order is sitting, when it is sitting anywhere. Null on takeaway
   * and courier orders: they belong to no table, and inventing one for them
   * would be a table the restaurant does not have.
   */
  readonly table: RestaurantTable | null;
  /** The payable entity. One order is one bill; two orders are never merged. */
  readonly order: Order;
  readonly billRequested: boolean;
}

/**
 * The counter's queue, built from the orders that owe money.
 *
 * Built from ORDERS, not from tables. Walking the table list and taking the
 * first served order on each lost two kinds of money at once: a table's second
 * served round, which was never selectable, and every takeaway or courier
 * order, which has no table to be found under.
 *
 * A served round cannot grow, so a later request becomes a second order on the
 * same table. Both are listed, separately, under their own order numbers.
 */
export function buildCashierBills(
  tables: readonly RestaurantTable[],
  orders: readonly Order[],
  billRequestTableIds: ReadonlySet<string>,
): readonly CashierBill[] {
  const tableById = new Map(tables.map((table) => [table.id, table]));
  return orders
    // Only a served order is collectable; the API rejects anything earlier.
    .filter((order) => order.status === "served")
    .map((order) => ({
      table: order.tableId ? tableById.get(order.tableId) ?? null : null,
      order,
      // A guest asks for the bill at a table, not for one of its orders, so a
      // table with two open rounds flags both. Which one they meant is theirs
      // to say, and the cashier can see both.
      billRequested: order.tableId ? billRequestTableIds.has(order.tableId) : false,
    }));
}

/**
 * Whoever asked to pay comes first, then whoever has been sitting longest.
 *
 * The list used to render in table order while only the *fallback* selection
 * preferred a requester, so a guest who pressed "hesap" could sit below three
 * tables who had not. The id tiebreak keeps the order stable across polls.
 */
export function sortCashierBills(bills: readonly CashierBill[]): readonly CashierBill[] {
  return [...bills].sort((left, right) => {
    if (left.billRequested !== right.billRequested) return left.billRequested ? -1 : 1;
    return (
      right.order.elapsedMinutes - left.order.elapsedMinutes ||
      // The order is the identity here, so it is the order that breaks the tie.
      left.order.id.localeCompare(right.order.id)
    );
  });
}

export type CashierSelectionReason =
  /** The cashier picked this order and it is still on the counter. */
  | "explicit"
  /** Nothing was picked, so the top of the queue is offered. */
  | "auto"
  /** The picked order left the counter — settled elsewhere, or reopened. */
  | "gone"
  /** Nothing to collect. */
  | "empty";

export interface CashierSelection {
  readonly bill: CashierBill | null;
  readonly reason: CashierSelectionReason;
}

/**
 * Resolve what the payment panel is pointed at.
 *
 * The important case is `gone`. Keyed by table, settling one round handed the
 * panel to the table's *next* round while still reporting "explicit" — the
 * cashier read one total and pressed Ödemeyi Tamamla against another. Keyed by
 * the order, a selection that disappears clears the panel and says so, and the
 * cashier picks again deliberately.
 */
export function resolveCashierSelection(
  bills: readonly CashierBill[],
  selectedOrderId: string | null,
): CashierSelection {
  if (bills.length === 0) return { bill: null, reason: "empty" };

  if (selectedOrderId) {
    const chosen = bills.find((bill) => bill.order.id === selectedOrderId);
    return chosen ? { bill: chosen, reason: "explicit" } : { bill: null, reason: "gone" };
  }

  return { bill: bills[0] ?? null, reason: "auto" };
}

/**
 * What the counter is owed, and what it owes back.
 *
 * A sum, not a derivation: each order already carries the balance the server
 * produced with `calculateOrderBalance`, and this only adds them up — in minor
 * units, so the headline is exact rather than the nearest float.
 *
 * The two directions are kept apart on purpose. A bill owing 100 and a bill
 * owed 100 back are two obligations, not zero: netting them would show a quiet
 * counter while two guests are each still waiting for something. No new rule is
 * invented to do it — the sign on the server's own `outstanding` is the whole
 * of the distinction.
 */
export interface CashierMoneySummary {
  /** Still to collect: the positive balances. */
  readonly toCollect: string;
  /**
   * Held but no longer owed, as a positive amount — money to give back.
   *
   * No current server path produces one: every payable-reducing operation is
   * refused once a payment has settled, and a collection is capped at the
   * outstanding balance. It is carried anyway so that if that ever stops being
   * true, the counter shows the credit instead of quietly shrinking the amount
   * it claims to be owed.
   */
  readonly toRefund: string;
  /** Bills that still owe something. Not a row count. */
  readonly unpaidCount: number;
  /** Bills the restaurant owes money back on. */
  readonly creditCount: number;
}

/** Null the moment one bill has no balance: a partial answer is not a total. */
export function summariseCashierMoney(
  bills: readonly CashierBill[],
): CashierMoneySummary | null {
  const owed: number[] = [];
  const credit: number[] = [];
  for (const bill of bills) {
    if (bill.order.outstanding === null) return null;
    // Signed, because that is how `calculateOrderBalance` reports it. Parsing
    // it as unsigned would throw inside the counter's render rather than show
    // what is there.
    const minor = decimalToMinor(bill.order.outstanding, { allowNegative: true });
    if (minor > 0) owed.push(minor);
    else if (minor < 0) credit.push(-minor);
  }
  return {
    toCollect: minorToDecimal(addMoney(...owed)),
    toRefund: minorToDecimal(addMoney(...credit)),
    unpaidCount: owed.length,
    creditCount: credit.length,
  };
}
