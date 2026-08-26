import { DomainError } from "../api/domain-error";
import { orderPlaceLabel } from "../domain/display";
import type { OrderChannel } from "../domain/status";
import {
  authorizeRestaurantAccess,
  type RestaurantPrincipal,
} from "../domain/restaurant-scope";
import {
  ORDER_ITEM_STATUS_TRANSITIONS,
  USER_ROLES,
  canRoleTransitionOrderItemStatus,
  isOrderItemRollback,
  isOrderStageCompatibleWithItemTransition,
  validateStatusTransition,
  type OrderItemStatus,
} from "../domain/status";
import type { RepositoryJsonObject } from "../repositories/order-repository";
import {
  type StaffOrderListFilters,
  type StaffOrderRepository,
} from "../repositories/staff-order-repository";

export interface StaffOrderListResultItem {
  readonly id: string;
  readonly productName: string;
  readonly unitPrice: string;
  readonly quantity: number;
  readonly lineTotal: string;
  readonly notes: string | null;
  readonly status: OrderItemStatus;
}

export interface StaffOrderListResult {
  readonly id: string;
  readonly orderNumber: string;
  readonly status: string;
  readonly channel: OrderChannel;
  /** Null on takeaway and courier orders; use `placeLabel` to show them. */
  readonly table: { readonly id: string; readonly name: string; readonly number: number } | null;
  /**
   * Where this order belongs, already in words: a table name for dine-in,
   * "Paket Sipariş" or "Kurye Siparişi" otherwise. Derived once here so the
   * kitchen screen, the order list and the ticket cannot drift apart.
   */
  readonly placeLabel: string;
  readonly amounts: {
    readonly subtotal: string;
    readonly serviceCharge: string;
    readonly tax: string;
    readonly total: string;
  };
  readonly notes: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly items: readonly StaffOrderListResultItem[];
}

export interface UpdateOrderItemStatusCommand {
  readonly restaurantId: string;
  readonly orderItemId: string;
  readonly nextStatus: Extract<OrderItemStatus, "PENDING" | "PREPARING" | "READY" | "SERVED">;
  /** Only meaningful when undoing a step; recorded, never required. */
  readonly reasonCode?: string;
  readonly reasonNote?: string;
  readonly requestId?: string;
}

export interface UpdateOrderItemStatusResult {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly orderItemId: string;
  readonly previousStatus: OrderItemStatus;
  readonly reverted: boolean;
  readonly status: Extract<OrderItemStatus, "PENDING" | "PREPARING" | "READY" | "SERVED">;
  readonly updatedAt: string;
}

export interface StaffOrderServiceOptions {
  readonly clock?: () => Date;
}

function requireOperationalPrincipal(
  principal: RestaurantPrincipal | null | undefined,
  restaurantId: string,
): RestaurantPrincipal {
  const decision = authorizeRestaurantAccess(principal, restaurantId, {
    allowedRoles: USER_ROLES,
  });
  if (decision.allowed) return decision.principal;
  if (decision.reason === "AUTHENTICATION_REQUIRED") {
    throw new DomainError("AUTHENTICATION_REQUIRED", "Oturum açmanız gerekiyor.", {
      httpStatus: 401,
    });
  }
  if (decision.reason === "ACCOUNT_INACTIVE") {
    throw new DomainError("ACCOUNT_INACTIVE", "Hesap aktif değil.", { httpStatus: 403 });
  }
  if (decision.reason === "RESTAURANT_SCOPE_MISMATCH") {
    throw new DomainError("RESTAURANT_SCOPE_VIOLATION", "Restoran erişimi reddedildi.", {
      httpStatus: 403,
    });
  }
  throw new DomainError("FORBIDDEN", "Bu işlem için yetkiniz yok.", { httpStatus: 403 });
}

export {
  canRoleTransitionOrderItemStatus,
  isOrderStageCompatibleWithItemTransition,
} from "../domain/status";

export class StaffOrderService {
  private readonly clock: () => Date;

  constructor(
    private readonly repository: StaffOrderRepository,
    options: StaffOrderServiceOptions = {},
  ) {
    this.clock = options.clock ?? (() => new Date());
  }

