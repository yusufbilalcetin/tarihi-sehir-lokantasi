import assert from "node:assert/strict";
import test from "node:test";

import { DomainError } from "../../lib/api/domain-error";
import type { RestaurantPrincipal } from "../../lib/domain/restaurant-scope";
import { OPEN_ORDER_STATUSES } from "../../lib/domain/status";
import type {
  InsertAuditLogInput,
  InsertOrderEventInput,
  InsertOutboxEventInput,
} from "../../lib/repositories/order-repository";
import type {
  MutableOrderItemRecord,
  StaffOrderListFilters,
  StaffOrderListRecord,
  StaffOrderRepository,
  StaffOrderTransactionRepository,
  UpdateOrderItemStatusRecordInput,
} from "../../lib/repositories/staff-order-repository";
import { canRoleTransitionOrderStatus } from "../../lib/services/order-service";
import {
  canRoleTransitionOrderItemStatus,
  isOrderStageCompatibleWithItemTransition,
  StaffOrderService,
} from "../../lib/services/staff-order-service";
import { staffOrderItemStatusBodySchema } from "../../lib/validation/staff-orders";

interface FakeStaffState {
  item: MutableOrderItemRecord | null;
  updatedItems: UpdateOrderItemStatusRecordInput[];
  events: InsertOrderEventInput[];
  outbox: InsertOutboxEventInput[];
  audits: InsertAuditLogInput[];
  listRecords: StaffOrderListRecord[];
  listedRestaurantId: string | null;
  failAt?: "audit";
  listedFilters?: StaffOrderListFilters;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

class FakeStaffOrderRepository implements StaffOrderRepository {
  constructor(readonly state: FakeStaffState) {}

  async listOrders(restaurantId: string, filters: StaffOrderListFilters) {
    this.state.listedRestaurantId = restaurantId;
    this.state.listedFilters = filters;
    return this.state.listRecords;
  }

