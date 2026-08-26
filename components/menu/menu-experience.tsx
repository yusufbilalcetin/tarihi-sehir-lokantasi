"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BellRing, CheckCircle2, ChevronLeft, CircleCheck, Loader2, ReceiptText, Search, Send, ShoppingBag, UtensilsCrossed, X } from "lucide-react";
import { toast } from "sonner";
import { BottomNavigation, type MenuTab } from "@/components/menu/bottom-navigation";
import { CartItem } from "@/components/menu/cart-item";
import { CustomerFeedbackForm } from "@/components/menu/customer-feedback-form";
import { CategoryChips } from "@/components/menu/category-chips";
import { CategoryGrid, type MenuCategory } from "@/components/menu/category-grid";
import { CurrencySelector } from "@/components/menu/currency-selector";
import { MenuPreferencesProvider, useMenuPreferences } from "@/components/menu/menu-preferences-provider";
import { MenuStateCard } from "@/components/menu/menu-state-card";
import { OrderStatusTimeline } from "@/components/menu/order-status-timeline";
import { ProductCard } from "@/components/menu/product-card";
import { ProductDetailSheet } from "@/components/menu/product-detail-sheet";
import { RestaurantHeader } from "@/components/menu/restaurant-header";
import { SplashIntro } from "@/components/menu/splash-intro";
import { EmptyState } from "@/components/shared/data-states";
import { MotionValue } from "@/components/shared/motion-value";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { menuApiToViewModel, type MenuViewCategory } from "@/lib/adapters/menu-view-model";
import { ApiClientError, newIdempotencyKey } from "@/lib/api/client";
import { menuApi, orderApi, type CreateOrderPayload } from "@/lib/api/endpoints";
import { customerCallStatusTranslationKey, matchesCustomerMenuSearch } from "@/lib/domain/customer-menu";
import { useApiResource } from "@/lib/hooks/use-api-resource";
import { getMenuCategoryName, getMenuProductDescription, getMenuProductName, getMenuTag } from "@/lib/i18n/menu-content";
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

const MENU_VIEW_KEY = "tarihiSehirMenuView";
const MENU_CATEGORY_KEY = "tarihiSehirMenuCategory";
const MENU_PRODUCT_KEY = "tarihiSehirMenuProduct";
const MENU_QUERY_KEY = "tarihiSehirMenuQuery";

/** Guests see live menu/order data without ever refreshing the page. */
const MENU_POLL_MS = 30_000;
const ACTIVE_ORDER_POLL_MS = 12_000;
const ACTIVE_CALL_POLL_MS = 15_000;

const EMPTY_CATEGORIES: readonly MenuViewCategory[] = [];
const EMPTY_PRODUCTS: readonly Product[] = [];

const SESSION_ERROR_CODES = new Set([
  "INVALID_TABLE_TOKEN",
  "AUTHENTICATION_REQUIRED",
  "TABLE_INACTIVE",
]);

type MenuHistoryView = "categories" | "products" | "detail";

function currentHistoryState() {
  return (window.history.state ?? {}) as Record<string, unknown>;
}

function currentHistoryView(): MenuHistoryView | undefined {
  const view = currentHistoryState()[MENU_VIEW_KEY];
  return view === "categories" || view === "products" || view === "detail" ? view : undefined;
}

/** Server copy is Turkish-only, so guests always see a translated message. */
function customerErrorKey(error: unknown): MenuTranslationKey {
  if (!(error instanceof ApiClientError)) return "somethingWentWrong";
  if (error.code === "NETWORK_ERROR") return "networkError";
  if (error.code === "PRODUCT_UNAVAILABLE" || error.code === "PRODUCT_NOT_FOUND") return "productUnavailable";
  if (SESSION_ERROR_CODES.has(error.code)) return "invalidQr";
  if (error.code === "RATE_LIMITED") return "tryAgain";
  return "unableToSendOrder";
}

function unavailableProductId(error: unknown): string | null {
  if (!(error instanceof ApiClientError) || error.code !== "PRODUCT_UNAVAILABLE") return null;
  const details = error.details;
  if (!details || typeof details !== "object" || Array.isArray(details)) return null;
  const productId = (details as Record<string, unknown>).productId;
  return typeof productId === "string" ? productId : null;
}

