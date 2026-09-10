"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BellRing, CheckCircle2, ChevronLeft, CircleCheck, Loader2, ReceiptText, Search, Send, ShoppingBag, UtensilsCrossed, X } from "lucide-react";
import { toast } from "sonner";
import { BottomNavigation, type MenuTab } from "@/components/menu/bottom-navigation";
import { CartBar } from "@/components/menu/cart-bar";
import { CategoryJump } from "@/components/menu/category-jump";
import { MenuLoadingSkeleton } from "@/components/menu/menu-loading-skeleton";
import { MenuSections } from "@/components/menu/menu-sections";
import { buildCustomerMenuSections } from "@/lib/adapters/customer-menu-sections";
import { CartItem } from "@/components/menu/cart-item";
import { CustomerFeedbackForm } from "@/components/menu/customer-feedback-form";
import { CurrencySelector } from "@/components/menu/currency-selector";
import { MenuPreferencesProvider, useMenuPreferences } from "@/components/menu/menu-preferences-provider";
import { MenuStateCard } from "@/components/menu/menu-state-card";
import { OrderStatusTimeline } from "@/components/menu/order-status-timeline";
import { OrderDetailsDisclosure, isServableLine } from "@/components/menu/order-details-disclosure";
import { rememberSessionOrder, useSessionOrderIds } from "@/components/menu/session-orders";
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
import { playSound } from "@/lib/audio/sound-effects";
import { customerCallStatusTranslationKey, matchesCustomerMenuSearch } from "@/lib/domain/customer-menu";
import { addMoney, decimalToMinor, minorToDecimal, multiplyMoney } from "@/lib/domain/money";
import { calculateOrderAmounts } from "@/lib/domain/order-mutations";
import { useApiResource } from "@/lib/hooks/use-api-resource";
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

const MENU_VIEW_KEY = "tarihiSehirMenuView";
const MENU_PRODUCT_KEY = "tarihiSehirMenuProduct";

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

type MenuHistoryView = "menu" | "detail";

function currentHistoryState() {
  return (window.history.state ?? {}) as Record<string, unknown>;
}

