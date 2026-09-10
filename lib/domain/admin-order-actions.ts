import {
  ORDER_STATUS_TRANSITIONS,
  canRoleTransitionOrderStatus,
  itemsBlockingOrderStage,
  type OrderItemStatus,
  type OrderStatus,
  type UserRole,
} from "@/lib/domain/status";

const ACTION_LABELS: Partial<Record<OrderStatus, string>> = {
  CONFIRMED: "Onayla",
  PREPARING: "Hazırlanıyor",
  READY: "Hazır",
  SERVED: "Servis Edildi",
  COMPLETED: "Tamamlandı",
};

export interface AdminOrderProgressAction {
  readonly status: Exclude<OrderStatus, "NEW" | "CANCELLED">;
  readonly label: string;
}

/**
 * The one forward operational step this role may apply from the current state.
 * Cancellation deliberately stays out: it has its own reason-bearing command.
 *
 * The lines are required, not optional. An override that moves the order past
 * food nobody has started is refused by the server, and a manager looking at a
 * stuck ticket is exactly the person who must be told which line is holding it
 * rather than handed a button that returns a 409.
 */
export function adminOrderProgressAction(
  role: UserRole,
  current: OrderStatus,
  items: readonly { readonly status: OrderItemStatus }[],
): AdminOrderProgressAction | null {
  const next = ORDER_STATUS_TRANSITIONS[current].find(
    (candidate) =>
      candidate !== "CANCELLED" && canRoleTransitionOrderStatus(role, current, candidate),
  );
  if (!next || next === "CANCELLED") return null;
  if (itemsBlockingOrderStage(next, items).length > 0) return null;
  return { status: next, label: ACTION_LABELS[next] ?? next };
}
