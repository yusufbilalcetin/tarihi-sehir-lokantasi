"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useParams } from "next/navigation";
import { BellRing, CheckCircle2, ChevronLeft, CircleCheck, ReceiptText, Search, Send, ShoppingBag, UtensilsCrossed, X } from "lucide-react";
import { toast } from "sonner";
import { BottomNavigation, type MenuTab } from "@/components/menu/bottom-navigation";
import { CartItem } from "@/components/menu/cart-item";
import { CategoryGrid, type MenuCategory } from "@/components/menu/category-grid";
import { CurrencySelector } from "@/components/menu/currency-selector";
import { MenuPreferencesProvider, useMenuPreferences } from "@/components/menu/menu-preferences-provider";
import { OrderStatusTimeline } from "@/components/menu/order-status-timeline";
import { ProductCard } from "@/components/menu/product-card";
import { ProductDetailSheet } from "@/components/menu/product-detail-sheet";
import { RestaurantHeader } from "@/components/menu/restaurant-header";
import { SplashIntro } from "@/components/menu/splash-intro";
import { EmptyState } from "@/components/shared/empty-state";
import { MotionValue } from "@/components/shared/motion-value";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { categories, products } from "@/lib/mock-data";
import { getMenuCategoryName, getMenuProductDescription, getMenuProductName } from "@/lib/i18n/menu-content";
import type { MenuTranslationKey } from "@/lib/i18n/menu-translations";
import { cn } from "@/lib/utils";
import type { CartItem as CartItemType, Product, WaiterCallType } from "@/types";

const waiterOptions: Array<{ type: WaiterCallType; titleKey: MenuTranslationKey; descriptionKey: MenuTranslationKey }> = [
  { type: "Garson çağır", titleKey: "callWaiter", descriptionKey: "generalRequest" },
  { type: "Sipariş vereceğim", titleKey: "placeOrder", descriptionKey: "orderHelp" },
  { type: "Su istiyorum", titleKey: "wantWater", descriptionKey: "waterDescription" },
  { type: "Ekmek istiyorum", titleKey: "wantBread", descriptionKey: "breadDescription" },
  { type: "Ek servis istiyorum", titleKey: "wantService", descriptionKey: "serviceDescription" },
  { type: "Diğer", titleKey: "other", descriptionKey: "otherDescription" },
];

const categoryImages: Record<string, string> = {
  soups: "/images/food/mercimek-corbasi.jpg",
  grill: "/images/food/izgara-kofte.jpg",
  mains: "/images/food/etli-kuru-fasulye.jpg",
  drinks: "/images/food/yayik-ayrani.jpg",
  kebabs: "/images/food/kuzu-tandir.jpg",
  dessert: "/images/food/firin-sutlac.jpg",
};

const menuCategories: MenuCategory[] = categories
  .filter((category) => category.active)
  .sort((first, second) => first.sortOrder - second.sortOrder)
  .map((category) => ({
    ...category,
    image: categoryImages[category.id] ?? "/images/food/tas-kebabi.jpg",
  }));
const activeMenuCategoryIds = new Set(menuCategories.map((category) => category.id));
const publicProducts = products.filter(
  (product) => product.status !== "inactive" && activeMenuCategoryIds.has(product.categoryId),
);

const MENU_VIEW_KEY = "tarihiSehirMenuView";
const MENU_CATEGORY_KEY = "tarihiSehirMenuCategory";
const MENU_PRODUCT_KEY = "tarihiSehirMenuProduct";
const MENU_QUERY_KEY = "tarihiSehirMenuQuery";

type MenuHistoryView = "categories" | "products" | "detail";
type MenuViewTransition = {
  finished: Promise<void>;
  skipTransition?: () => void;
};

function currentHistoryState() {
  return (window.history.state ?? {}) as Record<string, unknown>;
}

function currentHistoryView(): MenuHistoryView | undefined {
  const view = currentHistoryState()[MENU_VIEW_KEY];
  return view === "categories" || view === "products" || view === "detail" ? view : undefined;
}