  async listOrders(
    principal: RestaurantPrincipal | null | undefined,
    filters: StaffOrderListFilters,
  ): Promise<readonly StaffOrderListResult[]> {
    const actor = requireOperationalPrincipal(principal, principal?.restaurantId ?? "");
    const records = await this.repository.listOrders(actor.restaurantId, filters);
    return records.map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      channel: order.channel,
      table:
        order.tableId !== null && order.tableName !== null && order.tableNumber !== null
          ? { id: order.tableId, name: order.tableName, number: order.tableNumber }
          : null,
      placeLabel: orderPlaceLabel(order.channel, order.tableName),
      amounts: {
        subtotal: order.subtotal,
        serviceCharge: order.serviceChargeTotal,
        tax: order.taxTotal,
        total: order.total,
      },
      notes: order.notes,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
      items: order.items.map((item) => ({
        id: item.id,
        productName: item.productName,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        lineTotal: item.lineTotal,
        notes: item.notes,
        status: item.status,
      })),
    }));
  }

  async updateItemStatus(
    principal: RestaurantPrincipal | null | undefined,
    command: UpdateOrderItemStatusCommand,
  ): Promise<UpdateOrderItemStatusResult> {
    const actor = requireOperationalPrincipal(principal, command.restaurantId);
    return this.repository.transaction(async (transaction) => {
      const item = await transaction.findOrderItemForUpdate(
        command.restaurantId,
        command.orderItemId,
      );
      if (!item) {
        throw new DomainError("ORDER_NOT_FOUND", "Sipariş kalemi bulunamadı.", {
          httpStatus: 404,
        });
      }
      if (item.orderStatus === "COMPLETED" || item.orderStatus === "CANCELLED") {
        throw new DomainError("INVALID_STATUS_TRANSITION", "Kapanmış sipariş değiştirilemez.", {
          httpStatus: 409,
        });
      }

      const transition = validateStatusTransition(
        ORDER_ITEM_STATUS_TRANSITIONS,
        item.status,
        command.nextStatus,
      );
      if (!transition.valid) {
        throw new DomainError("INVALID_STATUS_TRANSITION", "Sipariş kalemi durumu değiştirilemez.", {
          httpStatus: 409,
          details: {
            current: transition.current,
            requested: transition.next,
            allowed: [...transition.allowed],
            reason: transition.reason,
          },
        });
      }
      if (!canRoleTransitionOrderItemStatus(actor.role, item.status, command.nextStatus)) {
        throw new DomainError("FORBIDDEN", "Bu kalem durumu için yetkiniz yok.", {
          httpStatus: 403,
        });
      }
      if (
        !isOrderStageCompatibleWithItemTransition(
          item.orderStatus,
          item.status,
          command.nextStatus,
        )
      ) {
        throw new DomainError(
          "INVALID_STATUS_TRANSITION",
          "Sipariş kalemi, siparişin mevcut aşamasında değiştirilemez.",
          {
            httpStatus: 409,
            details: {
              orderStatus: item.orderStatus,
              current: item.status,
              requested: command.nextStatus,
            },
          },
        );
      }

      const at = this.clock();
      const reverted = isOrderItemRollback(item.status, command.nextStatus);
      const reason = reverted
        ? {
            reasonCode: command.reasonCode ?? null,
            reasonNote: command.reasonNote?.trim() || null,
          }
        : null;
      const updated = await transaction.updateOrderItemStatus({
        restaurantId: command.restaurantId,
        orderItemId: item.id,
        currentStatus: item.status,
        nextStatus: command.nextStatus,
        at,
      });
      if (!updated) {
        throw new DomainError("CONFLICT", "Sipariş kalemi başka bir işlem tarafından güncellendi.", {
          httpStatus: 409,
        });
      }

      const payload: RepositoryJsonObject = {
        scope: "ORDER_ITEM",
        orderId: item.orderId,
        orderNumber: item.orderNumber,
        orderItemId: item.id,
        productName: item.productName,
        previousStatus: item.status,
        status: command.nextStatus,
        reverted,
        ...(reason ?? {}),
        updatedAt: at.toISOString(),
      };
      await transaction.insertOrderEvent({
        restaurantId: command.restaurantId,
        orderId: item.orderId,
        eventType: "ORDER_ITEM_STATUS_CHANGED",
        userId: actor.userId,
        payload,
      });
      await transaction.insertOutboxEvent({
        restaurantId: command.restaurantId,
        aggregateType: "ORDER_ITEM",
        aggregateId: item.id,
        eventType: "ORDER_ITEM_STATUS_CHANGED",
        payload,
      });
      await transaction.insertAuditLog({
        restaurantId: command.restaurantId,
        actorUserId: actor.userId,
        // An undo reads differently from a step forward, and the audit says so.
        action: reverted ? "order_item.status_reverted" : "ORDER_ITEM_STATUS_CHANGED",
        entityType: "ORDER_ITEM",
        entityId: item.id,
        oldValue: { status: item.status },
        newValue: { status: command.nextStatus },
        metadata: {
          orderId: item.orderId,
          orderNumber: item.orderNumber,
          from: item.status,
          to: command.nextStatus,
          ...(reason ?? {}),
        },
        requestId: command.requestId,
      });

      return {
        orderId: item.orderId,
        orderNumber: item.orderNumber,
        orderItemId: item.id,
        previousStatus: item.status,
        reverted,
        status: command.nextStatus,
        updatedAt: at.toISOString(),
      };
    });
  }
}
