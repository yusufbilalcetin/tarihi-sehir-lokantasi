import type { Order, RestaurantTable } from "@/types";

/**
 * Which check a cashier is looking at, and in what order the queue is offered.
 *
 * This is money, so the rules are stated once, are pure, and are tested. The
 * counter derives no amount here — totals come from the server ledger. All this
 * decides is ordering and selection.
 */

export interface CashierBill {
  readonly table: RestaurantTable;
  readonly order: Order;
  readonly billRequested: boolean;
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
      left.table.id.localeCompare(right.table.id)
    );
  });
}

export type CashierSelectionReason =
  /** The cashier picked this table and it is still on the counter. */
  | "explicit"
  /** Nothing was picked, so the top of the queue is offered. */
  | "auto"
  /** The picked table left the counter — settled elsewhere, or reopened. */
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
 * The important case is `gone`. The counter used to fall through to "the first
 * bill that asked for its check, otherwise the first bill at all" whenever the
 * chosen table was missing from a refresh. A poll landing between a cashier
 * reading a total and pressing Ödemeyi Tamamla could therefore swap the panel
 * to a different table under their hand. Payment is not a place to guess: a
 * selection that disappears clears the panel and says so, and the cashier picks
 * again deliberately.
 */
export function resolveCashierSelection(
  bills: readonly CashierBill[],
  selectedTableId: string | null,
): CashierSelection {
  if (bills.length === 0) return { bill: null, reason: "empty" };

  if (selectedTableId) {
    const chosen = bills.find((bill) => bill.table.id === selectedTableId);
    return chosen ? { bill: chosen, reason: "explicit" } : { bill: null, reason: "gone" };
  }

  return { bill: bills[0] ?? null, reason: "auto" };
}
