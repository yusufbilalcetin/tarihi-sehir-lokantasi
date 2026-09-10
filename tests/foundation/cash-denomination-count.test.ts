import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CASH_COUNT_CURRENCIES,
  CASH_DENOMINATIONS,
  InvalidCashCountError,
  MAX_DENOMINATION_COUNT,
  denominationsFor,
  findDenomination,
  isCashCountCurrency,
  summariseCashCount,
  totalForCurrency,
  type DenominationCount,
} from "@/lib/domain/cash-denominations";
import { minorToDecimal } from "@/lib/domain/money";

/**
 * A drawer count is a financial record, so these tests are about exactness
 * rather than shape: every total is asserted to the kuruş/cent, and the
 * currencies are asserted never to be added together.
 */

function count(currency: string, minorValue: number, n: number): DenominationCount {
  return { currency, minorValue, count: n };
}

/* ------------------------------------------------------------- exactness -- */

test("the worked TRY drawer from the brief totals to the kuruş", () => {
  // ₺200×4 + ₺100×3 + ₺50×5 + ₺20×6 + ₺10×4 + ₺5×10
  // + ₺1×20 + 50kr×12 + 25kr×16 + 10kr×20 + 5kr×10 + 1kr×25
  const drawer = [
    count("TRY", 20_000, 4),
    count("TRY", 10_000, 3),
    count("TRY", 5_000, 5),
    count("TRY", 2_000, 6),
    count("TRY", 1_000, 4),
    count("TRY", 500, 10),
    count("TRY", 100, 20),
    count("TRY", 50, 12),
    count("TRY", 25, 16),
    count("TRY", 10, 20),
    count("TRY", 5, 10),
    count("TRY", 1, 25),
  ];

  //   notes 80000+30000+25000+12000+4000+5000 = 156000 kuruş
  //   coins  2000+600+400+200+50+25            =   3275 kuruş
  // The brief states ₺1.588,75, which drops the 25 kr × 16 = ₺4 line; the
  // arithmetic total is ₺1.592,75 and the code is asserted against that.
  const { totals } = summariseCashCount(drawer);
  const tryTotal = totalForCurrency(totals, "TRY");
  assert.equal(tryTotal, 159_275, "the drawer did not total 1.592,75 in kuruş");
  assert.equal(minorToDecimal(tryTotal), "1592.75");
  assert.equal(totals.find((t) => t.currency === "TRY")?.pieceCount, 135);
});

test("minor-unit arithmetic has no floating-point drift", () => {
  // Each of these is a float trap: 0.1*10, 0.01*100, 0.25*4.
  const cases: readonly [string, number, number, string][] = [
    ["TRY", 10, 10, "1.00"],
    ["TRY", 1, 25, "0.25"],
    ["TRY", 5, 10, "0.50"],
    ["EUR", 1, 100, "1.00"],
    ["EUR", 2, 99, "1.98"],
    ["EUR", 5_000, 3, "150.00"],
    ["USD", 10, 10, "1.00"],
    ["USD", 25, 4, "1.00"],
    ["USD", 10_000, 2, "200.00"],
  ];

  for (const [currency, minorValue, n, expected] of cases) {
    const { totals } = summariseCashCount([count(currency, minorValue, n)]);
    const total = totalForCurrency(totals, currency as "TRY" | "EUR" | "USD");
    assert.equal(
      minorToDecimal(total),
      expected,
      `${currency} ${minorValue}×${n} drifted`,
    );
    assert.ok(Number.isSafeInteger(total), "a total left the safe-integer range");
  }
});

test("the three currencies are totalled apart and never summed together", () => {
  const { totals } = summariseCashCount([
    count("TRY", 10_000, 1),
    count("EUR", 10_000, 1),
    count("USD", 10_000, 1),
  ]);

  assert.equal(totals.length, 3);
  assert.equal(minorToDecimal(totalForCurrency(totals, "TRY")), "100.00");
  assert.equal(minorToDecimal(totalForCurrency(totals, "EUR")), "100.00");
  assert.equal(minorToDecimal(totalForCurrency(totals, "USD")), "100.00");
  // There is deliberately no combined figure to reach for.
  assert.ok(
    !("total" in (totals as unknown as Record<string, unknown>)),
    "a cross-currency total appeared",
  );
});

test("an uncounted currency contributes nothing and is not invented", () => {
  const { totals, lines } = summariseCashCount([count("TRY", 500, 2)]);
  assert.equal(totals.length, 1, "an uncounted currency was reported anyway");
  assert.equal(totalForCurrency(totals, "EUR"), 0);
  assert.equal(totalForCurrency(totals, "USD"), 0);
  // Zero counts are dropped rather than stored as empty financial rows.
  assert.equal(lines.length, 1);
  assert.deepEqual(summariseCashCount([count("TRY", 500, 0)]).lines, []);
  // An entirely empty drawer is legitimate.
  assert.deepEqual(summariseCashCount([]).totals, []);
});

/* ------------------------------------------------------------ validation -- */

