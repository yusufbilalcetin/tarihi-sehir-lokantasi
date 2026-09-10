import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { calculateOrderAmounts } from "../../lib/domain/order-mutations";
import { decimalToMinor, multiplyMoney } from "../../lib/domain/money";

/**
 * The guest basket and the order it becomes must agree on the price.
 *
 * The pre-submit panel used to print the service fee as a hard-coded zero and
 * set the total equal to the subtotal. The server charges service on the
 * subtotal and then tax on subtotal *plus* service, so the two only agreed
 * because both rates are zero today. Set either one and the guest pressed a
 * button reading one figure and was billed another.
 *
 * The fix is not a second implementation of the formula on the client — that is
 * how the two drift apart again — but the same `calculateOrderAmounts` the
 * order path uses. These tests pin the formula it encodes, and the last one
 * pins that the basket still routes through it.
 */

const menuExperience = readFileSync(
  new URL("../../components/menu/menu-experience.tsx", import.meta.url),
  "utf8",
);

/** The basket, expressed the way the component builds it. */
function basket(lines: readonly { price: string; quantity: number }[], serviceRate: string, taxRate: string) {
  return calculateOrderAmounts(
    lines.map((line) => ({
      lineTotalMinor: multiplyMoney(decimalToMinor(line.price), line.quantity),
      cancelled: false,
    })),
    serviceRate,
    taxRate,
  );
}

test("no service fee and no tax leaves the total equal to the subtotal", () => {
  // The configuration every restaurant is on today: the visible numbers must
  // not move at all as a result of this change.
  const amounts = basket([{ price: "105.00", quantity: 1 }, { price: "125.00", quantity: 2 }], "0.00", "0.00");
  assert.equal(amounts.subtotal, "355.00");
  assert.equal(amounts.serviceCharge, "0.00");
  assert.equal(amounts.tax, "0.00");
  assert.equal(amounts.total, "355.00");
});

test("a service fee alone is charged on the subtotal", () => {
  const amounts = basket([{ price: "100.00", quantity: 1 }], "10.00", "0.00");
  assert.equal(amounts.subtotal, "100.00");
  assert.equal(amounts.serviceCharge, "10.00");
  assert.equal(amounts.tax, "0.00");
  assert.equal(amounts.total, "110.00");
});

test("tax alone is charged on the subtotal", () => {
  const amounts = basket([{ price: "100.00", quantity: 1 }], "0.00", "20.00");
  assert.equal(amounts.subtotal, "100.00");
  assert.equal(amounts.serviceCharge, "0.00");
  assert.equal(amounts.tax, "20.00");
  assert.equal(amounts.total, "120.00");
});

/**
 * The case that separates the two possible formulas.
 *
 * Tax on the subtotal alone would be 20.00 and the total 130.00. Tax on
 * subtotal + service is 22.00 and the total 132.00. The server does the
 * latter, so a basket that quoted 130.00 would under-quote every quest by the
 * tax on the service charge.
 */
test("tax is charged on the subtotal plus the service fee, not the subtotal alone", () => {
  const amounts = basket([{ price: "100.00", quantity: 1 }], "10.00", "20.00");
  assert.equal(amounts.subtotal, "100.00");
  assert.equal(amounts.serviceCharge, "10.00");
  assert.equal(amounts.tax, "22.00", "tax must be levied on 110.00, not on 100.00");
  assert.equal(amounts.total, "132.00");
  assert.notEqual(amounts.total, "130.00");
});

test("rounding is half-up at each step, in minor units", () => {
  // 0.05 at 10% is exactly half a kuruş: it must round up to 0.01, not down to
  // 0.00, and it must do so without a binary float ever touching the value.
  const halfUp = basket([{ price: "0.05", quantity: 1 }], "0.00", "10.00");
  assert.equal(halfUp.tax, "0.01");
  assert.equal(halfUp.total, "0.06");

  // Service and tax round independently — the tax base is the *rounded*
  // service charge, which is what the stored order will carry.
  const twoSteps = basket([{ price: "0.05", quantity: 1 }], "10.00", "10.00");
  assert.equal(twoSteps.serviceCharge, "0.01");
  assert.equal(twoSteps.tax, "0.01");
  assert.equal(twoSteps.total, "0.07");
});

test("a large but valid basket stays exact", () => {
  // 250 covers of the most expensive dish — comfortably inside a real service,
  // and far past the point where float addition starts drifting.
  const amounts = basket([{ price: "395.00", quantity: 250 }], "10.00", "20.00");
  assert.equal(amounts.subtotal, "98750.00");
  assert.equal(amounts.serviceCharge, "9875.00");
  assert.equal(amounts.tax, "21725.00");
  assert.equal(amounts.total, "130350.00");
});

test("quantities multiply before the rates are applied", () => {
  const single = basket([{ price: "33.33", quantity: 3 }], "10.00", "20.00");
  const expanded = basket(
    [{ price: "33.33", quantity: 1 }, { price: "33.33", quantity: 1 }, { price: "33.33", quantity: 1 }],
    "10.00",
    "20.00",
  );
  assert.deepEqual(single, expanded);
  assert.equal(single.subtotal, "99.99");
});

test("the guest basket derives its totals from the shared order formula", () => {
  // Imported, not reimplemented. If this import goes, the panel has started
  // computing money on its own again.
  assert.match(menuExperience, /import \{ calculateOrderAmounts \} from "@\/lib\/domain\/order-mutations";/);
  assert.match(menuExperience, /calculateOrderAmounts\(\s*lines,/);

  // The three figures the guest reads, and the button they press, all come from
  // that result rather than from the raw subtotal.
  assert.match(menuExperience, /const subtotal = Number\(basket\.subtotal\);/);
  assert.match(menuExperience, /const serviceCharge = Number\(basket\.serviceCharge\);/);
  assert.match(menuExperience, /const basketTotal = Number\(basket\.total\);/);

  // The regression itself: a hard-coded zero fee, and a total that was only the
  // subtotal, must not come back.
  assert.doesNotMatch(menuExperience, /formatPrice\(0\)/);
  assert.equal(
    /sendOrder"\)\} · <MotionValue value=\{formatPrice\(subtotal\)\}/.test(menuExperience),
    false,
    "the send button must quote the total the guest will be charged",
  );

  // Line totals are summed in minor units, never as floats.
  assert.match(menuExperience, /multiplyMoney\(decimalToMinor\(item\.unitPrice\.toFixed\(2\)\), item\.quantity\)/);
  assert.equal(
    /cart\.reduce\(\(sum, item\) => sum \+ item\.unitPrice \* item\.quantity, 0\)/.test(menuExperience),
    false,
    "the basket subtotal must not be re-summed in binary floating point",
  );
});
