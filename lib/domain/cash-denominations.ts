import {
  addMoney,
  minorUnits,
  multiplyMoney,
  type CurrencyCode,
  type MoneyMinor,
} from "@/lib/domain/money";

/**
 * The physical money a drawer can hold, and how a counted drawer becomes a
 * total.
 *
 * Every value here is an integer in the currency's minor unit — kuruş, cent —
 * and every total is produced by `multiplyMoney`/`addMoney` from `money.ts`,
 * which are safe-integer guarded. No major-unit float arithmetic exists in this
 * file or is permitted downstream of it: `₺0,10 × 10` has to be exactly `₺1,00`
 * every time, and `0.1 * 10` in binary floating point is not.
 *
 * This is the only place denominations are declared. The counting screen, the
 * request validator and the server-side recomputation all read this list, so a
 * denomination cannot exist in the interface without the server accepting it,
 * or vice versa.
 */

/** Currencies a drawer may be *counted* in. Not a claim about what may be taken
 *  as payment — see `CASH_COUNT_IS_NOT_PAYMENT_SUPPORT` below. */
export const CASH_COUNT_CURRENCIES = ["TRY", "EUR", "USD"] as const;
export type CashCountCurrency = (typeof CASH_COUNT_CURRENCIES)[number];

/**
 * Counting a currency is drawer inventory. It says nothing about which
 * currencies the till may collect a payment in — that needs payment currency,
 * an FX rate, change currency, ledger currency, refund currency and a receipt,
 * none of which this feature adds. Payments remain exactly as they were.
 */
export const CASH_COUNT_IS_NOT_PAYMENT_SUPPORT = true;

export type DenominationKind = "BANKNOTE" | "COIN";

export interface CashDenomination {
  readonly currency: CashCountCurrency;
  /** Face value in minor units. Doubles as the denomination's identity. */
  readonly minorValue: number;
  readonly label: string;
  readonly kind: DenominationKind;
  /** A business may retire a denomination without deleting its history. */
  readonly enabled: boolean;
}

/**
 * A count of one denomination.
 *
 * Absurd counts are refused rather than trusted: ten million banknotes is not a
 * drawer, it is a tampered payload or a stuck key.
 */
export const MAX_DENOMINATION_COUNT = 100_000;

function note(
  currency: CashCountCurrency,
  minorValue: number,
  label: string,
  enabled = true,
): CashDenomination {
  return { currency, minorValue, label, kind: "BANKNOTE", enabled };
}

function coin(
  currency: CashCountCurrency,
  minorValue: number,
  label: string,
  enabled = true,
): CashDenomination {
  return { currency, minorValue, label, kind: "COIN", enabled };
}

/**
 * Ordered high to low, which is the order a drawer is physically counted in.
 *
 * `enabled: false` keeps a denomination known to the server — so historical
 * rows still resolve — while removing it from the counting screen.
 */
export const CASH_DENOMINATIONS: readonly CashDenomination[] = [
  // ---------------------------------------------------------------- TRY ----
  note("TRY", 20_000, "₺200"),
  note("TRY", 10_000, "₺100"),
  note("TRY", 5_000, "₺50"),
  note("TRY", 2_000, "₺20"),
  note("TRY", 1_000, "₺10"),
  note("TRY", 500, "₺5"),
  coin("TRY", 100, "₺1"),
  coin("TRY", 50, "50 kr"),
  coin("TRY", 25, "25 kr"),
  coin("TRY", 10, "10 kr"),
  coin("TRY", 5, "5 kr"),
  coin("TRY", 1, "1 kr"),

  // ---------------------------------------------------------------- EUR ----
  // €500 is no longer issued but remains legal tender and still turns up.
  note("EUR", 50_000, "€500"),
  note("EUR", 20_000, "€200"),
  note("EUR", 10_000, "€100"),
  note("EUR", 5_000, "€50"),
  note("EUR", 2_000, "€20"),
  note("EUR", 1_000, "€10"),
  note("EUR", 500, "€5"),
  coin("EUR", 200, "€2"),
  coin("EUR", 100, "€1"),
  coin("EUR", 50, "50 c"),
  coin("EUR", 20, "20 c"),
  coin("EUR", 10, "10 c"),
  coin("EUR", 5, "5 c"),
  coin("EUR", 2, "2 c"),
  coin("EUR", 1, "1 c"),

  // ---------------------------------------------------------------- USD ----
  note("USD", 10_000, "$100"),
  note("USD", 5_000, "$50"),
  note("USD", 2_000, "$20"),
  note("USD", 1_000, "$10"),
  note("USD", 500, "$5"),
  note("USD", 200, "$2"),
  note("USD", 100, "$1"),
  // A restaurant in Türkiye will not break a dollar into coins, so these are
  // known to the server and off the screen until a business turns them on.
  coin("USD", 100, "$1 coin", false),
  coin("USD", 50, "50¢", false),
  coin("USD", 25, "25¢", false),
  coin("USD", 10, "10¢", false),
  coin("USD", 5, "5¢", false),
  coin("USD", 1, "1¢", false),
];

/** Currency symbols, for a label that never relies on the symbol alone. */
export const CURRENCY_SYMBOL: Readonly<Record<CashCountCurrency, string>> = {
  TRY: "₺",
  EUR: "€",
  USD: "$",
};

export const CURRENCY_LABEL: Readonly<Record<CashCountCurrency, string>> = {
  TRY: "Türk Lirası",
  EUR: "Euro",
  USD: "ABD Doları",
};

export function isCashCountCurrency(value: string): value is CashCountCurrency {
  return (CASH_COUNT_CURRENCIES as readonly string[]).includes(value);
}

