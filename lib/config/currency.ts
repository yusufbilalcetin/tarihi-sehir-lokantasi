import type { MenuCurrency, MenuLanguage } from "@/lib/i18n/menu-translations";

export const MOCK_EXCHANGE_RATES: Record<MenuCurrency, number> = {
  TRY: 1,
  USD: 0.024,
  EUR: 0.022,
};

const MENU_LOCALES: Record<MenuLanguage, string> = {
  tr: "tr-TR",
  en: "en-US",
  de: "de-DE",
  ar: "ar",
};

export function formatMenuPrice(
  priceTRY: number,
  currency: MenuCurrency,
  language: MenuLanguage,
) {
  return new Intl.NumberFormat(MENU_LOCALES[language], {
    style: "currency",
    currency,
    minimumFractionDigits: currency === "TRY" ? 0 : 2,
    maximumFractionDigits: currency === "TRY" ? 0 : 2,
  }).format(priceTRY * MOCK_EXCHANGE_RATES[currency]);
}
