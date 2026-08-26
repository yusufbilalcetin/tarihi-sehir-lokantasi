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

/**
 * Guest-facing prices: menu cards, the cart, the subtotal and the order total.
 *
 * Kuruş are shown for TRY as well as for the converted currencies. They used to
 * be dropped, which looked tidy on a menu card of round prices but rounded the
 * guest's own cart: a ₺348,40 basket read "₺348" and a ₺75,50 item read "₺76",
 * while the till and the receipt charged the true amount. What the guest agrees
 * to has to be what they are asked to pay.
 */
export function formatMenuPrice(
  priceTRY: number,
  currency: MenuCurrency,
  language: MenuLanguage,
  rates: MenuExchangeRates = FALLBACK_EXCHANGE_RATES,
) {
  return new Intl.NumberFormat(getMenuLanguage(language)?.locale ?? "tr-TR", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(priceTRY * rates[currency]);
}
