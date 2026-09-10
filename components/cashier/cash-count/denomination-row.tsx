"use client";

import { Minus, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CURRENCY_LABEL,
  MAX_DENOMINATION_COUNT,
  formatMinorAmount,
  type CashDenomination,
} from "@/lib/domain/cash-denominations";
import { cn } from "@/lib/utils";

/**
 * One face value being counted.
 *
 * The subtotal is shown live because a cashier counting a tray checks it
 * against the pile in their hand. It is computed in integer minor units here
 * exactly as the server computes it — but it is only ever a display: the
 * request carries counts, never amounts, so this number can never become the
 * recorded figure.
 *
 * Typing is a first-class path, not a fallback. Eighty ₺1 coins is eighty taps
 * on a plus button, which is how counts get abandoned halfway.
 */
export function DenominationRow({
  denomination,
  count,
  onChange,
}: {
  readonly denomination: CashDenomination;
  readonly count: number;
  readonly onChange: (next: number) => void;
}) {
  const subtotalMinor = denomination.minorValue * count;
  const inputId = `count-${denomination.currency}-${denomination.minorValue}`;
  const currencyName = CURRENCY_LABEL[denomination.currency];

  function commit(raw: string) {
    // An empty or unparseable box is zero, not NaN.
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return onChange(0);
    onChange(Math.min(MAX_DENOMINATION_COUNT, Math.max(0, parsed)));
  }

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 py-1.5">
      <label
        htmlFor={inputId}
        className="w-16 shrink-0 text-sm font-bold tabular-nums text-text-primary"
      >
        {denomination.label}
      </label>

      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          className="size-11 shrink-0 p-0"
          disabled={count === 0}
          aria-label={`${denomination.label} ${currencyName} azalt`}
          // Clamped at zero, so a fast repeated tap cannot go negative.
          onClick={() => onChange(Math.max(0, count - 1))}
        >
          <Minus className="size-4" aria-hidden="true" />
        </Button>

        <Input
          id={inputId}
          type="number"
          inputMode="numeric"
          min={0}
          max={MAX_DENOMINATION_COUNT}
          step={1}
          value={count === 0 ? "" : String(count)}
          placeholder="0"
          aria-label={`${denomination.label} ${currencyName} adedi`}
          className="h-11 w-16 shrink-0 text-center text-base font-bold tabular-nums"
          onChange={(event) => commit(event.currentTarget.value)}
          onBlur={(event) => commit(event.currentTarget.value)}
        />

        <Button
          type="button"
          variant="outline"
          className="size-11 shrink-0 p-0"
          disabled={count >= MAX_DENOMINATION_COUNT}
          aria-label={`${denomination.label} ${currencyName} ekle`}
          onClick={() => onChange(Math.min(MAX_DENOMINATION_COUNT, count + 1))}
        >
          <Plus className="size-4" aria-hidden="true" />
        </Button>
      </div>

      {/* At 320px this wraps to its own line rather than squeezing the stepper. */}
      <span
        className={cn(
          "ms-auto min-w-20 text-end text-sm font-bold tabular-nums",
          count === 0 ? "text-text-muted" : "text-text-primary",
        )}
      >
        {formatMinorAmount(subtotalMinor, denomination.currency)}
      </span>
    </div>
  );
}
