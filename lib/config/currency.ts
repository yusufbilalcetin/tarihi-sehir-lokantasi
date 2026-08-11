import type { MenuCurrency, MenuLanguage } from "@/lib/i18n/menu-translations";
import { getMenuLanguage } from "@/lib/i18n/languages";

export const MOCK_EXCHANGE_RATES: Record<MenuCurrency, number> = {
  TRY: 1,
  USD: 0.024,
  EUR: 0.022,
};

export function formatMenuPrice(
  priceTRY: number,
  currency: MenuCurrency,
  language: MenuLanguage,
) {
  return new Intl.NumberFormat(getMenuLanguage(language)?.locale ?? "tr-TR", {
    style: "currency",
    currency,
    minimumFractionDigits: currency === "TRY" ? 0 : 2,
    maximumFractionDigits: currency === "TRY" ? 0 : 2,
  }).format(priceTRY * MOCK_EXCHANGE_RATES[currency]);
}
