import type { MenuCurrency, MenuLanguage } from "@/lib/i18n/menu-translations";
import { getMenuLanguage } from "@/lib/i18n/languages";

export type MenuExchangeRates = Record<MenuCurrency, number>;

export interface ExchangeRateSnapshot {
  rates: MenuExchangeRates;
  updatedAt: string;
  sourceUpdatedAt?: string;
  stale?: boolean;
}

export const FALLBACK_EXCHANGE_RATES: MenuExchangeRates = {
  TRY: 1,
  USD: 0.024,
  EUR: 0.022,
};

export function isMenuExchangeRates(value: unknown): value is MenuExchangeRates {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Record<MenuCurrency, unknown>>;
  return candidate.TRY === 1
    && typeof candidate.USD === "number"
    && Number.isFinite(candidate.USD)
    && candidate.USD > 0
    && typeof candidate.EUR === "number"
    && Number.isFinite(candidate.EUR)
    && candidate.EUR > 0;
}

export function isExchangeRateSnapshot(value: unknown): value is ExchangeRateSnapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ExchangeRateSnapshot>;
  return isMenuExchangeRates(candidate.rates)
    && typeof candidate.updatedAt === "string"
    && Number.isFinite(Date.parse(candidate.updatedAt));
}

export function formatMenuPrice(
  priceTRY: number,
  currency: MenuCurrency,
  language: MenuLanguage,
  rates: MenuExchangeRates = FALLBACK_EXCHANGE_RATES,
) {
  return new Intl.NumberFormat(getMenuLanguage(language)?.locale ?? "tr-TR", {
    style: "currency",
    currency,
    minimumFractionDigits: currency === "TRY" ? 0 : 2,
    maximumFractionDigits: currency === "TRY" ? 0 : 2,
  }).format(priceTRY * rates[currency]);
}
