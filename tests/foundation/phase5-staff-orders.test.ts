import assert from "node:assert/strict";
import test from "node:test";

import { DomainError } from "../../lib/api/domain-error";
import type { RestaurantPrincipal } from "../../lib/domain/restaurant-scope";
import type {
  IdempotencyClaim,
  InsertAuditLogInput,
  InsertOrderEventInput,
  InsertOrderItemRecordInput,
  InsertOrderRecordInput,
  InsertOutboxEventInput,
  OrderContextRecord,
  OrderProductRecord,
  OrderRepository,
  OrderTransactionRepository,
  StoredIdempotencyRecord,
} from "../../lib/repositories/order-repository";
import { OrderService } from "../../lib/services/order-service";

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
  tableMarkedWaiting: boolean;
  sequence: bigint;
}

class FakeOrderRepository implements OrderRepository {
  constructor(readonly state: FakeState) {}

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
      async restartIdempotency(input): Promise<void> {
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
        if (!state.idempotency) throw new Error("scope miss");
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
        state.orderItems.push(...inputs);
      },
      async markTableWaiting() {
        state.tableMarkedWaiting = true;
      },
      async findOrderWithItemsForUpdate() {
        return null;
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
      async updateOrderStatus() {
        return false;
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

function state(contextOverrides: Partial<OrderContextRecord> = {}): FakeState {
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
      serviceFeeRate: "10.00",
      taxRate: "0.00",
      maxItemQuantity: 2,
      orderNotesMaxLength: 500,
      ...contextOverrides,
    },
    products: [
      {
        id: "product-soup",
        restaurantId: "restaurant-1",
        name: "Mercimek Corbasi",
        price: "250.00",
        isActive: true,
        isAvailable: true,
        deletedAt: null,
        categoryIsActive: true,
        categoryDeletedAt: null,
      },
    ],
    orders: [],
    orderItems: [],
    fulfillmentRequests: [],
    events: [],
    outbox: [],
    audits: [],
    tableMarkedWaiting: false,
    sequence: BigInt(105),
  };
}

const fixedClock = () => new Date("2026-08-14T12:00:00.000Z");

function principal(role: RestaurantPrincipal["role"]): RestaurantPrincipal {
  return {
    userId: `user-${role.toLowerCase()}`,
    restaurantId: "restaurant-1",
    role,
    isActive: true,
  };
}

function service(fakeState: FakeState) {
  return new OrderService(new FakeOrderRepository(fakeState), { clock: fixedClock });
}

const staffCommand = {
  tableId: "table-3",
  idempotencyKey: "staff-order-key-1",
  items: [{ productId: "product-soup", quantity: 2 }],
};

test("a waiter order is priced from the database, not from the request", async () => {
  const fakeState = state();
  const result = await service(fakeState).createStaffOrder(principal("WAITER"), {
    ...staffCommand,
    items: [{ productId: "product-soup", quantity: 2, price: "0.01" }],
  } as unknown as typeof staffCommand);

  assert.equal(result.amounts.subtotal, "500.00");
  assert.equal(result.amounts.serviceCharge, "50.00");
  assert.equal(result.amounts.total, "550.00");
  assert.equal(fakeState.orderItems[0]?.unitPrice, "250.00");
});

test("a waiter order is attributed to the staff member who opened it", async () => {
  const fakeState = state();
  await service(fakeState).createStaffOrder(principal("WAITER"), staffCommand);

  assert.equal(fakeState.orders[0]?.createdByType, "STAFF");
  assert.equal(fakeState.orders[0]?.createdByUserId, "user-waiter");
  assert.equal(fakeState.events[0]?.userId, "user-waiter");
  assert.equal(fakeState.audits[0]?.action, "ORDER_CREATED");
  assert.equal(fakeState.audits[0]?.actorUserId, "user-waiter");
  assert.equal(fakeState.tableMarkedWaiting, true);
});

test("a guest order keeps the customer attribution and writes no staff audit", async () => {
  const fakeState = state();
  await service(fakeState).createOrder({
    restaurantId: "restaurant-1",
    tableId: "table-3",
    tableAccessVersion: 5,
    sessionNonce: "Zm9vYmFyYmF6cXV4MTIzNA",
    idempotencyKey: "guest-order-key-1",
    items: [{ productId: "product-soup", quantity: 2 }],
  });

  assert.equal(fakeState.orders[0]?.createdByType, "CUSTOMER");
  assert.equal(fakeState.orders[0]?.createdByUserId, null);
  // The sitting is recorded too, which is what later lets this guest — and
  // only this guest — read the order back.
  assert.equal(fakeState.orders[0]?.customerSessionNonce, "Zm9vYmFyYmF6cXV4MTIzNA");
  assert.equal(fakeState.audits.length, 0);
});

test("replaying the same key returns the first order instead of a second one", async () => {
  const fakeState = state();
  const staff = service(fakeState);
  const first = await staff.createStaffOrder(principal("WAITER"), staffCommand);
  const second = await staff.createStaffOrder(principal("WAITER"), staffCommand);

  assert.equal(first.replayed, false);
  assert.equal(second.replayed, true);
  assert.equal(second.order.orderNumber, first.order.orderNumber);
  assert.equal(fakeState.orders.length, 1);
});

test("reusing a key for a different cart is a conflict, never a silent overwrite", async () => {
  const fakeState = state();
  const staff = service(fakeState);
  await staff.createStaffOrder(principal("WAITER"), staffCommand);

  await assert.rejects(
    () =>
      staff.createStaffOrder(principal("WAITER"), {
        ...staffCommand,
        items: [{ productId: "product-soup", quantity: 1 }],
      }),
    (error: unknown) => error instanceof DomainError && error.code === "IDEMPOTENCY_CONFLICT",
  );
  assert.equal(fakeState.orders.length, 1);
});

test("staff ordering survives the guest self-service switch being off", async () => {
  const fakeState = state({ orderingEnabled: false });
  const result = await service(fakeState).createStaffOrder(principal("WAITER"), staffCommand);
  assert.equal(result.order.status, "NEW");

  const guestState = state({ orderingEnabled: false });
  await assert.rejects(
    () =>
      service(guestState).createOrder({
        restaurantId: "restaurant-1",
        tableId: "table-3",
        tableAccessVersion: 5,
        sessionNonce: "Zm9vYmFyYmF6cXV4MTIzNA",
        idempotencyKey: "guest-order-key-2",
        items: [{ productId: "product-soup", quantity: 2 }],
      }),
    (error: unknown) => error instanceof DomainError && error.code === "CONFLICT",
  );
});

test("the guest per-item cap does not bind a waiter taking a table order", async () => {
  const fakeState = state();
  const result = await service(fakeState).createStaffOrder(principal("WAITER"), {
    ...staffCommand,
    idempotencyKey: "staff-order-key-2",
    items: [{ productId: "product-soup", quantity: 6 }],
  });
  assert.equal(result.amounts.subtotal, "1500.00");
});

test("a deactivated table refuses a staff order too", async () => {
  const fakeState = state({ tableIsActive: false });
  await assert.rejects(
    () => service(fakeState).createStaffOrder(principal("WAITER"), staffCommand),
    (error: unknown) => error instanceof DomainError && error.code === "TABLE_INACTIVE",
  );
  assert.equal(fakeState.orders.length, 0);
});

test("an unavailable product blocks the whole order", async () => {
  const fakeState = state();
  fakeState.products = [{ ...fakeState.products[0]!, isAvailable: false }];
  await assert.rejects(
    () => service(fakeState).createStaffOrder(principal("WAITER"), staffCommand),
    (error: unknown) => error instanceof DomainError && error.code === "PRODUCT_UNAVAILABLE",
  );
  assert.equal(fakeState.orders.length, 0);
});

test("kitchen and cashier roles cannot open an order for a table", async () => {
  for (const role of ["KITCHEN", "CASHIER"] as const) {
    const fakeState = state();
    await assert.rejects(
      () => service(fakeState).createStaffOrder(principal(role), staffCommand),
      (error: unknown) => error instanceof DomainError && error.code === "FORBIDDEN",
    );
    assert.equal(fakeState.orders.length, 0);
  }
});

test("an anonymous caller cannot open a staff order", async () => {
  const fakeState = state();
  await assert.rejects(
    () => service(fakeState).createStaffOrder(null, staffCommand),
    (error: unknown) =>
      error instanceof DomainError && error.code === "AUTHENTICATION_REQUIRED",
  );
  assert.equal(fakeState.orders.length, 0);
});

test("the tenant comes from the session, so a foreign table is never found", async () => {
  const fakeState = state();
  await assert.rejects(
    () =>
      service(fakeState).createStaffOrder(
        { ...principal("WAITER"), restaurantId: "restaurant-2" },
        staffCommand,
      ),
    (error: unknown) => error instanceof DomainError && error.code === "TABLE_INACTIVE",
  );
  assert.equal(fakeState.orders.length, 0);
});
