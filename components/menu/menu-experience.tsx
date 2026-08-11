"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { BellRing, CheckCircle2, ChevronLeft, CircleCheck, ReceiptText, Search, Send, ShoppingBag, UtensilsCrossed, X } from "lucide-react";
import { toast } from "sonner";
import { BottomNavigation, type MenuTab } from "@/components/menu/bottom-navigation";
import { CartItem } from "@/components/menu/cart-item";
import { CategoryGrid, type MenuCategory } from "@/components/menu/category-grid";
import { MenuPreferencesProvider, useMenuPreferences } from "@/components/menu/menu-preferences-provider";
import { OrderStatusTimeline } from "@/components/menu/order-status-timeline";
import { ProductCard } from "@/components/menu/product-card";
import { ProductDetailSheet } from "@/components/menu/product-detail-sheet";
import { RestaurantHeader } from "@/components/menu/restaurant-header";
import { SplashIntro } from "@/components/menu/splash-intro";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
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

function currentHistoryState() {
  return (window.history.state ?? {}) as Record<string, unknown>;
}

function currentHistoryView(): MenuHistoryView | undefined {
  const view = currentHistoryState()[MENU_VIEW_KEY];
  return view === "categories" || view === "products" || view === "detail" ? view : undefined;
}

export function MenuExperience() {
  return (
    <MenuPreferencesProvider>
      <MenuExperienceContent />
    </MenuPreferencesProvider>
  );
}

