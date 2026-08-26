import assert from "node:assert/strict";
import { test } from "node:test";

import {
  affectsDrawer,
  calculateCashVariance,
  calculateExpectedCash,
  canRoleOperateShift,
  canRoleSuperviseShift,
  checkShiftClose,
  isZeroMoney,
  summarizeShiftMoney,
} from "../../lib/domain/cashier-shift";

/**
 * Phase 8A — the drawer arithmetic, in isolation from any database.
 *
 * The single most important property here is that card money never touches the
 * expected physical cash. Everything else in the phase is bookkeeping on top of
 * that distinction.
 */

const BASE = {
  openingCash: "500.00",
  cashPayments: "1000.00",
  cashRefunds: "100.00",
  cashIn: "50.00",
  cashOut: "200.00",
};

test("expected cash follows the one formula, exactly", () => {
  // 500 + 1000 − 100 + 50 − 200 = 1250.00
  assert.equal(calculateExpectedCash(BASE), "1250.00");
});

test("card money never moves the expected physical cash", () => {
  const withCard = summarizeShiftMoney({
    ...BASE,
    cardPayments: "600.00",
    otherPayments: "0.00",
    cardRefunds: "50.00",
    otherRefunds: "0.00",
    paymentCount: 4,
    refundCount: 2,
  });
  assert.equal(
    withCard.expectedCash,
    "1250.00",
    "600.00 of card sales and 50.00 of card refunds must leave the drawer untouched",
  );
  // They still belong to the shift's accountability, just not to the drawer.
  assert.equal(withCard.grossCollected, "1600.00");
  assert.equal(withCard.netCollected, "1450.00");
  assert.equal(withCard.payments.cash, "1000.00");
  assert.equal(withCard.payments.card, "600.00");
  assert.equal(withCard.refunds.total, "150.00");
  assert.equal(affectsDrawer("CASH"), true);
  assert.equal(affectsDrawer("CARD"), false);
  assert.equal(affectsDrawer("OTHER"), false);
});

test("a cash movement pair nets out exactly", () => {
  const noMovements = calculateExpectedCash({ ...BASE, cashIn: "0.00", cashOut: "0.00" });
  assert.equal(noMovements, "1400.00");
  // +50 in, −20 out is a net +30 on the drawer.
  assert.equal(
    calculateExpectedCash({ ...BASE, cashIn: "50.00", cashOut: "20.00" }),
    "1430.00",
  );
});

test("expected cash is exact where floating point would not be", () => {
  // 0.10 + 0.20 is 0.30 here, not 0.30000000000000004.
  assert.equal(
    calculateExpectedCash({
      openingCash: "0.10",
      cashPayments: "0.20",
      cashRefunds: "0.00",
      cashIn: "0.00",
      cashOut: "0.00",
    }),
    "0.30",
  );
  assert.equal(
    calculateExpectedCash({
      openingCash: "0.00",
      cashPayments: "1234567.89",
      cashRefunds: "0.01",
      cashIn: "0.00",
      cashOut: "0.00",
    }),
    "1234567.88",
  );
});

test("a drawer emptied below its float reports a negative expectation", () => {
  const expected = calculateExpectedCash({
    openingCash: "100.00",
    cashPayments: "0.00",
    cashRefunds: "0.00",
    cashIn: "0.00",
    cashOut: "150.00",
  });
  assert.equal(expected, "-50.00", "a real state, not something to clamp to zero");
  assert.equal(calculateCashVariance("0.00", expected), "50.00");
});

test("variance is counted minus expected", () => {
  assert.equal(calculateCashVariance("1240.00", "1250.00"), "-10.00");
  assert.equal(calculateCashVariance("1260.00", "1250.00"), "10.00");
  assert.equal(calculateCashVariance("1250.00", "1250.00"), "0.00");
  assert.equal(isZeroMoney("0.00"), true);
  assert.equal(isZeroMoney("-0.01"), false);
});

test("a zero variance closes without an explanation", () => {
  assert.equal(
    checkShiftClose({
      countedCash: "1250.00",
      expectedCash: "1250.00",
      note: undefined,
      closingOnBehalf: false,
    }),
    null,
  );
});

test("a discrepancy must be explained, but never blocks the close outright", () => {
  assert.equal(
    checkShiftClose({
      countedCash: "1240.00",
      expectedCash: "1250.00",
      note: "  ",
      closingOnBehalf: false,
    }),
    "VARIANCE_NOTE_REQUIRED",
    "whitespace is not an explanation",
  );
  assert.equal(
    checkShiftClose({
      countedCash: "1240.00",
      expectedCash: "1250.00",
      note: "Bozuk para kasada sayılmadı.",
      closingOnBehalf: false,
    }),
    null,
    "with a note the till can still be closed and handed over",
  );
  // A surplus needs explaining just as much as a shortfall.
  assert.equal(
    checkShiftClose({
      countedCash: "1260.00",
      expectedCash: "1250.00",
      note: undefined,
      closingOnBehalf: false,
    }),
    "VARIANCE_NOTE_REQUIRED",
  );
});

test("closing somebody else's till always needs an explanation", () => {
  assert.equal(
    checkShiftClose({
      countedCash: "1250.00",
      expectedCash: "1250.00",
      note: undefined,
      closingOnBehalf: true,
    }),
    "SUPERVISOR_NOTE_REQUIRED",
  );
  assert.equal(
    checkShiftClose({
      countedCash: "1250.00",
      expectedCash: "1250.00",
      note: "Kasiyer vardiya bitiminde ayrıldı.",
      closingOnBehalf: true,
    }),
    null,
  );
});

test("a negative counted drawer is refused before anything else", () => {
  assert.equal(
    checkShiftClose({
      countedCash: "-1.00",
      expectedCash: "1250.00",
      note: "açıklama",
      closingOnBehalf: false,
    }),
    "COUNTED_CASH_NEGATIVE",
  );
});

test("the role matrix keeps waiters and kitchen away from the till", () => {
  for (const role of ["ADMIN", "MANAGER", "CASHIER"] as const) {
    assert.equal(canRoleOperateShift(role), true, `${role} may run a till`);
  }
  for (const role of ["WAITER", "KITCHEN"] as const) {
    assert.equal(canRoleOperateShift(role), false, `${role} may not run a till`);
    assert.equal(canRoleSuperviseShift(role), false, `${role} may not supervise one`);
  }
  assert.equal(canRoleSuperviseShift("CASHIER"), false, "a cashier supervises nobody");
  assert.equal(canRoleSuperviseShift("MANAGER"), true);
  assert.equal(canRoleSuperviseShift("ADMIN"), true);
});

test("the summary reports collection, and never calls it profit", () => {
  const summary = summarizeShiftMoney({
    openingCash: "0.00",
    cashPayments: "80.00",
    cardPayments: "120.00",
    otherPayments: "0.00",
    cashRefunds: "0.00",
    cardRefunds: "0.00",
    otherRefunds: "0.00",
    cashIn: "0.00",
    cashOut: "0.00",
    paymentCount: 2,
    refundCount: 0,
  });
  assert.equal(summary.grossCollected, "200.00", "80 cash + 120 card");
  assert.equal(summary.netCollected, "200.00");
  assert.equal(summary.expectedCash, "80.00", "only the cash half is in the drawer");
  assert.equal(summary.paymentCount, 2);
  assert.ok(
    !Object.keys(summary).some((key) => /profit|margin|kar/i.test(key)),
    "there is no cost model, so no field may imply profit",
  );
});
