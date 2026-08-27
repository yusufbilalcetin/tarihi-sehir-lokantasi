/**
 * Money on an operational surface: bills, the till, printed receipts and every
 * report. Kuruş are always shown, because these numbers are reconciled against
 * the database and handed to a customer — a ₺275,50 bill displayed as ₺276 is
 * a different amount from the one actually charged.
 *
 * The guest menu formats its own prices (lib/config/currency.ts), where round
 * lira are a deliberate presentation choice; this helper is not that.
 */
export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function getInitials(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toLocaleUpperCase("tr-TR");
}

/**
 * How long a ticket, table or bill has been open.
 *
 * Screens used to print the raw minute count, which is fine at "15 dk" and
 * unreadable at "15899 dk" — nobody divides by 1440 while carrying plates. The
 * unit changes with the size of the number so the value stays two glances wide
 * at most, and precision is dropped only where it has stopped mattering: past a
 * day, the hours are noise.
 */
export function formatElapsed(minutes: number): string {
  const safe = Number.isFinite(minutes) && minutes > 0 ? Math.floor(minutes) : 0;
  if (safe < 60) return `${safe} dk`;

  const hours = Math.floor(safe / 60);
  if (hours < 24) {
    const rest = safe % 60;
    return rest === 0 ? `${hours} sa` : `${hours} sa ${rest} dk`;
  }

  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours === 0 ? `${days} gün` : `${days} gün ${restHours} sa`;
}