test("a tampered payload cannot invent money", () => {
  const bad: readonly [string, DenominationCount[]][] = [
    ["unknown denomination", [count("TRY", 12_345, 1)]],
    ["unknown currency", [count("GBP", 10_000, 1)]],
    ["crypto currency", [count("BTC", 100, 1)]],
    ["lowercase currency", [count("try", 100, 1)]],
    ["legacy alias", [count("TL", 100, 1)]],
    ["negative count", [count("TRY", 100, -1)]],
    ["fractional count", [count("TRY", 100, 1.5)]],
    ["NaN count", [count("TRY", 100, Number.NaN)]],
    ["infinite count", [count("TRY", 100, Number.POSITIVE_INFINITY)]],
    ["absurd count", [count("TRY", 100, MAX_DENOMINATION_COUNT + 1)]],
    ["duplicate denomination", [count("TRY", 100, 1), count("TRY", 100, 2)]],
    ["fractional denomination", [count("TRY", 100.5, 1)]],
  ];

  for (const [name, payload] of bad) {
    assert.throws(
      () => summariseCashCount(payload),
      InvalidCashCountError,
      `${name} was accepted`,
    );
  }
});

test("a client-claimed subtotal is ignored entirely", () => {
  // The shape a tampering client would send: a real denomination, a real
  // count, and a subtotal it would like the server to believe.
  const payload = [
    { currency: "TRY", minorValue: 20_000, count: 5, subtotalMinor: 1, total: 1 },
  ] as unknown as DenominationCount[];

  const { lines, totals } = summariseCashCount(payload);
  assert.equal(lines[0].subtotalMinor, 100_000, "the client's subtotal was believed");
  assert.equal(minorToDecimal(totalForCurrency(totals, "TRY")), "1000.00");
});

test("the count ceiling is enforced at its exact boundary", () => {
  assert.doesNotThrow(() => summariseCashCount([count("TRY", 1, MAX_DENOMINATION_COUNT)]));
  assert.throws(() => summariseCashCount([count("TRY", 1, MAX_DENOMINATION_COUNT + 1)]));
});

/* ----------------------------------------------------------- the catalog -- */

test("every declared denomination is a whole number of minor units", () => {
  for (const denomination of CASH_DENOMINATIONS) {
    assert.ok(
      Number.isSafeInteger(denomination.minorValue) && denomination.minorValue > 0,
      `${denomination.label} is not a positive integer minor value`,
    );
    assert.ok(denomination.label.trim().length > 0, "a denomination has no label");
    assert.ok(isCashCountCurrency(denomination.currency));
  }
});

test("no currency declares the same face value twice", () => {
  for (const currency of CASH_COUNT_CURRENCIES) {
    const values = denominationsFor(currency, { includeDisabled: true }).map(
      (d) => `${d.kind}:${d.minorValue}`,
    );
    assert.equal(new Set(values).size, values.length, `${currency} has a duplicate`);
  }
});

test("each currency carries the notes and coins the brief asked for", () => {
  const faces = (currency: "TRY" | "EUR" | "USD") =>
    denominationsFor(currency, { includeDisabled: true }).map((d) => d.minorValue);

  assert.deepEqual(
    faces("TRY"),
    [20_000, 10_000, 5_000, 2_000, 1_000, 500, 100, 50, 25, 10, 5, 1],
  );
  assert.deepEqual(
    faces("EUR"),
    [50_000, 20_000, 10_000, 5_000, 2_000, 1_000, 500, 200, 100, 50, 20, 10, 5, 2, 1],
  );
  assert.deepEqual(
    faces("USD"),
    [10_000, 5_000, 2_000, 1_000, 500, 200, 100, 100, 50, 25, 10, 5, 1],
  );
  // Ordered high to low, the way a drawer is actually counted.
  for (const currency of CASH_COUNT_CURRENCIES) {
    const notes = denominationsFor(currency, { includeDisabled: true })
      .filter((d) => d.kind === "BANKNOTE")
      .map((d) => d.minorValue);
    assert.deepEqual([...notes].sort((a, b) => b - a), notes, `${currency} notes are out of order`);
  }
});

test("a retired denomination stays resolvable but leaves the screen", () => {
  // USD coins are off by default for a restaurant in Türkiye.
  const dollarCoin = findDenomination("USD", 25);
  assert.ok(dollarCoin, "a historical denomination stopped resolving");
  assert.equal(dollarCoin.enabled, false);
  assert.ok(
    !denominationsFor("USD").some((d) => d.minorValue === 25),
    "a disabled denomination is still offered for counting",
  );
  // But a row counted before it was retired still totals correctly.
  const { totals } = summariseCashCount([count("USD", 25, 4)]);
  assert.equal(minorToDecimal(totalForCurrency(totals, "USD")), "1.00");
});

test("counting a currency is not a claim that it can be taken as payment", () => {
  // Guards the boundary the brief drew: drawer inventory is not payment support.
  const source = readFileSync(
    new URL("../../lib/domain/cash-denominations.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /CASH_COUNT_IS_NOT_PAYMENT_SUPPORT/);
  assert.doesNotMatch(source, /paymentApi|collectPayment|PaymentMethod/);
});
