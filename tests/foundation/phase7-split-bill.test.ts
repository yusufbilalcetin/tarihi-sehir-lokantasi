import assert from "node:assert/strict";
import test from "node:test";

import { DomainError } from "../../lib/api/domain-error";
import type { RestaurantPrincipal } from "../../lib/domain/restaurant-scope";
import type { OrderItemStatus } from "../../lib/domain/status";
import type {
  CheckItemRecord,
  CheckOrderRecord,
  InsertCheckAllocationInput,
  InsertCheckInput,
  OrderCheckRecord,
  OrderCheckRepository,
  OrderCheckTransactionRepository,
} from "../../lib/repositories/order-check-repository";
import { OrderCheckService } from "../../lib/services/order-check-service";

const NOW = () => new Date("2026-08-14T21:00:00.000Z");

function principal(role: RestaurantPrincipal["role"]): RestaurantPrincipal {
  return {
    userId: `user-${role.toLowerCase()}`,
    restaurantId: "restaurant-1",
    role,
    isActive: true,
  };
}

function item(
  id: string,
  quantity: number,
  unitPrice: string,
  status: OrderItemStatus = "SERVED",
): CheckItemRecord {
  return {
    id,
    productNameSnapshot: `Ürün ${id}`,
    unitPrice,
    quantity,
    status,
    allocatedQuantity: 0,
  };
}

/** Mirrors the repository contract: allocations accumulate per order item. */
class FakeCheckTransaction implements OrderCheckTransactionRepository {
  order: CheckOrderRecord | null = {
    id: "order-1",
    restaurantId: "restaurant-1",
    channel: "DINE_IN" as const,
    orderNumber: "ORD-000120",
    status: "SERVED",
    total: "1200.00",
    tableId: "table-7",
  };
  items: CheckItemRecord[] = [
    item("item-fasulye", 2, "250.00"),
    item("item-pilav", 2, "150.00"),
    item("item-ayran", 3, "50.00"),
  ];
  checks: OrderCheckRecord[] = [];
  insertedChecks: InsertCheckInput[] = [];
  allocations: InsertCheckAllocationInput[] = [];
  outbox: { eventType: string }[] = [];
  audits: { action: string }[] = [];
  cancelledChecks: string[] = [];
  deletedAllocations: string[] = [];
  updatedChecks: { checkId: string; label: string; total: string }[] = [];
  private sequence = 0;

  async findOrderForUpdate(restaurantId: string, orderId: string) {
    if (!this.order) return null;
    return this.order.restaurantId === restaurantId && this.order.id === orderId
      ? this.order
      : null;
  }

  async listBillableItems(restaurantId: string) {
    if (this.order?.restaurantId !== restaurantId) return [];
    // Mirrors the repository predicate: only OPEN and PAID checks hold
    // quantities, so a cancelled check releases its portions automatically.
    const liveCheckIds = new Set(
      this.checks
        .filter((check) => check.status === "OPEN" || check.status === "PAID")
        .map((check) => check.id),
    );
    return this.items.map((candidate) => ({
      ...candidate,
      allocatedQuantity: this.allocations
        .filter(
          (allocation) =>
            allocation.orderItemId === candidate.id && liveCheckIds.has(allocation.checkId),
        )
        .reduce((sum, allocation) => sum + allocation.quantity, 0),
    }));
  }

  async listChecks(restaurantId: string) {
    return this.order?.restaurantId === restaurantId ? this.checks : [];
  }

  async findCheckForUpdate(restaurantId: string, checkId: string) {
    if (this.order?.restaurantId !== restaurantId) return null;
    return this.checks.find((check) => check.id === checkId) ?? null;
  }

  async insertCheck(input: InsertCheckInput) {
    this.insertedChecks.push(input);
    this.sequence += 1;
    const id = `check-${this.sequence}`;
    this.checks.push({
      id,
      orderId: input.orderId,
      label: input.label,
      status: "OPEN",
      total: input.total,
      createdAt: input.at,
      closedAt: null,
      items: [],
      paidTotal: "0.00",
      refundedTotal: "0.00",
    });
    return { id };
  }

