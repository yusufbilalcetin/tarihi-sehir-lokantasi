import assert from "node:assert/strict";
import test from "node:test";

import { DomainError } from "../../lib/api/domain-error";
import type { RestaurantPrincipal } from "../../lib/domain/restaurant-scope";
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

const NOW = () => new Date("2026-08-14T22:00:00.000Z");

function principal(role: RestaurantPrincipal["role"]): RestaurantPrincipal {
  return {
    userId: `user-${role.toLowerCase()}`,
    restaurantId: "restaurant-1",
    role,
    isActive: true,
  };
}

/**
 * A bill already split into two checks:
 *   Hesap 1 — 1 Fasulye (250) + 1 Pilav (150) = 400.00
 *   Hesap 2 — 1 Fasulye (250) + 1 Ayran  (50) = 300.00
 */
class FakeCheckTransaction implements OrderCheckTransactionRepository {
  order: CheckOrderRecord = {
    id: "order-1",
    restaurantId: "restaurant-1",
    channel: "DINE_IN" as const,
    orderNumber: "ORD-000200",
    status: "SERVED",
    total: "700.00",
    tableId: "table-7",
  };
  items: CheckItemRecord[] = [
    { id: "item-fasulye", productNameSnapshot: "Kuru Fasulye", unitPrice: "250.00", quantity: 2, status: "SERVED", allocatedQuantity: 0 },
    { id: "item-pilav", productNameSnapshot: "Pilav", unitPrice: "150.00", quantity: 1, status: "SERVED", allocatedQuantity: 0 },
    { id: "item-ayran", productNameSnapshot: "Ayran", unitPrice: "50.00", quantity: 1, status: "SERVED", allocatedQuantity: 0 },
  ];
  allocations: (InsertCheckAllocationInput & { id: string })[] = [
    { id: "a1", restaurantId: "restaurant-1", checkId: "check-1", orderItemId: "item-fasulye", quantity: 1, unitPriceSnapshot: "250.00", lineTotal: "250.00", at: NOW() },
    { id: "a2", restaurantId: "restaurant-1", checkId: "check-1", orderItemId: "item-pilav", quantity: 1, unitPriceSnapshot: "150.00", lineTotal: "150.00", at: NOW() },
    { id: "a3", restaurantId: "restaurant-1", checkId: "check-2", orderItemId: "item-fasulye", quantity: 1, unitPriceSnapshot: "250.00", lineTotal: "250.00", at: NOW() },
    { id: "a4", restaurantId: "restaurant-1", checkId: "check-2", orderItemId: "item-ayran", quantity: 1, unitPriceSnapshot: "50.00", lineTotal: "50.00", at: NOW() },
  ];
  checkRows = [
    { id: "check-1", label: "Hesap 1", status: "OPEN" as const, total: "400.00", paidTotal: "0.00" },
    { id: "check-2", label: "Hesap 2", status: "OPEN" as const, total: "300.00", paidTotal: "0.00" },
  ];
  updatedChecks: { checkId: string; label: string; total: string }[] = [];
  deletedAllocations: string[] = [];
  audits: { action: string }[] = [];
  outbox: { eventType: string }[] = [];

  async findOrderForUpdate(restaurantId: string, orderId: string) {
    return this.order.restaurantId === restaurantId && this.order.id === orderId
      ? this.order
      : null;
  }

  private build(row: (typeof this.checkRows)[number]): OrderCheckRecord {
    return {
      id: row.id,
      orderId: "order-1",
      label: row.label,
      status: row.status,
      total: row.total,
      createdAt: NOW(),
      closedAt: null,
      paidTotal: row.paidTotal,
      refundedTotal: "0.00",
      items: this.allocations
        .filter((allocation) => allocation.checkId === row.id)
        .map((allocation) => ({
          id: allocation.id,
          orderItemId: allocation.orderItemId,
          productNameSnapshot:
            this.items.find((item) => item.id === allocation.orderItemId)
              ?.productNameSnapshot ?? "",
          quantity: allocation.quantity,
          unitPriceSnapshot: allocation.unitPriceSnapshot,
          lineTotal: allocation.lineTotal,
        })),
    };
  }

  async listBillableItems(restaurantId: string) {
    if (this.order.restaurantId !== restaurantId) return [];
    const live = new Set(
      this.checkRows
        .filter((row) => row.status === "OPEN" || row.status === "PAID")
        .map((row) => row.id),
    );
    return this.items.map((item) => ({
      ...item,
      allocatedQuantity: this.allocations
        .filter(
          (allocation) =>
            allocation.orderItemId === item.id && live.has(allocation.checkId),
        )
        .reduce((sum, allocation) => sum + allocation.quantity, 0),
    }));
  }

