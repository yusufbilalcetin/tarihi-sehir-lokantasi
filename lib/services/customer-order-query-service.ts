import { DomainError } from "../api/domain-error";
import {
  ORDER_TRACKING_STEPS,
  orderTrackingTimeline,
  type OrderTrackingStep,
  type OrderTrackingStepKey,
} from "../domain/display";
import type {
  CustomerOrderQueryRepository,
} from "../repositories/customer-order-query-repository";

/**
 * What a guest tracking their own takeaway or courier order is told.
 *
 * Everything that identifies the order internally is gone: no order id, no
 * restaurant id, no fulfillment id, no staff or courier, no payment and no
 * audit column. What is left is what the person standing there wants — which
 * order this is, where it has got to, and what is in it. The progress arrives
 * as translation keys rather than sentences, so the words come out in the
 * language they picked for the menu.
 */
export interface CustomerOrderTrackingResult {
  readonly orderNumber: string;
  readonly channel: keyof typeof ORDER_TRACKING_STEPS;
  readonly current: OrderTrackingStepKey;
  readonly steps: readonly OrderTrackingStep[];
  readonly cancelled: boolean;
  readonly total: string;
  readonly currency: string;
  readonly placedAt: string;
  readonly updatedAt: string;
  readonly items: readonly { readonly name: string; readonly quantity: number }[];
}

export interface CustomerActiveOrderResult {
  readonly id: string;
  readonly orderNumber: string;
  readonly status: "NEW" | "CONFIRMED" | "PREPARING" | "READY" | "SERVED";
  readonly notes: string | null;
  readonly amounts: {
    readonly currency: string;
    readonly subtotal: string;
    readonly serviceCharge: string;
    readonly tax: string;
    readonly total: string;
  };
  readonly items: readonly {
    readonly id: string;
    readonly productId: string;
    readonly productName: string;
    readonly unitPrice: string;
    readonly quantity: number;
    readonly lineTotal: string;
    readonly notes: string | null;
    readonly status:
      | "PENDING"
      | "PREPARING"
      | "READY"
      | "SERVED"
      | "CANCELLED"
      | "VOIDED";
  }[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export class CustomerOrderQueryService {
  constructor(private readonly repository: CustomerOrderQueryRepository) {}

  /**
   * `sessionNonce` must come from the caller's verified table session. It is
   * an extra narrowing on an already-authorised restaurant/table pair, never a
   * grant, and it is never echoed back in the result.
   */
  async getActiveOrders(
    restaurantId: string,
    tableId: string,
    sessionNonce: string,
  ): Promise<readonly CustomerActiveOrderResult[]> {
    // A missing sitting would otherwise widen the query back to the table.
    if (!sessionNonce) {
      throw new DomainError("INVALID_TABLE_TOKEN", "Masa oturumu geçersiz.", {
        httpStatus: 401,
      });
    }
    const records = await this.repository.findActiveByTable(
      restaurantId,
      tableId,
      sessionNonce,
    );
    const itemsByOrder = new Map<
      string,
      CustomerActiveOrderResult["items"] extends readonly (infer T)[] ? T[] : never
    >();
    for (const item of records.items) {
      const current = itemsByOrder.get(item.orderId) ?? [];
      current.push({
        id: item.id,
        productId: item.productId,
        productName: item.productNameSnapshot,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        lineTotal: item.lineTotal,
        notes: item.notes,
        status: item.status,
      });
      itemsByOrder.set(item.orderId, current);
    }
    return records.orders.map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      notes: order.notes,
      amounts: {
        currency: order.currency,
        subtotal: order.subtotal,
        serviceCharge: order.serviceChargeTotal,
        tax: order.taxTotal,
        total: order.total,
      },
      items: itemsByOrder.get(order.id) ?? [],
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
    }));
  }

  async getTrackedOrder(
    restaurantId: string,
    orderId: string,
  ): Promise<CustomerOrderTrackingResult> {
    const order = await this.repository.findTrackedOrder(restaurantId, orderId);
    // A capability for an order that is not there answers the same way as one
    // for an order in another restaurant: it is simply not found.
    if (!order || (order.channel !== "TAKEAWAY" && order.channel !== "DELIVERY")) {
      throw new DomainError("NOT_FOUND", "Sipariş bulunamadı.", { httpStatus: 404 });
    }
    const timeline = orderTrackingTimeline({
      channel: order.channel,
      orderStatus: order.status,
      fulfillmentStatus: order.fulfillmentStatus,
    });
    return {
      orderNumber: order.orderNumber,
      channel: order.channel,
      current: timeline.current,
      steps: timeline.steps,
      cancelled: order.status === "CANCELLED" || order.fulfillmentStatus === "CANCELLED",
      total: order.total,
      currency: order.currency,
      placedAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
      // A line the kitchen struck off is not part of what is coming.
      items: order.items
        .filter((item) => item.status !== "CANCELLED" && item.status !== "VOIDED")
        .map((item) => ({ name: item.productNameSnapshot, quantity: item.quantity })),
    };
  }
}
