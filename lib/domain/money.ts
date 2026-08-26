declare const moneyMinorBrand: unique symbol;

/**
 * An exact monetary value in the currency's minor unit (kuruş for TRY).
 * Runtime values are safe integers; floating-point major-unit arithmetic is forbidden.
 */
export type MoneyMinor = number & { readonly [moneyMinorBrand]: "MoneyMinor" };

export interface MoneyValue {
  readonly currency: CurrencyCode;
  readonly amountMinor: MoneyMinor;
}

export const CURRENCY_CODES = ["TRY", "USD", "EUR"] as const;
export type CurrencyCode = (typeof CURRENCY_CODES)[number];

export const DEFAULT_MONEY_SCALE = 2;
const MAX_SCALE = 6;

export class InvalidMoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidMoneyError";
  }
}

function assertScale(scale: number): void {
  if (!Number.isInteger(scale) || scale < 0 || scale > MAX_SCALE) {
    throw new InvalidMoneyError(`Money scale must be an integer between 0 and ${MAX_SCALE}.`);
  }
}

export function minorUnits(value: number): MoneyMinor {
  if (!Number.isSafeInteger(value)) {
    throw new InvalidMoneyError("Minor-unit money must be a safe integer.");
  }

  return value as MoneyMinor;
}

export function nonNegativeMinorUnits(value: number): MoneyMinor {
  const amount = minorUnits(value);
  if (amount < 0) {
    throw new InvalidMoneyError("Money amount cannot be negative.");
  }

  return amount;
}

export function decimalToMinor(
  decimal: string,
  options: { readonly scale?: number; readonly allowNegative?: boolean } = {},
): MoneyMinor {
  const scale = options.scale ?? DEFAULT_MONEY_SCALE;
  assertScale(scale);

  const normalized = decimal.trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(normalized);
  if (!match) {
    throw new InvalidMoneyError("Money must be a plain decimal string.");
  }

  const [, sign, integerDigits, fractionDigits = ""] = match;
  if (sign === "-" && !options.allowNegative) {
    throw new InvalidMoneyError("Money amount cannot be negative.");
  }
  if (fractionDigits.length > scale) {
    throw new InvalidMoneyError(`Money supports at most ${scale} decimal places.`);
  }

  const factor = BigInt(10) ** BigInt(scale);
  const paddedFraction = fractionDigits.padEnd(scale, "0");
  const absoluteMinor = BigInt(integerDigits) * factor + BigInt(paddedFraction || "0");
  const signedMinor = sign === "-" ? -absoluteMinor : absoluteMinor;

  if (
    signedMinor > BigInt(Number.MAX_SAFE_INTEGER) ||
    signedMinor < BigInt(Number.MIN_SAFE_INTEGER)
  ) {
    throw new InvalidMoneyError("Money amount exceeds the safe minor-unit range.");
  }

  return minorUnits(Number(signedMinor));
}

export function minorToDecimal(
  amountMinor: MoneyMinor | number,
  scale: number = DEFAULT_MONEY_SCALE,
): string {
  assertScale(scale);
  const amount = minorUnits(amountMinor);
  const negative = amount < 0;
  const absolute = BigInt(Math.abs(amount));
  const factor = BigInt(10) ** BigInt(scale);
  const integerPart = absolute / factor;
  const fractionPart = absolute % factor;
  const sign = negative ? "-" : "";

  if (scale === 0) return `${sign}${integerPart}`;
  return `${sign}${integerPart}.${fractionPart.toString().padStart(scale, "0")}`;
}

export function addMoney(...amounts: readonly (MoneyMinor | number)[]): MoneyMinor {
  return amounts.reduce<MoneyMinor>(
    (total, amount) => minorUnits(total + minorUnits(amount)),
    minorUnits(0),
  );
}

export function subtractMoney(
  minuend: MoneyMinor | number,
  subtrahend: MoneyMinor | number,
): MoneyMinor {
  return minorUnits(minorUnits(minuend) - minorUnits(subtrahend));
}

export function multiplyMoney(
  amountMinor: MoneyMinor | number,
  quantity: number,
): MoneyMinor {
  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    throw new InvalidMoneyError("Money quantity must be a non-negative safe integer.");
  }

  return minorUnits(minorUnits(amountMinor) * quantity);
}

/**
 * Converts a percentage decimal (for example `12.50`) to integer basis points.
 * This mirrors the database percentage scale without binary floating-point math.
 */
export function percentageToBasisPoints(percentage: string): number {
  const normalized = percentage.trim();
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) {
    throw new InvalidMoneyError("Percentage must be a plain decimal with at most two places.");
  }

  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  const basisPoints = whole * 100 + fraction;
  if (basisPoints > 10_000) {
    throw new InvalidMoneyError("Percentage must be between 0 and 100.");
  }
  return basisPoints;
}

/** Applies basis points and rounds half-up to the nearest minor unit. */
export function applyBasisPoints(
  amountMinor: MoneyMinor | number,
  basisPoints: number,
): MoneyMinor {
  const amount = nonNegativeMinorUnits(amountMinor);
  if (!Number.isSafeInteger(basisPoints) || basisPoints < 0 || basisPoints > 10_000) {
    throw new InvalidMoneyError("Basis points must be an integer between 0 and 10000.");
  }

  const rounded = (BigInt(amount) * BigInt(basisPoints) + BigInt(5_000)) / BigInt(10_000);
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new InvalidMoneyError("Calculated money amount exceeds the safe minor-unit range.");
  }
  return minorUnits(Number(rounded));
}

export function money(currency: CurrencyCode, amountMinor: number): MoneyValue {
  return { currency, amountMinor: minorUnits(amountMinor) };
}
