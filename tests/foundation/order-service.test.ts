import assert from "node:assert/strict";
import test from "node:test";

import { DomainError } from "../../lib/api/domain-error";
import type { RestaurantPrincipal } from "../../lib/domain/restaurant-scope";
import type {
  ClaimIdempotencyInput,
  IdempotencyClaim,
  InsertOrderEventInput,
  InsertAuditLogInput,
  InsertOrderItemRecordInput,
  InsertOrderRecordInput,
  InsertOutboxEventInput,
  MutableOrderRecord,
  OrderContextRecord,
  OrderProductRecord,
  OrderRepository,
  OrderTransactionRepository,
  RestartIdempotencyInput,
  StoredIdempotencyRecord,
  UpdateOrderStatusInput,
} from "../../lib/repositories/order-repository";
import { OrderService, type CreateCustomerOrderCommand } from "../../lib/services/order-service";

interface FakeState {
  idempotency: StoredIdempotencyRecord | null;
  context: OrderContextRecord | null;
  products: OrderProductRecord[];
  orders: InsertOrderRecordInput[];
  orderItems: InsertOrderItemRecordInput[];
  fulfillmentRequests: unknown[];
  events: InsertOrderEventInput[];
  outbox: InsertOutboxEventInput[];
  audits: InsertAuditLogInput[];
  mutableOrder: MutableOrderRecord | null;
  tableMarkedWaiting: boolean;
  sequence: bigint;
  failAt?: "items" | "event" | "audit";
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

class FakeOrderRepository implements OrderRepository {
  constructor(readonly state: FakeState) {}

  async transaction<TResult>(
    work: (repository: OrderTransactionRepository) => Promise<TResult>,
  ): Promise<TResult> {
    const snapshot = clone(this.state);
    try {
      return await work(this.transactionPort());
    } catch (error) {
      Object.assign(this.state, snapshot);
      throw error;
    }
  }

