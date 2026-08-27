"use client";

import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";

import { useMenuPreferences } from "@/components/menu/menu-preferences-provider";
import { cn } from "@/lib/utils";

/**
 * Everything the guest has ordered this visit, folded away until they ask.
 *
 * The tracking screen answers "where is my food", so the dishes are secondary:
 * one tap away rather than permanently pushing the timeline and the total down
 * the page. Collapsed by default for the same reason.
 *
 * It lists every order of the visit, not just the newest. A guest who orders
 * soup, then a kebab twenty minutes later, has two orders — the first one used
 * to vanish from the screen the moment the second arrived, which is exactly
 * the question this panel exists to answer.
 *
 * Inline, never an overlay: the guest is already on the page this belongs to,
 * and a dialog over a status screen would hide what they came to watch.
 */

export interface CustomerOrderLine {
  /** React key only. Never rendered. */
  readonly id: string;
  readonly productName: string;
  readonly quantity: number;
  readonly lineTotal: string;
  readonly notes: string | null;
  readonly status: string;
}

export interface CustomerSessionOrder {
  /** React key only. Never rendered. */
  readonly id: string;
  /**
   * Which order of this visit it was: 1 for the first the guest sent, 2 for
   * the next. A presentation label, never an identifier — the real
   * `orderNumber` stays on the order for the kitchen, the till and the staff
   * screens, it is simply not what a guest at a table needs to read.
   *
   * Counted from the browser's own append-only record of what it submitted,
   * so it does not shift when an earlier order is settled and drops out of
   * the list.
   */
  readonly sequence: number;
  readonly status: string;
  readonly createdAt: string;
  readonly items: readonly CustomerOrderLine[];
}

/**
 * A line the kitchen struck off is not part of what is coming, so it is not
 * listed and its quantity is not counted — the same rule
 * `CustomerOrderQueryService.getTrackedOrder` already applies.
 */
export function isServableLine(line: CustomerOrderLine): boolean {
  return line.status !== "CANCELLED" && line.status !== "VOIDED";
}

/** The customer wording for each stage, in the order the timeline shows them. */
const STATUS_LABEL_KEY = {
  NEW: "orderReceived",
  CONFIRMED: "waiterConfirmed",
  PREPARING: "preparing",
  READY: "ready",
  SERVED: "served",
} as const;

export function OrderDetailsDisclosure({ orders }: { orders: readonly CustomerSessionOrder[] }) {
  const { formatPrice, language, t } = useMenuPreferences();
  const [open, setOpen] = useState(false);
  const regionId = useId();

  const sections = orders
    .map((order) => ({ order, lines: order.items.filter(isServableLine) }))
    .filter((section) => section.lines.length > 0);
  if (sections.length === 0) return null;

  const itemCount = sections.reduce(
    (sum, section) => sum + section.lines.reduce((lineSum, line) => lineSum + line.quantity, 0),
    0,
  );
  const clock = new Intl.DateTimeFormat(language, { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="mt-4 border-t pt-1">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls={regionId}
        className="motion-press flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-1 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span className="truncate text-sm font-bold text-text-primary">{t("orderSummary")}</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {/* The order count only appears once there is more than one, so a
                single order never reads as "1 orders" in the languages whose
                counters are not plural-aware. */}
            {sections.length > 1 ? `${t("orderCount", { count: sections.length })} · ` : ""}
            {t("itemCount", { count: itemCount })}
          </span>
        </span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform duration-[var(--motion-quick)] ease-[var(--ease-out)]",
            open && "rotate-180",
          )}
          aria-hidden="true"
        />
      </button>

      {/*
        Expands downward by animating grid rows from 0fr to 1fr. The row is the
        only animated property and the browser resolves the height itself, so
        nothing measures the DOM on a frame loop the way an animated
        `height: auto` has to. One region expands, not one per order.
      */}
      <div id={regionId} data-open={open} className="motion-disclosure" role="region">
        <div className="overflow-hidden">
          <div className="space-y-4 pb-2 pt-1">
            {sections.map(({ order, lines }) => (
              <section
                key={order.id}
                aria-label={t("orderSequence", { number: order.sequence })}
                className="first:pt-0"
              >
                <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <span className="text-xs font-bold text-text-primary">
                    {t("orderSequence", { number: order.sequence })}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    <span className="tabular-nums">{clock.format(new Date(order.createdAt))}</span>
                    {" · "}
                    {t(STATUS_LABEL_KEY[order.status as keyof typeof STATUS_LABEL_KEY] ?? "orderStatus")}
                  </span>
                </header>
                <ul className="mt-1.5 space-y-2">
                  {lines.map((line) => (
                    <li key={line.id} className="flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        <span className="text-sm leading-6 text-text-primary">
                          <span className="font-bold tabular-nums">{line.quantity} ×</span>{" "}
                          {line.productName}
                        </span>
                        {line.notes ? (
                          <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                            {t("note")}: {line.notes}
                          </span>
                        ) : null}
                      </span>
                      {/* Same formatter as the total below, so a guest reading
                          in euros never sees one row priced in lira. */}
                      <span
                        dir="ltr"
                        className="shrink-0 text-sm font-semibold tabular-nums text-text-primary"
                      >
                        {formatPrice(Number(line.lineTotal))}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
