"use client";

import { useCallback } from "react";
import { Check, Circle, CircleDot, X } from "lucide-react";

import {
  MenuPreferencesProvider,
  useMenuPreferences,
} from "@/components/menu/menu-preferences-provider";
import { Button } from "@/components/ui/button";
import { guestApi, type OrderTrackingPayload } from "@/lib/api/endpoints";
import { useApiResource } from "@/lib/hooks/use-api-resource";
import type { MenuTranslationKey } from "@/lib/i18n/menu-translations";
import { cn } from "@/lib/utils";

/**
 * Where a takeaway or courier guest watches their own order.
 *
 * Nothing is asked of them: the capability minted when the order was placed
 * travels in an HttpOnly cookie, so this page has no order number to type, no
 * identifier in its URL and nothing in it to guess. Without that capability
 * there is simply nothing to show — which is a sentence, not an error.
 *
 * The words are the guest's own language throughout. The server sends the step
 * the order has reached as a key into the same menu dictionary the ordering
 * screen uses, so a guest reading in Arabic is not handed a Turkish status
 * line halfway through their evening.
 */

const STEP_ICON = { done: Check, current: CircleDot, upcoming: Circle } as const;

export function OrderTracking() {
  return (
    <MenuPreferencesProvider>
      <OrderTrackingContent />
    </MenuPreferencesProvider>
  );
}

function OrderTrackingContent() {
  const { t, formatPrice, languageDefinition } = useMenuPreferences();
  const load = useCallback((signal: AbortSignal) => guestApi.tracking(signal), []);
  // The refresh model of the project, unchanged: REST is the source of truth
  // and the poll is only a nudge. `useApiResource` already pauses while the tab
  // is hidden, revalidates on focus and collapses overlapping runs into one.
  const resource = useApiResource(load, { pollMs: 30_000 });
  const order = resource.data?.order ?? null;

  // A 4xx here is the deployment answering: the capability expired, or this
  // browser never had one. Retrying re-asks a question already answered.
  const missing =
    resource.error !== null && resource.error.status >= 400 && resource.error.status < 500;

  return (
    <main className="mx-auto min-h-dvh w-full max-w-lg px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-5">
      <h1 className="font-heading text-xl font-bold text-text-primary">
        {t("orderTrackingTitle")}
      </h1>

      {resource.loading ? (
        <div
          className="mt-6 space-y-3"
          role="status"
          aria-busy="true"
          aria-label={t("orderTrackingTitle")}
        >
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="h-12 animate-pulse rounded-xl border border-border-subtle bg-surface-muted/60"
            />
          ))}
        </div>
      ) : missing || !order ? (
        <div className="mt-8 rounded-2xl border border-dashed border-border-strong px-5 py-10 text-center">
          <p className="text-base font-semibold text-text-primary">{t("trackNotFound")}</p>
          <p className="mt-2 text-sm leading-6 text-text-secondary">
            {t("trackNotFoundDescription")}
          </p>
        </div>
      ) : resource.error ? (
        <div
          role="alert"
          className="mt-8 rounded-2xl border border-border-strong px-5 py-8 text-center"
        >
          <p className="text-sm font-semibold text-status-danger">{t("networkError")}</p>
          <Button
            type="button"
            variant="outline"
            className="mt-4 min-h-11"
            disabled={resource.refreshing}
            onClick={() => void resource.refetch()}
          >
            {t("tryAgain")}
          </Button>
        </div>
      ) : (
        <OrderProgress
          order={order}
          t={t}
          formatPrice={formatPrice}
          locale={languageDefinition.locale}
        />
      )}
    </main>
  );
}

function OrderProgress({
  order,
  t,
  formatPrice,
  locale,
}: {
  readonly order: OrderTrackingPayload;
  readonly t: (key: MenuTranslationKey) => string;
  readonly formatPrice: (priceTRY: number) => string;
  readonly locale: string;
}) {
  return (
    <>
      <header className="mt-4 rounded-2xl border border-border-subtle bg-surface-raised p-4">
        <p className="text-sm font-semibold text-text-secondary">
          {t(order.channel === "DELIVERY" ? "deliveryOrder" : "takeawayOrder")}
        </p>
        <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-text-primary">
          {order.orderNumber}
        </p>
        <p className="mt-2 text-xs text-text-muted">
          {t("placedAt")}:{" "}
          <time dateTime={order.placedAt}>
            {new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(
              new Date(order.placedAt),
            )}
          </time>
        </p>
      </header>

      {/* Words and icons, never colour alone, and the step the order is on is
          announced as the current one. */}
      <ol className="mt-5 space-y-1" aria-label={t("orderStatus")}>
        {order.steps.map((step) => {
          const cancelled = step.key === "trackCancelled";
          const Icon = cancelled ? X : STEP_ICON[step.state];
          return (
            <li
              key={step.key}
              aria-current={step.state === "current" ? "step" : undefined}
              className={cn(
                "flex min-h-12 items-center gap-3 rounded-xl px-3 py-2",
                step.state === "current" && !cancelled && "bg-primary/10",
                cancelled && "bg-status-danger-tint",
              )}
            >
              <Icon
                aria-hidden="true"
                className={cn(
                  "size-5 shrink-0",
                  cancelled
                    ? "text-status-danger"
                    : step.state === "upcoming"
                      ? "text-text-muted"
                      : "text-primary",
                )}
              />
              <span
                className={cn(
                  "text-sm",
                  step.state === "upcoming"
                    ? "text-text-muted"
                    : "font-semibold text-text-primary",
                  cancelled && "font-semibold text-status-danger",
                )}
              >
                {t(step.key as MenuTranslationKey)}
              </span>
              <span className="sr-only">
                {t(
                  step.state === "done"
                    ? "trackStepDone"
                    : step.state === "current"
                      ? "trackStepCurrent"
                      : "trackStepUpcoming",
                )}
              </span>
            </li>
          );
        })}
      </ol>

      <section className="mt-6 rounded-2xl border border-border-subtle bg-surface-raised p-4">
        <h2 className="font-heading text-base font-semibold text-text-primary">
          {t("orderContents")}
        </h2>
        <ul className="mt-2 space-y-1.5">
          {order.items.map((item) => (
            <li
              key={`${item.name}-${item.quantity}`}
              className="flex items-baseline justify-between gap-3 text-sm text-text-secondary"
            >
              <span className="min-w-0">{item.name}</span>
              <span className="shrink-0 tabular-nums">×{item.quantity}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 flex items-baseline justify-between border-t border-border-subtle pt-3 text-sm font-semibold text-text-primary">
          <span>{t("total")}</span>
          <span className="tabular-nums">{formatPrice(Number(order.total))}</span>
        </p>
        <p className="mt-1 text-xs text-text-muted">{t("amountConfirmedLater")}</p>
      </section>
    </>
  );
}
