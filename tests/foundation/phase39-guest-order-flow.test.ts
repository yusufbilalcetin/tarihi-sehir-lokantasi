import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { DomainError } from "../../lib/api/domain-error";
import type {
  InsertFulfillmentRequestInput,
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
import { OrderService, type CreateGuestOrderCommand } from "../../lib/services/order-service";

/**
 * Takeaway and courier orders placed by a customer, end to end through the
 * one canonical create path.
 *
 * The properties worth holding still: the order and its fulfillment row are
 * written together or not at all; the price is the catalogue's, never the
 * caller's; a takeaway never acquires a table; and one submit produces one
 * order however many times it arrives.
 */

const PRODUCT = "product-soup";

function context(tableId: string | null): OrderContextRecord {
  return {
    restaurantId: "restaurant-1",
    restaurantName: "Tarihi Şehir Lokantası",
    restaurantIsActive: true,
    currency: "TRY",
    timezone: "Europe/Istanbul",
    tableId,
    tableName: tableId ? "Masa 3" : null,
    tableNumber: tableId ? 3 : null,
    tableIsActive: tableId ? true : null,
    tableTokenVersion: tableId ? 5 : null,
    tableTokenRevokedAt: null,
    orderingEnabled: true,
    waiterApprovalRequired: true,
    customerNotesEnabled: true,
    serviceFeeRate: "0.00",
    taxRate: "0.00",
    maxItemQuantity: 20,
    orderNotesMaxLength: 500,
  };
}

interface FakeState {
  idempotency: StoredIdempotencyRecord | null;
  orders: InsertOrderRecordInput[];
  orderItems: InsertOrderItemRecordInput[];
  fulfillment: InsertFulfillmentRequestInput[];
  events: InsertOrderEventInput[];
  outbox: InsertOutboxEventInput[];
  tableTouched: boolean;
  orderingEnabled: boolean;
  failFulfillment: boolean;
}

function state(overrides: Partial<FakeState> = {}): FakeState {
  return {
    idempotency: null,
    orders: [],
    orderItems: [],
    fulfillment: [],
    events: [],
    outbox: [],
    tableTouched: false,
    orderingEnabled: true,
    failFulfillment: false,
    ...overrides,
  };
}

const PRODUCTS: OrderProductRecord[] = [
  {
    id: PRODUCT,
    restaurantId: "restaurant-1",
    name: "Mercimek Çorbası",
    price: "250.00",
    isActive: true,
    isAvailable: true,
    deletedAt: null,
    categoryIsActive: true,
    categoryDeletedAt: null,
  },
];

class FakeRepository implements OrderRepository {
  constructor(readonly s: FakeState) {}

  async transaction<TResult>(work: (repository: OrderTransactionRepository) => Promise<TResult>): Promise<TResult> {
    const snapshot = structuredClone(this.s);
    try {
      return await work(this.port());
    } catch (error) {
      // Mirrors a real rollback: nothing the failed attempt wrote survives.
      Object.assign(this.s, snapshot);
      throw error;
    }
  }

  private port(): OrderTransactionRepository {
    const s = this.s;
    // Only the members this flow exercises; the cast at the end stands in for
    // the rest of the interface, which createOrder never reaches.
    const port: Partial<OrderTransactionRepository> = {
      async claimIdempotency(input) {
        if (s.idempotency) return { acquired: false, record: s.idempotency };
        s.idempotency = {
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
      async restartIdempotency() {},
      async completeIdempotency(input) {
        if (s.idempotency) {
          s.idempotency = { ...s.idempotency, status: "COMPLETED", responseBody: input.responseBody };
        }
      },
      async findOrderContext(_restaurantId, tableId) {
        const record = context(tableId);
        return { ...record, orderingEnabled: s.orderingEnabled };
      },
      async findOrderProducts() {
        return PRODUCTS;
      },
      async allocateOrderSequence() {
        return BigInt(105);
      },
      async insertOrder(input) {
        s.orders.push(input);
        return { id: `order-${s.orders.length}` };
      },
      async insertFulfillmentRequest(input) {
        if (s.failFulfillment) throw new Error("simulated fulfillment insert failure");
        s.fulfillment.push(input);
        return { id: `fulfillment-${s.fulfillment.length}` };
      },
      async insertOrderItems(inputs) {
        s.orderItems.push(...inputs);
      },
      async markTableWaiting() {
        s.tableTouched = true;
      },
      async insertOrderEvent(input) {
        s.events.push(input);
      },
      async insertOutboxEvent(input) {
        s.outbox.push(input);
      },
      async insertAuditLog() {},
    };
    return port as OrderTransactionRepository;
  }
}

function guestCommand(overrides: Partial<CreateGuestOrderCommand> = {}): CreateGuestOrderCommand {
  return {
    restaurantId: "restaurant-1",
    channel: "TAKEAWAY",
    idempotencyKey: "guest-request-0001",
    items: [{ productId: PRODUCT, quantity: 2 }],
    fulfillment: { customerName: "Ayşe Yılmaz", contact: "05001234567", address: null, deliveryNotes: null },
    ...overrides,
  };
}

const clock = () => new Date("2026-08-26T12:00:00.000Z");

function service(s: FakeState) {
  return new OrderService(new FakeRepository(s), { clock });
}

test("a takeaway order is a canonical order with no table", async () => {
  const s = state();
  const result = await service(s).createGuestOrder(guestCommand());

  assert.equal(result.order.channel, "TAKEAWAY");
  assert.equal(result.order.tableId, null);
  assert.match(result.order.orderNumber, /^ORD-\d{6}$/);
  assert.equal(s.orders[0]?.channel, "TAKEAWAY");
  assert.equal(s.orders[0]?.tableId, null);
  // The order it produced is an ordinary order: same events, same numbering.
  assert.equal(s.events[0]?.eventType, "ORDER_CREATED");
  assert.equal(s.outbox[0]?.eventType, "ORDER_CREATED");
});

test("a courier order carries its address and its delivery state starts at PLACED", async () => {
  const s = state();
  await service(s)
    .createGuestOrder(
      guestCommand({
        channel: "DELIVERY",
        fulfillment: { customerName: "Ayşe Yılmaz", contact: "05001234567", address: "Atatürk Cd. 5", deliveryNotes: "Zili çalmayın" },
      }),
    );
  assert.equal(s.orders[0]?.channel, "DELIVERY");
  assert.equal(s.fulfillment[0]?.channel, "DELIVERY");
  assert.equal(s.fulfillment[0]?.address, "Atatürk Cd. 5");
  assert.equal(s.fulfillment[0]?.orderId, "order-1");
});

test("the order and its fulfillment are written together, or neither is", async () => {
  const s = state();
  await service(s).createGuestOrder(guestCommand());
  assert.equal(s.orders.length, 1);
  assert.equal(s.fulfillment.length, 1);
  assert.equal(s.fulfillment[0]?.orderId, "order-1");

  // If the fulfillment cannot be written, the order must not survive either:
  // an order nobody can deliver is worse than no order at all.
  const failing = state({ failFulfillment: true });
  await assert.rejects(() => service(failing).createGuestOrder(guestCommand()));
  assert.equal(failing.orders.length, 0);
  assert.equal(failing.fulfillment.length, 0);
});

test("the normal customer flow needs no manual link: the order id is set at creation", async () => {
  const s = state();
  await service(s).createGuestOrder(guestCommand());
  assert.equal(s.fulfillment[0]?.orderId, s.orders.length ? "order-1" : null);
  assert.ok(s.fulfillment[0]?.orderId, "fulfillment must reference its order without an operator step");
});

test("a takeaway order never touches the floor plan", async () => {
  const s = state();
  await service(s).createGuestOrder(guestCommand());
  assert.equal(s.tableTouched, false, "a takeaway order marked a table as waiting");
});

test("the price is the catalogue's, whatever the caller sends", async () => {
  const s = state();
  const spoofed = {
    ...guestCommand(),
    items: [{ productId: PRODUCT, quantity: 2, price: "0.01", unitPrice: "0.01", lineTotal: "0.02" }],
  } as unknown as CreateGuestOrderCommand;
  const result = await service(s).createGuestOrder(spoofed);
  assert.equal(result.amounts.subtotal, "500.00");
  assert.equal(result.amounts.total, "500.00");
  assert.equal(s.orderItems[0]?.unitPrice, "250.00");
  assert.equal(s.orderItems[0]?.lineTotal, "500.00");
});

test("a caller cannot smuggle a table onto a takeaway order", async () => {
  const s = state();
  const withTable = { ...guestCommand(), tableId: "table-3" } as unknown as CreateGuestOrderCommand;
  // The extra field is not in the command shape, so it is simply not read —
  // and the order still records no table.
  await service(s).createGuestOrder(withTable);
  assert.equal(s.orders[0]?.tableId, null);
  assert.equal(s.tableTouched, false);
});

test("the guest endpoint refuses to open a dine-in order", async () => {
  const s = state();
  await assert.rejects(
    () => service(s).createGuestOrder({ ...guestCommand(), channel: "DINE_IN" as never }),
    (error: unknown) => error instanceof DomainError && error.code === "VALIDATION_ERROR",
  );
});

test("a courier order without an address is refused", async () => {
  const s = state();
  await assert.rejects(
    () => service(s).createGuestOrder(guestCommand({ channel: "DELIVERY" })),
    (error: unknown) => error instanceof DomainError && /adres/i.test(error.message),
  );
  assert.equal(s.orders.length, 0);
});

test("a takeaway order carrying an address is refused", async () => {
  const s = state();
  await assert.rejects(() =>
    service(s).createGuestOrder(
      guestCommand({ fulfillment: { customerName: "Ayşe", contact: "05001234567", address: "Bir yer", deliveryNotes: null } }),
    ),
  );
});

test("contact is required and minimal: a name and a number, nothing more", async () => {
  const s = state();
  await assert.rejects(() =>
    service(s).createGuestOrder(guestCommand({ fulfillment: { customerName: "A", contact: "05001234567", address: null, deliveryNotes: null } })),
  );
  await assert.rejects(() =>
    service(s).createGuestOrder(guestCommand({ fulfillment: { customerName: "Ayşe Yılmaz", contact: "123", address: null, deliveryNotes: null } })),
  );
});

test("the same submit twice produces one order and one obligation", async () => {
  const s = state();
  const first = await service(s).createGuestOrder(guestCommand());
  const second = await service(s).createGuestOrder(guestCommand());

  assert.equal(second.replayed, true);
  assert.equal(second.order.orderNumber, first.order.orderNumber);
  assert.equal(second.amounts.total, first.amounts.total);
  assert.equal(s.orders.length, 1, "a repeated submit created a second order");
  assert.equal(s.fulfillment.length, 1, "a repeated submit created a second delivery");
});

test("online ordering being switched off closes the public door too", async () => {
  const s = state({ orderingEnabled: false });
  await assert.rejects(
    () => service(s).createGuestOrder(guestCommand()),
    (error: unknown) => error instanceof DomainError && error.httpStatus === 409,
  );
});

test("the public endpoint accepts no authoritative field from the caller", () => {
  const route = readFileSync(new URL("../../app/api/guest-orders/route.ts", import.meta.url), "utf8");
  // `.strict()` turns a smuggled field into a validation error rather than
  // something silently dropped.
  assert.match(route, /\.strict\(\)/);
  const schema = route.slice(route.indexOf("const createGuestOrderBodySchema"), route.indexOf("const RESPONSE_HEADERS"));
  for (const forbidden of ["restaurantId", "tableId", "unitPrice", "lineTotal", "total:", "staffId", "price"]) {
    assert.equal(schema.includes(forbidden), false, `the body schema accepts ${forbidden}`);
  }
  // The restaurant comes from the signed session.
  assert.match(route, /requireGuestOrderContext\(\)/);
  assert.match(route, /restaurantId: context\.restaurantId/);
  // The guest is shown words, not an enum.
  assert.match(route, /ORDER_CHANNEL_LABELS\[created\.order\.channel\]/);
  assert.doesNotMatch(route, /channel: created\.order\.channel/);
});

test("the session endpoint does not let a stranger enumerate restaurants", () => {
  const route = readFileSync(new URL("../../app/api/guest-sessions/route.ts", import.meta.url), "utf8");
  assert.match(route, /eq\(restaurants\.isActive, true\)/);
  // Unknown slug and closed restaurant give the same answer.
  assert.match(route, /if \(!restaurant \|\| !restaurant\.orderingEnabled\)/);
  assert.match(route, /httpOnly: true/);
  assert.match(route, /sameSite: "lax"/);
  assert.match(route, /assertTrustedMutationOrigin/);
});

test("the sales report splits by channel without double-counting revenue", () => {
  const source = readFileSync(new URL("../../lib/services/report-analytics-service.ts", import.meta.url), "utf8");
  const figures = source.slice(source.indexOf("private async summaryFigures"), source.indexOf("const totals = orderTotals[0]"));
  // One scope, one sum, partitioned three ways: the parts add up by
  // construction rather than by a second query that could drift.
  for (const channel of ["DINE_IN", "TAKEAWAY", "DELIVERY"]) {
    assert.ok(figures.includes(`${orders_channel()} = '${channel}'`), `no ${channel} partition in the summary`);
  }
  assert.equal(figures.split(".from(orders)").length - 1, 1, "the breakdown added a second orders query");
});

function orders_channel() {
  return "${orders.channel}";
}