function MenuExperienceContent() {
  const { currency, direction, formatPrice, language, t } = useMenuPreferences();
  const params = useParams<{ tableToken?: string }>();
  const categoryHeadingRef = useRef<HTMLHeadingElement>(null);
  const productHeadingRef = useRef<HTMLHeadingElement>(null);
  const productTriggerRef = useRef<HTMLElement | null>(null);
  const [introComplete, setIntroComplete] = useState(false);
  const [activeTab, setActiveTab] = useState<MenuTab>("menu");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [cart, setCart] = useState<CartItemType[]>([]);
  const [waiterOpen, setWaiterOpen] = useState(false);
  const [billRequested, setBillRequested] = useState(false);
  const [orderSent, setOrderSent] = useState(false);
  const [submittedTotal, setSubmittedTotal] = useState(0);
  const hasSearch = Boolean(search.trim());

  const finishIntro = useCallback(() => setIntroComplete(true), []);
  const tableName = useMemo(() => {
    const token = params?.tableToken;
    if (!token || token === "demo-table") return "Masa 7";
    const tableNumber = token.match(/\d+/)?.[0];
    if (tableNumber) return `Masa ${tableNumber}`;
    return decodeURIComponent(token).replaceAll("-", " ").replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase("tr-TR"));
  }, [params]);
  const selectedCategory = menuCategories.find((category) => category.id === activeCategory);
  const selectedCategoryName = selectedCategory
    ? getMenuCategoryName(selectedCategory, language)
    : "";

  const filteredProducts = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase(language === "tr" ? "tr-TR" : language);
    return publicProducts.filter((product) => {
      const matchesCategory = normalized ? true : Boolean(activeCategory) && product.categoryId === activeCategory;
      const searchableText = `${getMenuProductName(product, language)} ${getMenuProductDescription(product, language)} ${getMenuCategoryName(categories.find((category) => category.id === product.categoryId) ?? { id: product.categoryId, name: product.category, slug: product.categoryId, productCount: 0, active: true, sortOrder: 0 }, language)}`;
      const matchesSearch = !normalized || searchableText.toLocaleLowerCase(language === "tr" ? "tr-TR" : language).includes(normalized);
      return matchesCategory && matchesSearch;
    });
  }, [activeCategory, language, search]);

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
        setActiveTab("menu");
        setActiveCategory(categoryId);
        setSearch(query);
        setSelectedProduct(null);
        window.requestAnimationFrame(() => {
          if (selectedProduct) {
            productTriggerRef.current?.focus();
          } else {
            productHeadingRef.current?.focus();
          }
        });
        return;
      }

      if (view === "categories") {
        const categoryToRestore = activeCategory;
        setActiveTab("menu");
        setActiveCategory(null);
        setSearch("");
        setSelectedProduct(null);
        window.scrollTo({ top: 0, behavior: "auto" });
        window.requestAnimationFrame(() => {
          if (categoryToRestore) {
            document.getElementById(`menu-category-${categoryToRestore}`)?.focus();
          } else {
            categoryHeadingRef.current?.focus();
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
    toast.success(t("addedToCart", { name: getMenuProductName(product, language) }));
  }

  function updateQuantity(id: string, change: number) {
    setCart((current) => current.map((item) => item.id === id ? { ...item, quantity: Math.max(1, item.quantity + change) } : item));
  }

  function openCategoryHome() {
    setActiveTab("menu");
    const historyView = currentHistoryView();
    if (historyView === "detail") {
      window.history.go(-2);
      return;
    }
    if (historyView === "products") {
      window.history.back();
      return;
    }
    setActiveCategory(null);
    setSearch("");
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function selectCategory(category: MenuCategory) {
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
    setActiveCategory(category.id);
    setSearch("");
    window.scrollTo({ top: 0, behavior: "auto" });
    window.requestAnimationFrame(() => productHeadingRef.current?.focus());
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
    setActiveCategory(null);
    setSearch("");
  }

  function handleSearchChange(value: string) {
    const nextHasSearch = Boolean(value.trim());
    const historyView = currentHistoryView();

    if (!activeCategory && !hasSearch && nextHasSearch && historyView === "categories") {
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
      setWaiterOpen(true);
      return;
    }
    if (tab === "menu") {
      openCategoryHome();
      return;
    }
    setActiveTab(tab);
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
      <div dir={direction} lang={language} className={cn("menu-content min-h-[100dvh] pb-24", introComplete && "menu-content-ready")} aria-hidden={!introComplete} inert={!introComplete}>
        {activeTab === "menu" ? (
          <>
            <RestaurantHeader tableName={tableName} />
            <main className="mx-auto max-w-5xl px-4 pb-6 pt-5 sm:px-6">
              <div className={cn("relative", !activeCategory && !hasSearch && "mx-auto max-w-3xl")}>
                <Search className="pointer-events-none absolute start-3.5 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
                <Input value={search} onChange={(event) => handleSearchChange(event.target.value)} placeholder={t("search")} aria-label={t("searchLabel")} className="h-12 rounded-2xl border-border bg-card ps-11 pe-4 text-base shadow-sm placeholder:text-muted-foreground/70" />
              </div>
              {currency !== "TRY" ? (
                <p className="mx-auto mt-2 max-w-3xl text-center text-[11px] leading-5 text-[#70665C]">
                  {t("approximateCurrency")}
                </p>
              ) : null}
              {!activeCategory && !hasSearch ? (
                <section className="mx-auto w-full max-w-3xl pt-6" aria-labelledby="category-heading">
                  <div className="mb-4">
                    <h1 ref={categoryHeadingRef} id="category-heading" tabIndex={-1} className="font-heading text-2xl font-semibold outline-none sm:text-3xl">{t("categories")}</h1>
                    <p className="mt-1 text-sm leading-6 text-[#70665C]">{t("categoryIntro")}</p>
                  </div>
                  <CategoryGrid categories={menuCategories} onSelect={selectCategory} />
                </section>
              ) : (
                <section className="pt-5">
                  <button type="button" onClick={returnFromProducts} className="-ms-2 inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-sm font-bold text-burgundy transition-colors hover:bg-burgundy/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <ChevronLeft className={cn("size-4", direction === "rtl" && "rotate-180")} aria-hidden="true" />
                    {hasSearch && activeCategory ? t("backToCategory", { name: selectedCategoryName }) : t("backToCategories")}
                  </button>
                  <div className="mb-4 mt-2 flex items-end justify-between gap-3">
                    <div>
                      <h1 ref={productHeadingRef} id="product-list-heading" tabIndex={-1} className="font-heading text-2xl font-semibold outline-none sm:text-3xl">{hasSearch ? t("searchResults") : selectedCategoryName}</h1>
                      <p className="mt-1 text-xs text-[#70665C]" role="status" aria-live="polite">{hasSearch ? t("productsFound", { count: filteredProducts.length }) : `${selectedCategory?.productCount ?? filteredProducts.length} ${t("items")}`}</p>
                    </div>
                    {hasSearch ? <button type="button" onClick={clearSearch} className="min-h-11 shrink-0 text-sm font-semibold text-burgundy">{t("clearSearch")}</button> : null}
                  </div>
                  {filteredProducts.length ? (
                    <div className="grid gap-3 lg:grid-cols-2">{filteredProducts.map((product) => <ProductCard key={product.id} product={product} onOpen={() => openProduct(product)} onAdd={() => addToCart(product)} />)}</div>
                  ) : <EmptyState icon={UtensilsCrossed} title={t("noResults")} description={t("noResultsDescription")} />}
                </section>
              )}
            </main>
          </>
        ) : null}

        {activeTab === "order" ? (
          <main className="mx-auto max-w-2xl px-4 pb-8 pt-[max(1.5rem,env(safe-area-inset-top))] sm:px-6">
            <div className="flex items-center gap-3"><button type="button" onClick={openCategoryHome} className="touch-target -ms-2 flex items-center justify-center rounded-xl" aria-label={t("backToCategories")}><ChevronLeft className={cn(direction === "rtl" && "rotate-180")} /></button><div><h1 className="font-heading text-3xl font-semibold">{t("order")}</h1><p className="text-sm text-muted-foreground">{tableName}</p></div></div>
            {orderSent ? (
              <section className="mt-6 rounded-3xl border bg-card p-5 surface-shadow sm:p-6">
                <div className="flex size-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700"><CheckCircle2 className="size-6" /></div>
                <h2 className="mt-4 font-heading text-2xl font-semibold">{t("orderSent")}</h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">{t("orderTracking", { number: "2420" })}</p>
                <OrderStatusTimeline currentStep={2} />
                <div className="mt-5 border-t pt-4"><div className="flex justify-between text-sm text-muted-foreground"><span>{t("total")}</span><strong dir="ltr" className="text-lg text-burgundy">{formatPrice(submittedTotal)}</strong></div></div>
                <Button type="button" variant="outline" onClick={() => { setOrderSent(false); openCategoryHome(); }} className="mt-4 h-11 w-full rounded-xl">{t("newItem")}</Button>
              </section>
            ) : cart.length ? (
              <>
                <div className="mt-6 space-y-3">{cart.map((item) => <CartItem key={item.id} item={item} onDecrease={() => updateQuantity(item.id, -1)} onIncrease={() => updateQuantity(item.id, 1)} onRemove={() => setCart((current) => current.filter((cartItem) => cartItem.id !== item.id))} />)}</div>
                <section className="mt-5 rounded-2xl border bg-card p-5">
                  <dl className="space-y-3 text-sm"><div className="flex justify-between text-muted-foreground"><dt>{t("subtotal")}</dt><dd dir="ltr">{formatPrice(subtotal)}</dd></div><div className="flex justify-between text-muted-foreground"><dt>{t("serviceFee")}</dt><dd dir="ltr">{formatPrice(0)}</dd></div><div className="flex justify-between border-t pt-3 text-base font-bold"><dt>{t("total")}</dt><dd dir="ltr" className="text-burgundy">{formatPrice(subtotal)}</dd></div></dl>
                  <Button type="button" onClick={sendOrder} className="mt-5 h-12 w-full rounded-xl text-sm font-bold"><Send className="size-4" /> {t("sendOrder")}</Button>
                </section>
                {currency !== "TRY" ? <p className="mt-3 text-center text-xs leading-5 text-muted-foreground">{t("approximateCurrency")}</p> : null}
              </>
            ) : <div className="mt-6"><EmptyState icon={ShoppingBag} title={t("emptyCart")} description={t("emptyCartDescription")} /><Button type="button" onClick={openCategoryHome} className="mt-4 h-11 w-full rounded-xl">{t("browseMenu")}</Button></div>}
          </main>
        ) : null}

        {activeTab === "bill" ? (
          <main className="mx-auto flex min-h-[calc(100dvh-5rem)] max-w-xl items-center px-4 py-8 sm:px-6">
            <section className="w-full rounded-3xl border bg-card p-6 text-center surface-shadow sm:p-8">
              <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-burgundy/8 text-burgundy">{billRequested ? <CircleCheck className="size-7" /> : <ReceiptText className="size-7" />}</div>
              <h1 className="mt-5 font-heading text-2xl font-semibold">{billRequested ? t("billSent") : t("billConfirm")}</h1>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{billRequested ? t("billSentDescription") : t("billConfirmDescription")}</p>
              {!billRequested ? <Button type="button" onClick={() => { setBillRequested(true); toast.success(t("billToast")); }} className="mt-6 h-12 w-full rounded-xl text-sm font-bold">{t("requestBill")}</Button> : <Button type="button" variant="outline" onClick={openCategoryHome} className="mt-6 h-12 w-full rounded-xl">{t("backToMenu")}</Button>}
            </section>
          </main>
        ) : null}
      </div>

      <ProductDetailSheet key={selectedProduct?.id ?? "none"} product={selectedProduct} open={Boolean(selectedProduct)} onOpenChange={(open) => { if (!open) closeProduct(); }} onAdd={addToCart} />

      <Sheet open={waiterOpen} onOpenChange={setWaiterOpen}>
        <SheetContent dir={direction} side="bottom" showCloseButton={false} className="mx-auto max-h-[88dvh] w-full overflow-y-auto rounded-t-3xl p-0 sm:max-w-xl">
          <SheetClose className="absolute right-3 top-3 z-10 inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <X className="size-4" aria-hidden="true" />
            <span className="sr-only">{t("close")}</span>
          </SheetClose>
          <SheetHeader className="px-5 pb-2 pr-14 pt-6 text-start"><div className="mb-2 flex size-11 items-center justify-center rounded-2xl bg-burgundy/8 text-burgundy"><BellRing className="size-5" /></div><SheetTitle className="font-heading text-2xl font-semibold">{t("waiterHelpTitle")}</SheetTitle><SheetDescription>{t("waiterHelpDescription", { table: tableName })}</SheetDescription></SheetHeader>
          <div className="space-y-2 px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3">{waiterOptions.map((option) => <button key={option.type} type="button" onClick={() => sendWaiterCall(option.type)} className="flex min-h-16 w-full items-center justify-between rounded-2xl border bg-card px-4 py-3 text-start transition-colors hover:border-copper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span><span className="block text-sm font-bold">{t(option.titleKey)}</span><span className="mt-0.5 block text-xs text-muted-foreground">{t(option.descriptionKey)}</span></span><ChevronLeft className={cn("size-4 text-muted-foreground", direction === "ltr" && "rotate-180")} /></button>)}</div>
        </SheetContent>
      </Sheet>

      {introComplete ? <BottomNavigation active={activeTab} cartCount={cartCount} onChange={handleTabChange} /> : null}
    </>
  );
}
