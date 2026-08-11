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
import {
  DEFAULT_MENU_LANGUAGE,
  getMenuLanguage,
  isMenuLanguage,
  matchBrowserLanguage,
  type MenuLanguageDefinition,
} from "@/lib/i18n/languages";
import { loadMenuCatalog } from "@/lib/i18n/menu-catalog";

export const MENU_LANGUAGE_STORAGE_KEY = "tarihi-sehir-language";
export const MENU_RECENT_LANGUAGES_STORAGE_KEY = "tarihi-sehir-recent-languages";
export const MENU_CURRENCY_STORAGE_KEY = "tarihi-sehir-currency";

const CURRENCIES: MenuCurrency[] = ["TRY", "USD", "EUR"];

interface MenuPreferencesValue {
  language: MenuLanguage;
  languageDefinition: MenuLanguageDefinition;
  recentLanguages: MenuLanguage[];
  currency: MenuCurrency;
  direction: "ltr" | "rtl";
  preferencesReady: boolean;
  languageLoading: boolean;
  setLanguage: (language: MenuLanguage) => Promise<boolean>;
  setCurrency: (currency: MenuCurrency) => void;
  t: (
    key: MenuTranslationKey,
    values?: Record<string, string | number>,
  ) => string;
  formatNumber: (value: number) => string;
  formatPrice: (priceTRY: number) => string;
}

const MenuPreferencesContext = createContext<MenuPreferencesValue | null>(null);

function isMenuCurrency(value: string | null): value is MenuCurrency {
  return CURRENCIES.includes(value as MenuCurrency);
}

export function MenuPreferencesProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<MenuLanguage>(DEFAULT_MENU_LANGUAGE);
  const [languageLoading, setLanguageLoading] = useState(false);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [recentLanguages, setRecentLanguages] = useState<MenuLanguage[]>([]);
  const [currency, setCurrencyState] = useState<MenuCurrency>("TRY");

  useEffect(() => {
    const previousLanguage = document.documentElement.lang;
    const previousDirection = document.documentElement.dir;
    return () => {
      document.documentElement.lang = previousLanguage;
      document.documentElement.dir = previousDirection;
    };
  }, []);

  useEffect(() => {
    const restoreTimer = window.setTimeout(async () => {
      try {
        const storedLanguage = window.localStorage.getItem(
          MENU_LANGUAGE_STORAGE_KEY,
        );
        const storedCurrency = window.localStorage.getItem(
          MENU_CURRENCY_STORAGE_KEY,
        );
        const storedRecentLanguages = window.localStorage.getItem(
          MENU_RECENT_LANGUAGES_STORAGE_KEY,
        );
        const hasStoredLanguage = isMenuLanguage(storedLanguage);
        const initialLanguage = hasStoredLanguage
          ? storedLanguage
          : matchBrowserLanguage(
            navigator.languages?.length ? navigator.languages : [navigator.language],
          );
        await loadMenuCatalog(initialLanguage);
        setLanguageState(initialLanguage);
        const definition = getMenuLanguage(initialLanguage);
        if (definition) {
          document.documentElement.lang = definition.locale;
          document.documentElement.dir = definition.direction;
        }
        if (!hasStoredLanguage) window.localStorage.setItem(MENU_LANGUAGE_STORAGE_KEY, initialLanguage);
        if (storedRecentLanguages) {
          try {
            const parsed: unknown = JSON.parse(storedRecentLanguages);
            if (Array.isArray(parsed)) {
              setRecentLanguages(parsed.filter((item): item is MenuLanguage => typeof item === "string" && isMenuLanguage(item)).slice(0, 3));
            }
          } catch {
            window.localStorage.removeItem(MENU_RECENT_LANGUAGES_STORAGE_KEY);
          }
        }
        if (isMenuCurrency(storedCurrency)) setCurrencyState(storedCurrency);
      } catch {
        // Storage may be unavailable in private/restricted browser contexts.
      } finally {
        setPreferencesReady(true);
      }
    }, 0);

    return () => window.clearTimeout(restoreTimer);
  }, []);

  const setLanguage = useCallback(async (nextLanguage: MenuLanguage) => {
    if (!isMenuLanguage(nextLanguage)) return false;
    setLanguageLoading(true);
    try {
      await loadMenuCatalog(nextLanguage);
    } catch {
      setLanguageLoading(false);
      return false;
    }
    const definition = getMenuLanguage(nextLanguage);
    if (definition) {
      document.documentElement.lang = definition.locale;
      document.documentElement.dir = definition.direction;
    }
    setLanguageState(nextLanguage);
    setRecentLanguages((currentLanguages) => {
      const nextRecentLanguages = [nextLanguage, ...currentLanguages.filter((item) => item !== nextLanguage)].slice(0, 3);
      try {
        window.localStorage.setItem(MENU_RECENT_LANGUAGES_STORAGE_KEY, JSON.stringify(nextRecentLanguages));
      } catch {
        // The in-memory recent list remains usable when storage is unavailable.
      }
      return nextRecentLanguages;
    });
    try {
      window.localStorage.setItem(MENU_LANGUAGE_STORAGE_KEY, nextLanguage);
    } catch {
      // The in-memory preference remains usable when storage is unavailable.
    }
    setLanguageLoading(false);
    return true;
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
    (key: MenuTranslationKey, values?: Record<string, string | number>) => {
      const locale = getMenuLanguage(language)?.locale ?? "tr-TR";
      const localizedValues = values
        ? Object.fromEntries(Object.entries(values).map(([name, value]) => [
          name,
          typeof value === "number" ? new Intl.NumberFormat(locale).format(value) : value,
        ]))
        : undefined;
      return translateMenu(language, key, localizedValues);
    },
    [language],
  );
  const formatPrice = useCallback(
    (priceTRY: number) => formatMenuPrice(priceTRY, currency, language),
    [currency, language],
  );
  const formatNumber = useCallback(
    (value: number) => new Intl.NumberFormat(getMenuLanguage(language)?.locale ?? "tr-TR").format(value),
    [language],
  );

  useEffect(() => {
    document.title = `${t("menu")} | Tarihi Şehir Lokantası`;
  }, [t]);

  const value = useMemo<MenuPreferencesValue>(
    () => ({
      language,
      languageDefinition: getMenuLanguage(language) ?? getMenuLanguage(DEFAULT_MENU_LANGUAGE)!,
      recentLanguages,
      currency,
      direction: getMenuLanguage(language)?.direction ?? "ltr",
      preferencesReady,
      languageLoading,
      setLanguage,
      setCurrency,
      t,
      formatNumber,
      formatPrice,
    }),
    [currency, formatNumber, formatPrice, language, languageLoading, preferencesReady, recentLanguages, setCurrency, setLanguage, t],
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