function OrderCurrencyPanel({ amount }: { amount: number }) {
  const { currency, formatPrice, t } = useMenuPreferences();

  return (
    <div className="mt-4 border-t pt-4 text-center">
      <p className="text-xs font-semibold text-muted-foreground">{t("currencyLabel")}</p>
      <div className="mt-2 flex justify-center"><CurrencySelector variant="surface" /></div>
      <p className="mt-3 text-sm text-muted-foreground">
        {t("total")}: <strong dir="ltr" className="ms-1 text-base tabular-nums text-burgundy"><MotionValue value={formatPrice(amount)} numericValue={amount} delayMs={20} /></strong>
      </p>
      {currency !== "TRY" ? <p className="mx-auto mt-2 max-w-md text-[11px] leading-5 text-muted-foreground">{t("approximateCurrency")}</p> : null}
    </div>
  );
}

export function MenuExperience() {
  return (
    <MenuPreferencesProvider>
      <MenuExperienceContent />
    </MenuPreferencesProvider>
  );
}

function MenuExperienceContent() {
  const { currency, direction, formatPrice, language, languageDefinition, preferencesReady, t } = useMenuPreferences();
  const params = useParams<{ tableToken?: string }>();
  const categoryHeadingRef = useRef<HTMLHeadingElement>(null);
  const productHeadingRef = useRef<HTMLHeadingElement>(null);
  const productTriggerRef = useRef<HTMLElement | null>(null);
  const cartListRef = useRef<HTMLDivElement>(null);
  const activeViewTransitionRef = useRef<MenuViewTransition | null>(null);
  const [introComplete, setIntroComplete] = useState(false);
  const [activeTab, setActiveTab] = useState<MenuTab>("menu");
  const [navigationDirection, setNavigationDirection] = useState<"forward" | "back">("forward");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [cart, setCart] = useState<CartItemType[]>([]);
  const [waiterOpen, setWaiterOpen] = useState(false);
  const [billRequested, setBillRequested] = useState(false);
  const [orderSent, setOrderSent] = useState(false);
  const [submittedTotal, setSubmittedTotal] = useState(0);
  const hasSearch = Boolean(search.trim());

  function runViewTransition(direction: "forward" | "back", update: () => void) {
    document.documentElement.dataset.navigationDirection = direction;
    const transitionDocument = document as Document & {
      startViewTransition?: (callback: () => void) => MenuViewTransition;
    };
    const applyUpdate = () => {
      setNavigationDirection(direction);
      update();
    };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !transitionDocument.startViewTransition) {
      applyUpdate();
      return;
    }

    activeViewTransitionRef.current?.skipTransition?.();
    try {
      const transition = transitionDocument.startViewTransition(() => flushSync(applyUpdate));
      activeViewTransitionRef.current = transition;
      void transition.finished.then(
        () => {
          if (activeViewTransitionRef.current === transition) activeViewTransitionRef.current = null;
        },
        () => {
          if (activeViewTransitionRef.current === transition) activeViewTransitionRef.current = null;
        },
      );
    } catch {
      activeViewTransitionRef.current = null;
      applyUpdate();
    }
  }

  const finishIntro = useCallback(() => setIntroComplete(true), []);
  const tableName = useMemo(() => {
    const token = params?.tableToken;
    if (!token || token === "demo-table") return t("tableNumber", { number: 7 });
    const tableNumber = token.match(/\d+/)?.[0];
    if (tableNumber) return t("tableNumber", { number: Number(tableNumber) });
    return decodeURIComponent(token).replaceAll("-", " ").replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase(languageDefinition.locale));
  }, [languageDefinition.locale, params, t]);
  const selectedCategory = menuCategories.find((category) => category.id === activeCategory);
  const selectedCategoryName = selectedCategory
    ? getMenuCategoryName(selectedCategory, language)
    : "";

  const filteredProducts = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase(languageDefinition.locale);
    return publicProducts.filter((product) => {
      const matchesCategory = normalized ? true : Boolean(activeCategory) && product.categoryId === activeCategory;
      const searchableText = `${getMenuProductName(product, language)} ${getMenuProductDescription(product, language)} ${getMenuCategoryName(categories.find((category) => category.id === product.categoryId) ?? { id: product.categoryId, name: product.category, slug: product.categoryId, productCount: 0, active: true, sortOrder: 0 }, language)}`;
      const matchesSearch = !normalized || searchableText.toLocaleLowerCase(languageDefinition.locale).includes(normalized);
      return matchesCategory && matchesSearch;
    });
  }, [activeCategory, language, languageDefinition.locale, search]);

  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);

  useEffect(() => {
    const restoreTimer = window.setTimeout(() => {
      const state = currentHistoryState();
      const view = currentHistoryView();
      const storedCategory = typeof state[MENU_CATEGORY_KEY] === "string" && activeMenuCategoryIds.has(state[MENU_CATEGORY_KEY])
        ? state[MENU_CATEGORY_KEY]
        : null;
      const storedProductId = typeof state[MENU_PRODUCT_KEY] === "string" ? state[MENU_PRODUCT_KEY] : null;
      const storedQuery = typeof state[MENU_QUERY_KEY] === "string" ? state[MENU_QUERY_KEY] : "";
      const storedProduct = storedProductId
        ? publicProducts.find((product) => product.id === storedProductId) ?? null
        : null;

      if (view === "detail" && storedProduct) {
        setActiveCategory(storedCategory);
        setSearch(storedQuery);
        setSelectedProduct(storedProduct);
        return;
      }

      if (view === "products" && (storedCategory || storedQuery.trim())) {
        setActiveCategory(storedCategory);
        setSearch(storedQuery);
        return;
      }

      window.history.replaceState(
        {
          ...state,
          [MENU_VIEW_KEY]: "categories",
          [MENU_CATEGORY_KEY]: null,
          [MENU_PRODUCT_KEY]: null,
          [MENU_QUERY_KEY]: "",
        },
        "",
      );
    }, 0);

    return () => window.clearTimeout(restoreTimer);
  }, []);

  useEffect(() => {
    function handlePopState(event: PopStateEvent) {
      const state = (event.state ?? {}) as Record<string, unknown>;
      const view = state[MENU_VIEW_KEY];
      const categoryId = typeof state[MENU_CATEGORY_KEY] === "string" && activeMenuCategoryIds.has(state[MENU_CATEGORY_KEY])
        ? state[MENU_CATEGORY_KEY]
        : null;
      const productId = typeof state[MENU_PRODUCT_KEY] === "string" ? state[MENU_PRODUCT_KEY] : null;
      const query = typeof state[MENU_QUERY_KEY] === "string" ? state[MENU_QUERY_KEY] : "";

      if (view === "detail" && productId) {
        setActiveTab("menu");
        setActiveCategory(categoryId);
        setSearch(query);
        setSelectedProduct(publicProducts.find((product) => product.id === productId) ?? null);
        return;
      }

      if (view === "products") {
        setNavigationDirection("back");
        setActiveTab("menu");
        setActiveCategory(categoryId);
        setSearch(query);
        setSelectedProduct(null);
        window.requestAnimationFrame(() => {
          if (selectedProduct) {
            productTriggerRef.current?.focus({ preventScroll: true });
          } else {
            productHeadingRef.current?.focus({ preventScroll: true });
          }
        });
        return;
      }

      if (view === "categories") {
        const categoryToRestore = activeCategory;
        runViewTransition("back", () => {
          setActiveTab("menu");
          setActiveCategory(null);
          setSearch("");
          setSelectedProduct(null);
        });
        window.requestAnimationFrame(() => {
          if (categoryToRestore) {
            document.getElementById(`menu-category-${categoryToRestore}`)?.focus({ preventScroll: true });
          } else {
            categoryHeadingRef.current?.focus({ preventScroll: true });
          }
        });
        return;
      }

      setSelectedProduct(null);
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [activeCategory, selectedProduct]);

  function addToCart(product: Product, quantity = 1, note = "") {
    setOrderSent(false);
    setCart((current) => {
      const matching = current.find((item) => item.productId === product.id && (item.note ?? "") === note);
      if (matching) return current.map((item) => item.id === matching.id ? { ...item, quantity: item.quantity + quantity } : item);
      return [...current, { id: `${product.id}-${Date.now()}`, productId: product.id, productName: product.name, quantity, unitPrice: product.price, note: note || undefined, image: product.image, product }];
    });
  }

  function updateQuantity(id: string, change: number) {
    setCart((current) => current.map((item) => item.id === id ? { ...item, quantity: Math.max(1, item.quantity + change) } : item));
  }

  function removeCartItem(id: string) {
    const list = cartListRef.current;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const previousPositions = new Map<string, DOMRect>();
    const rootStyles = window.getComputedStyle(document.documentElement);
    const spatialDuration = Number.parseFloat(rootStyles.getPropertyValue("--motion-spatial")) || 220;
    const spatialEasing = rootStyles.getPropertyValue("--ease-spatial").trim() || "cubic-bezier(0.25, 0.8, 0.25, 1)";

    if (list && !reduceMotion) {
      list.querySelectorAll<HTMLElement>("[data-cart-item-id]").forEach((element) => {
        const itemId = element.dataset.cartItemId;
        if (itemId && itemId !== id) previousPositions.set(itemId, element.getBoundingClientRect());
      });

      const removedElement = Array.from(list.querySelectorAll<HTMLElement>("[data-cart-item-id]"))
        .find((element) => element.dataset.cartItemId === id);
      if (removedElement) {
        const rect = removedElement.getBoundingClientRect();
        const clone = removedElement.cloneNode(true) as HTMLElement;
        clone.removeAttribute("data-cart-item-id");
        clone.setAttribute("aria-hidden", "true");
        Object.assign(clone.style, {
          position: "fixed",
          inset: "auto",
          top: `${rect.top}px`,
          left: `${rect.left}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
          margin: "0",
          pointerEvents: "none",
          zIndex: "39",
          transformOrigin: "center",
        });
        document.body.append(clone);
        const exitAnimation = clone.animate(
          [
            { opacity: 1, transform: "translateX(0) scale(1)" },
            { opacity: 0, transform: "translateX(-4px) scale(0.995)" },
          ],
          { duration: 170, easing: "cubic-bezier(0.4, 0, 0.2, 1)", fill: "forwards" },
        );
        void exitAnimation.finished.then(() => clone.remove(), () => clone.remove());
      }
    }

    setCart((current) => current.filter((item) => item.id !== id));

    if (!list || reduceMotion) return;
    window.requestAnimationFrame(() => {
      list.querySelectorAll<HTMLElement>("[data-cart-item-id]").forEach((element) => {
        const itemId = element.dataset.cartItemId;
        const previous = itemId ? previousPositions.get(itemId) : undefined;
        if (!previous) return;
        const current = element.getBoundingClientRect();
        const deltaY = previous.top - current.top;
        if (Math.abs(deltaY) < 1) return;
        element.animate(
          [{ transform: `translateY(${deltaY}px)` }, { transform: "translateY(0)" }],
          { duration: spatialDuration, easing: spatialEasing },
        );
      });
    });
  }

  function openCategoryHome() {
    const historyView = currentHistoryView();
    if (historyView === "detail") {
      window.history.go(-2);
      return;
    }
    if (historyView === "products") {
      window.history.back();
      return;
    }
    runViewTransition("back", () => {
      setActiveTab("menu");
      setActiveCategory(null);
      setSearch("");
    });
  }

  function selectCategory(category: MenuCategory, focusHeading: boolean) {
    if (currentHistoryView() === "products" || currentHistoryView() === "detail") return;

    window.history.pushState(
      {
        ...currentHistoryState(),
        [MENU_VIEW_KEY]: "products",
        [MENU_CATEGORY_KEY]: category.id,
        [MENU_PRODUCT_KEY]: null,
        [MENU_QUERY_KEY]: "",
      },
      "",
    );
    runViewTransition("forward", () => {
      setActiveCategory(category.id);
      setSearch("");
    });
    if (focusHeading) {
      window.requestAnimationFrame(() => productHeadingRef.current?.focus({ preventScroll: true }));
    }
  }

  function returnFromProducts() {
    if (hasSearch && activeCategory) {
      setSearch("");
      window.history.replaceState(
        {
          ...currentHistoryState(),
          [MENU_QUERY_KEY]: "",
        },
        "",
      );
      window.requestAnimationFrame(() => productHeadingRef.current?.focus());
      return;
    }
    if (currentHistoryView() === "products") {
      window.history.back();
      return;
    }
    runViewTransition("back", () => {
      setActiveCategory(null);
      setSearch("");
    });
  }

  function handleSearchChange(value: string) {
    const nextHasSearch = Boolean(value.trim());
    const historyView = currentHistoryView();

    if (!activeCategory && !hasSearch && nextHasSearch && historyView === "categories") {
      setNavigationDirection("forward");
      window.history.pushState(
        {
          ...currentHistoryState(),
          [MENU_VIEW_KEY]: "products",
          [MENU_CATEGORY_KEY]: null,
          [MENU_PRODUCT_KEY]: null,
          [MENU_QUERY_KEY]: value,
        },
        "",
      );
    } else if (!activeCategory && hasSearch && !nextHasSearch && historyView === "products") {
      setNavigationDirection("back");
      setSearch("");
      window.history.back();
      return;
    } else if (historyView === "products") {
      window.history.replaceState(
        {
          ...currentHistoryState(),
          [MENU_QUERY_KEY]: value,
        },
        "",
      );
    }

    setSearch(value);
  }

  function clearSearch() {
    if (!activeCategory && currentHistoryView() === "products") {
      window.history.back();
      return;
    }
    setSearch("");
    window.history.replaceState(
      {
        ...currentHistoryState(),
        [MENU_QUERY_KEY]: "",
      },
      "",
    );
    window.requestAnimationFrame(() => productHeadingRef.current?.focus());
  }

  function openProduct(product: Product) {
    productTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    window.history.pushState(
      {
        ...currentHistoryState(),
        [MENU_VIEW_KEY]: "detail",
        [MENU_CATEGORY_KEY]: activeCategory,
        [MENU_PRODUCT_KEY]: product.id,
        [MENU_QUERY_KEY]: search,
      },
      "",
    );
    setSelectedProduct(product);
  }

  function closeProduct() {
    if (currentHistoryView() === "detail") {
      window.history.back();
      return;
    }
    setSelectedProduct(null);
    window.requestAnimationFrame(() => productTriggerRef.current?.focus());
  }

  function handleTabChange(tab: MenuTab) {
    if (tab === "waiter") {
      setNavigationDirection("forward");
      setWaiterOpen(true);
      return;
    }
    if (tab === "menu") {
      openCategoryHome();
      return;
    }
    const tabOrder: MenuTab[] = ["menu", "order", "waiter", "bill"];
    const nextDirection = tabOrder.indexOf(tab) >= tabOrder.indexOf(activeTab) ? "forward" : "back";
    runViewTransition(nextDirection, () => setActiveTab(tab));
  }

  function sendWaiterCall(type: WaiterCallType) {
    setWaiterOpen(false);
    const option = waiterOptions.find((item) => item.type === type);
    toast.success(t("waiterRequestSent"), { description: option ? t(option.titleKey) : type });
  }

  function sendOrder() {
    if (!cart.length) return;
    setSubmittedTotal(subtotal);
    setCart([]);
    setOrderSent(true);
    toast.success(t("orderSuccess"));
  }

  return (
    <>
      <SplashIntro onComplete={finishIntro} />
      {introComplete && !preferencesReady ? <div className="fixed inset-0 z-[90] min-h-[100dvh] bg-[#120c08]" aria-hidden="true" /> : null}
      <div dir={direction} lang={languageDefinition.locale} className={cn("menu-content min-h-[100dvh] pb-24", introComplete && preferencesReady && "menu-content-ready")} aria-hidden={!introComplete || !preferencesReady} inert={!introComplete || !preferencesReady}>
        {activeTab === "menu" ? (
          <>
            <RestaurantHeader tableName={tableName} />
            <main className="menu-shell pb-6 pt-5">
              <div className={cn("motion-search relative", !activeCategory && !hasSearch && "mx-auto max-w-3xl")}>
                <Search className="motion-search-icon pointer-events-none absolute start-3.5 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
                <Input value={search} onChange={(event) => handleSearchChange(event.target.value)} placeholder={t("search")} aria-label={t("searchLabel")} className="h-12 rounded-2xl border-border bg-card ps-11 pe-4 text-base shadow-sm placeholder:text-muted-foreground/70" />
              </div>
              {currency !== "TRY" ? (
                <p className="mx-auto mt-2 max-w-3xl text-center text-[11px] leading-5 text-[#70665C]">
                  {t("approximateCurrency")}
                </p>
              ) : null}
              {!activeCategory && !hasSearch ? (
                <section className="motion-page motion-view-panel mx-auto w-full max-w-3xl pt-6" data-navigation-direction={navigationDirection} aria-labelledby="category-heading">
                  <div className="mb-5 text-center">
                    <h1 ref={categoryHeadingRef} id="category-heading" tabIndex={-1} className="font-heading text-2xl font-semibold outline-none sm:text-3xl">{t("categories")}</h1>
                    <p className="mx-auto mt-1 max-w-xl text-sm leading-6 text-[#70665C]">{t("categoryIntro")}</p>
                  </div>
                  <CategoryGrid categories={menuCategories} onSelect={selectCategory} />
                </section>
              ) : (
                <section className="motion-page motion-view-panel pt-5" data-navigation-direction={navigationDirection}>
                  <button type="button" onClick={returnFromProducts} className="motion-press motion-ripple -ms-2 inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-sm font-bold text-burgundy hover:bg-burgundy/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <ChevronLeft className={cn("size-4", direction === "rtl" && "rotate-180")} aria-hidden="true" />
                    {hasSearch && activeCategory ? t("backToCategory", { name: selectedCategoryName }) : t("backToCategories")}
                  </button>
                  <div className="mb-5 mt-2 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-3 text-center">
                    <div className="col-start-2">
                      <h1 ref={productHeadingRef} id="product-list-heading" tabIndex={-1} className="font-heading text-2xl font-semibold outline-none sm:text-3xl">{hasSearch ? t("searchResults") : selectedCategoryName}</h1>
                      <p className="mt-1 text-xs text-[#70665C]" role="status" aria-live="polite">{hasSearch ? t("productsFound", { count: filteredProducts.length }) : t("itemCount", { count: selectedCategory?.productCount ?? filteredProducts.length })}</p>
                    </div>
                    {hasSearch ? <button type="button" onClick={clearSearch} className="col-start-3 min-h-11 justify-self-end text-sm font-semibold text-burgundy">{t("clearSearch")}</button> : null}
                  </div>
                  {filteredProducts.length ? (
                    <div key={search} data-searching={hasSearch} className="motion-results grid gap-[var(--menu-grid-gap)] lg:grid-cols-2">{filteredProducts.map((product, index) => <ProductCard key={product.id} product={product} index={index} onOpen={() => openProduct(product)} onAdd={() => addToCart(product)} />)}</div>
                  ) : <EmptyState icon={UtensilsCrossed} title={t("noResults")} description={t("noResultsDescription")} />}
                </section>
              )}
            </main>
          </>
        ) : null}

        {activeTab === "order" ? (
          <main className="motion-page motion-view-panel menu-shell menu-shell-narrow pb-8 pt-[max(1.5rem,env(safe-area-inset-top))]" data-navigation-direction={navigationDirection}>
            <div className="relative flex min-h-12 items-center justify-center px-12 text-center"><button type="button" onClick={openCategoryHome} className="motion-press motion-ripple touch-target absolute start-0 flex items-center justify-center rounded-xl" aria-label={t("backToCategories")}><ChevronLeft className={cn(direction === "rtl" && "rotate-180")} /></button><div><h1 className="font-heading text-3xl font-semibold">{t("order")}</h1><p className="text-sm text-muted-foreground">{tableName}</p></div></div>
            {orderSent ? (
              <section className="mt-6 rounded-3xl border bg-card p-5 surface-shadow sm:p-6">
                <div className="motion-status flex size-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700" data-motion-success="true"><CheckCircle2 className="size-6" /></div>
                <h2 className="mt-4 font-heading text-2xl font-semibold">{t("orderSent")}</h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">{t("orderTracking", { number: 2420 })}</p>
                <OrderStatusTimeline currentStep={2} />
                <div className="mt-5 border-t pt-4"><div className="flex justify-between text-sm text-muted-foreground"><span>{t("total")}</span><strong dir="ltr" className="text-lg text-burgundy"><MotionValue value={formatPrice(submittedTotal)} numericValue={submittedTotal} /></strong></div></div>
                <OrderCurrencyPanel amount={submittedTotal} />
                <Button type="button" variant="outline" onClick={() => { setOrderSent(false); openCategoryHome(); }} className="mt-4 h-11 w-full rounded-xl">{t("newItem")}</Button>
              </section>
            ) : cart.length ? (
              <>
                <div ref={cartListRef} className="mt-6 space-y-3">{cart.map((item, index) => <CartItem key={item.id} item={item} motionIndex={index} onDecrease={() => updateQuantity(item.id, -1)} onIncrease={() => updateQuantity(item.id, 1)} onRemove={() => removeCartItem(item.id)} />)}</div>
                <section className="mt-5 rounded-2xl border bg-card p-5">
                  <dl className="space-y-3 text-sm"><div className="flex justify-between text-muted-foreground"><dt>{t("subtotal")}</dt><dd dir="ltr"><MotionValue value={formatPrice(subtotal)} numericValue={subtotal} delayMs={20} /></dd></div><div className="flex justify-between text-muted-foreground"><dt>{t("serviceFee")}</dt><dd dir="ltr"><MotionValue value={formatPrice(0)} numericValue={0} delayMs={30} /></dd></div><div className="flex justify-between border-t pt-3 text-base font-bold"><dt>{t("total")}</dt><dd dir="ltr" className="text-burgundy"><MotionValue value={formatPrice(subtotal)} numericValue={subtotal} delayMs={40} /></dd></div></dl>
                  <OrderCurrencyPanel amount={subtotal} />
                  <Button type="button" onClick={sendOrder} className="motion-cta mt-5 h-12 w-full rounded-xl text-sm font-bold"><Send className="size-4" /> {t("sendOrder")}</Button>
                </section>
              </>
            ) : <div className="motion-empty mt-6"><EmptyState icon={ShoppingBag} title={t("emptyCart")} description={t("emptyCartDescription")} /><Button type="button" onClick={openCategoryHome} className="mt-4 h-11 w-full rounded-xl">{t("browseMenu")}</Button></div>}
          </main>
        ) : null}

        {activeTab === "bill" ? (
          <main className="motion-page motion-view-panel menu-shell menu-shell-narrow flex min-h-[calc(100dvh-5rem)] items-center py-8" data-navigation-direction={navigationDirection}>
            <section className="w-full rounded-3xl border bg-card p-6 text-center surface-shadow sm:p-8">
              <div key={billRequested ? "success" : "idle"} className="motion-status mx-auto flex size-14 items-center justify-center rounded-2xl bg-burgundy/8 text-burgundy" data-motion-success={billRequested}>{billRequested ? <CircleCheck className="size-7" /> : <ReceiptText className="size-7" />}</div>
              <h1 className="mt-5 font-heading text-2xl font-semibold">{billRequested ? t("billSent") : t("billConfirm")}</h1>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{billRequested ? t("billSentDescription") : t("billConfirmDescription")}</p>
              <Button
                type="button"
                variant={billRequested ? "outline" : "default"}
                onClick={billRequested ? openCategoryHome : () => { setBillRequested(true); toast.success(t("billToast")); }}
                className="motion-cta mt-6 h-12 w-full rounded-xl text-sm font-bold"
              >
                <span key={billRequested ? "back" : "request"} className="motion-action-label">{billRequested ? t("backToMenu") : t("requestBill")}</span>
              </Button>
            </section>
          </main>
        ) : null}
      </div>

      <ProductDetailSheet key={selectedProduct?.id ?? "none"} product={selectedProduct} open={Boolean(selectedProduct)} onOpenChange={(open) => { if (!open) closeProduct(); }} onAdd={addToCart} />

      <Dialog open={waiterOpen} onOpenChange={setWaiterOpen}>
        <DialogContent dir={direction} showCloseButton={false} className="menu-dialog-scroll flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl flex-col gap-0 overflow-y-auto rounded-3xl border-border p-0 sm:max-w-xl">
          <DialogClose className="absolute end-4 top-4 z-10 inline-flex size-10 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <X className="size-4" aria-hidden="true" />
            <span className="sr-only">{t("close")}</span>
          </DialogClose>
          <DialogHeader className="items-center px-14 pb-4 pt-6 text-center sm:px-16"><div className="mb-1 flex size-11 items-center justify-center rounded-2xl bg-burgundy/8 text-burgundy"><BellRing className="size-5" /></div><DialogTitle className="font-heading text-2xl font-semibold">{t("waiterHelpTitle")}</DialogTitle><DialogDescription className="mx-auto max-w-md">{t("waiterHelpDescription", { table: tableName })}</DialogDescription></DialogHeader>
          <div className="grid grid-cols-1 gap-3 border-t px-5 py-5 sm:grid-cols-2 sm:px-6">{waiterOptions.map((option) => <button key={option.type} type="button" onClick={() => sendWaiterCall(option.type)} className="motion-press motion-ripple motion-hover grid min-h-20 w-full grid-cols-[minmax(0,1fr)_1rem] items-center gap-3 rounded-2xl border bg-card px-4 py-3 text-start hover:border-copper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span><span className="block text-sm font-bold">{t(option.titleKey)}</span><span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{t(option.descriptionKey)}</span></span><ChevronLeft className={cn("size-4 text-muted-foreground", direction === "ltr" && "rotate-180")} /></button>)}</div>
        </DialogContent>
      </Dialog>

      {introComplete && preferencesReady ? <BottomNavigation active={waiterOpen ? "waiter" : activeTab} cartCount={cartCount} onChange={handleTabChange} /> : null}
    </>
  );
}
