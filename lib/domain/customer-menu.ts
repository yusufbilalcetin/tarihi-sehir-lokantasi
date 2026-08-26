export type CustomerVisibleCallType = "WAITER_CALL" | "BILL_REQUEST";
export type CustomerVisibleCallStatus = "OPEN" | "ACKNOWLEDGED";

/**
 * Search is intentionally limited to text already visible to the guest.
 *
 * NFKD plus mark removal makes `kofte` match `köfte`, while the final Turkish
 * dotless-i fold makes `mercimek`, `Mercimek` and `MERCİMEK` equivalent. The
 * same function is used for the query and every field, so matching stays
 * symmetric instead of special-casing individual product names.
 */
export function normalizeCustomerMenuSearch(
  value: string,
  locale = "tr-TR",
): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase(locale)
    .replaceAll("ı", "i")
    .trim();
}

export function matchesCustomerMenuSearch(
  query: string,
  fields: readonly string[],
  locale = "tr-TR",
): boolean {
  const normalizedQuery = normalizeCustomerMenuSearch(query, locale);
  if (!normalizedQuery) return true;
  return fields.some((field) =>
    normalizeCustomerMenuSearch(field, locale).includes(normalizedQuery),
  );
}

/** Existing translated copy only; raw machine states never reach the screen. */
export function customerCallStatusTranslationKey(
  type: CustomerVisibleCallType,
  status: CustomerVisibleCallStatus,
): "waiterRequestSent" | "billSent" | "waiterConfirmed" {
  if (status === "ACKNOWLEDGED") return "waiterConfirmed";
  return type === "BILL_REQUEST" ? "billSent" : "waiterRequestSent";
}