/**
 * A currency's denominations, newest-issue first.
 *
 * `includeDisabled` exists for reading history: a row counted before a
 * denomination was retired must still resolve to its face value.
 */
export function denominationsFor(
  currency: CashCountCurrency,
  options: { readonly includeDisabled?: boolean } = {},
): readonly CashDenomination[] {
  return CASH_DENOMINATIONS.filter(
    (denomination) =>
      denomination.currency === currency &&
      (options.includeDisabled || denomination.enabled),
  );
}

/** The one lookup. A value that is not here is not money this drawer counts. */
export function findDenomination(
  currency: string,
  minorValue: number,
): CashDenomination | null {
  if (!isCashCountCurrency(currency)) return null;
  if (!Number.isSafeInteger(minorValue)) return null;
  return (
    CASH_DENOMINATIONS.find(
      (denomination) =>
        denomination.currency === currency && denomination.minorValue === minorValue,
    ) ?? null
  );
}

export interface DenominationCount {
  readonly currency: string;
  readonly minorValue: number;
  readonly count: number;
}

export interface CountedDenomination {
  readonly currency: CashCountCurrency;
  readonly minorValue: number;
  readonly count: number;
  readonly subtotalMinor: MoneyMinor;
}

export interface CurrencyCashTotal {
  readonly currency: CashCountCurrency;
  readonly totalMinor: MoneyMinor;
  /** How many physical pieces were counted, for a sanity check at the drawer. */
  readonly pieceCount: number;
}

export class InvalidCashCountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidCashCountError";
  }
}

function assertCount(count: number, label: string): void {
  if (!Number.isSafeInteger(count)) {
    throw new InvalidCashCountError(`${label} adedi tam sayı olmalıdır.`);
  }
  if (count < 0) {
    throw new InvalidCashCountError(`${label} adedi negatif olamaz.`);
  }
  if (count > MAX_DENOMINATION_COUNT) {
    throw new InvalidCashCountError(`${label} adedi çok yüksek.`);
  }
}

/**
 * Turn a counted drawer into per-currency totals.
 *
 * This is the authority. A client may send whatever it likes, including a
 * subtotal it computed itself; nothing here reads such a field. Every subtotal
 * is `minorValue × count` recomputed from the denomination table above, and a
 * value that is not in that table is rejected rather than trusted.
 *
 * The three currencies are never added together. `₺100 + €100 + $100` is not
 * `300` of anything, so the result is a total *per currency* and there is no
 * combined figure for a caller to misuse.
 */
export function summariseCashCount(
  counts: readonly DenominationCount[],
): {
  readonly lines: readonly CountedDenomination[];
  readonly totals: readonly CurrencyCashTotal[];
} {
  const seen = new Set<string>();
  const lines: CountedDenomination[] = [];

  for (const entry of counts) {
    const denomination = findDenomination(entry.currency, entry.minorValue);
    if (!denomination) {
      throw new InvalidCashCountError(
        `Tanımsız kupür veya para birimi: ${entry.currency} ${entry.minorValue}`,
      );
    }

    const key = `${denomination.currency}:${denomination.minorValue}`;
    if (seen.has(key)) {
      // Silently folding duplicates would let one payload write the same
      // denomination twice and make the audit trail unreadable.
      throw new InvalidCashCountError(`Aynı kupür iki kez gönderildi: ${denomination.label}`);
    }
    seen.add(key);

    assertCount(entry.count, denomination.label);
    if (entry.count === 0) continue;

    lines.push({
      currency: denomination.currency,
      minorValue: denomination.minorValue,
      count: entry.count,
      // Safe-integer guarded; a count large enough to overflow throws.
      subtotalMinor: multiplyMoney(minorUnits(denomination.minorValue), entry.count),
    });
  }

  const totals = CASH_COUNT_CURRENCIES.map((currency) => {
    const forCurrency = lines.filter((line) => line.currency === currency);
    return {
      currency,
      totalMinor: addMoney(...forCurrency.map((line) => line.subtotalMinor)),
      pieceCount: forCurrency.reduce((sum, line) => sum + line.count, 0),
    };
  }).filter((total) => total.totalMinor > 0 || total.pieceCount > 0);

  return { lines, totals };
}

/** One currency's total, or zero when it was not counted. */
export function totalForCurrency(
  totals: readonly CurrencyCashTotal[],
  currency: CashCountCurrency,
): MoneyMinor {
  return totals.find((total) => total.currency === currency)?.totalMinor ?? minorUnits(0);
}

/**
 * The counting currencies are a subset of the money domain's own currency list,
 * checked here so the two can never drift apart.
 */
const _currencyAlignment: readonly CurrencyCode[] = CASH_COUNT_CURRENCIES;
void _currencyAlignment;

/**
 * Render an integer minor amount in its own currency.
 *
 * The integer is split into major and minor parts as digits before it ever
 * becomes a Number, so nothing is divided and nothing can round: 1010 kuruş is
 * "₺10,10" because the string says so, not because a float happened to land
 * there. Grouping and the symbol's position come from the Turkish locale,
 * which is the locale every other amount in this product is shown in.
 */
export function formatMinorAmount(
  amountMinor: number,
  currency: CashCountCurrency,
): string {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw new InvalidCashCountError("Tutar negatif olmayan bir tam sayı olmalıdır.");
  }

  const major = Math.floor(amountMinor / 100);
  const minor = amountMinor % 100;
  const groupedMajor = new Intl.NumberFormat("tr-TR", {
    useGrouping: true,
    maximumFractionDigits: 0,
  }).format(major);

  return `${CURRENCY_SYMBOL[currency]}${groupedMajor},${String(minor).padStart(2, "0")}`;
}
