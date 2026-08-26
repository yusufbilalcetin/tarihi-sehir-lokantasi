import assert from "node:assert/strict";
import test from "node:test";

import {
  InvalidMoneyError,
  addMoney,
  decimalToMinor,
  minorToDecimal,
  minorUnits,
  multiplyMoney,
  subtractMoney,
} from "../../lib/domain/money";

test("decimal strings convert to minor units without floating-point arithmetic", () => {
  assert.equal(decimalToMinor("0.10"), 10);
  assert.equal(decimalToMinor("250"), 25_000);
  assert.equal(decimalToMinor("001.20"), 120);
  assert.equal(minorToDecimal(decimalToMinor("280.05")), "280.05");
});
test("money helpers calculate totals in exact minor units", () => {
  const soup = decimalToMinor("120.00");
  const ayran = decimalToMinor("55.00");

  assert.equal(multiplyMoney(soup, 2), 24_000);
  assert.equal(addMoney(multiplyMoney(soup, 2), ayran), 29_500);
  assert.equal(subtractMoney(decimalToMinor("300"), decimalToMinor("4.75")), 29_525);
});

test("invalid precision, unsafe values, and invalid quantities fail closed", () => {
  assert.throws(() => decimalToMinor("1.005"), InvalidMoneyError);
  assert.throws(() => decimalToMinor("-1.00"), InvalidMoneyError);
  assert.throws(() => minorUnits(1.5), InvalidMoneyError);
  assert.throws(() => minorUnits(Number.MAX_SAFE_INTEGER + 1), InvalidMoneyError);
  assert.throws(() => multiplyMoney(decimalToMinor("10"), -1), InvalidMoneyError);
});

test("negative money is opt-in and formats canonically", () => {
  const refund = decimalToMinor("-12.30", { allowNegative: true });
  assert.equal(refund, -1_230);
  assert.equal(minorToDecimal(refund), "-12.30");
});
