import type { FulfillmentWorkflowStatus } from "../domain/erp-workspaces";
import type { OrderChannel, OrderItemStatus, OrderStatus } from "../domain/status";

export type CustomerActiveOrderStatus =
  | "NEW"
  | "CONFIRMED"
  | "PREPARING"
  | "READY"
  | "SERVED";

export interface CustomerActiveOrderRecord {
  readonly id: string;
  readonly orderNumber: string;
  readonly status: CustomerActiveOrderStatus;
  readonly notes: string | null;
  readonly subtotal: string;
  readonly serviceChargeTotal: string;
  readonly taxTotal: string;
  readonly total: string;
  readonly currency: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CustomerActiveOrderItemRecord {
  readonly id: string;
  readonly orderId: string;
  readonly productId: string;
  readonly productNameSnapshot: string;
  readonly unitPrice: string;
  readonly quantity: number;
  readonly lineTotal: string;
  readonly notes: string | null;
  readonly status: OrderItemStatus;
  readonly sortOrder: number;
}

export interface CustomerActiveOrderRecords {
  readonly orders: readonly CustomerActiveOrderRecord[];
  readonly items: readonly CustomerActiveOrderItemRecord[];
}

/**
 * One takeaway or courier order, read for the guest who placed it.
 *
 * Deliberately narrower than the row: no customer name, telephone number or
 * address comes back, even though the fulfillment row holds all three — the
 * guest supplied them and does not need them read back, and a response that
 * carried them would put a person's address behind nothing but a cookie.
 */
export interface CustomerTrackedOrderRecord {
  readonly orderNumber: string;
  readonly channel: OrderChannel;
  readonly status: OrderStatus;
  readonly fulfillmentStatus: FulfillmentWorkflowStatus | null;
  readonly total: string;
  readonly currency: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly items: readonly {
    readonly productNameSnapshot: string;
    readonly quantity: number;
    readonly status: OrderItemStatus;
  }[];
}

export interface CustomerOrderQueryRepository {
  /**
   * The active orders of one guest sitting — never of the table.
   *
   * `sessionNonce` is the nonce of the caller's verified table session. Rows
   * whose `customerSessionNonce` is null (staff orders, and everything written
   * before the column existed) belong to no sitting and must not come back
   * here, so the comparison is exact equality and null fails closed.
   */
  findActiveByTable(
    restaurantId: string,
    tableId: string,
    sessionNonce: string,
  ): Promise<CustomerActiveOrderRecords>;
  /** Scoped to the restaurant the capability names; null when it is not there. */
  findTrackedOrder(
    restaurantId: string,
    orderId: string,
  ): Promise<CustomerTrackedOrderRecord | null>;
}
