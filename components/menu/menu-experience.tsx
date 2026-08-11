"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { BellRing, CheckCircle2, ChevronLeft, CircleCheck, ReceiptText, Search, Send, ShoppingBag, UtensilsCrossed } from "lucide-react";
import { toast } from "sonner";
import { BottomNavigation, type MenuTab } from "@/components/menu/bottom-navigation";
import { CartItem } from "@/components/menu/cart-item";
import { CategoryGrid, type MenuCategory } from "@/components/menu/category-grid";
import { OrderStatusTimeline } from "@/components/menu/order-status-timeline";
import { ProductCard } from "@/components/menu/product-card";
import { ProductDetailSheet } from "@/components/menu/product-detail-sheet";
import { RestaurantHeader } from "@/components/menu/restaurant-header";
import { SplashIntro } from "@/components/menu/splash-intro";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { categories, products } from "@/lib/mock-data";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CartItem as CartItemType, Product, WaiterCallType } from "@/types";

const waiterOptions: { title: WaiterCallType; description: string }[] = [
  { title: "Garson çağır", description: "Genel bir talebim var" },
  { title: "Sipariş vereceğim", description: "Siparişim için yardım istiyorum" },
  { title: "Su istiyorum", description: "Masaya su rica ediyorum" },
  { title: "Ekmek istiyorum", description: "Ekmek servisi rica ediyorum" },
  { title: "Ek servis istiyorum", description: "Çatal, kaşık veya tabak istiyorum" },
  { title: "Diğer", description: "Farklı bir konuda yardıma ihtiyacım var" },
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

  const filteredProducts = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase("tr-TR");
    return publicProducts.filter((product) => {
      const matchesCategory = normalized ? true : Boolean(activeCategory) && product.categoryId === activeCategory;
      const matchesSearch = !normalized || `${product.name} ${product.description} ${product.category}`.toLocaleLowerCase("tr-TR").includes(normalized);
      return matchesCategory && matchesSearch;
    });
  }, [activeCategory, search]);

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
    toast.success(`${product.name} sepete eklendi.`);
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
    toast.success("Talebiniz garsonumuza iletildi.", { description: type });
  }

  function sendOrder() {
    if (!cart.length) return;
    setSubmittedTotal(subtotal);
    setCart([]);
    setOrderSent(true);
    toast.success("Siparişiniz başarıyla gönderildi.");
  }

  return (
    <>
      <SplashIntro onComplete={finishIntro} />
      <div className={cn("menu-content min-h-[100dvh] pb-24", introComplete && "menu-content-ready")} aria-hidden={!introComplete} inert={!introComplete}>
        {activeTab === "menu" ? (
          <>
            <RestaurantHeader tableName={tableName} />
            <main className="mx-auto max-w-5xl px-4 pb-6 pt-5 sm:px-6">
              <div className={cn("relative", !activeCategory && !hasSearch && "mx-auto max-w-3xl")}>
                <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
                <Input value={search} onChange={(event) => handleSearchChange(event.target.value)} placeholder="Menüde ara..." aria-label="Menüde ara" className="h-12 rounded-2xl border-border bg-card pl-11 pr-4 text-base shadow-sm placeholder:text-muted-foreground/70" />
              </div>
              {!activeCategory && !hasSearch ? (
                <section className="mx-auto w-full max-w-3xl pt-6" aria-labelledby="category-heading">
                  <div className="mb-4">
                    <h1 ref={categoryHeadingRef} id="category-heading" tabIndex={-1} className="font-heading text-2xl font-semibold outline-none sm:text-3xl">Kategoriler</h1>
                    <p className="mt-1 text-sm leading-6 text-[#70665C]">Sofranıza yakışan lezzeti seçin.</p>
                  </div>
                  <CategoryGrid categories={menuCategories} onSelect={selectCategory} />
                </section>
              ) : (
                <section className="pt-5">
                  <button type="button" onClick={returnFromProducts} className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-sm font-bold text-burgundy transition-colors hover:bg-burgundy/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <ChevronLeft className="size-4" aria-hidden="true" />
                    {hasSearch && activeCategory ? `${selectedCategory?.name ?? "Kategori"} listesine dön` : "Kategorilere dön"}
                  </button>
                  <div className="mb-4 mt-2 flex items-end justify-between gap-3">
                    <div>
                      <h1 ref={productHeadingRef} id="product-list-heading" tabIndex={-1} className="font-heading text-2xl font-semibold outline-none sm:text-3xl">{hasSearch ? "Arama Sonuçları" : selectedCategory?.name}</h1>
                      <p className="mt-1 text-xs text-[#70665C]" role="status" aria-live="polite">{hasSearch ? `${filteredProducts.length} ürün bulundu` : `${selectedCategory?.productCount ?? filteredProducts.length} ürün`}</p>
                    </div>
                    {hasSearch ? <button type="button" onClick={clearSearch} className="min-h-11 shrink-0 text-sm font-semibold text-burgundy">Aramayı temizle</button> : null}
                  </div>
                  {filteredProducts.length ? (
                    <div className="grid gap-3 lg:grid-cols-2">{filteredProducts.map((product) => <ProductCard key={product.id} product={product} onOpen={() => openProduct(product)} onAdd={() => addToCart(product)} />)}</div>
                  ) : <EmptyState icon={UtensilsCrossed} title="Eşleşen ürün bulunamadı" description="Arama kelimenizi değiştirin veya kategorilere dönün." />}
                </section>
              )}
            </main>
          </>
        ) : null}

        {activeTab === "order" ? (
          <main className="mx-auto max-w-2xl px-4 pb-8 pt-[max(1.5rem,env(safe-area-inset-top))] sm:px-6">
            <div className="flex items-center gap-3"><button type="button" onClick={openCategoryHome} className="touch-target -ml-2 flex items-center justify-center rounded-xl" aria-label="Kategori menüsüne dön"><ChevronLeft /></button><div><h1 className="font-heading text-3xl font-semibold">Siparişim</h1><p className="text-sm text-muted-foreground">{tableName}</p></div></div>
            {orderSent ? (
              <section className="mt-6 rounded-3xl border bg-card p-5 surface-shadow sm:p-6">
                <div className="flex size-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700"><CheckCircle2 className="size-6" /></div>
                <h2 className="mt-4 font-heading text-2xl font-semibold">Siparişiniz mutfağa iletildi</h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">#2420 numaralı siparişinizi buradan takip edebilirsiniz.</p>
                <OrderStatusTimeline currentStep={2} />
                <div className="mt-5 border-t pt-4"><div className="flex justify-between text-sm text-muted-foreground"><span>Toplam</span><strong className="text-lg text-burgundy">{formatCurrency(submittedTotal)}</strong></div></div>
                <Button type="button" variant="outline" onClick={() => { setOrderSent(false); openCategoryHome(); }} className="mt-4 h-11 w-full rounded-xl">Yeni Ürün Ekle</Button>
              </section>
            ) : cart.length ? (
              <>
                <div className="mt-6 space-y-3">{cart.map((item) => <CartItem key={item.id} item={item} onDecrease={() => updateQuantity(item.id, -1)} onIncrease={() => updateQuantity(item.id, 1)} onRemove={() => setCart((current) => current.filter((cartItem) => cartItem.id !== item.id))} />)}</div>
                <section className="mt-5 rounded-2xl border bg-card p-5">
                  <dl className="space-y-3 text-sm"><div className="flex justify-between text-muted-foreground"><dt>Ara toplam</dt><dd>{formatCurrency(subtotal)}</dd></div><div className="flex justify-between text-muted-foreground"><dt>Servis ücreti</dt><dd>{formatCurrency(0)}</dd></div><div className="flex justify-between border-t pt-3 text-base font-bold"><dt>Genel toplam</dt><dd className="text-burgundy">{formatCurrency(subtotal)}</dd></div></dl>
                  <Button type="button" onClick={sendOrder} className="mt-5 h-12 w-full rounded-xl text-sm font-bold"><Send className="size-4" /> Siparişi Gönder</Button>
                </section>
              </>
            ) : <div className="mt-6"><EmptyState icon={ShoppingBag} title="Sepetiniz henüz boş" description="Menüden seçtiğiniz ürünler burada görünecek." /><Button type="button" onClick={openCategoryHome} className="mt-4 h-11 w-full rounded-xl">Menüyü İncele</Button></div>}
          </main>
        ) : null}

        {activeTab === "bill" ? (
          <main className="mx-auto flex min-h-[calc(100dvh-5rem)] max-w-xl items-center px-4 py-8 sm:px-6">
            <section className="w-full rounded-3xl border bg-card p-6 text-center surface-shadow sm:p-8">
              <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-burgundy/8 text-burgundy">{billRequested ? <CircleCheck className="size-7" /> : <ReceiptText className="size-7" />}</div>
              <h1 className="mt-5 font-heading text-2xl font-semibold">{billRequested ? "Hesap talebiniz iletildi" : "Hesabı istemek istediğinize emin misiniz?"}</h1>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{billRequested ? "Garsonumuz kısa süre içinde masanızla ilgilenecek." : "Talebiniz doğrudan garson ekranına düşecek. Ödemeyi kasada veya masada yapabilirsiniz."}</p>
              {!billRequested ? <Button type="button" onClick={() => { setBillRequested(true); toast.success("Hesap talebiniz garsonumuza iletildi."); }} className="mt-6 h-12 w-full rounded-xl text-sm font-bold">Hesabı İste</Button> : <Button type="button" variant="outline" onClick={openCategoryHome} className="mt-6 h-12 w-full rounded-xl">Menüye Dön</Button>}
            </section>
          </main>
        ) : null}
      </div>

      <ProductDetailSheet key={selectedProduct?.id ?? "none"} product={selectedProduct} open={Boolean(selectedProduct)} onOpenChange={(open) => { if (!open) closeProduct(); }} onAdd={addToCart} />

      <Sheet open={waiterOpen} onOpenChange={setWaiterOpen}>
        <SheetContent side="bottom" className="mx-auto max-h-[88dvh] w-full overflow-y-auto rounded-t-3xl p-0 sm:max-w-xl">
          <SheetHeader className="px-5 pb-2 pt-6 text-left"><div className="mb-2 flex size-11 items-center justify-center rounded-2xl bg-burgundy/8 text-burgundy"><BellRing className="size-5" /></div><SheetTitle className="font-heading text-2xl font-semibold">Size nasıl yardımcı olabiliriz?</SheetTitle><SheetDescription>Talebiniz {tableName} bilgisiyle garson ekranına iletilir.</SheetDescription></SheetHeader>
          <div className="space-y-2 px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3">{waiterOptions.map((option) => <button key={option.title} type="button" onClick={() => sendWaiterCall(option.title)} className="flex min-h-16 w-full items-center justify-between rounded-2xl border bg-card px-4 py-3 text-left transition-colors hover:border-copper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span><span className="block text-sm font-bold">{option.title}</span><span className="mt-0.5 block text-xs text-muted-foreground">{option.description}</span></span><ChevronLeft className="size-4 rotate-180 text-muted-foreground" /></button>)}</div>
        </SheetContent>
      </Sheet>

      {introComplete ? <BottomNavigation active={activeTab} cartCount={cartCount} onChange={handleTabChange} /> : null}
    </>
  );
}