function currentHistoryView(): MenuHistoryView | undefined {
  const view = currentHistoryState()[MENU_VIEW_KEY];
  if (view === "detail") return "detail";
  // Treat the previous category-first states as the continuous menu so a tab
  // restored across this UI update never lands on an obsolete screen.
  return view === "menu" || view === "categories" || view === "products" ? "menu" : undefined;
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
      {currency !== "TRY" ? <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-muted-foreground">{t("approximateCurrency")}</p> : null}
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
  const productTriggerRef = useRef<HTMLElement | null>(null);
  const cartListRef = useRef<HTMLDivElement>(null);
  const historyRestoredRef = useRef(false);
  const idempotencyKeyRef = useRef<string | null>(null);
  const [introComplete, setIntroComplete] = useState(false);
  const [activeTab, setActiveTab] = useState<MenuTab>("menu");
  const [navigationDirection, setNavigationDirection] = useState<"forward" | "back">("forward");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [menuQuery, setMenuQuery] = useState("");
  const [storedCart, setCart] = useState<CartItemType[]>([]);
  const [waiterOpen, setWaiterOpen] = useState(false);
  const [waiterSending, setWaiterSending] = useState(false);
  const [billSending, setBillSending] = useState(false);
  const [orderResult, setOrderResult] = useState<CreateOrderPayload | null>(null);
  const [submitting, setSubmitting] = useState(false);
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
  /**
   * Every order this visit placed, newest first.
   *
   * The endpoint answers with all unsettled orders at the table, which is not
   * the same thing: an order the previous party left open is also unsettled.
   * Intersecting with the ids this browser was handed at creation keeps the
   * list to the guest's own orders and fails closed on anything else. Once
   * migration 0017 is applied the server scopes by session nonce and this
   * filter becomes redundant rather than load-bearing.
   *
   * Sorted on the server's own `createdAt`, never a device clock.
   */
  const sessionOrderIds = useSessionOrderIds();
  const sessionOrders = useMemo(() => {
    const mine = new Set(sessionOrderIds);
    return (activeOrders.data?.orders ?? [])
      .filter((order) => mine.has(order.id))
      .map((order) => ({
        ...order,
        /**
         * Which order of the visit this was, counted from the browser's own
         * append-only record of what it submitted — not from this array's
         * length. An earlier order that gets settled drops out of the list,
         * and numbering by position would silently renumber the rest: the
         * guest's third order would start calling itself the second.
         */
        sequence: sessionOrderIds.indexOf(order.id) + 1,
      }))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }, [activeOrders.data, sessionOrderIds]);

  /**
   * The newest order drives the status timeline; the rest stay in the summary
   * below it. A freshly submitted order is matched by id so it appears the
   * instant the server confirms it, without waiting for the next poll.
   */
  const trackedOrder = useMemo(() => {
    if (orderResult) {
      const matching = sessionOrders.find((order) => order.id === orderResult.orderId);
      if (matching) return matching;
    }
    return sessionOrders[0] ?? null;
  }, [sessionOrders, orderResult]);

  /**
   * What the visit adds up to.
   *
   * Quantities are summed, not lines: one soup and five ayran is six items.
   * Money is summed in minor units through the shared helpers — the totals are
   * each order's own authoritative figure, never rebuilt from the rows on
   * screen, so discounts, service charge and tax stay exactly as the server
   * calculated them.
   */
  const sessionSummary = useMemo(() => {
    const itemCount = sessionOrders.reduce(
      (sum, order) =>
        sum +
        order.items
          .filter(isServableLine)
          .reduce((lineSum, item) => lineSum + item.quantity, 0),
      0,
    );
    const total = addMoney(
      ...sessionOrders.map((order) => decimalToMinor(order.amounts.total)),
    );
    return {
      orderCount: sessionOrders.length,
      itemCount,
      total: Number(minorToDecimal(total)),
    };
  }, [sessionOrders]);

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
    () => {
      const number = menu?.table?.number ?? tableNumber;
      // A guest must never read a placeholder for the one fact they are most
      // anxious about. No real number, no line.
      return Number.isSafeInteger(number) && number > 0
        ? t("tableNumber", { number: String(number) })
        : null;
    },
    [menu?.table?.number, tableNumber, t],
  );
  // One derivation for the sections, both rails, the category bar and its
  // popover — and for the administrator's preview, which reads the same
  // function so what they approve is what a guest gets.
  const visibleProducts = useMemo(() => {
    if (!menuQuery.trim()) return publicProducts;
    const categoriesById = new Map(menuCategories.map((category) => [category.id, category]));
    return publicProducts.filter((product) => {
      const category = categoriesById.get(product.categoryId);
      return matchesCustomerMenuSearch(
        menuQuery,
        [
          getMenuProductName(product, language),
          getMenuProductDescription(product, language),
          category ? getMenuCategoryName(category, language) : "",
          product.name,
        ],
        languageDefinition.locale,
      );
    });
  }, [language, languageDefinition.locale, menuCategories, menuQuery, publicProducts]);

  const { sections: groupedProducts, featured: featuredProducts, popular: popularProducts } =
    useMemo(
      () => buildCustomerMenuSections(menuCategories, visibleProducts),
      [menuCategories, visibleProducts],
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

  /**
   * What this basket will actually cost, derived by the server's own function.
   *
   * The panel used to print `serviceFee` as a hard-coded zero and set the total
   * equal to the subtotal, while the server charges service on the subtotal and
   * then tax on subtotal *plus* service. Both rates are zero today, so the
   * numbers happened to agree — the moment a restaurant sets either, the guest
   * pressed a button reading one figure and was billed another.
   *
   * `calculateOrderAmounts` is imported rather than reimplemented: it is a pure
   * domain function over primitives, already used by three other client
   * components, and it is the single place order money is derived. A second
   * copy of the formula here is exactly how the two would drift apart again.
   *
   * The lines are summed in minor units too. The old `reduce` added binary
   * floats, which could land a kuruş away from the order the guest is shown
   * next.
   */
  const basket = useMemo(() => {
    const lines = cart.map((item) => ({
      lineTotalMinor: multiplyMoney(decimalToMinor(item.unitPrice.toFixed(2)), item.quantity),
      cancelled: false,
    }));
    return calculateOrderAmounts(
      lines,
      menu?.settings.serviceFeeRate ?? "0.00",
      menu?.settings.taxRate ?? "0.00",
    );
  }, [cart, menu?.settings.serviceFeeRate, menu?.settings.taxRate]);

  const subtotal = Number(basket.subtotal);
  const serviceCharge = Number(basket.serviceCharge);
  const basketTotal = Number(basket.total);
  const sessionTotal = sessionSummary.total;

  // The tab title follows the guest's language. It lives here rather than in
  // the preferences provider, which the admin editor and the tracking page
  // also mount — neither of them wants its own <title> overwritten.
  useEffect(() => {
    document.title = `${t("menu")} | Tarihi Şehir Lokantası`;
  }, [t]);

  // History restore waits for the first payload; before that a product id
  // cannot be resolved.
  useEffect(() => {
    if (!menuReady || historyRestoredRef.current) return;
    historyRestoredRef.current = true;

    const restoreTimer = window.setTimeout(() => {
      const state = currentHistoryState();
      const view = state[MENU_VIEW_KEY];
      const storedProductId = typeof state[MENU_PRODUCT_KEY] === "string" ? state[MENU_PRODUCT_KEY] : null;
      const storedProduct = storedProductId
        ? publicProducts.find((product) => product.id === storedProductId) ?? null
        : null;

      if (view === "detail" && storedProduct) {
        setSelectedProduct(storedProduct);
        return;
      }

      window.history.replaceState(
        {
          ...state,
          [MENU_VIEW_KEY]: "menu",
          [MENU_PRODUCT_KEY]: null,
        },
        "",
      );
    }, 0);

    return () => window.clearTimeout(restoreTimer);
  }, [menuReady, publicProducts]);

  useEffect(() => {
    function handlePopState(event: PopStateEvent) {
      const state = (event.state ?? {}) as Record<string, unknown>;
      const view = state[MENU_VIEW_KEY];
      const productId = typeof state[MENU_PRODUCT_KEY] === "string" ? state[MENU_PRODUCT_KEY] : null;

      if (view === "detail" && productId) {
        setActiveTab("menu");
        setSelectedProduct(publicProducts.find((product) => product.id === productId) ?? null);
        return;
      }

      setNavigationDirection("back");
      setActiveTab("menu");
      setSelectedProduct(null);
      if (selectedProduct) {
        window.requestAnimationFrame(() => productTriggerRef.current?.focus({ preventScroll: true }));
      }
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [publicProducts, selectedProduct]);

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

  function openMenuHome() {
    if (currentHistoryView() === "detail") {
      window.history.back();
      return;
    }
    navigateWithDirection("back", () => {
      setActiveTab("menu");
      setSelectedProduct(null);
    });
  }

  function openProduct(product: Product) {
    productTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    window.history.pushState(
      {
        ...currentHistoryState(),
        [MENU_VIEW_KEY]: "detail",
        [MENU_PRODUCT_KEY]: product.id,
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
      openMenuHome();
      return;
    }
    const tabOrder: MenuTab[] = ["menu", "order", "waiter", "bill"];
    const nextDirection = tabOrder.indexOf(tab) >= tabOrder.indexOf(activeTab) ? "forward" : "back";
    navigateWithDirection(nextDirection, () => setActiveTab(tab));
  }

  function reportFailure(error: unknown) {
    void playSound("error");
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
      void playSound("customer-order-success");
      resetIdempotency();
      setCart([]);
      // The server just told this browser which order is its own.
      rememberSessionOrder(result.orderId);
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
        <MenuLoadingSkeleton label={t("loadingLanguage")} />
      ) : null}
      <div dir={direction} lang={languageDefinition.locale} className={cn("menu-content min-h-[100dvh]", cartCount > 0 ? "pb-[9.5rem]" : "pb-24", contentReady && "menu-content-ready")} aria-hidden={!contentReady} inert={!contentReady}>
        {activeTab === "menu" ? (
          <>
            <RestaurantHeader tableName={tableName} />
            <main className="menu-shell pb-6">
              <h1 className="sr-only">{t("menu")}</h1>
              <div className="relative mx-auto mb-3 max-w-3xl">
                <Search className="pointer-events-none absolute start-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  type="search"
                  value={menuQuery}
                  onChange={(event) => setMenuQuery(event.target.value)}
                  placeholder={t("search")}
                  aria-label={t("searchLabel")}
                  className="h-11 ps-10 pe-11 text-base"
                />
                {menuQuery ? (
                  <button
                    type="button"
                    onClick={() => setMenuQuery("")}
                    className="absolute end-0 top-0 flex size-11 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={t("clearSearch")}
                  >
                    <X className="size-4" aria-hidden="true" />
                  </button>
                ) : null}
              </div>
              <CategoryJump sections={groupedProducts} />
              {currency !== "TRY" ? (
                <p className="mx-auto max-w-3xl text-center text-xs leading-5 text-[#70665C]">
                  {t("approximateCurrency")}
                </p>
              ) : null}
              <section className={cn("motion-page pt-4", currency !== "TRY" && "pt-3")} data-navigation-direction={navigationDirection}>
                <MenuSections
                  sections={groupedProducts}
                  featured={featuredProducts}
                  popular={popularProducts}
                  canOrder={orderingEnabled}
                  onOpenProduct={openProduct}
                  onAddProduct={addToCart}
                  emptyState={
                    menuQuery.trim()
                      ? <EmptyState icon={Search} title={t("noResults")} description={t("noResultsDescription")} />
                      : <EmptyState icon={UtensilsCrossed} title={t("menuUnavailable")} description={t("somethingWentWrong")} />
                  }
                />
              </section>
            </main>
          </>
        ) : null}

        {activeTab === "order" ? (
          <main className="motion-page menu-shell menu-shell-narrow pb-28 pt-[max(1.5rem,env(safe-area-inset-top))]" data-navigation-direction={navigationDirection}>
            <div className="relative flex min-h-12 items-center justify-center px-12 text-center"><button type="button" onClick={openMenuHome} className="motion-press motion-ripple touch-target absolute start-0 flex items-center justify-center rounded-xl" aria-label={t("menu")}><ChevronLeft className={cn(direction === "rtl" && "rotate-180")} /></button><div><h1 className="font-heading text-3xl font-semibold">{t("order")}</h1>{tableName ? <p className="text-sm text-muted-foreground">{tableName}</p> : null}</div></div>
            {orderResult ? (
              <section className="mt-6 rounded-lg border bg-card p-5 surface-shadow sm:p-6" aria-live="polite">
                <div className="motion-status flex size-12 items-center justify-center rounded-md bg-status-success-tint text-status-success" data-motion-success="true"><CheckCircle2 className="size-6" /></div>
                <h2 className="mt-4 font-heading text-2xl font-semibold">{t("orderSent")}</h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">{t("orderTrackingStatus")}</p>
                <OrderStatusTimeline currentStep={ORDER_TIMELINE_STEP[trackedOrder?.status ?? "NEW"] ?? 1} />
                <div className="mt-5 space-y-2 border-t pt-4">
                  {tableName ? <div className="flex justify-between text-sm text-text-secondary"><span>{t("yourTable")}</span><span className="font-semibold text-text-primary">{tableName}</span></div> : null}
                  <div className="flex justify-between text-sm text-text-secondary"><span>{t("total")}</span><strong dir="ltr" className="text-lg text-primary"><MotionValue value={formatPrice(sessionTotal)} numericValue={sessionTotal} /></strong></div>
                </div>
                <OrderDetailsDisclosure orders={sessionOrders} />
                <OrderCurrencyPanel amount={sessionTotal} />
                {trackedOrder?.status === "SERVED" ? <CustomerFeedbackForm orderId={trackedOrder.id} /> : null}
                <Button type="button" variant="outline" onClick={() => { setOrderResult(null); openMenuHome(); }} className="mt-4 h-11 w-full rounded-xl">{t("newItem")}</Button>
              </section>
            ) : cart.length ? (
              <>
                <div ref={cartListRef} className="mt-6 space-y-3">{cart.map((item, index) => <CartItem key={item.id} item={item} motionIndex={index} onDecrease={() => updateQuantity(item.id, -1)} onIncrease={() => updateQuantity(item.id, 1)} onRemove={() => removeCartItem(item.id)} />)}</div>
                {/* §32: with a long basket the totals and the button that sends
                    it were below the fold. They stay above the tab bar now. */}
                <section className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] mt-5 rounded-lg border bg-card p-5 shadow-[var(--shadow-raised)]">
                  <dl className="space-y-3 text-sm"><div className="flex justify-between text-muted-foreground"><dt>{t("subtotal")}</dt><dd dir="ltr"><MotionValue value={formatPrice(subtotal)} numericValue={subtotal} delayMs={20} /></dd></div><div className="flex justify-between text-muted-foreground"><dt>{t("serviceFee")}</dt><dd dir="ltr"><MotionValue value={formatPrice(serviceCharge)} numericValue={serviceCharge} delayMs={30} /></dd></div><div className="flex justify-between border-t pt-3 text-base font-bold"><dt>{t("total")}</dt><dd dir="ltr" className="text-burgundy"><MotionValue value={formatPrice(basketTotal)} numericValue={basketTotal} delayMs={40} /></dd></div></dl>
                  <OrderCurrencyPanel amount={basketTotal} />
                  <Button type="button" onClick={() => void sendOrder()} disabled={submitting || !orderingEnabled} aria-busy={submitting} className="motion-cta mt-5 h-12 w-full rounded-xl text-sm font-bold">
                    {/* The catalogue does carry a translated pending string, so
                        the button says what is happening rather than only
                        spinning at the guest. */}
                    {submitting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Send className="size-4" aria-hidden="true" />}
                    {submitting ? t("sending") : <>{t("sendOrder")} · <MotionValue value={formatPrice(basketTotal)} numericValue={basketTotal} delayMs={40} /></>}
                  </Button>
                </section>
              </>
            ) : trackedOrder ? (
              <section className="mt-6 rounded-lg border bg-card p-5 surface-shadow sm:p-6" aria-live="polite">
                <div className="motion-status flex size-12 items-center justify-center rounded-md bg-status-success-tint text-status-success" data-motion-success="true"><CheckCircle2 className="size-6" /></div>
                <h2 className="mt-4 font-heading text-2xl font-semibold">{t("orderSent")}</h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">{t("orderTrackingStatus")}</p>
                <OrderStatusTimeline currentStep={ORDER_TIMELINE_STEP[trackedOrder.status] ?? 1} />
                <OrderDetailsDisclosure orders={sessionOrders} />
                <div className="mt-5 border-t pt-4"><div className="flex justify-between text-sm text-muted-foreground"><span>{t("total")}</span><strong dir="ltr" className="text-lg text-burgundy"><MotionValue value={formatPrice(sessionTotal)} numericValue={sessionTotal} /></strong></div></div>
                {trackedOrder.status === "SERVED" ? <CustomerFeedbackForm orderId={trackedOrder.id} /> : null}
                <Button type="button" variant="outline" onClick={openMenuHome} className="mt-4 h-11 w-full rounded-xl">{t("newItem")}</Button>
              </section>
            ) : <div className="motion-empty mt-6"><EmptyState icon={ShoppingBag} title={t("emptyCart")} description={t("emptyCartDescription")} /><Button type="button" onClick={openMenuHome} className="mt-4 h-11 w-full rounded-xl">{t("browseMenu")}</Button></div>}
          </main>
        ) : null}

        {activeTab === "bill" ? (
          <main className="motion-page menu-shell menu-shell-narrow flex min-h-[calc(100dvh-5rem)] items-center py-8" data-navigation-direction={navigationDirection}>
            <section className="w-full rounded-lg border bg-card p-6 text-center surface-shadow sm:p-8">
              <div key={billRequested ? "success" : "idle"} className="motion-status mx-auto flex size-14 items-center justify-center rounded-md bg-burgundy/8 text-burgundy" data-motion-success={billRequested}>{billRequested ? <CircleCheck className="size-7" /> : <ReceiptText className="size-7" />}</div>
              <h1 className="mt-5 font-heading text-2xl font-semibold">{billRequest ? t(customerCallStatusTranslationKey(billRequest.type, billRequest.status)) : t("billConfirm")}</h1>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{billRequested ? t("billSentDescription") : t("billConfirmDescription")}</p>
              <Button
                type="button"
                variant={billRequested ? "outline" : "default"}
                disabled={billSending}
                aria-busy={billSending}
                onClick={billRequested ? openMenuHome : () => void requestBill()}
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
        <DialogContent dir={direction} lang={languageDefinition.locale} showCloseButton={false} className="menu-dialog-scroll flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl flex-col gap-0 overflow-y-auto rounded-xl border-copper/35 p-0 sm:max-w-xl">
          <DialogClose className="absolute end-4 top-4 z-10 inline-flex size-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <X className="size-4" aria-hidden="true" />
            <span className="sr-only">{t("close")}</span>
          </DialogClose>
          <DialogHeader className="items-center px-14 pb-4 pt-6 text-center sm:px-16"><div className="mb-1 flex size-11 items-center justify-center rounded-md bg-burgundy/8 text-burgundy"><BellRing className="size-5" /></div><DialogTitle className="font-heading text-2xl font-semibold">{t("waiterHelpTitle")}</DialogTitle>{tableName ? <DialogDescription className="mx-auto max-w-md">{t("waiterHelpDescription", { table: tableName })}</DialogDescription> : null}</DialogHeader>
          {waiterCall ? (
            /* A request is already with the floor. Re-offering the options
               here would invite a duplicate call for the same table; the
               status shown is the one the server returned, not a guess. */
            <div className="border-t px-5 py-6 text-center sm:px-6" aria-live="polite">
              <div className="mx-auto flex size-12 items-center justify-center rounded-md bg-status-success-tint text-status-success">
                <CircleCheck className="size-6" aria-hidden="true" />
              </div>
              <p className="mt-3 text-sm font-semibold text-text-primary">{t(customerCallStatusTranslationKey(waiterCall.type, waiterCall.status))}</p>
              <Button type="button" variant="outline" onClick={() => setWaiterOpen(false)} className="mt-5 h-11 w-full rounded-xl">{t("close")}</Button>
            </div>
          ) : (
          <div className="grid grid-cols-1 gap-3 border-t px-5 py-5 sm:grid-cols-2 sm:px-6">{waiterOptions.map((option) => <button key={option.type} type="button" disabled={waiterSending} aria-busy={waiterSending} onClick={() => void sendWaiterCall(option.type)} className="motion-press motion-ripple motion-hover grid min-h-20 w-full grid-cols-[minmax(0,1fr)_1rem] items-center gap-3 rounded-lg border bg-card px-4 py-3 text-start hover:border-copper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"><span><span className="block text-sm font-bold">{t(option.titleKey)}</span><span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{t(option.descriptionKey)}</span></span><ChevronLeft className={cn("size-4 text-muted-foreground", direction === "ltr" && "rotate-180")} /></button>)}</div>
          )}
        </DialogContent>
      </Dialog>

      {contentReady ? (
        <BottomNavigation
          active={waiterOpen ? "waiter" : activeTab}
          cartCount={cartCount}
          cartSlot={
            activeTab === "menu" ? (
              <CartBar count={cartCount} total={basketTotal} onOpen={() => handleTabChange("order")} />
            ) : null
          }
          onChange={handleTabChange}
        />
      ) : null}
    </>
  );
}