  async insertCheckAllocation(input: InsertCheckAllocationInput) {
    this.allocations.push(input);
    const index = this.checks.findIndex((candidate) => candidate.id === input.checkId);
    if (index >= 0) {
      this.checks[index] = {
        ...this.checks[index]!,
        items: [
          ...this.checks[index]!.items,
          {
            id: `alloc-${this.allocations.length}`,
            orderItemId: input.orderItemId,
            productNameSnapshot: `Ürün ${input.orderItemId}`,
            quantity: input.quantity,
            unitPriceSnapshot: input.unitPriceSnapshot,
            lineTotal: input.lineTotal,
          },
        ],
      };
    }
  }

  async updateCheckDetails(
    _restaurantId: string,
    checkId: string,
    details: { label: string; total: string },
  ) {
    const index = this.checks.findIndex((check) => check.id === checkId);
    if (index >= 0) {
      this.checks[index] = { ...this.checks[index]!, label: details.label, total: details.total };
    }
    this.updatedChecks.push({ checkId, ...details });
  }

  async cancelCheck(_restaurantId: string, checkId: string) {
    const index = this.checks.findIndex((check) => check.id === checkId);
    if (index < 0 || this.checks[index]!.status !== "OPEN") return false;
    this.checks[index] = { ...this.checks[index]!, status: "CANCELLED" };
    this.cancelledChecks.push(checkId);
    return true;
  }

  async deleteCheckAllocations(_restaurantId: string, checkId: string) {
    this.deletedAllocations.push(checkId);
    this.allocations = this.allocations.filter(
      (allocation) => allocation.checkId !== checkId,
    );
  }

  async insertOutbox(input: { eventType: string }) {
    this.outbox.push({ eventType: input.eventType });
  }

  async insertAudit(input: { action: string }) {
    this.audits.push({ action: input.action });
  }
}

class FakeCheckRepository implements OrderCheckRepository {
  transactionRepository = new FakeCheckTransaction();

  /** A throw rolls everything back, exactly as the database transaction does. */
  async transaction<TResult>(
    work: (repository: OrderCheckTransactionRepository) => Promise<TResult>,
  ): Promise<TResult> {
    const snapshot = structuredClone({
      checks: this.transactionRepository.checks,
      insertedChecks: this.transactionRepository.insertedChecks,
      allocations: this.transactionRepository.allocations,
      outbox: this.transactionRepository.outbox,
      audits: this.transactionRepository.audits,
      cancelledChecks: this.transactionRepository.cancelledChecks,
      deletedAllocations: this.transactionRepository.deletedAllocations,
      updatedChecks: this.transactionRepository.updatedChecks,
    });
    try {
      return await work(this.transactionRepository);
    } catch (error) {
      Object.assign(this.transactionRepository, snapshot);
      throw error;
    }
  }
}

function service(repository: FakeCheckRepository) {
  return new OrderCheckService(repository, { clock: NOW });
}

test("splitting by product gives each check its own lines and total", async () => {
  const repository = new FakeCheckRepository();
  const result = await service(repository).createChecks(principal("CASHIER"), {
    orderId: "order-1",
    mode: "ITEMS",
    checks: [
      {
        label: "Ali",
        items: [
          { orderItemId: "item-fasulye", quantity: 1 },
          { orderItemId: "item-pilav", quantity: 1 },
          { orderItemId: "item-ayran", quantity: 1 },
        ],
      },
      {
        items: [
          { orderItemId: "item-fasulye", quantity: 1 },
          { orderItemId: "item-pilav", quantity: 1 },
          { orderItemId: "item-ayran", quantity: 2 },
        ],
      },
    ],
  });

  assert.equal(result.checks.length, 2);
  assert.equal(result.checks[0]?.label, "Ali");
  assert.equal(result.checks[0]?.total, "450.00");
  assert.equal(result.checks[1]?.label, "Hesap 2");
  assert.equal(result.checks[1]?.total, "500.00");
  // The original order and its lines are untouched.
  assert.equal(repository.transactionRepository.order?.total, "1200.00");
  assert.equal(repository.transactionRepository.items.length, 3);
});