  async transaction<TResult>(
    work: (repository: StaffOrderTransactionRepository) => Promise<TResult>,
  ): Promise<TResult> {
    const snapshot = clone(this.state);
    try {
      const state = this.state;
      return await work({
        async findOrderItemForUpdate(restaurantId, orderItemId) {
          return state.item?.restaurantId === restaurantId && state.item.id === orderItemId
            ? state.item
            : null;
        },
        async updateOrderItemStatus(input) {
          if (!state.item || state.item.status !== input.currentStatus) return false;
          state.updatedItems.push(input);
          state.item = { ...state.item, status: input.nextStatus };
          return true;
        },
        async insertOrderEvent(input) {
          state.events.push(input);
        },
        async insertOutboxEvent(input) {
          state.outbox.push(input);
        },
        async insertAuditLog(input) {
          if (state.failAt === "audit") throw new Error("simulated audit failure");
          state.audits.push(input);
        },
      });
    } catch (error) {
      Object.assign(this.state, snapshot);
      throw error;
    }
  }
}

function principal(
  role: RestaurantPrincipal["role"],
  restaurantId = "restaurant-a",
): RestaurantPrincipal {
  return { userId: `staff-${role.toLowerCase()}`, restaurantId, role, isActive: true };
}

function state(overrides: Partial<FakeStaffState> = {}): FakeStaffState {
  return {
    item: {
      id: "item-1",
      restaurantId: "restaurant-a",
      orderId: "order-1",
      orderNumber: "ORD-000001",
      orderStatus: "CONFIRMED",
      productName: "Mercimek Çorbası",
      status: "PENDING",
    },
    updatedItems: [],
    events: [],
    outbox: [],
    audits: [],
    listRecords: [],
    listedRestaurantId: null,
    ...overrides,
  };
}

test("staff order transition permissions are edge-based", () => {
  assert.equal(canRoleTransitionOrderStatus("WAITER", "NEW", "CONFIRMED"), true);
  assert.equal(canRoleTransitionOrderStatus("WAITER", "READY", "SERVED"), true);
  assert.equal(canRoleTransitionOrderStatus("WAITER", "SERVED", "COMPLETED"), false);
  assert.equal(canRoleTransitionOrderStatus("KITCHEN", "CONFIRMED", "PREPARING"), true);
  assert.equal(canRoleTransitionOrderStatus("KITCHEN", "PREPARING", "READY"), true);
  assert.equal(canRoleTransitionOrderStatus("KITCHEN", "READY", "SERVED"), false);
  assert.equal(canRoleTransitionOrderStatus("CASHIER", "SERVED", "COMPLETED"), true);
  assert.equal(canRoleTransitionOrderStatus("CASHIER", "NEW", "CONFIRMED"), false);
  assert.equal(canRoleTransitionOrderStatus("ADMIN", "PREPARING", "CANCELLED"), true);
  assert.equal(canRoleTransitionOrderStatus("MANAGER", "READY", "SERVED"), true);
  assert.equal(canRoleTransitionOrderStatus("ADMIN", "COMPLETED", "PREPARING"), false);
});

test("item transitions enforce kitchen/waiter boundaries", () => {
  assert.equal(canRoleTransitionOrderItemStatus("KITCHEN", "PENDING", "PREPARING"), true);
  assert.equal(canRoleTransitionOrderItemStatus("KITCHEN", "PREPARING", "READY"), true);
  assert.equal(canRoleTransitionOrderItemStatus("KITCHEN", "READY", "SERVED"), false);
  assert.equal(canRoleTransitionOrderItemStatus("WAITER", "READY", "SERVED"), true);
  assert.equal(canRoleTransitionOrderItemStatus("WAITER", "PENDING", "PREPARING"), false);
  assert.equal(canRoleTransitionOrderItemStatus("CASHIER", "READY", "SERVED"), false);
  assert.equal(canRoleTransitionOrderItemStatus("MANAGER", "PENDING", "CANCELLED"), false);
  assert.equal(staffOrderItemStatusBodySchema.safeParse({ status: "CANCELLED" }).success, false);
});

test("item transitions cannot move ahead of their locked parent order", () => {
  assert.equal(isOrderStageCompatibleWithItemTransition("NEW", "PENDING", "PREPARING"), false);
  assert.equal(isOrderStageCompatibleWithItemTransition("CONFIRMED", "PENDING", "PREPARING"), true);
  assert.equal(isOrderStageCompatibleWithItemTransition("CONFIRMED", "PREPARING", "READY"), false);
  assert.equal(isOrderStageCompatibleWithItemTransition("PREPARING", "PREPARING", "READY"), true);
  assert.equal(isOrderStageCompatibleWithItemTransition("PREPARING", "READY", "SERVED"), false);
  assert.equal(isOrderStageCompatibleWithItemTransition("READY", "READY", "SERVED"), true);
});

test("item status event, outbox, and audit are committed atomically", async () => {
  const fake = state();
  const service = new StaffOrderService(new FakeStaffOrderRepository(fake), {
    clock: () => new Date("2026-08-13T13:00:00.000Z"),
  });
  const result = await service.updateItemStatus(principal("KITCHEN"), {
    restaurantId: "restaurant-a",
    orderItemId: "item-1",
    nextStatus: "PREPARING",
    requestId: "request-1234",
  });

  assert.equal(result.status, "PREPARING");
  assert.equal(fake.events[0]?.eventType, "ORDER_ITEM_STATUS_CHANGED");
  assert.equal(fake.events[0]?.payload.scope, "ORDER_ITEM");
  assert.equal(fake.outbox[0]?.eventType, "ORDER_ITEM_STATUS_CHANGED");
  assert.equal(fake.audits[0]?.action, "ORDER_ITEM_STATUS_CHANGED");
  assert.deepEqual(fake.audits[0]?.oldValue, { status: "PENDING" });
  assert.deepEqual(fake.audits[0]?.newValue, { status: "PREPARING" });

  const failing = state({ failAt: "audit" });
  await assert.rejects(
    () => new StaffOrderService(new FakeStaffOrderRepository(failing)).updateItemStatus(
      principal("KITCHEN"),
      {
        restaurantId: "restaurant-a",
        orderItemId: "item-1",
        nextStatus: "PREPARING",
      },
    ),
    /simulated audit failure/,
  );
  assert.equal(failing.item?.status, "PENDING");
  assert.equal(failing.events.length, 0);
  assert.equal(failing.outbox.length, 0);
  assert.equal(failing.audits.length, 0);
});

test("item mutation is tenant-scoped and rejects invalid transitions", async () => {
  const fake = state();
  const service = new StaffOrderService(new FakeStaffOrderRepository(fake));
  await assert.rejects(
    () => service.updateItemStatus(principal("KITCHEN", "restaurant-b"), {
      restaurantId: "restaurant-a",
      orderItemId: "item-1",
      nextStatus: "PREPARING",
    }),
    (error: unknown) =>
      error instanceof DomainError && error.code === "RESTAURANT_SCOPE_VIOLATION",
  );

  // A served line is the floor's business: the kitchen cannot pull it back.
  fake.item = { ...fake.item!, status: "SERVED", orderStatus: "SERVED" };
  await assert.rejects(
    () => service.updateItemStatus(principal("KITCHEN"), {
      restaurantId: "restaurant-a",
      orderItemId: "item-1",
      nextStatus: "READY",
    }),
    (error: unknown) =>
      error instanceof DomainError && error.code === "INVALID_STATUS_TRANSITION",
  );

  // Undoing a preparation step is the kitchen's own correction, and allowed …
  fake.item = { ...fake.item!, status: "READY", orderStatus: "READY" };
  const reverted = await service.updateItemStatus(principal("KITCHEN"), {
    restaurantId: "restaurant-a",
    orderItemId: "item-1",
    nextStatus: "PREPARING",
    reasonCode: "MARKED_BY_MISTAKE",
  });
  assert.equal(reverted.status, "PREPARING");
  assert.equal(reverted.previousStatus, "READY");
  assert.equal(reverted.reverted, true, "the result says this was an undo");

  // … but not the floor's, and not the till's.
  for (const role of ["WAITER", "CASHIER"] as const) {
    fake.item = { ...fake.item!, status: "READY", orderStatus: "READY" };
    await assert.rejects(
      () => service.updateItemStatus(principal(role), {
        restaurantId: "restaurant-a",
        orderItemId: "item-1",
        nextStatus: "PREPARING",
      }),
      (error: unknown) => error instanceof DomainError && error.code === "FORBIDDEN",
      `${role} must not undo a kitchen step`,
    );
  }

  fake.item = { ...fake.item!, status: "PENDING", orderStatus: "NEW" };
  await assert.rejects(
    () => service.updateItemStatus(principal("KITCHEN"), {
      restaurantId: "restaurant-a",
      orderItemId: "item-1",
      nextStatus: "PREPARING",
    }),
    (error: unknown) =>
      error instanceof DomainError && error.code === "INVALID_STATUS_TRANSITION",
  );
});

test("staff order reads always derive tenant scope from the principal", async () => {
  const fake = state();
  const service = new StaffOrderService(new FakeStaffOrderRepository(fake));
  const result = await service.listOrders(principal("WAITER", "restaurant-a"), {
    status: "NEW",
    date: "2026-08-13",
    limit: 50,
  });
  assert.deepEqual(result, []);
  assert.equal(fake.listedRestaurantId, "restaurant-a");
});

test("a live-service screen asks the server for open orders only", async () => {
  // The list is newest-first and capped. Filtering settled orders in the browser
  // therefore hides nothing — it just lets them use up the rows a ticket that is
  // still cooking needed, so the oldest live order silently leaves the screen.
  // The three live screens must push that filter down to the query.
  const { readFileSync } = await import("node:fs");
  const path = await import("node:path");
  for (const file of [
    "components/kitchen/kitchen-board.tsx",
    "components/cashier/cashier-dashboard.tsx",
    "components/staff/use-staff-floor.ts",
  ]) {
    const source = readFileSync(path.join(process.cwd(), file), "utf8");
    assert.match(
      source,
      /staffApi\.orders\(\s*\{[^}]*open:\s*true/,
      `${file} must request open orders only`,
    );
  }

  // And the parameter has to survive validation and reach the repository.
  const { staffOrderListQuerySchema } = await import("../../lib/validation/staff-orders");
  assert.equal(staffOrderListQuerySchema.safeParse({ open: "true" }).success, true);
  assert.equal(staffOrderListQuerySchema.safeParse({ open: "yes" }).success, false);

  const fake = state();
  const service = new StaffOrderService(new FakeStaffOrderRepository(fake));
  await service.listOrders(principal("KITCHEN", "restaurant-a"), {
    openOnly: true,
    limit: 50,
  });
  assert.equal(fake.listedFilters?.openOnly, true);
});

test("the open-status set is exactly the non-terminal stages", () => {
  // Live screens filter on this set. If a terminal status ever crept in, a
  // settled order would sit on the pass for ever; if a live one dropped out,
  // a table's food would disappear from it.
  assert.deepEqual([...OPEN_ORDER_STATUSES], ["NEW", "CONFIRMED", "PREPARING", "READY", "SERVED"]);
  for (const status of ["COMPLETED", "CANCELLED"] as const) {
    assert.equal(OPEN_ORDER_STATUSES.includes(status), false, `${status} is settled`);
  }
});
