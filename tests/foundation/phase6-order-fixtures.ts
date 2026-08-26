import type { RestaurantPrincipal } from "../../lib/domain/restaurant-scope";
import type { OrderItemStatus, OrderStatus } from "../../lib/domain/status";
import type {
  CancelOrderItemInput,
  IdempotencyClaim,
  InsertAuditLogInput,
  InsertOrderEventInput,
  InsertOrderItemRecordInput,
  InsertOutboxEventInput,
  LockedOrderItemRecord,
  MutableOrderWithItems,
  OrderProductRecord,
  OrderRepository,
  OrderTransactionRepository,
  StoredIdempotencyRecord,
  UpdateOrderAmountsInput,
  UpdateOrderStatusInput,
  VoidOrderItemInput,
} from "../../lib/repositories/order-repository";
import { OrderService } from "../../lib/services/order-service";

export const FIXED_NOW = () => new Date("2026-08-14T18:00:00.000Z");

export function principal(role: RestaurantPrincipal["role"]): RestaurantPrincipal {
  return {
    userId: `user-${role.toLowerCase()}`,
    restaurantId: "restaurant-1",
    role,
    isActive: true,
  };
}

export function line(
  overrides: Partial<LockedOrderItemRecord> = {},
): LockedOrderItemRecord {
  const quantity = overrides.quantity ?? 2;
  const unitPrice = overrides.unitPrice ?? "250.00";
  return {
    id: "item-1",
    orderId: "order-1",
    productId: "product-soup",
    productNameSnapshot: "Mercimek Corbasi",
    unitPrice,
    quantity,
    lineTotal: (Number(unitPrice) * quantity).toFixed(2),
    status: "PENDING",
    sortOrder: 0,
    ...overrides,
  };
}

export interface OrderFixtureState {
  order: MutableOrderWithItems | null;
  idempotency: StoredIdempotencyRecord | null;
  products: OrderProductRecord[];
  insertedItems: InsertOrderItemRecordInput[];
  amountUpdates: UpdateOrderAmountsInput[];
  statusUpdates: UpdateOrderStatusInput[];
  cancelledItems: CancelOrderItemInput[];
  voidedItems: VoidOrderItemInput[];
  events: InsertOrderEventInput[];
  outbox: InsertOutboxEventInput[];
  fulfillmentRequests: unknown[];
  audits: InsertAuditLogInput[];
  /** Simulates another writer bumping the order version mid-transaction. */
  amountUpdateFails: boolean;
  itemCancelFails: boolean;
}

export function order(
  overrides: Partial<MutableOrderWithItems> = {},
): MutableOrderWithItems {
  const items = overrides.items ?? [line()];
  return {
    id: "order-1",
    restaurantId: "restaurant-1",
    tableId: "table-3",
    channel: "DINE_IN" as const,
    orderNumber: "ORD-000105",
    status: "CONFIRMED" as OrderStatus,
    version: 3,
    subtotal: "500.00",
    serviceChargeTotal: "50.00",
    taxTotal: "0.00",
    total: "550.00",
    serviceFeeRate: "10.00",
    taxRate: "0.00",
    currency: "TRY",
    hasSettledPayment: false,
    hasPendingPayment: false,
    ...overrides,
    items,
  };
}

export function product(
  overrides: Partial<OrderProductRecord> = {},
): OrderProductRecord {
  return {
    id: "product-tea",
    restaurantId: "restaurant-1",
    name: "Çay",
    price: "40.00",
    isActive: true,
    isAvailable: true,
    deletedAt: null,
    categoryIsActive: true,
    categoryDeletedAt: null,
    ...overrides,
  };
}

export function state(overrides: Partial<OrderFixtureState> = {}): OrderFixtureState {
  return {
    order: order(),
    idempotency: null,
    products: [product()],
    insertedItems: [],
    fulfillmentRequests: [],
    amountUpdates: [],
    statusUpdates: [],
    cancelledItems: [],
    voidedItems: [],
    events: [],
    outbox: [],
    audits: [],
    amountUpdateFails: false,
    itemCancelFails: false,
    ...overrides,
  };
}

