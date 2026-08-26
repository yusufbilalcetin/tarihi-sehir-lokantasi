"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Bike, ShoppingBag, Trash2 } from "lucide-react";

import { CartItem } from "@/components/menu/cart-item";
import { CategoryChips } from "@/components/menu/category-chips";
import { MenuStateCard } from "@/components/menu/menu-state-card";
import { MenuPreferencesProvider, useMenuPreferences } from "@/components/menu/menu-preferences-provider";
import { ProductCard } from "@/components/menu/product-card";
import { ProductDetailSheet } from "@/components/menu/product-detail-sheet";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ApiClientError, newIdempotencyKey } from "@/lib/api/client";
import { guestApi, type GuestOrderPayload } from "@/lib/api/endpoints";
import { menuApiToViewModel } from "@/lib/adapters/menu-view-model";
import { useApiResource } from "@/lib/hooks/use-api-resource";
import type { MenuTranslationKey } from "@/lib/i18n/menu-translations";
import { cn } from "@/lib/utils";
import type { CartItem as CartItemType, Product } from "@/types";

/**
 * Ordering from the street rather than from a table.
 *
 * The menu on this page is the menu: the same cards, the same detail sheet,
 * the same cart rows the QR flow uses, because a guest ordering a takeaway is
 * looking at the same food. What is different is only what surrounds it —
 * there is no table, so the page starts by asking how the food should reach
 * them, and ends by asking the least it can get away with: a name, a number,
 * and for a courier, somewhere to go.
 *
 * The QR flow is untouched. This is a second composition over the same
 * presentational parts, not a generalisation of the first one.
 */

type Channel = "TAKEAWAY" | "DELIVERY";
type Step = "channel" | "menu" | "contact" | "done";

/**
 * The two doors, as keys into the language the guest chose rather than as
 * words.
 *
 * No enum reaches the page and no sentence is written here: this screen is read
 * in whichever of the supported languages the guest picked for the menu, and a
 * Turkish label frozen into this file could not follow them.
 */
const CHANNELS: readonly {
  id: Channel;
  label: MenuTranslationKey;
  hint: MenuTranslationKey;
  icon: typeof ShoppingBag;
}[] = [
  { id: "TAKEAWAY", label: "takeawayOption", hint: "takeawayHint", icon: ShoppingBag },
  { id: "DELIVERY", label: "deliveryOption", hint: "deliveryHint", icon: Bike },
];

const CHANNEL_TITLE: Readonly<Record<Channel, MenuTranslationKey>> = {
  TAKEAWAY: "takeawayOrder",
  DELIVERY: "deliveryOrder",
};

export function GuestOrderExperience({ restaurantSlug }: { readonly restaurantSlug: string }) {
  return (
    <MenuPreferencesProvider>
      <GuestOrderContent restaurantSlug={restaurantSlug} />
    </MenuPreferencesProvider>
  );
}