  private transactionPort(): OrderTransactionRepository {
    const state = this.state;
    return {
      async claimIdempotency(input: ClaimIdempotencyInput): Promise<IdempotencyClaim> {
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
      async restartIdempotency(input: RestartIdempotencyInput): Promise<void> {
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
      async completeIdempotency(input): Promise<void> {
        if (!state.idempotency || input.id !== state.idempotency.id) throw new Error("scope miss");
        state.idempotency = {
          ...state.idempotency,
          status: "COMPLETED",
          responseStatus: input.responseStatus,
          responseBody: input.responseBody,
          lockedUntil: null,
        };
      },
      async findOrderContext(restaurantId, tableId) {
        return state.context?.restaurantId === restaurantId && state.context.tableId === tableId
          ? state.context
          : null;
      },
      async findOrderProducts(restaurantId, productIds) {
        return state.products.filter(
          (product) => product.restaurantId === restaurantId && productIds.includes(product.id),
        );
      },
      async allocateOrderSequence() {
        const sequence = state.sequence;
        state.sequence += BigInt(1);
        return sequence;
      },
      async insertOrder(input) {
        state.orders.push(input);
        return { id: `order-${state.orders.length}` };
      },
      async insertFulfillmentRequest(input) {
        state.fulfillmentRequests.push(input);
        return { id: `fulfillment-${state.fulfillmentRequests.length}` };
      },
      async insertOrderItems(inputs) {
        if (state.failAt === "items") throw new Error("simulated item insert failure");
        state.orderItems.push(...inputs);
      },
      async markTableWaiting() {
        state.tableMarkedWaiting = true;
      },
      // This suite exercises creation and status changes; the money fields and
      // the lines a whole-order command sweeps belong to the Phase 6 fixtures.
      async findOrderWithItemsForUpdate(restaurantId, orderId) {
        const record = state.mutableOrder;
        if (record?.restaurantId !== restaurantId || record.id !== orderId) return null;
        return {
          ...record,
          subtotal: "0.00",
          serviceChargeTotal: "0.00",
          taxTotal: "0.00",
          total: "0.00",
          serviceFeeRate: null,
          taxRate: null,
          currency: "TRY",
          hasSettledPayment: false,
          hasPendingPayment: false,
          items: [],
        };
      },
      async updateOrderAmounts() {
        return false;
      },
      async cancelOrderItem() {
        return false;
      },
      async voidOrderItem() {
        return false;
      },
      async advanceOrderItems() {
        return [];
      },
      async updateOrderStatus(input: UpdateOrderStatusInput) {
        if (!state.mutableOrder) return false;
        state.mutableOrder = {
          ...state.mutableOrder,
          status: input.nextStatus,
          version: input.currentVersion + 1,
        };
        return true;
      },
      async insertOrderEvent(input) {
        if (state.failAt === "event") throw new Error("simulated event failure");
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
        if (state.failAt === "audit") throw new Error("simulated audit failure");
        state.audits.push(input);
      },
    };
  }
}

function state(overrides: Partial<FakeState> = {}): FakeState {
  return {
    idempotency: null,
    context: {
      restaurantId: "restaurant-1",
      restaurantName: "Tarihi Sehir Lokantasi",
      restaurantIsActive: true,
      currency: "TRY",
      timezone: "Europe/Istanbul",
      tableId: "table-3",
      tableName: "Masa 3",
      tableNumber: 3,
      tableIsActive: true,
      tableTokenVersion: 5,
      tableTokenRevokedAt: null,
      orderingEnabled: true,
      waiterApprovalRequired: true,
      customerNotesEnabled: true,
      serviceFeeRate: "0.00",
      taxRate: "0.00",
      maxItemQuantity: 20,
      orderNotesMaxLength: 500,
    },
    products: [{
      id: "product-soup",
      restaurantId: "restaurant-1",
      name: "Mercimek Corbasi",
      price: "250.00",
      isActive: true,
      isAvailable: true,
      deletedAt: null,
      categoryIsActive: true,
      categoryDeletedAt: null,
    }],
    orders: [],
    orderItems: [],
    fulfillmentRequests: [],
    events: [],
    outbox: [],
    audits: [],
    mutableOrder: null,
    tableMarkedWaiting: false,
    sequence: BigInt(105),
    ...overrides,
  };
}

function command(overrides: Partial<CreateCustomerOrderCommand> = {}): CreateCustomerOrderCommand {
  return {
    restaurantId: "restaurant-1",
    tableId: "table-3",
    tableAccessVersion: 5,
    sessionNonce: "c2l0dGluZy1vbmUtMTIzNA",
    idempotencyKey: "request-key-123",
    items: [{ productId: "product-soup", quantity: 2 }],
    ...overrides,
  };
}

const fixedClock = () => new Date("2026-08-13T12:00:00.000Z");

test("OrderService ignores manipulated client price and snapshots DB price atomically", async () => {
  const fakeState = state();
  const service = new OrderService(new FakeOrderRepository(fakeState), { clock: fixedClock });
  const input = {
    ...command(),
    items: [{ productId: "product-soup", quantity: 2, price: "0.01" }],
  } as unknown as CreateCustomerOrderCommand;

  const result = await service.createOrder(input);
  assert.equal(result.amounts.subtotal, "500.00");
  assert.equal(fakeState.orderItems[0]?.unitPrice, "250.00");
  assert.equal(fakeState.orderItems[0]?.productNameSnapshot, "Mercimek Corbasi");
  assert.equal(fakeState.events[0]?.eventType, "ORDER_CREATED");
  assert.equal(fakeState.outbox[0]?.eventType, "ORDER_CREATED");
});

test("OrderService rejects unavailable and cross-tenant products", async () => {
  const unavailable = state({ products: [{ ...state().products[0]!, isAvailable: false }] });
  await assert.rejects(
    () => new OrderService(new FakeOrderRepository(unavailable), { clock: fixedClock }).createOrder(command()),
    (error: unknown) => error instanceof DomainError && error.code === "PRODUCT_UNAVAILABLE",
  );
  assert.equal(unavailable.orders.length, 0);

  const crossTenant = state({ products: [{ ...state().products[0]!, restaurantId: "restaurant-2" }] });
  await assert.rejects(
    () => new OrderService(new FakeOrderRepository(crossTenant), { clock: fixedClock }).createOrder(command()),
    (error: unknown) => error instanceof DomainError && error.code === "PRODUCT_NOT_FOUND",
  );
});

test("OrderService transaction rolls back order, items, counter, event and idempotency", async () => {
  const fakeState = state({ failAt: "event" });
  await assert.rejects(
    () => new OrderService(new FakeOrderRepository(fakeState), { clock: fixedClock }).createOrder(command()),
    /simulated event failure/,
  );
  assert.equal(fakeState.orders.length, 0);
  assert.equal(fakeState.orderItems.length, 0);
  assert.equal(fakeState.events.length, 0);
  assert.equal(fakeState.outbox.length, 0);
  assert.equal(fakeState.idempotency, null);
  assert.equal(fakeState.sequence, BigInt(105));
});

test("OrderService replays completed idempotent requests and conflicts on changed payload", async () => {
  const fakeState = state();
  const service = new OrderService(new FakeOrderRepository(fakeState), { clock: fixedClock });
  const first = await service.createOrder(command());
  const replay = await service.createOrder(command());
  assert.equal(replay.replayed, true);
  assert.equal(replay.order.id, first.order.id);
  assert.equal(fakeState.orders.length, 1);

  await assert.rejects(
    () => service.createOrder(command({ items: [{ productId: "product-soup", quantity: 3 }] })),
    (error: unknown) => error instanceof DomainError && error.code === "IDEMPOTENCY_CONFLICT",
  );
});

test("a second sitting reusing the first one's key is a conflict, not a replay", async () => {
  // Both parties sit at `table-3`, so they share the `CUSTOMER_ORDER:table-3`
  // idempotency scope. Without the sitting in the request fingerprint the
  // second one would be handed the first one's order back — its number, its
  // total — as a successful replay.
  const fakeState = state();
  const service = new OrderService(new FakeOrderRepository(fakeState), { clock: fixedClock });
  await service.createOrder(command());

  await assert.rejects(
    () => service.createOrder(command({ sessionNonce: "c2l0dGluZy10d28tNTY3OA" })),
    (error: unknown) => error instanceof DomainError && error.code === "IDEMPOTENCY_CONFLICT",
  );
  assert.equal(fakeState.orders.length, 1);
  assert.equal(fakeState.orders[0]?.customerSessionNonce, "c2l0dGluZy1vbmUtMTIzNA");
});

test("an order is stamped with the sitting, and a blank one is refused", async () => {
  const fakeState = state();
  const service = new OrderService(new FakeOrderRepository(fakeState), { clock: fixedClock });
  await service.createOrder(command());
  assert.equal(fakeState.orders[0]?.customerSessionNonce, "c2l0dGluZy1vbmUtMTIzNA");

  // Nothing may be written that no sitting owns and no guest can read back.
  await assert.rejects(
    () => service.createOrder(command({ sessionNonce: "", idempotencyKey: "request-key-999" })),
    (error: unknown) => error instanceof DomainError && error.code === "INVALID_TABLE_TOKEN",
  );
  assert.equal(fakeState.orders.length, 1);
});

test("OrderService validates table access version and role-scoped status flow", async () => {
  const fakeState = state({
    mutableOrder: {
      id: "order-1",
      restaurantId: "restaurant-1",
      channel: "DINE_IN" as const,
      tableId: "table-3",
      orderNumber: "ORD-000105",
      status: "CONFIRMED",
      version: 1,
    },
  });
  const service = new OrderService(new FakeOrderRepository(fakeState), { clock: fixedClock });
  await assert.rejects(
    () => service.createOrder(command({ tableAccessVersion: 4 })),
    (error: unknown) => error instanceof DomainError && error.code === "INVALID_TABLE_TOKEN",
  );

  const kitchen: RestaurantPrincipal = {
    userId: "kitchen-1",
    restaurantId: "restaurant-1",
    role: "KITCHEN",
    isActive: true,
  };
  const status = await service.updateStatus(kitchen, {
    restaurantId: "restaurant-1",
    orderId: "order-1",
    nextStatus: "PREPARING",
  });
  assert.equal(status.status, "PREPARING");
  assert.equal(fakeState.outbox.at(-1)?.eventType, "ORDER_PREPARING");
  assert.equal(fakeState.audits.at(-1)?.action, "ORDER_STATUS_CHANGED");

  const otherTenant: RestaurantPrincipal = { ...kitchen, restaurantId: "restaurant-2" };
  await assert.rejects(
    () => service.updateStatus(otherTenant, {
      restaurantId: "restaurant-1",
      orderId: "order-1",
      nextStatus: "READY",
    }),
    (error: unknown) =>
      error instanceof DomainError && error.code === "RESTAURANT_SCOPE_VIOLATION",
  );
});

test("OrderService rolls back status, event, and outbox when audit persistence fails", async () => {
  const fakeState = state({
    failAt: "audit",
    mutableOrder: {
      id: "order-1",
      restaurantId: "restaurant-1",
      channel: "DINE_IN" as const,
      tableId: "table-3",
      orderNumber: "ORD-000105",
      status: "NEW",
      version: 1,
    },
  });
  const waiter: RestaurantPrincipal = {
    userId: "waiter-1",
    restaurantId: "restaurant-1",
    role: "WAITER",
    isActive: true,
  };
  await assert.rejects(
    () => new OrderService(new FakeOrderRepository(fakeState), { clock: fixedClock })
      .updateStatus(waiter, {
        restaurantId: "restaurant-1",
        orderId: "order-1",
        nextStatus: "CONFIRMED",
      }),
    /simulated audit failure/,
  );
  assert.equal(fakeState.mutableOrder?.status, "NEW");
  assert.equal(fakeState.mutableOrder?.version, 1);
  assert.equal(fakeState.events.length, 0);
  assert.equal(fakeState.outbox.length, 0);
  assert.equal(fakeState.audits.length, 0);
});