test("one line's quantity can be spread across two checks", async () => {
  const repository = new FakeCheckRepository();
  await service(repository).createChecks(principal("CASHIER"), {
    orderId: "order-1",
    mode: "ITEMS",
    checks: [
      {
        items: [
          { orderItemId: "item-ayran", quantity: 1 },
          { orderItemId: "item-fasulye", quantity: 2 },
        ],
      },
      {
        items: [
          { orderItemId: "item-ayran", quantity: 2 },
          { orderItemId: "item-pilav", quantity: 2 },
        ],
      },
    ],
  });

  const ayranAllocations = repository.transactionRepository.allocations.filter(
    (allocation) => allocation.orderItemId === "item-ayran",
  );
  assert.deepEqual(
    ayranAllocations.map((allocation) => allocation.quantity),
    [1, 2],
  );
  assert.equal(ayranAllocations[0]?.unitPriceSnapshot, "50.00");
  assert.equal(ayranAllocations[0]?.lineTotal, "50.00");
  assert.equal(ayranAllocations[1]?.lineTotal, "100.00");
});

test("a split that leaves a portion unassigned is refused", async () => {
  const repository = new FakeCheckRepository();
  await assert.rejects(
    () =>
      service(repository).createChecks(principal("CASHIER"), {
        orderId: "order-1",
        mode: "ITEMS",
        // Only two of the three Ayran are handed out.
        checks: [
          {
            items: [
              { orderItemId: "item-ayran", quantity: 1 },
              { orderItemId: "item-fasulye", quantity: 2 },
            ],
          },
          {
            items: [
              { orderItemId: "item-ayran", quantity: 1 },
              { orderItemId: "item-pilav", quantity: 2 },
            ],
          },
        ],
      }),
    (error: unknown) =>
      error instanceof DomainError && error.code === "CHECK_ALLOCATION_INVALID",
  );
  // The rollback leaves no half-built split behind.
  assert.equal(repository.transactionRepository.checks.length, 0);
});

test("a split needs at least two checks", async () => {
  const repository = new FakeCheckRepository();
  await assert.rejects(
    () =>
      service(repository).createChecks(principal("CASHIER"), {
        orderId: "order-1",
        mode: "ITEMS",
        checks: [
          {
            items: [
              { orderItemId: "item-fasulye", quantity: 2 },
              { orderItemId: "item-pilav", quantity: 2 },
              { orderItemId: "item-ayran", quantity: 3 },
            ],
          },
        ],
      }),
    (error: unknown) => error instanceof DomainError && error.code === "VALIDATION_ERROR",
  );
});

test("allocating more than a line holds is refused, even within one request", async () => {
  const repository = new FakeCheckRepository();
  await assert.rejects(
    () =>
      service(repository).createChecks(principal("CASHIER"), {
        orderId: "order-1",
        mode: "ITEMS",
        checks: [
          { items: [{ orderItemId: "item-ayran", quantity: 2 }] },
          { items: [{ orderItemId: "item-ayran", quantity: 2 }] },
        ],
      }),
    (error: unknown) =>
      error instanceof DomainError && error.code === "CHECK_ALLOCATION_INVALID",
  );
  assert.equal(repository.transactionRepository.allocations.length, 0);
});