const ORDER_TIMELINE_STEP: Record<string, number> = {
  NEW: 1,
  CONFIRMED: 2,
  PREPARING: 3,
  READY: 4,
  SERVED: 5,
};

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

export function MenuExperience({ tableNumber }: { tableNumber: number }) {
  return (
    <MenuPreferencesProvider>
      <MenuExperienceContent tableNumber={tableNumber} />
    </MenuPreferencesProvider>
  );
}

function MenuExperienceContent({ tableNumber }: { tableNumber: number }) {
  const { currency, direction, formatPrice, language, languageDefinition, preferencesReady, t } = useMenuPreferences();
  const categoryHeadingRef = useRef<HTMLHeadingElement>(null);
  const productHeadingRef = useRef<HTMLHeadingElement>(null);
  const productTriggerRef = useRef<HTMLElement | null>(null);
  const cartListRef = useRef<HTMLDivElement>(null);
  const historyRestoredRef = useRef(false);
  const idempotencyKeyRef = useRef<string | null>(null);
  const [introComplete, setIntroComplete] = useState(false);
  const [activeTab, setActiveTab] = useState<MenuTab>("menu");
  const [navigationDirection, setNavigationDirection] = useState<"forward" | "back">("forward");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [storedCart, setCart] = useState<CartItemType[]>([]);
  const [waiterOpen, setWaiterOpen] = useState(false);
  const [waiterSending, setWaiterSending] = useState(false);
  const [billSending, setBillSending] = useState(false);
  const [orderResult, setOrderResult] = useState<CreateOrderPayload | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const hasSearch = Boolean(search.trim());

  const loadMenu = useCallback((signal: AbortSignal) => menuApi.get(signal), []);
  const menuResource = useApiResource(loadMenu, { pollMs: MENU_POLL_MS });
  const menu = useMemo(
    () => (menuResource.data ? menuApiToViewModel(menuResource.data) : null),
    [menuResource.data],
  );

  const menuCategories = menu?.categories ?? EMPTY_CATEGORIES;
  const publicProducts = menu?.products ?? EMPTY_PRODUCTS;
  const orderingEnabled = menu?.settings.orderingEnabled ?? false;
  const menuEnabled = menu?.settings.menuEnabled ?? true;
  const menuReady = Boolean(menu);
  const activeMenuCategoryIds = useMemo(
    () => new Set(menuCategories.map((category) => category.id)),
    [menuCategories],
  );

  const loadActiveOrders = useCallback((signal: AbortSignal) => orderApi.active(signal), []);
  const activeOrders = useApiResource(loadActiveOrders, {
    enabled: menuReady,
    pollMs: ACTIVE_ORDER_POLL_MS,
  });
  const loadActiveCalls = useCallback((signal: AbortSignal) => orderApi.activeCalls(signal), []);
  const activeCalls = useApiResource(loadActiveCalls, {
    enabled: menuReady,
    pollMs: ACTIVE_CALL_POLL_MS,
  });
  const waiterCall = activeCalls.data?.calls.find((call) => call.type === "WAITER_CALL") ?? null;
  const billRequest = activeCalls.data?.calls.find((call) => call.type === "BILL_REQUEST") ?? null;
  const billRequested = billRequest !== null;
  const trackedOrder = useMemo(() => {
    const orders = activeOrders.data?.orders ?? [];
    if (orderResult) {
      const matching = orders.find((order) => order.id === orderResult.orderId);
      if (matching) return matching;
    }
    return orders[0] ?? null;
  }, [activeOrders.data, orderResult]);

  // Single transition system (motion doc §49): the panel enter/exit is driven by
  // the .motion-page CSS animation keyed off this direction. No View Transition
  // API on top — the two used to overlap and produce duplicate snapshots.
  function navigateWithDirection(direction: "forward" | "back", update: () => void) {
    setNavigationDirection(direction);
    update();
  }

  const finishIntro = useCallback(() => setIntroComplete(true), []);
  const tableName = useMemo(
    // Passed as text on purpose: `t` runs numbers through Intl.NumberFormat,
    // which is right for quantities and wrong for identifiers — it turned
    // table 9000 into "Masa 9.000".
    () => t("tableNumber", { number: String(menu?.table?.number ?? tableNumber) }),
    [menu?.table?.number, tableNumber, t],
  );
  const selectedCategory = menuCategories.find((category) => category.id === activeCategory);
  const selectedCategoryName = selectedCategory
    ? getMenuCategoryName(selectedCategory, language)
    : "";

  const filteredProducts = useMemo(() => {
    return publicProducts.filter((product) => {
      const matchesCategory = activeCategory ? product.categoryId === activeCategory : true;
      if (!matchesCategory) return false;
      const category = menuCategories.find((item) => item.id === product.categoryId);
      const categoryName = category ? getMenuCategoryName(category, language) : product.category;
      return matchesCustomerMenuSearch(
        search,
        [
          getMenuProductName(product, language),
          getMenuProductDescription(product, language),
          categoryName,
        ],
        languageDefinition.locale,
      );
    });
  }, [activeCategory, language, languageDefinition.locale, menuCategories, publicProducts, search]);
  const featuredProducts = useMemo(
    () => publicProducts.filter((product) => product.featured),
    [publicProducts],
  );
  const popularProducts = useMemo(
    () => publicProducts.filter((product) => product.popular),
    [publicProducts],
  );

  // A live menu can retire a product while it sits in the cart. Deriving the
  // orderable list keeps a sold-out item out of checkout without an effect.
  const availableProductIds = useMemo(
    () => new Set(publicProducts.filter((product) => product.status !== "sold-out").map((product) => product.id)),
    [publicProducts],
  );
  const cart = useMemo(
    () => (menuReady ? storedCart.filter((item) => availableProductIds.has(item.productId)) : storedCart),
    [availableProductIds, menuReady, storedCart],
  );

  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const submittedTotal = orderResult ? Number(orderResult.total) : 0;

  // History restore waits for the first payload; before that no product or
  // category id can be resolved.
  useEffect(() => {
    if (!menuReady || historyRestoredRef.current) return;
    historyRestoredRef.current = true;

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
  }, [activeMenuCategoryIds, menuReady, publicProducts]);

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
        navigateWithDirection("back", () => {
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
  }, [activeCategory, activeMenuCategoryIds, publicProducts, selectedProduct]);

  function resetIdempotency() {
    idempotencyKeyRef.current = null;
  }

  function addToCart(product: Product, quantity = 1, note = "") {
    if (product.status === "sold-out" || !orderingEnabled) return;
    setOrderResult(null);
    resetIdempotency();
    setCart((current) => {
      const matching = current.find((item) => item.productId === product.id && (item.note ?? "") === note);
      if (matching) return current.map((item) => item.id === matching.id ? { ...item, quantity: item.quantity + quantity } : item);
      return [...current, { id: `${product.id}-${Date.now()}`, productId: product.id, productName: product.name, quantity, unitPrice: product.price, note: note || undefined, image: product.image, product }];
    });
  }

  function updateQuantity(id: string, change: number) {
    resetIdempotency();
    setCart((current) => current.map((item) => item.id === id ? { ...item, quantity: Math.max(1, item.quantity + change) } : item));
  }

  function removeCartItem(id: string) {
    resetIdempotency();
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
    navigateWithDirection("back", () => {
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
    navigateWithDirection("forward", () => {
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
    navigateWithDirection("back", () => {
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
    navigateWithDirection(nextDirection, () => setActiveTab(tab));
  }

  function reportFailure(error: unknown) {
    const unavailableId = unavailableProductId(error);
    const unavailable = unavailableId
      ? publicProducts.find((product) => product.id === unavailableId)
      : undefined;
    toast.error(t(customerErrorKey(error)), {
      description: unavailable ? getMenuProductName(unavailable, language) : undefined,
    });
    if (unavailableId) {
      setCart((current) => current.filter((item) => item.productId !== unavailableId));
      void menuResource.refetch();
    }
    if (error instanceof ApiClientError && SESSION_ERROR_CODES.has(error.code)) {
      void menuResource.refetch();
    }
  }

  async function sendWaiterCall(type: WaiterCallType) {
    if (waiterSending) return;
    setWaiterSending(true);
    const option = waiterOptions.find((item) => item.type === type);
    try {
      const call = await orderApi.call(type);
      activeCalls.setData((current) => ({
        calls: [
          ...(current?.calls.filter((item) => item.type !== "WAITER_CALL") ?? []),
          { type: call.type, status: call.status, createdAt: call.createdAt },
        ],
      }));
      setWaiterOpen(false);
      toast.success(t("waiterRequestSent"), { description: option ? t(option.titleKey) : type });
    } catch (error) {
      reportFailure(error);
    } finally {
      setWaiterSending(false);
    }
  }

  async function requestBill() {
    if (billSending) return;
    setBillSending(true);
    try {
      const call = await orderApi.requestBill();
      activeCalls.setData((current) => ({
        calls: [
          ...(current?.calls.filter((item) => item.type !== "BILL_REQUEST") ?? []),
          { type: call.type, status: call.status, createdAt: call.createdAt },
        ],
      }));
      toast.success(t("billToast"));
    } catch (error) {
      reportFailure(error);
    } finally {
      setBillSending(false);
    }
  }

  async function sendOrder() {
    if (!cart.length || submitting || !orderingEnabled) return;
    setSubmitting(true);
    // Reused across retries so a failed-then-retried submit stays one order.
    idempotencyKeyRef.current ??= newIdempotencyKey();

    try {
      const result = await orderApi.create(
        cart.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          ...(item.note ? { note: item.note } : {}),
        })),
        undefined,
        idempotencyKeyRef.current,
      );
      resetIdempotency();
      setCart([]);
      setOrderResult(result);
      toast.success(t("orderSuccess"));
      void activeOrders.refetch();
    } catch (error) {
      reportFailure(error);
    } finally {
      setSubmitting(false);
    }
  }

  if (menuResource.error && !menu) {
    const sessionExpired = menuResource.error.code !== "NETWORK_ERROR";
    return (
      <MenuStateCard
        title={t(sessionExpired ? "invalidQr" : "networkError")}
        description={sessionExpired ? t("menuUnavailable") : t("somethingWentWrong")}
        actionLabel={t("tryAgain")}
        onAction={() => void menuResource.refetch()}
      />
    );
  }

  if (menu && !menuEnabled) {
    return <MenuStateCard title={t("menuUnavailable")} description={t("billSentDescription")} />;
  }

  const contentReady = introComplete && preferencesReady && menuReady;

  return (
    <>
      <SplashIntro onComplete={finishIntro} />
      {introComplete && !contentReady ? (
        <div className="fixed inset-0 z-[90] min-h-[100dvh] bg-[#120c08]" role="status" aria-label={t("loadingLanguage")} />
      ) : null}
      <div dir={direction} lang={languageDefinition.locale} className={cn("menu-content min-h-[100dvh] pb-24", contentReady && "menu-content-ready")} aria-hidden={!contentReady} inert={!contentReady}>
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
                <section className="motion-page mx-auto w-full max-w-3xl pt-6" data-navigation-direction={navigationDirection} aria-labelledby="category-heading">
                  {popularProducts.length ? (
                    <section aria-labelledby="popular-products-title">
                      <h2 id="popular-products-title" className="mb-3 font-heading text-xl font-semibold text-text-primary">
                        {getMenuTag("Popüler", language)}
                      </h2>
                      <div className="-mx-[var(--menu-gutter)] flex snap-x snap-mandatory gap-3 overflow-x-auto px-[var(--menu-gutter)] pb-2 scrollbar-none">
                        {popularProducts.map((product, index) => (
                          <div key={`popular-${product.id}`} className="min-w-[min(86vw,24rem)] snap-start sm:min-w-[22rem]">
                            <ProductCard product={product} index={index} canOrder={orderingEnabled} onOpen={() => openProduct(product)} onAdd={() => addToCart(product)} />
                          </div>
                        ))}
                      </div>
                    </section>
                  ) : null}

                  {featuredProducts.length ? (
                    <section className="mb-8" aria-labelledby="featured-products-heading">
                      <h2 id="featured-products-heading" className="mb-3 font-heading text-xl font-semibold sm:text-2xl">
                        {getMenuTag("Şefin Önerisi", language)}
                      </h2>
                      <div className="-mx-[var(--menu-gutter)] flex snap-x snap-mandatory gap-[var(--menu-grid-gap)] overflow-x-auto px-[var(--menu-gutter)] pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                        {featuredProducts.map((product, index) => (
                          <div key={product.id} className="min-w-[min(86vw,24rem)] snap-start sm:min-w-[22rem]">
                            <ProductCard product={product} index={index} canOrder={orderingEnabled} onOpen={() => openProduct(product)} onAdd={() => addToCart(product)} />
                          </div>
                        ))}
                      </div>
                    </section>
                  ) : null}
                  <div className="mb-5 text-center">
                    <h1 ref={categoryHeadingRef} id="category-heading" tabIndex={-1} className="font-heading text-2xl font-semibold outline-none sm:text-3xl">{t("categories")}</h1>
                    <p className="mx-auto mt-1 max-w-xl text-sm leading-6 text-[#70665C]">{t("categoryIntro")}</p>
                  </div>
                  <CategoryGrid categories={[...menuCategories]} onSelect={selectCategory} />
                </section>
              ) : (
                <section className="motion-page pt-5" data-navigation-direction={navigationDirection}>
                  <button type="button" onClick={returnFromProducts} className="motion-press motion-ripple -ms-2 inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-sm font-bold text-burgundy hover:bg-burgundy/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <ChevronLeft className={cn("size-4", direction === "rtl" && "rotate-180")} aria-hidden="true" />
                    {hasSearch && activeCategory ? t("backToCategory", { name: selectedCategoryName }) : t("backToCategories")}
                  </button>
                  {/* Course-to-course without a round trip through the grid. */}
                  <div className="mt-2">
                    <CategoryChips
                      categories={menuCategories}
                      activeCategoryId={activeCategory}
                      onSelect={selectCategory}
                    />
                  </div>
                  <div className="mb-5 mt-2 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-3 text-center">
                    <div className="col-start-2">
                      <h1 ref={productHeadingRef} id="product-list-heading" tabIndex={-1} className="font-heading text-2xl font-semibold outline-none sm:text-3xl">{hasSearch ? t("searchResults") : selectedCategoryName}</h1>
                      <p className="mt-1 text-xs text-[#70665C]" role="status" aria-live="polite">{hasSearch ? t("productsFound", { count: filteredProducts.length }) : t("itemCount", { count: selectedCategory?.productCount ?? filteredProducts.length })}</p>
                    </div>
                    {hasSearch ? <button type="button" onClick={clearSearch} className="col-start-3 min-h-11 justify-self-end text-sm font-semibold text-burgundy">{t("clearSearch")}</button> : null}
                  </div>
                  {filteredProducts.length ? (
                    <div key={search} data-searching={hasSearch} className="motion-results grid gap-[var(--menu-grid-gap)] lg:grid-cols-2">{filteredProducts.map((product, index) => <ProductCard key={product.id} product={product} index={index} canOrder={orderingEnabled} onOpen={() => openProduct(product)} onAdd={() => addToCart(product)} />)}</div>
                  ) : <EmptyState icon={UtensilsCrossed} title={t("noResults")} description={t("noResultsDescription")} />}
                </section>
              )}
            </main>
          </>
        ) : null}

        {activeTab === "order" ? (
          <main className="motion-page menu-shell menu-shell-narrow pb-8 pt-[max(1.5rem,env(safe-area-inset-top))]" data-navigation-direction={navigationDirection}>
            <div className="relative flex min-h-12 items-center justify-center px-12 text-center"><button type="button" onClick={openCategoryHome} className="motion-press motion-ripple touch-target absolute start-0 flex items-center justify-center rounded-xl" aria-label={t("backToCategories")}><ChevronLeft className={cn(direction === "rtl" && "rotate-180")} /></button><div><h1 className="font-heading text-3xl font-semibold">{t("order")}</h1><p className="text-sm text-muted-foreground">{tableName}</p></div></div>
            {orderResult ? (
              <section className="mt-6 rounded-3xl border bg-card p-5 surface-shadow sm:p-6" aria-live="polite">
                <div className="motion-status flex size-12 items-center justify-center rounded-2xl bg-status-success-tint text-status-success" data-motion-success="true"><CheckCircle2 className="size-6" /></div>
                <h2 className="mt-4 font-heading text-2xl font-semibold">{t("orderSent")}</h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">{t("orderTracking", { number: orderResult.orderNumber })}</p>
                <OrderStatusTimeline currentStep={ORDER_TIMELINE_STEP[trackedOrder?.status ?? "NEW"] ?? 1} />
                <div className="mt-5 space-y-2 border-t pt-4">
                  <div className="flex justify-between text-sm text-text-secondary"><span>{t("yourTable")}</span><span className="font-semibold text-text-primary">{tableName}</span></div>
                  <div className="flex justify-between text-sm text-text-secondary"><span>{t("total")}</span><strong dir="ltr" className="text-lg text-primary"><MotionValue value={formatPrice(submittedTotal)} numericValue={submittedTotal} /></strong></div>
                </div>
                <OrderCurrencyPanel amount={submittedTotal} />
                {trackedOrder?.status === "SERVED" ? <CustomerFeedbackForm orderId={trackedOrder.id} /> : null}
                <Button type="button" variant="outline" onClick={() => { setOrderResult(null); openCategoryHome(); }} className="mt-4 h-11 w-full rounded-xl">{t("newItem")}</Button>
              </section>
            ) : cart.length ? (
              <>
                <div ref={cartListRef} className="mt-6 space-y-3">{cart.map((item, index) => <CartItem key={item.id} item={item} motionIndex={index} onDecrease={() => updateQuantity(item.id, -1)} onIncrease={() => updateQuantity(item.id, 1)} onRemove={() => removeCartItem(item.id)} />)}</div>
                <section className="mt-5 rounded-2xl border bg-card p-5">
                  <dl className="space-y-3 text-sm"><div className="flex justify-between text-muted-foreground"><dt>{t("subtotal")}</dt><dd dir="ltr"><MotionValue value={formatPrice(subtotal)} numericValue={subtotal} delayMs={20} /></dd></div><div className="flex justify-between text-muted-foreground"><dt>{t("serviceFee")}</dt><dd dir="ltr"><MotionValue value={formatPrice(0)} numericValue={0} delayMs={30} /></dd></div><div className="flex justify-between border-t pt-3 text-base font-bold"><dt>{t("total")}</dt><dd dir="ltr" className="text-burgundy"><MotionValue value={formatPrice(subtotal)} numericValue={subtotal} delayMs={40} /></dd></div></dl>
                  <OrderCurrencyPanel amount={subtotal} />
                  <Button type="button" onClick={() => void sendOrder()} disabled={submitting || !orderingEnabled} aria-busy={submitting} className="motion-cta mt-5 h-12 w-full rounded-xl text-sm font-bold">
                    {/* The spinner is the pending state: there is no translated
                        "sending…" string in the catalogue and inventing one
                        would ship untranslated English to 108 languages. */}
                    {submitting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Send className="size-4" aria-hidden="true" />}
                    {t("sendOrder")}
                  </Button>
                </section>
              </>
            ) : trackedOrder ? (
              <section className="mt-6 rounded-3xl border bg-card p-5 surface-shadow sm:p-6" aria-live="polite">
                <div className="motion-status flex size-12 items-center justify-center rounded-2xl bg-status-success-tint text-status-success" data-motion-success="true"><CheckCircle2 className="size-6" /></div>
                <h2 className="mt-4 font-heading text-2xl font-semibold">{t("orderSent")}</h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">{t("orderTracking", { number: trackedOrder.orderNumber })}</p>
                <OrderStatusTimeline currentStep={ORDER_TIMELINE_STEP[trackedOrder.status] ?? 1} />
                <div className="mt-5 border-t pt-4"><div className="flex justify-between text-sm text-muted-foreground"><span>{t("total")}</span><strong dir="ltr" className="text-lg text-burgundy"><MotionValue value={formatPrice(Number(trackedOrder.amounts.total))} numericValue={Number(trackedOrder.amounts.total)} /></strong></div></div>
                {trackedOrder.status === "SERVED" ? <CustomerFeedbackForm orderId={trackedOrder.id} /> : null}
                <Button type="button" variant="outline" onClick={openCategoryHome} className="mt-4 h-11 w-full rounded-xl">{t("newItem")}</Button>
              </section>
            ) : <div className="motion-empty mt-6"><EmptyState icon={ShoppingBag} title={t("emptyCart")} description={t("emptyCartDescription")} /><Button type="button" onClick={openCategoryHome} className="mt-4 h-11 w-full rounded-xl">{t("browseMenu")}</Button></div>}
          </main>
        ) : null}

        {activeTab === "bill" ? (
          <main className="motion-page menu-shell menu-shell-narrow flex min-h-[calc(100dvh-5rem)] items-center py-8" data-navigation-direction={navigationDirection}>
            <section className="w-full rounded-3xl border bg-card p-6 text-center surface-shadow sm:p-8">
              <div key={billRequested ? "success" : "idle"} className="motion-status mx-auto flex size-14 items-center justify-center rounded-2xl bg-burgundy/8 text-burgundy" data-motion-success={billRequested}>{billRequested ? <CircleCheck className="size-7" /> : <ReceiptText className="size-7" />}</div>
              <h1 className="mt-5 font-heading text-2xl font-semibold">{billRequest ? t(customerCallStatusTranslationKey(billRequest.type, billRequest.status)) : t("billConfirm")}</h1>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{billRequested ? t("billSentDescription") : t("billConfirmDescription")}</p>
              <Button
                type="button"
                variant={billRequested ? "outline" : "default"}
                disabled={billSending}
                aria-busy={billSending}
                onClick={billRequested ? openCategoryHome : () => void requestBill()}
                className="motion-cta mt-6 h-12 w-full rounded-xl text-sm font-bold"
              >
                <span key={billRequested ? "back" : "request"} className="motion-action-label">{billRequested ? t("backToMenu") : t("requestBill")}</span>
              </Button>
            </section>
          </main>
        ) : null}
      </div>

      <ProductDetailSheet key={selectedProduct?.id ?? "none"} product={selectedProduct} open={Boolean(selectedProduct)} canOrder={orderingEnabled} onOpenChange={(open) => { if (!open) closeProduct(); }} onAdd={addToCart} />

      <Dialog open={waiterOpen} onOpenChange={setWaiterOpen}>
        <DialogContent dir={direction} showCloseButton={false} className="menu-dialog-scroll flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl flex-col gap-0 overflow-y-auto rounded-3xl border-border p-0 sm:max-w-xl">
          <DialogClose className="absolute end-4 top-4 z-10 inline-flex size-10 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <X className="size-4" aria-hidden="true" />
            <span className="sr-only">{t("close")}</span>
          </DialogClose>
          <DialogHeader className="items-center px-14 pb-4 pt-6 text-center sm:px-16"><div className="mb-1 flex size-11 items-center justify-center rounded-2xl bg-burgundy/8 text-burgundy"><BellRing className="size-5" /></div><DialogTitle className="font-heading text-2xl font-semibold">{t("waiterHelpTitle")}</DialogTitle><DialogDescription className="mx-auto max-w-md">{t("waiterHelpDescription", { table: tableName })}</DialogDescription></DialogHeader>
          {waiterCall ? (
            /* A request is already with the floor. Re-offering the options
               here would invite a duplicate call for the same table; the
               status shown is the one the server returned, not a guess. */
            <div className="border-t px-5 py-6 text-center sm:px-6" aria-live="polite">
              <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-status-success-tint text-status-success">
                <CircleCheck className="size-6" aria-hidden="true" />
              </div>
              <p className="mt-3 text-sm font-semibold text-text-primary">{t(customerCallStatusTranslationKey(waiterCall.type, waiterCall.status))}</p>
              <Button type="button" variant="outline" onClick={() => setWaiterOpen(false)} className="mt-5 h-11 w-full rounded-xl">{t("close")}</Button>
            </div>
          ) : (
          <div className="grid grid-cols-1 gap-3 border-t px-5 py-5 sm:grid-cols-2 sm:px-6">{waiterOptions.map((option) => <button key={option.type} type="button" disabled={waiterSending} aria-busy={waiterSending} onClick={() => void sendWaiterCall(option.type)} className="motion-press motion-ripple motion-hover grid min-h-20 w-full grid-cols-[minmax(0,1fr)_1rem] items-center gap-3 rounded-2xl border bg-card px-4 py-3 text-start hover:border-copper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"><span><span className="block text-sm font-bold">{t(option.titleKey)}</span><span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{t(option.descriptionKey)}</span></span><ChevronLeft className={cn("size-4 text-muted-foreground", direction === "ltr" && "rotate-180")} /></button>)}</div>
          )}
        </DialogContent>
      </Dialog>

      {contentReady ? <BottomNavigation active={waiterOpen ? "waiter" : activeTab} cartCount={cartCount} onChange={handleTabChange} /> : null}
    </>
  );
}
