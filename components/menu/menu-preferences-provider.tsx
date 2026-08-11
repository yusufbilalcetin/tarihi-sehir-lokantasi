"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { formatMenuPrice } from "@/lib/config/currency";
import {
  translateMenu,
  type MenuCurrency,
  type MenuLanguage,
  type MenuTranslationKey,
} from "@/lib/i18n/menu-translations";

export const MENU_LANGUAGE_STORAGE_KEY = "tarihi-sehir-language";
export const MENU_CURRENCY_STORAGE_KEY = "tarihi-sehir-currency";

const LANGUAGES: MenuLanguage[] = ["tr", "en", "de", "ar"];
const CURRENCIES: MenuCurrency[] = ["TRY", "USD", "EUR"];

interface MenuPreferencesValue {
  language: MenuLanguage;
  currency: MenuCurrency;
  direction: "ltr" | "rtl";
  setLanguage: (language: MenuLanguage) => void;
  setCurrency: (currency: MenuCurrency) => void;
  t: (
    key: MenuTranslationKey,
    values?: Record<string, string | number>,
  ) => string;
  formatPrice: (priceTRY: number) => string;
}

const MenuPreferencesContext = createContext<MenuPreferencesValue | null>(null);

function isMenuLanguage(value: string | null): value is MenuLanguage {
  return LANGUAGES.includes(value as MenuLanguage);
}

function isMenuCurrency(value: string | null): value is MenuCurrency {
  return CURRENCIES.includes(value as MenuCurrency);
}

export function MenuPreferencesProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<MenuLanguage>("tr");
  const [currency, setCurrencyState] = useState<MenuCurrency>("TRY");

  useEffect(() => {
    const restoreTimer = window.setTimeout(() => {
      try {
        const storedLanguage = window.localStorage.getItem(
          MENU_LANGUAGE_STORAGE_KEY,
        );
        const storedCurrency = window.localStorage.getItem(
          MENU_CURRENCY_STORAGE_KEY,
        );
        if (isMenuLanguage(storedLanguage)) setLanguageState(storedLanguage);
        if (isMenuCurrency(storedCurrency)) setCurrencyState(storedCurrency);
      } catch {
        // Storage may be unavailable in private/restricted browser contexts.
      }
    }, 0);

    return () => window.clearTimeout(restoreTimer);
  }, []);

  const setLanguage = useCallback((nextLanguage: MenuLanguage) => {
    setLanguageState(nextLanguage);
    try {
      window.localStorage.setItem(MENU_LANGUAGE_STORAGE_KEY, nextLanguage);
    } catch {
      // The in-memory preference remains usable when storage is unavailable.
    }
  }, []);

  const setCurrency = useCallback((nextCurrency: MenuCurrency) => {
    setCurrencyState(nextCurrency);
    try {
      window.localStorage.setItem(MENU_CURRENCY_STORAGE_KEY, nextCurrency);
    } catch {
      // The in-memory preference remains usable when storage is unavailable.
    }
  }, []);

  const t = useCallback(
    (key: MenuTranslationKey, values?: Record<string, string | number>) =>
      translateMenu(language, key, values),
    [language],
  );
  const formatPrice = useCallback(
    (priceTRY: number) => formatMenuPrice(priceTRY, currency, language),
    [currency, language],
  );

  const value = useMemo<MenuPreferencesValue>(
    () => ({
      language,
      currency,
      direction: language === "ar" ? "rtl" : "ltr",
      setLanguage,
      setCurrency,
      t,
      formatPrice,
    }),
    [currency, formatPrice, language, setCurrency, setLanguage, t],
  );

  return (
    <MenuPreferencesContext.Provider value={value}>
      {children}
    </MenuPreferencesContext.Provider>
  );
}

export function useMenuPreferences() {
  const context = useContext(MenuPreferencesContext);
  if (!context) {
    throw new Error(
      "useMenuPreferences must be used inside MenuPreferencesProvider.",
    );
  }
  return context;
}
