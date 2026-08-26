import assert from "node:assert/strict";
import test from "node:test";

import { formatCurrency } from "@/lib/format";

/**
 * The reported bug: a ₺275,50 bill was shown to the cashier as "₺276 tahsil et",
 * printed on the receipt as ₺276, and the 30-day report showed ₺1.176 where the
 * API and the database both said 1175.50. formatCurrency carried
 * maximumFractionDigits: 0, so every operational money surface — till, receipt,
 * report — rounded the kuruş away while the API charged the true amount.
 *
 * Money that is reconciled or handed to a customer keeps its kuruş.
 */

/** Intl uses a narrow no-break space between the symbol and the number. */
const normalise = (value: string) => value.replace(/\s|\u00a0|\u202f/g, "");

test("kuruş survive formatting", () => {
  assert.equal(normalise(formatCurrency(275.5)), "₺275,50");
  assert.equal(normalise(formatCurrency(1175.5)), "₺1.175,50");
  assert.equal(normalise(formatCurrency(64.25)), "₺64,25");
});

test("whole lira still render as money, not as a bare integer", () => {
  assert.equal(normalise(formatCurrency(200)), "₺200,00");
});

test("a formatted total never rounds away from the underlying amount", () => {
  // The exact reconciliation the reports gate asks for: what the screen shows
  // must parse back to what the database holds.
  for (const amount of [375.5, 100, 300, 200, 200]) {
    const shown = normalise(formatCurrency(amount))
      .replace("₺", "")
      .replace(/\./g, "")
      .replace(",", ".");
    assert.equal(Number(shown), amount, `${amount} was displayed as ${shown}`);
  }
});

/**
 * The same defect, customer side: `formatMenuPrice` dropped kuruş for TRY, so a
 * ₺348,40 basket read "₺348" and a ₺75,50 item read "₺76" in the QR menu while
 * the till charged the true amount. A guest must be shown the amount they will
 * actually be asked to pay.
 */
test("the guest menu shows the same kuruş the till charges", async () => {
  const { formatMenuPrice } = await import("@/lib/config/currency");
  const rates = { TRY: 1, USD: 0.024, EUR: 0.022 } as const;

  assert.equal(normalise(formatMenuPrice(75.5, "TRY", "tr", rates)), "₺75,50");
  assert.equal(normalise(formatMenuPrice(348.4, "TRY", "tr", rates)), "₺348,40");
  assert.equal(normalise(formatMenuPrice(100, "TRY", "tr", rates)), "₺100,00");
});

test("a guest price parses back to the amount behind it", () => {
  const parse = (shown: string) =>
    Number(normalise(shown).replace("₺", "").replace(/\./g, "").replace(",", "."));
  for (const amount of [75.5, 348.4, 275.5, 1175.5]) {
    assert.equal(parse(formatCurrency(amount)), amount);
  }
});