test("a second split cannot re-use quantities the first one took", async () => {
  const repository = new FakeCheckRepository();
  const cashier = service(repository);
  await cashier.createChecks(principal("CASHIER"), {
    orderId: "order-1",
    mode: "ITEMS",
    checks: [{ items: [{ orderItemId: "item-fasulye", quantity: 2 }, { orderItemId: "item-ayran", quantity: 3 }] }, { items: [{ orderItemId: "item-pilav", quantity: 2 }] }],
  });

  await assert.rejects(
    () =>
      cashier.createChecks(principal("CASHIER"), {
        orderId: "order-1",
        mode: "ITEMS",
        checks: [
          { items: [{ orderItemId: "item-fasulye", quantity: 1 }] },
          { items: [{ orderItemId: "item-pilav", quantity: 1 }] },
        ],
      }),
    (error: unknown) =>
      error instanceof DomainError && error.code === "CHECK_ALLOCATION_INVALID",
  );
});

test("cancelled and voided lines can never be put on a check", async () => {
  for (const status of ["CANCELLED", "VOIDED"] as const) {
    const repository = new FakeCheckRepository();
    repository.transactionRepository.items = [item("item-x", 2, "100.00", status)];
    await assert.rejects(
      () =>
        service(repository).createChecks(principal("CASHIER"), {
          orderId: "order-1",
          mode: "ITEMS",
          checks: [
            { items: [{ orderItemId: "item-x", quantity: 1 }] },
            { items: [{ orderItemId: "item-x", quantity: 1 }] },
          ],
        }),
      (error: unknown) =>
        error instanceof DomainError && error.code === "CHECK_ALLOCATION_INVALID",
      `${status} must not be allocatable`,
    );
    assert.equal(repository.transactionRepository.allocations.length, 0);
  }
});

test("an equal split cuts the payable total without losing a kuruş", async () => {
  const repository = new FakeCheckRepository();
  repository.transactionRepository.order = {
    ...repository.transactionRepository.order!,
    total: "100.00",
  };
  const result = await service(repository).createChecks(principal("CASHIER"), {
    orderId: "order-1",
    mode: "EQUAL",
    shares: 3,
  });

  assert.deepEqual(
    result.checks.map((check) => check.total),
    ["33.34", "33.33", "33.33"],
  );
  const sum = result.checks.reduce((total, check) => total + Number(check.total) * 100, 0);
  assert.equal(Math.round(sum), 10_000);
  // An equal split assigns amounts, not lines.
  assert.equal(repository.transactionRepository.allocations.length, 0);
});

test("an equal split is refused once the bill already has checks", async () => {
  const repository = new FakeCheckRepository();
  const cashier = service(repository);
  await cashier.createChecks(principal("CASHIER"), {
    orderId: "order-1",
    mode: "ITEMS",
    checks: [{ items: [{ orderItemId: "item-fasulye", quantity: 2 }, { orderItemId: "item-ayran", quantity: 3 }] }, { items: [{ orderItemId: "item-pilav", quantity: 2 }] }],
  });

  await assert.rejects(
    () =>
      cashier.createChecks(principal("CASHIER"), {
        orderId: "order-1",
        mode: "EQUAL",
        shares: 2,
      }),
    (error: unknown) =>
      error instanceof DomainError && error.code === "CHECK_ALLOCATION_INVALID",
  );
});

test("an equal split needs at least two shares and at most twenty", async () => {
  for (const shares of [1, 21]) {
    const repository = new FakeCheckRepository();
    await assert.rejects(
      () =>
        service(repository).createChecks(principal("CASHIER"), {
          orderId: "order-1",
          mode: "EQUAL",
          shares,
        }),
      (error: unknown) => error instanceof DomainError && error.code === "VALIDATION_ERROR",
    );
  }
});

