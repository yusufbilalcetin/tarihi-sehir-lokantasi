"use client";

import { useMemo, useState } from "react";
import { Coins, Banknote, RotateCcw } from "lucide-react";

import { DenominationRow } from "@/components/cashier/cash-count/denomination-row";
import { Button } from "@/components/ui/button";
import {
  CASH_COUNT_CURRENCIES,
  CURRENCY_LABEL,
  CURRENCY_SYMBOL,
  denominationsFor,
  formatMinorAmount,
  summariseCashCount,
  totalForCurrency,
  type CashCountCurrency,
} from "@/lib/domain/cash-denominations";
import { cn } from "@/lib/utils";

/**
 * Counting a drawer, one currency at a time.
 *
 * The three currencies are three separate inventories and are never added up:
 * there is a total per currency and deliberately no combined figure, because
 * `₺100 + €100 + $100` is not `300` of anything.
 *
 * Switching tabs never clears anything. All three currencies live in one state
 * object held above the tabs, so a cashier who counts lira, checks the euro
 * tray and comes back finds their lira counts exactly as they left them.
 *
 * Everything shown here is a preview. The request carries counts only, and the
 * server reprices the drawer from its own table — see `summariseCashCount`.
 */

export type CashCountState = Record<string, number>;

/** `TRY:20000` — currency and face value, which together identify a row. */
export function denominationKey(currency: CashCountCurrency, minorValue: number): string {
  return `${currency}:${minorValue}`;
}

export function cashCountRequestPayload(
  counts: CashCountState,
): readonly { currency: string; denominationMinor: number; count: number }[] {
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([key, count]) => {
      const [currency, minorValue] = key.split(":");
      return { currency, denominationMinor: Number(minorValue), count };
    });
}

/** The per-currency totals, computed by the same domain function the server uses. */
export function summariseCounts(counts: CashCountState) {
  try {
    return summariseCashCount(
      cashCountRequestPayload(counts).map((entry) => ({
        currency: entry.currency,
        minorValue: entry.denominationMinor,
        count: entry.count,
      })),
    );
  } catch {
    // A preview never blocks the screen; the server is the one that decides.
    return { lines: [], totals: [] as const };
  }
}

export function CashDrawerCount({
  counts,
  onChange,
  disabled = false,
}: {
  readonly counts: CashCountState;
  readonly onChange: (next: CashCountState) => void;
  readonly disabled?: boolean;
}) {
  const [currency, setCurrency] = useState<CashCountCurrency>("TRY");
  const summary = useMemo(() => summariseCounts(counts), [counts]);

  const notes = denominationsFor(currency).filter((d) => d.kind === "BANKNOTE");
  const coins = denominationsFor(currency).filter((d) => d.kind === "COIN");

  function setCount(minorValue: number, next: number) {
    onChange({ ...counts, [denominationKey(currency, minorValue)]: next });
  }

  function resetCurrency() {
    if (
      !window.confirm(
        `${CURRENCY_LABEL[currency]} sayımındaki tüm adetler sıfırlansın mı?`,
      )
    ) {
      return;
    }
    const next = { ...counts };
    for (const denomination of denominationsFor(currency, { includeDisabled: true })) {
      delete next[denominationKey(currency, denomination.minorValue)];
    }
    onChange(next);
  }

  return (
    <div className="space-y-4">
      {/* Symbol and code together: a symbol alone is not a label. */}
      <div role="tablist" aria-label="Para birimi" className="flex gap-2">
        {CASH_COUNT_CURRENCIES.map((code) => {
          const active = code === currency;
          const total = totalForCurrency(summary.totals, code);
          return (
            <button
              key={code}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setCurrency(code)}
              className={cn(
                "motion-press min-h-11 flex-1 rounded-xl border px-3 text-sm font-bold",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "border-burgundy/45 bg-burgundy/[0.06] text-burgundy"
                  : "border-border bg-card text-text-secondary hover:bg-muted/60",
              )}
            >
              <span className="block">
                {CURRENCY_SYMBOL[code]} {code}
              </span>
              <span className="mt-0.5 block text-xs font-semibold tabular-nums opacity-80">
                {formatMinorAmount(total, code)}
              </span>
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        aria-label={`${CURRENCY_LABEL[currency]} sayımı`}
        className="rounded-xl border border-border-subtle bg-surface-raised p-3"
      >
        <Section icon={Banknote} title="Banknotlar">
          {notes.map((denomination) => (
            <DenominationRow
              key={denomination.minorValue}
              denomination={denomination}
              count={counts[denominationKey(currency, denomination.minorValue)] ?? 0}
              onChange={(next) => setCount(denomination.minorValue, next)}
            />
          ))}
        </Section>

        {coins.length ? (
          <Section icon={Coins} title="Madeni Paralar" className="mt-3 border-t border-border pt-3">
            {coins.map((denomination) => (
              <DenominationRow
                key={denomination.minorValue}
                denomination={denomination}
                count={counts[denominationKey(currency, denomination.minorValue)] ?? 0}
                onChange={(next) => setCount(denomination.minorValue, next)}
              />
            ))}
          </Section>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <span className="text-sm font-semibold text-text-secondary">
            {CURRENCY_LABEL[currency]} toplamı
          </span>
          <span className="text-xl font-extrabold tabular-nums text-burgundy">
            {formatMinorAmount(totalForCurrency(summary.totals, currency), currency)}
          </span>
        </div>

        {/* Quiet and confirmed: it is not the button anyone is aiming for. */}
        <Button
          type="button"
          variant="ghost"
          disabled={disabled}
          className="mt-2 h-11 w-full text-sm font-semibold text-text-muted"
          onClick={resetCurrency}
        >
          <RotateCcw className="size-4" aria-hidden="true" />
          {CURRENCY_LABEL[currency]} sayımını sıfırla
        </Button>
      </div>
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  className,
  children,
}: {
  readonly icon: typeof Coins;
  readonly title: string;
  readonly className?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section className={className} aria-label={title}>
      <h3 className="mb-1 flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.06em] text-text-muted">
        <Icon className="size-3.5" strokeWidth={2} aria-hidden="true" />
        {title}
      </h3>
      <div className="divide-y divide-border/60">{children}</div>
    </section>
  );
}
