import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";

/**
 * Money on screen.
 *
 * Every amount in this product is reconciled against the database and handed
 * to a guest, so kuruş are never dropped: ₺275,50 stays ₺275,50. `formatCurrency`
 * already guarantees that — this adds the typography that makes a column of
 * amounts readable (tabular figures, so digits line up) and the emphasis
 * levels the till and the bill actually need.
 *
 * `tone="due"` is the one that matters most: on a cashier screen the number
 * still owed is the number a mistake is made on, so it gets its own weight.
 */

export type MoneyTone = "default" | "due" | "positive" | "negative" | "muted";
export type MoneySize = "sm" | "md" | "lg" | "xl";

const TONE: Readonly<Record<MoneyTone, string>> = {
  default: "text-text-primary",
  due: "text-primary",
  positive: "text-status-success",
  negative: "text-status-danger",
  muted: "text-text-muted",
};

const SIZE: Readonly<Record<MoneySize, string>> = {
  sm: "text-sm",
  md: "text-base",
  lg: "text-xl",
  xl: "text-3xl",
};

export interface MoneyProps {
  /** Accepts the decimal strings the API returns as well as numbers. */
  readonly amount: string | number | null | undefined;
  readonly tone?: MoneyTone;
  readonly size?: MoneySize;
  readonly strong?: boolean;
  readonly className?: string;
}

export function Money({
  amount,
  tone = "default",
  size = "md",
  strong = false,
  className,
}: MoneyProps) {
  const value = typeof amount === "string" ? Number(amount) : amount;
  // An absent or unparseable amount is a dash, never "NaN" or "₺0,00" — a
  // fabricated zero on a bill is worse than an honest blank.
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return <span className={cn("tabular-nums text-text-muted", SIZE[size], className)}>—</span>;
  }
  return (
    <span
      dir="ltr"
      className={cn(
        "tabular-nums",
        SIZE[size],
        TONE[tone],
        strong ? "font-bold" : "font-semibold",
        className,
      )}
    >
      {formatCurrency(value)}
    </span>
  );
}