/**
 * Mirrors the transactional contract the Drizzle repository provides: the order
 * and its lines are read under a lock, amount writes are version-guarded, and a
 * thrown error rolls the whole snapshot back.
 */
export class FakeOrderRepository implements OrderRepository {
  constructor(readonly state: OrderFixtureState) {}

  async transaction<TResult>(
    work: (repository: OrderTransactionRepository) => Promise<TResult>,
  ): Promise<TResult> {
    const snapshot = structuredClone(this.state);
    try {
      return await work(this.port());
    } catch (error) {
      Object.assign(this.state, snapshot);
      throw error;
    }
  }

  private port(): OrderTransactionRepository {
    const state = this.state;
    return {
      async claimIdempotency(input): Promise<IdempotencyClaim> {
        if (state.idempotency) return { acquired: false, record: state.idempotency };
        state.idempotency = {
          id: "idem-1",
          requestHash: input.requestHash,
          status: "PROCESSING",
          responseStatus: null,
          responseBody: null,
          lockedUntil: input.lockedUntil,
          expiresAt: input.expiresAt,
        };
        return { acquired: true, id: "idem-1" };
      },
      async restartIdempotency(input) {
        state.idempotency = {
          id: input.id,
          requestHash: input.requestHash,
          status: "PROCESSING",
          responseStatus: null,
          responseBody: null,
          lockedUntil: input.lockedUntil,
          expiresAt: input.expiresAt,
        };
      },
      async completeIdempotency(input) {
        if (!state.idempotency) throw new Error("idempotency scope miss");
        state.idempotency = {
          ...state.idempotency,
          status: "COMPLETED",
          responseStatus: input.responseStatus,
          responseBody: input.responseBody,
          lockedUntil: null,
        };
      },
      async findOrderContext() {
        return null;
      },
      async findOrderProducts(restaurantId, productIds) {
        return state.products.filter(
          (candidate) =>
            candidate.restaurantId === restaurantId && productIds.includes(candidate.id),
        );
      },
      async allocateOrderSequence() {
        return BigInt(1);
      },
      async insertOrder() {
        return { id: "order-new" };
      },
      async insertFulfillmentRequest(input) {
        state.fulfillmentRequests.push(input);
        return { id: `fulfillment-${state.fulfillmentRequests.length}` };
      },
      async insertOrderItems(inputs) {
        state.insertedItems.push(...inputs);
      },
      async markTableWaiting() {},
      async findOrderForUpdate() {
        return state.order;
      },
      async findOrderWithItemsForUpdate(restaurantId, orderId) {
        return state.order?.restaurantId === restaurantId && state.order.id === orderId
          ? state.order
          : null;
      },
      async updateOrderAmounts(input) {
        if (state.amountUpdateFails) return false;
        state.amountUpdates.push(input);
        return true;
      },
      async cancelOrderItem(input) {
        if (state.itemCancelFails) return false;
        state.cancelledItems.push(input);
        return true;
      },
      async voidOrderItem(input) {
        if (state.itemCancelFails) return false;
        state.voidedItems.push(input);
        return true;
      },
      async updateOrderStatus(input) {
        state.statusUpdates.push(input);
        return true;
      },
      async insertOrderEvent(input) {
        state.events.push(input);
      },
      async insertOutboxEvent(input) {
        state.outbox.push(input);
      },
      // Phase 8C queues the kitchen ticket with the order; this fake keeps
      // the domain tests about the order rather than about printing.
      async enqueueKitchenPrint() {
        return { created: 0, unrouted: 0 };
      },
      async insertAuditLog(input) {
        state.audits.push(input);
      },
    };
  }
}

export function service(fixtureState: OrderFixtureState): OrderService {
  return new OrderService(new FakeOrderRepository(fixtureState), { clock: FIXED_NOW });
}

export type { OrderItemStatus, OrderStatus };
