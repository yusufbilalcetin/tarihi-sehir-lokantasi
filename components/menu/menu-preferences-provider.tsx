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
import {
  FALLBACK_EXCHANGE_RATES,
  formatMenuPrice,
  isExchangeRateSnapshot,
  type MenuExchangeRates,
} from "@/lib/config/currency";
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
export const MENU_EXCHANGE_RATES_STORAGE_KEY = "tarihi-sehir-exchange-rates";

const EXCHANGE_RATES_REFRESH_MS = 60_000;

const CURRENCIES: MenuCurrency[] = ["TRY", "USD", "EUR"];

interface MenuPreferencesValue {
  language: MenuLanguage;
  languageDefinition: MenuLanguageDefinition;
  recentLanguages: MenuLanguage[];
  currency: MenuCurrency;
  exchangeRatesUpdatedAt: string | null;
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
  const [exchangeRates, setExchangeRates] = useState<MenuExchangeRates>(FALLBACK_EXCHANGE_RATES);
  const [exchangeRatesUpdatedAt, setExchangeRatesUpdatedAt] = useState<string | null>(null);

  useEffect(() => {
    const previousLanguage = document.documentElement.lang;
    const previousDirection = document.documentElement.dir;
    return () => {
      document.documentElement.lang = previousLanguage;
      document.documentElement.dir = previousDirection;
    };
  }, []);

  useEffect(() => {
    let active = true;
    let receivedServerSnapshot = false;
    let requestInFlight: Promise<void> | null = null;
    let activeController: AbortController | null = null;

    const restoreRatesTimer = window.setTimeout(() => {
      try {
        const storedSnapshot = window.localStorage.getItem(MENU_EXCHANGE_RATES_STORAGE_KEY);
        if (storedSnapshot) {
          const parsed: unknown = JSON.parse(storedSnapshot);
          if (isExchangeRateSnapshot(parsed) && !receivedServerSnapshot) {
            setExchangeRates(parsed.rates);
            setExchangeRatesUpdatedAt(parsed.updatedAt);
          } else {
            window.localStorage.removeItem(MENU_EXCHANGE_RATES_STORAGE_KEY);
          }
        }
      } catch {
        // The default rates remain available when storage is unavailable or corrupt.
      }
    }, 0);

    function refreshExchangeRates() {
      if (requestInFlight) return requestInFlight;

      activeController = new AbortController();
      requestInFlight = (async () => {
        try {
          const response = await fetch("/api/exchange-rates", {
            cache: "no-store",
            signal: activeController?.signal,
          });
          if (!response.ok) return;

          const snapshot: unknown = await response.json();
          if (!active || !isExchangeRateSnapshot(snapshot)) return;

          receivedServerSnapshot = true;
          setExchangeRates(snapshot.rates);
          setExchangeRatesUpdatedAt(snapshot.updatedAt);
          try {
            window.localStorage.setItem(
              MENU_EXCHANGE_RATES_STORAGE_KEY,
              JSON.stringify(snapshot),
            );
          } catch {
            // Fresh in-memory rates remain usable when storage is unavailable.
          }
        } catch {
          // Keep the last successful rates; transient API failures must not reset prices.
        }
      })().finally(() => {
        requestInFlight = null;
        activeController = null;
      });

      return requestInFlight;
    }

    void refreshExchangeRates();

    const refreshTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshExchangeRates();
    }, EXCHANGE_RATES_REFRESH_MS);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshExchangeRates();
    };

    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("focus", refreshWhenVisible);

    return () => {
      active = false;
      activeController?.abort();
      window.clearTimeout(restoreRatesTimer);
      window.clearInterval(refreshTimer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("focus", refreshWhenVisible);
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
    (priceTRY: number) => formatMenuPrice(priceTRY, currency, language, exchangeRates),
    [currency, exchangeRates, language],
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
      exchangeRatesUpdatedAt,
      direction: getMenuLanguage(language)?.direction ?? "ltr",
      preferencesReady,
      languageLoading,
      setLanguage,
      setCurrency,
      t,
      formatNumber,
      formatPrice,
    }),
    [currency, exchangeRatesUpdatedAt, formatNumber, formatPrice, language, languageLoading, preferencesReady, recentLanguages, setCurrency, setLanguage, t],
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
