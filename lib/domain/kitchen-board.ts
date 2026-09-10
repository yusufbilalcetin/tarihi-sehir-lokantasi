import type { Order } from "@/types";

/**
 * How the kitchen board decides what a cook sees first.
 *
 * The rules live here rather than in the board so they can be tested without a
 * renderer, and so the thresholds a kitchen is judged on are stated once.
 *
 * No backend contract is involved: the API returns the most recent open orders
 * under a row limit (`desc(createdAt)`, which is the correct query — you want
 * the newest N live tickets, not the oldest N ever). Presentation order is a
 * separate question, and it is the opposite one.
 */

/** Past this, a ticket is late and says so in words as well as colour. */
export const KITCHEN_LATE_MINUTES = 15;
/** Past this, a ticket wants attention before the ones behind it. */
export const KITCHEN_ATTENTION_MINUTES = 8;

export type TicketUrgency = "on-time" | "attention" | "late";

export function resolveTicketUrgency(elapsedMinutes: number): TicketUrgency {
  if (elapsedMinutes >= KITCHEN_LATE_MINUTES) return "late";
  if (elapsedMinutes >= KITCHEN_ATTENTION_MINUTES) return "attention";
  return "on-time";
}

export const TICKET_URGENCY_LABELS: Readonly<Record<TicketUrgency, string>> = {
  "on-time": "Zamanında",
  attention: "Öncelikli",
  late: "Gecikti",
};

/**
 * Oldest first.
 *
 * Every kitchen display in the trade puts the oldest ticket where the eye lands
 * first, because the oldest ticket is the one a guest is already waiting on.
 * The feed arrives newest-first, so rendering it as delivered buries the most
 * urgent ticket at the bottom of the lane.
 *
 * The id tiebreak makes the order total: two tickets created in the same second
 * must not swap places between polls, or a cook loses the one they were reading.
 */
export function sortKitchenTickets<T extends { id: string; elapsedMinutes: number }>(
  tickets: readonly T[],
): readonly T[] {
  return [...tickets].sort(
    (left, right) =>
      right.elapsedMinutes - left.elapsedMinutes || left.id.localeCompare(right.id),
  );
}

export interface KitchenTicketNotes {
  /** The note the guest or waiter put on the whole order. */
  readonly orderNote: string | null;
  /** Notes attached to single lines, already paired with their product. */
  readonly itemNotes: readonly { readonly productName: string; readonly note: string }[];
}

/**
 * Everything written on a ticket that is not a product name.
 *
 * The order-level note was being dropped by the board entirely: a guest asking
 * for a dish without onions, or telling the kitchen a child is eating, wrote it
 * into the order note from the QR menu and no cook ever saw it. It is the
 * highest-attention text on a ticket, so it is surfaced separately rather than
 * folded in with the lines.
 */
export function collectTicketNotes(order: Order): KitchenTicketNotes {
  const orderNote = order.note?.trim() ? order.note.trim() : null;
  const itemNotes = order.items
    .filter((item) => item.status !== "cancelled" && item.status !== "voided")
    .flatMap((item) =>
      item.note?.trim()
        ? [{ productName: item.productName, note: item.note.trim() }]
        : [],
    );
  return { orderNote, itemNotes };
}

/** Whether a ticket carries any instruction at all, for a board-level marker. */
export function ticketHasNotes(order: Order): boolean {
  const { orderNote, itemNotes } = collectTicketNotes(order);
  return Boolean(orderNote) || itemNotes.length > 0;
}