function GuestOrderContent({ restaurantSlug }: { readonly restaurantSlug: string }) {
  const { formatPrice, t } = useMenuPreferences();

  const [step, setStep] = useState<Step>("channel");
  const [channel, setChannel] = useState<Channel | null>(null);
  const [cart, setCart] = useState<CartItemType[]>([]);
  // Null means "everything"; the chips themselves only name real categories.
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<Product | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [contact, setContact] = useState("");
  const [address, setAddress] = useState("");
  const [deliveryNotes, setDeliveryNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<GuestOrderPayload | null>(null);

  // Held across retries so a submit that timed out and was tried again stays
  // one order. Cleared only when the cart itself changes.
  const idempotencyKeyRef = useRef<string | null>(null);
  const resetIdempotency = () => {
    idempotencyKeyRef.current = null;
  };

  // The session must exist before the menu can be read, so one call opens it
  // and the next reads the menu through it.
  const load = useCallback(
    async (signal: AbortSignal) => {
      await guestApi.openSession(restaurantSlug);
      return guestApi.menu(signal);
    },
    [restaurantSlug],
  );
  const resource = useApiResource(load);

  const menu = useMemo(
    () => (resource.data ? menuApiToViewModel(resource.data) : null),
    [resource.data],
  );

  const products = useMemo(() => {
    if (!menu) return [];
    const term = search.trim().toLocaleLowerCase("tr-TR");
    return menu.products.filter((product) => {
      if (activeCategory !== null && product.categoryId !== activeCategory) return false;
      if (!term) return true;
      return (
        product.name.toLocaleLowerCase("tr-TR").includes(term) ||
        product.description.toLocaleLowerCase("tr-TR").includes(term)
      );
    });
  }, [menu, activeCategory, search]);

  const cartTotal = useMemo(
    () => cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0),
    [cart],
  );
  const cartCount = useMemo(() => cart.reduce((sum, item) => sum + item.quantity, 0), [cart]);

  function addToCart(product: Product, quantity: number, note: string) {
    if (product.status === "sold-out") return;
    resetIdempotency();
    setSubmitError(null);
    setCart((current) => {
      const matching = current.find(
        (item) => item.productId === product.id && (item.note ?? "") === note,
      );
      if (matching) {
        return current.map((item) =>
          item.id === matching.id ? { ...item, quantity: item.quantity + quantity } : item,
        );
      }
      return [
        ...current,
        {
          id: `${product.id}-${current.length}-${note}`,
          productId: product.id,
          productName: product.name,
          quantity,
          unitPrice: product.price,
          note: note || undefined,
          image: product.image,
          product,
        },
      ];
    });
  }

  function changeQuantity(id: string, delta: number) {
    resetIdempotency();
    setCart((current) =>
      current.flatMap((item) => {
        if (item.id !== id) return [item];
        const next = item.quantity + delta;
        return next < 1 ? [] : [{ ...item, quantity: next }];
      }),
    );
  }

  function removeFromCart(id: string) {
    resetIdempotency();
    setCart((current) => current.filter((item) => item.id !== id));
  }

  async function submit() {
    if (!channel || submitting || cart.length === 0) return;
    setSubmitting(true);
    setSubmitError(null);
    idempotencyKeyRef.current ??= newIdempotencyKey();
    try {
      const result = await guestApi.createOrder(
        {
          channel,
          items: cart.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            ...(item.note ? { note: item.note } : {}),
          })),
          customerName: customerName.trim(),
          contact: contact.trim(),
          ...(channel === "DELIVERY" ? { address: address.trim() } : {}),
          ...(deliveryNotes.trim() ? { deliveryNotes: deliveryNotes.trim() } : {}),
        },
        idempotencyKeyRef.current,
      );
      resetIdempotency();
      setCart([]);
      setConfirmation(result);
      setStep("done");
    } catch (error) {
      // The refusal itself is a Turkish sentence from the API, which is not
      // necessarily the language being read here — and nothing on this screen
      // logs, because everything it holds is a person's name, number and
      // address. What it can say in the reader's own words it says: an expired
      // ordering session is a different problem from a refused order, and the
      // form has already checked everything else it could check.
      setSubmitError(
        error instanceof ApiClientError && error.status === 401
          ? t("sessionExpired")
          : t("orderNotSent"),
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (resource.loading && !menu) {
    return (
      <GuestShell>
        <p className="py-16 text-center text-sm text-text-secondary">{t("menuLoading")}</p>     </GuestShell>
    );
  }

  if (resource.error && !menu) {
    return (
      <GuestShell>
        <MenuStateCard
          title={t("orderingClosed")}
          description={t("orderingClosedDescription")}
          actionLabel={t("tryAgain")}
          onAction={() => void resource.refetch()}
        />
      </GuestShell>
    );
  }

  if (step === "done" && confirmation) {
    return (
      <GuestShell>
        <div className="mx-auto max-w-md py-10 text-center">
          <h1 className="font-heading text-2xl font-bold text-text-primary">{t("orderPlaced")}</h1>
          <p className="mt-2 text-base font-semibold text-text-secondary">
            {t(channel === "DELIVERY" ? "deliveryOrder" : "takeawayOrder")}
          </p>
          <p className="mt-4 font-mono text-3xl font-bold tabular-nums text-text-primary">
            {confirmation.orderNumber}
          </p>
          <p className="mt-4 text-sm leading-6 text-text-secondary">
            {t(channel === "DELIVERY" ? "deliveryNextStep" : "takeawayNextStep")}
          </p>
          {/* The order number is what the guest reads out at the counter. What
              authorises the tracking page is the capability set as an HttpOnly
              cookie when the order was created, so this link carries nothing. */}
          <Link
            href="/order/track"
            className={cn(buttonVariants(), "mt-6 min-h-12 w-full text-base")}
          >
            {t("trackMyOrder")}
          </Link>
        </div>
      </GuestShell>
    );
  }

  if (step === "channel") {
    return (
      <GuestShell restaurantName={menu?.restaurantName}>
        <div className="mx-auto max-w-md py-8">
          <h1 className="text-center font-heading text-2xl font-bold text-text-primary">
            {t("guestChannelQuestion")}
          </h1>
          <div className="mt-8 grid gap-3">
            {CHANNELS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  setChannel(option.id);
                  setStep("menu");
                }}
                className="flex min-h-[4.5rem] w-full items-center gap-4 rounded-2xl border border-border-strong bg-surface-raised px-5 py-4 text-start transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <option.icon className="size-5" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block text-base font-semibold text-text-primary">
                    {t(option.label)}
                  </span>
                  <span className="mt-0.5 block text-sm text-text-secondary">{t(option.hint)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </GuestShell>
    );
  }

  if (step === "contact" && channel) {
    const nameValid = customerName.trim().length >= 2;
    const contactValid = contact.trim().length >= 7;
    const addressValid = channel === "TAKEAWAY" || address.trim().length > 0;
    const ready = nameValid && contactValid && addressValid && cart.length > 0;

    return (
      <GuestShell restaurantName={menu?.restaurantName} title={t(CHANNEL_TITLE[channel])}>
        <form
          className="mx-auto max-w-md space-y-5 py-6"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="space-y-1.5">
            <label htmlFor="guest-name" className="text-sm font-semibold text-text-primary">
              {t("fullName")}
            </label>
            <Input
              id="guest-name"
              value={customerName}
              onChange={(event) => setCustomerName(event.target.value)}
              autoComplete="name"
              required
              aria-describedby={nameValid || !customerName ? undefined : "guest-name-error"}
              className="min-h-11"
            />
            {customerName && !nameValid ? (
              <p id="guest-name-error" className="text-sm text-status-danger">
                {t("nameError")}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="guest-contact" className="text-sm font-semibold text-text-primary">
              {t("phone")}
            </label>
            <Input
              id="guest-contact"
              value={contact}
              onChange={(event) => setContact(event.target.value)}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              required
              aria-describedby={contactValid || !contact ? undefined : "guest-contact-error"}
              className="min-h-11"
            />
            {contact && !contactValid ? (
              <p id="guest-contact-error" className="text-sm text-status-danger">
                {t("phoneError")}
              </p>
            ) : null}
          </div>

          {channel === "DELIVERY" ? (
            <>
              <div className="space-y-1.5">
                <label htmlFor="guest-address" className="text-sm font-semibold text-text-primary">
                  {t("deliveryAddress")}
                </label>
                <Textarea
                  id="guest-address"
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                  rows={4}
                  autoComplete="street-address"
                  required
                  className="min-h-28"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="guest-delivery-note" className="text-sm font-semibold text-text-primary">
                  {t("deliveryNote")} <span className="font-normal text-text-muted">{t("optionalField")}</span>
                </label>
                <Textarea
                  id="guest-delivery-note"
                  value={deliveryNotes}
                  onChange={(event) => setDeliveryNotes(event.target.value)}
                  rows={2}
                />
              </div>
            </>
          ) : null}

          <div className="rounded-2xl border border-border-subtle bg-surface-muted/50 p-4">
            <p className="flex items-baseline justify-between text-sm font-semibold text-text-primary">
              <span>{t("itemCount", { count: cartCount })}</span>
              <span className="tabular-nums">{formatPrice(cartTotal)}</span>
            </p>
            <p className="mt-1 text-xs text-text-muted">{t("amountConfirmedLater")}</p>
          </div>

          {submitError ? (
            <p role="alert" className="rounded-xl bg-status-danger-tint px-4 py-3 text-sm text-status-danger">
              {submitError}
            </p>
          ) : null}

          <div className="flex gap-2">
            <Button type="button" variant="outline" className="min-h-12 flex-1" onClick={() => setStep("menu")}>
              {t("backToMenu")}
            </Button>
            <Button type="submit" className="min-h-12 flex-[2]" disabled={!ready || submitting}>
              {submitting ? t("sending") : t("sendOrder")}
            </Button>         </div>
        </form>
      </GuestShell>
    );
  }

  return (
    <GuestShell
      restaurantName={menu?.restaurantName}
      title={channel ? t(CHANNEL_TITLE[channel]) : undefined}
    >
      <div className="space-y-4 pb-32">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("searchLabel")}
          aria-label={t("searchLabel")}
          className="min-h-11"
        />

        {menu ? (
          <div className="space-y-2">
            <CategoryChips
              categories={menu.categories}
              activeCategoryId={activeCategory}
              onSelect={(category) =>
                setActiveCategory((current) => (current === category.id ? null : category.id))
              }
            />
            {activeCategory !== null ? (
              <button
                type="button"
                onClick={() => setActiveCategory(null)}
                className="min-h-11 text-sm font-medium text-text-secondary underline-offset-4 hover:underline"
              >
                {t("showAllMenu")}
              </button>
            ) : null}
          </div>
        ) : null}

        {products.length === 0 ? (
          <MenuStateCard title={t("noResults")} description={t("noResultsDescription")} />
        ) : (
          <div className="grid gap-3">
            {products.map((product, index) => (
              <ProductCard
                key={product.id}
                product={product}
                index={index}
                onOpen={() => setDetail(product)}
                onAdd={() => addToCart(product, 1, "")}
              />
            ))}
          </div>
        )}

        {cart.length > 0 ? (
          <section
            aria-label={t("cart")}
            className="space-y-2 rounded-2xl border border-border-subtle bg-surface-raised p-4"
          >
            <h2 className="font-heading text-lg font-semibold text-text-primary">{t("cart")}</h2>
            {cart.map((item, index) => (
              <CartItem
                key={item.id}
                item={item}
                motionIndex={index}
                onDecrease={() => changeQuantity(item.id, -1)}
                onIncrease={() => changeQuantity(item.id, 1)}
                onRemove={() => removeFromCart(item.id)}
              />
            ))}
            <button
              type="button"
              onClick={() => {
                resetIdempotency();
                setCart([]);
              }}
              className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-text-muted hover:text-status-danger"
            >
              <Trash2 className="size-4" aria-hidden="true" />
              {t("clearCart")}
            </button>
          </section>
        ) : null}
      </div>

      <ProductDetailSheet
        product={detail}
        open={detail !== null}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
        onAdd={(product, quantity, note) => {
          addToCart(product, quantity, note);
          setDetail(null);
        }}
      />

      {cart.length > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-[var(--z-sticky)] border-t border-border-subtle bg-surface-raised/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
          <Button className="min-h-12 w-full text-base" onClick={() => setStep("contact")}>
            <span className="flex-1 text-start">
              {t("confirmCart")} - {t("itemCount", { count: cartCount })}
            </span>
            <span className="tabular-nums">{formatPrice(cartTotal)}</span>
          </Button>
        </div>
      ) : null}
    </GuestShell>
  );
}

function GuestShell({
  children,
  restaurantName,
  title,
}: {
  readonly children: React.ReactNode;
  readonly restaurantName?: string;
  readonly title?: string;
}) {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl px-4 py-4">
      <header className="pb-4">
        <p className="font-heading text-lg font-semibold text-text-primary">
          {restaurantName ?? "Tarihi Şehir Lokantası"}
        </p>
        {title ? <p className="text-sm font-medium text-text-secondary">{title}</p> : null}
      </header>
      {children}
    </main>
  );
}
