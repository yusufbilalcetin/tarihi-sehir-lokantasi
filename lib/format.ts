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
