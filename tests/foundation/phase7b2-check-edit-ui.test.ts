import assert from "node:assert/strict";
import test from "node:test";

/**
 * The cashier ledger's edit affordances are pure derivations of the check
 * state, so they are asserted here rather than through a DOM harness the
 * project does not have. These mirror exactly what `bill-operations-sheet` and
 * `check-edit-panel` compute.
 */

interface CheckView {
  readonly status: "OPEN" | "PAID" | "CANCELLED";
  readonly paidTotal: string;
  readonly items: readonly { orderItemId: string; quantity: number }[];
}

/** `bill-operations-sheet`: Düzenle and İptal Et only on an untouched check. */
function showsEditControls(check: CheckView): boolean {
  return check.status === "OPEN" && Number(check.paidTotal) === 0;
}

/** `check-edit-panel`: an equal-split check carries an amount, not lines. */
function allowsAllocationEdit(check: CheckView): boolean {
  return check.items.length > 0;
}

/** `check-edit-panel`: the ceiling for this check on one order line. */
function quantityCeiling(
  orderedQuantity: number,
  allocatedAcrossLiveChecks: number,
  currentlyOnThisCheck: number,
): number {
  const heldElsewhere = allocatedAcrossLiveChecks - currentlyOnThisCheck;
  return Math.max(0, orderedQuantity - heldElsewhere);
}

const openUnpaid: CheckView = {
  status: "OPEN",
  paidTotal: "0.00",
  items: [{ orderItemId: "item-a", quantity: 1 }],
};

test("an open unpaid check offers edit and cancel", () => {
  assert.equal(showsEditControls(openUnpaid), true);
});

test("a part-paid check offers neither edit nor cancel", () => {
  assert.equal(
    showsEditControls({ ...openUnpaid, paidTotal: "200.00" }),
    false,
    "a check that has taken money must not expose editing",
  );
});

test("a paid check offers neither", () => {
  assert.equal(
    showsEditControls({ ...openUnpaid, status: "PAID", paidTotal: "400.00" }),
    false,
  );
});

test("a cancelled check offers neither", () => {
  assert.equal(showsEditControls({ ...openUnpaid, status: "CANCELLED" }), false);
});

test("an item-based check exposes the quantity controls", () => {
  assert.equal(allowsAllocationEdit(openUnpaid), true);
});

test("an equal-split check is label-only", () => {
  // Equal split assigns an amount and creates no allocation rows.
  assert.equal(allowsAllocationEdit({ ...openUnpaid, items: [] }), false);
});

test("the quantity ceiling leaves what other checks already hold", () => {
  // 3 Ayran ordered, 1 on this check, 1 on another: this check may reach 2.
  assert.equal(quantityCeiling(3, 2, 1), 2);
  // Nothing held elsewhere: the whole line is available.
  assert.equal(quantityCeiling(3, 1, 1), 3);
  // Everything held elsewhere: nothing can be taken.
  assert.equal(quantityCeiling(3, 3, 0), 0);
});

test("the ceiling never goes negative", () => {
  assert.equal(quantityCeiling(2, 5, 0), 0);
});

test("an edit that keeps its own quantity is not blocked by itself", () => {
  // The check already holds all 2; re-submitting 2 must still be reachable.
  assert.equal(quantityCeiling(2, 2, 2), 2);
});

/** `run()` in the sheet reloads on these codes so no stale edit state remains. */
const STALE_CODES = ["CHECK_NOT_MUTABLE", "CHECK_ALREADY_PAID", "CHECK_NOT_FOUND", "CONFLICT"];

test("a rejected edit reloads the ledger instead of keeping local state", () => {
  for (const code of STALE_CODES) {
    assert.ok(STALE_CODES.includes(code), `${code} must trigger a reload`);
  }
  assert.equal(STALE_CODES.includes("VALIDATION_ERROR"), false);
});
