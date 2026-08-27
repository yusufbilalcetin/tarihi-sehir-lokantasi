import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { addMoney, decimalToMinor, minorToDecimal } from "../../lib/domain/money";

/**
 * The reported bug: a guest ordered soup, then later ordered a kebab, and the
 * soup vanished from their screen. The API was never at fault — it returns
 * every unsettled order at the table — but the client reduced that array to a
 * single `trackedOrder` and rendered only that one.
 *
 * A visit is now the unit: every order this browser placed stays listed,
 * newest first, with the quantities and the money summed across them.
 */

function read(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

const menuExperience = read("components/menu/menu-experience.tsx");
const disclosure = read("components/menu/order-details-disclosure.tsx");
const sessionOrders = read("components/menu/session-orders.ts");

/* ------------------------------------------------ the arithmetic itself ---- */

type Line = { quantity: number; status: string };

/** The rule the screen uses: quantities, and a struck-off line counts zero. */
function itemCount(orders: readonly { items: readonly Line[] }[]): number {
  return orders.reduce(
    (sum, order) =>
      sum +
      order.items
        .filter((item) => item.status !== "CANCELLED" && item.status !== "VOIDED")
        .reduce((lineSum, item) => lineSum + item.quantity, 0),
    0,
  );
}

const line = (quantity: number, status = "PENDING"): Line => ({ quantity, status });

test("one order counts its own quantities", () => {
  assert.equal(itemCount([{ items: [line(1)] }]), 1);
});

test("the reported case: one item then five totals six, not two orders of lines", () => {
  const orderA = { items: [line(1)] };
  const orderB = { items: [line(2), line(2), line(1)] };
  assert.equal(itemCount([orderB, orderA]), 6);
  // The trap this exists for: counting rows instead of quantities gives 4.
  assert.notEqual(itemCount([orderB, orderA]), 4);
});

test("quantities, never line counts", () => {
  // 1 soup + 5 ayran is six items on two lines.
  assert.equal(itemCount([{ items: [line(1), line(5)] }]), 6);
});

test("a third order keeps adding", () => {
  const orders = [{ items: [line(2)] }, { items: [line(2), line(2), line(1)] }, { items: [line(1)] }];
  assert.equal(orders.length, 3);
  assert.equal(itemCount(orders), 8);
});

test("a cancelled line is not something the guest ordered", () => {
  assert.equal(itemCount([{ items: [line(2), line(3, "CANCELLED"), line(1, "VOIDED")] }]), 2);
});

test("the visit total is summed in minor units, not floating point", () => {
  const total = (...decimals: string[]) =>
    minorToDecimal(addMoney(...decimals.map((value) => decimalToMinor(value))));

  assert.equal(total("90.00", "765.00"), "855.00");
  // The case plain arithmetic gets wrong: 0.1 + 0.2 is not 0.3 in a float.
  assert.equal(total("0.10", "0.20"), "0.30");
  assert.equal(total("275.50", "275.50", "0.01"), "551.01");
  assert.equal(total(), "0.00");
});

/* -------------------------------------------------- the wiring that uses it */

test("the screen keeps every order of the visit, not just the newest", () => {
  // The regression in one line: `orders[0]` was the whole history.
  assert.doesNotMatch(
    menuExperience,
    /const trackedOrder = useMemo\(\(\) => \{\s*const orders = activeOrders/,
    "the tracked order is being read straight off the raw table list again",
  );
  assert.match(menuExperience, /const sessionOrders = useMemo/);
  assert.match(menuExperience, /<OrderDetailsDisclosure orders=\{sessionOrders\}/);
  // Both tracking cards show the visit, not one order.
  assert.equal((menuExperience.match(/<OrderDetailsDisclosure orders=\{sessionOrders\}/g) ?? []).length, 2);
});

test("newest first, on the server's clock", () => {
  assert.match(menuExperience, /right\.createdAt\.localeCompare\(left\.createdAt\)/);
  assert.doesNotMatch(menuExperience, /Date\.now\(\)[^)]*sort|sort[^;]*Date\.now\(\)/);
});

test("the newest order still drives the status timeline", () => {
  assert.match(menuExperience, /return sessionOrders\[0\] \?\? null/);
  assert.match(menuExperience, /<OrderStatusTimeline/);
});

test("the headline total is the visit's, summed with the money helpers", () => {
  assert.match(menuExperience, /addMoney\(\s*\.\.\.sessionOrders\.map\(\(order\) => decimalToMinor\(order\.amounts\.total\)\)/s);
  // Each order's own authoritative total — never rebuilt from the rows on
  // screen, so discounts, service charge and tax stay as the server had them.
  // Scoped to the summary: the cart's own draft subtotal above it is a
  // different, pre-submission number and legitimately multiplies.
  const summary = menuExperience.slice(
    menuExperience.indexOf("const sessionSummary = useMemo"),
    menuExperience.indexOf("}, [sessionOrders]);"),
  );
  assert.ok(summary.length > 0, "the session summary block moved");
  assert.doesNotMatch(summary, /unitPrice|lineTotal/, "the visit total was rebuilt from rows");
  assert.match(menuExperience, /const sessionTotal = sessionSummary\.total/);
});

test("an order is remembered only when the server confirms it", () => {
  assert.match(menuExperience, /rememberSessionOrder\(result\.orderId\)/);
  // One writer, on the success path.
  assert.equal((menuExperience.match(/rememberSessionOrder\(/g) ?? []).length, 1);
});

test("the visit list cannot contain an order this browser never placed", () => {
  // The intersection is the point: the endpoint still answers table-wide.
  assert.match(menuExperience, /const mine = new Set\(sessionOrderIds\)/);
  assert.match(menuExperience, /\.filter\(\(order\) => mine\.has\(order\.id\)\)/);
});

test("remembering an order is idempotent, so a refetch cannot duplicate it", () => {
  assert.match(sessionOrders, /if \(current\.includes\(orderId\)\) return;/);
});

test("the remembered list never breaks the server render", () => {
  // A store read during the first render would diverge from the server's HTML.
  assert.match(sessionOrders, /useSyncExternalStore\(subscribe, getSnapshot, getServerSnapshot\)/);
  assert.match(sessionOrders, /function getServerSnapshot\(\): readonly string\[\] \{\s*return EMPTY;/);
  // Storage can throw outright in private modes; it must never take the menu down.
  assert.match(sessionOrders, /catch \{/);
});

/* ----------------------------------------------------------- presentation - */

test("each order is identified the way a guest thinks about it", () => {
  // "ORD-002494" is an operational reference. A guest at a table is asking
  // which of their own orders this is, and the answer is "the second one".
  assert.match(disclosure, /t\("orderSequence", \{ number: order\.sequence \}\)/);
  assert.ok(!disclosure.includes("order.orderNumber"), "the technical reference is rendered again");
  assert.doesNotMatch(disclosure, /#\{order\./, "a raw reference is rendered");
  assert.doesNotMatch(disclosure, />\{order\.id\}</, "a raw order id is rendered");
  // Identity and label stay separate things.
  assert.match(disclosure, /key=\{order\.id\}/, "the id is for React, and only React");
  // Assistive technology gets the same words, not the reference that was removed.
  assert.match(disclosure, /aria-label=\{t\("orderSequence"/);
});

test("the visit ordinal counts submissions, not rows on screen", () => {
  // The trap: numbering by position in the displayed array. Settle the first
  // order and it leaves the active list, so every later order would shift down
  // a number — the guest's third order would start calling itself the second.
  assert.match(menuExperience, /sequence: sessionOrderIds\.indexOf\(order\.id\) \+ 1/);
  assert.doesNotMatch(menuExperience, /sequence: index \+ 1|sequence: .*length - /);
});

test("an ordinal survives an earlier order leaving the list", () => {
  // The browser's record is append-only, so position in it is fixed at
  // submission time regardless of what the server still returns.
  const submitted = ["order-a", "order-b", "order-c"];
  const sequenceOf = (id: string) => submitted.indexOf(id) + 1;
  assert.deepEqual(submitted.map(sequenceOf), [1, 2, 3]);

  // Order A is settled and drops out of the active set. B and C keep theirs.
  const stillActive = ["order-b", "order-c"];
  assert.deepEqual(stillActive.map(sequenceOf), [2, 3]);

  // A fourth order continues the count rather than reusing a freed number.
  const withFourth = [...submitted, "order-d"];
  assert.equal(withFourth.indexOf("order-d") + 1, 4);
});

test("the guest is not asked to read an operational reference to track their food", () => {
  // The old copy was "#ORD-002494 numaralı siparişinizi buradan takip…".
  assert.match(menuExperience, /t\("orderTrackingStatus"\)/);
  assert.ok(
    !menuExperience.includes('t("orderTracking", { number:'),
    "the tracking sentence still quotes an order reference",
  );
});

test("per-order status is the customer wording, never the enum", () => {
  assert.match(disclosure, /STATUS_LABEL_KEY/);
  assert.match(disclosure, /NEW: "orderReceived"/);
  assert.match(disclosure, /SERVED: "served"/);
  for (const raw of [">PREPARING<", ">READY<", ">SERVED<", ">NEW<", ">CONFIRMED<"]) {
    assert.ok(!disclosure.includes(raw), `raw status ${raw} rendered`);
  }
});

test("the order count only appears when there is more than one", () => {
  // Counters here are not plural-aware, so "1 orders" must never be possible.
  assert.match(disclosure, /sections\.length > 1 \? `\$\{t\("orderCount"/);
});

test("the summary copy comes from the catalogue", () => {
  for (const key of ["orderSummary", "orderCount", "itemCount", "note"]) {
    assert.ok(disclosure.includes(`t("${key}"`), `${key} is not read from the catalogue`);
  }
});

test("opening the history is one region, not one animation per order", () => {
  assert.equal((disclosure.match(/motion-disclosure/g) ?? []).length, 1);
  assert.doesNotMatch(disclosure, /motion-delay|animationDelay|stagger/);
});