test("the split reports what is still unallocated", async () => {
  const repository = new FakeCheckRepository();
  const result = await service(repository).createChecks(principal("CASHIER"), {
    orderId: "order-1",
    mode: "ITEMS",
    checks: [{ items: [{ orderItemId: "item-fasulye", quantity: 2 }, { orderItemId: "item-ayran", quantity: 3 }] }, { items: [{ orderItemId: "item-pilav", quantity: 2 }] }],
  });

  // A completed split leaves nothing unassigned.
  const ayran = result.allocatableItems.find((entry) => entry.orderItemId === "item-ayran");
  assert.equal(ayran?.quantity, 3);
  assert.equal(ayran?.allocatedQuantity, 3);
  assert.equal(ayran?.remainingQuantity, 0);
});

test("an unused check can be cancelled and frees its quantities", async () => {
  const repository = new FakeCheckRepository();
  const cashier = service(repository);
  await cashier.createChecks(principal("CASHIER"), {
    orderId: "order-1",
    mode: "ITEMS",
    checks: [
      { items: [{ orderItemId: "item-fasulye", quantity: 2 }] },
      {
        items: [
          { orderItemId: "item-pilav", quantity: 2 },
          { orderItemId: "item-ayran", quantity: 3 },
        ],
      },
    ],
  });

  const result = await cashier.cancelCheck(principal("CASHIER"), {
    orderId: "order-1",
    checkId: "check-1",
  });

  assert.equal(result.checks[0]?.status, "CANCELLED");
  // History is kept: the allocation rows survive, they simply stop counting.
  assert.deepEqual(repository.transactionRepository.deletedAllocations, []);
  const fasulye = result.allocatableItems.find(
    (entry) => entry.orderItemId === "item-fasulye",
  );
  assert.equal(fasulye?.remainingQuantity, 2);
});

test("a check that took money cannot be cancelled", async () => {
  const repository = new FakeCheckRepository();
  await service(repository).createChecks(principal("CASHIER"), {
    orderId: "order-1",
    mode: "ITEMS",
    checks: [
      { items: [{ orderItemId: "item-fasulye", quantity: 2 }] },
      {
        items: [
          { orderItemId: "item-pilav", quantity: 2 },
          { orderItemId: "item-ayran", quantity: 3 },
        ],
      },
    ],
  });
  repository.transactionRepository.checks[0] = {
    ...repository.transactionRepository.checks[0]!,
    paidTotal: "250.00",
  };

  await assert.rejects(
    () =>
      service(repository).cancelCheck(principal("CASHIER"), {
        orderId: "order-1",
        checkId: "check-1",
      }),
    (error: unknown) => error instanceof DomainError && error.code === "CHECK_ALREADY_PAID",
  );
});

test("waiters and kitchen cannot split a bill", async () => {
  for (const role of ["WAITER", "KITCHEN"] as const) {
    const repository = new FakeCheckRepository();
    await assert.rejects(
      () =>
        service(repository).createChecks(principal(role), {
          orderId: "order-1",
          mode: "EQUAL",
          shares: 2,
        }),
      (error: unknown) => error instanceof DomainError && error.code === "FORBIDDEN",
    );
    assert.equal(repository.transactionRepository.insertedChecks.length, 0);
  }
});

test("another restaurant's cashier cannot split this bill", async () => {
  const repository = new FakeCheckRepository();
  await assert.rejects(
    () =>
      service(repository).createChecks(
        { ...principal("CASHIER"), restaurantId: "restaurant-2" },
        { orderId: "order-1", mode: "EQUAL", shares: 2 },
      ),
    (error: unknown) => error instanceof DomainError && error.code === "ORDER_NOT_FOUND",
  );
  assert.equal(repository.transactionRepository.insertedChecks.length, 0);
});

test("splitting writes its outbox event and audit record", async () => {
  const repository = new FakeCheckRepository();
  await service(repository).createChecks(principal("CASHIER"), {
    orderId: "order-1",
    mode: "EQUAL",
    shares: 2,
  });

  assert.deepEqual(repository.transactionRepository.outbox, [{ eventType: "CHECK_CREATED" }]);
  assert.deepEqual(repository.transactionRepository.audits, [
    { action: "order.check.created" },
  ]);
});