  async listChecks(restaurantId: string) {
    return this.order.restaurantId === restaurantId
      ? this.checkRows.map((row) => this.build(row))
      : [];
  }

  async findCheckForUpdate(restaurantId: string, checkId: string) {
    if (this.order.restaurantId !== restaurantId) return null;
    const row = this.checkRows.find((candidate) => candidate.id === checkId);
    return row ? this.build(row) : null;
  }

  async insertCheck(input: InsertCheckInput) {
    const id = `check-${this.checkRows.length + 1}`;
    this.checkRows.push({
      id,
      label: input.label,
      status: "OPEN",
      total: input.total,
      paidTotal: "0.00",
    });
    return { id };
  }

  async insertCheckAllocation(input: InsertCheckAllocationInput) {
    this.allocations.push({ ...input, id: `a${this.allocations.length + 1}` });
  }

  async updateCheckDetails(
    _restaurantId: string,
    checkId: string,
    details: { label: string; total: string },
  ) {
    const index = this.checkRows.findIndex((row) => row.id === checkId);
    if (index >= 0) {
      this.checkRows[index] = {
        ...this.checkRows[index]!,
        label: details.label,
        total: details.total,
      };
    }
    this.updatedChecks.push({ checkId, ...details });
  }

  async cancelCheck(_restaurantId: string, checkId: string) {
    const index = this.checkRows.findIndex((row) => row.id === checkId);
    if (index < 0 || this.checkRows[index]!.status !== "OPEN") return false;
    this.checkRows[index] = { ...this.checkRows[index]!, status: "CANCELLED" as never };
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

  async transaction<TResult>(
    work: (repository: OrderCheckTransactionRepository) => Promise<TResult>,
  ): Promise<TResult> {
    const snapshot = structuredClone({
      allocations: this.transactionRepository.allocations,
      checkRows: this.transactionRepository.checkRows,
      updatedChecks: this.transactionRepository.updatedChecks,
      deletedAllocations: this.transactionRepository.deletedAllocations,
      audits: this.transactionRepository.audits,
      outbox: this.transactionRepository.outbox,
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

test("an untouched check's allocations can be rewritten", async () => {
  const repository = new FakeCheckRepository();
  // Hesap 1 swaps its Pilav for the Ayran that Hesap 2 gives up.
  await service(repository).updateCheck(principal("CASHIER"), {
    orderId: "order-1",
    checkId: "check-2",
    allocations: [{ orderItemId: "item-fasulye", quantity: 1 }],
  });
  const result = await service(repository).updateCheck(principal("CASHIER"), {
    orderId: "order-1",
    checkId: "check-1",
    allocations: [
      { orderItemId: "item-fasulye", quantity: 1 },
      { orderItemId: "item-ayran", quantity: 1 },
    ],
  });

  const first = result.checks.find((check) => check.id === "check-1");
  assert.equal(first?.total, "300.00");
  assert.deepEqual(
    first?.items.map((item) => `${item.orderItemId}:${item.quantity}`),
    ["item-fasulye:1", "item-ayran:1"],
  );
  // Atomic replacement: the old rows go, the new ones land.
  assert.ok(repository.transactionRepository.deletedAllocations.includes("check-1"));
});

test("an edit that keeps a quantity is not counted against itself", async () => {
  const repository = new FakeCheckRepository();
  // Hesap 1 already holds 1 Fasulye; re-submitting the same 1 must be allowed.
  const result = await service(repository).updateCheck(principal("CASHIER"), {
    orderId: "order-1",
    checkId: "check-1",
    allocations: [{ orderItemId: "item-fasulye", quantity: 1 }],
  });
  assert.equal(result.checks.find((check) => check.id === "check-1")?.total, "250.00");
});

test("an edit cannot claim a quantity another check already holds", async () => {
  const repository = new FakeCheckRepository();
  await assert.rejects(
    () =>
      service(repository).updateCheck(principal("CASHIER"), {
        orderId: "order-1",
        checkId: "check-1",
        // Hesap 2 holds the other Fasulye, so 2 is one too many.
        allocations: [{ orderItemId: "item-fasulye", quantity: 2 }],
      }),
    (error: unknown) =>
      error instanceof DomainError && error.code === "CHECK_ALLOCATION_INVALID",
  );
  assert.equal(repository.transactionRepository.updatedChecks.length, 0);
});

test("the label alone can be changed", async () => {
  const repository = new FakeCheckRepository();
  const result = await service(repository).updateCheck(principal("CASHIER"), {
    orderId: "order-1",
    checkId: "check-1",
    label: "  Ali  ",
  });

  assert.equal(result.checks.find((check) => check.id === "check-1")?.label, "Ali");
  // Untouched allocations keep the original total.
  assert.equal(result.checks.find((check) => check.id === "check-1")?.total, "400.00");
  assert.deepEqual(repository.transactionRepository.deletedAllocations, []);
});

test("a blank label is rejected", async () => {
  const repository = new FakeCheckRepository();
  await assert.rejects(
    () =>
      service(repository).updateCheck(principal("CASHIER"), {
        orderId: "order-1",
        checkId: "check-1",
        label: "   ",
      }),
    (error: unknown) => error instanceof DomainError && error.code === "VALIDATION_ERROR",
  );
});

test("a part-paid check is immutable", async () => {
  const repository = new FakeCheckRepository();
  repository.transactionRepository.checkRows[0] = {
    ...repository.transactionRepository.checkRows[0]!,
    paidTotal: "100.00",
  };

  await assert.rejects(
    () =>
      service(repository).updateCheck(principal("CASHIER"), {
        orderId: "order-1",
        checkId: "check-1",
        allocations: [{ orderItemId: "item-fasulye", quantity: 1 }],
      }),
    (error: unknown) => error instanceof DomainError && error.code === "CHECK_NOT_MUTABLE",
  );
  assert.equal(repository.transactionRepository.updatedChecks.length, 0);
});

test("a paid or cancelled check is immutable", async () => {
  for (const status of ["PAID", "CANCELLED"] as const) {
    const repository = new FakeCheckRepository();
    repository.transactionRepository.checkRows[0] = {
      ...repository.transactionRepository.checkRows[0]!,
      status: status as never,
    };
    await assert.rejects(
      () =>
        service(repository).updateCheck(principal("CASHIER"), {
          orderId: "order-1",
          checkId: "check-1",
          label: "Ali",
        }),
      (error: unknown) => error instanceof DomainError && error.code === "CHECK_NOT_MUTABLE",
      `${status} must be immutable`,
    );
  }
});

test("an empty allocation list is rejected", async () => {
  const repository = new FakeCheckRepository();
  await assert.rejects(
    () =>
      service(repository).updateCheck(principal("CASHIER"), {
        orderId: "order-1",
        checkId: "check-1",
        allocations: [],
      }),
    (error: unknown) => error instanceof DomainError && error.code === "VALIDATION_ERROR",
  );
});

test("a cancelled or voided line cannot be moved onto a check", async () => {
  for (const status of ["CANCELLED", "VOIDED"] as const) {
    const repository = new FakeCheckRepository();
    repository.transactionRepository.items = repository.transactionRepository.items.map(
      (item) => (item.id === "item-ayran" ? { ...item, status } : item),
    );
    await assert.rejects(
      () =>
        service(repository).updateCheck(principal("CASHIER"), {
          orderId: "order-1",
          checkId: "check-1",
          allocations: [{ orderItemId: "item-ayran", quantity: 1 }],
        }),
      (error: unknown) =>
        error instanceof DomainError && error.code === "CHECK_ALLOCATION_INVALID",
    );
  }
});

test("waiters and kitchen cannot edit a check", async () => {
  for (const role of ["WAITER", "KITCHEN"] as const) {
    const repository = new FakeCheckRepository();
    await assert.rejects(
      () =>
        service(repository).updateCheck(principal(role), {
          orderId: "order-1",
          checkId: "check-1",
          label: "Ali",
        }),
      (error: unknown) => error instanceof DomainError && error.code === "FORBIDDEN",
    );
    assert.equal(repository.transactionRepository.updatedChecks.length, 0);
  }
});

test("another restaurant cannot reach this check", async () => {
  const repository = new FakeCheckRepository();
  await assert.rejects(
    () =>
      service(repository).updateCheck(
        { ...principal("CASHIER"), restaurantId: "restaurant-2" },
        { orderId: "order-1", checkId: "check-1", label: "Ali" },
      ),
    (error: unknown) => error instanceof DomainError && error.code === "ORDER_NOT_FOUND",
  );
});

test("an unknown check id is not found", async () => {
  const repository = new FakeCheckRepository();
  await assert.rejects(
    () =>
      service(repository).updateCheck(principal("CASHIER"), {
        orderId: "order-1",
        checkId: "check-nope",
        label: "Ali",
      }),
    (error: unknown) => error instanceof DomainError && error.code === "CHECK_NOT_FOUND",
  );
});

test("the edit writes its outbox event and audit record", async () => {
  const repository = new FakeCheckRepository();
  await service(repository).updateCheck(principal("CASHIER"), {
    orderId: "order-1",
    checkId: "check-1",
    label: "Ali",
    requestId: "req-31",
  });

  assert.deepEqual(repository.transactionRepository.outbox, [{ eventType: "CHECK_UPDATED" }]);
  assert.deepEqual(repository.transactionRepository.audits, [
    { action: "order.check.updated" },
  ]);
});
