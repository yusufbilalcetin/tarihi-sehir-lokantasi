import assert from "node:assert/strict";
import test from "node:test";

import { DomainError } from "../../lib/api/domain-error";
import type {
  CustomerActiveOrderRecords,
  CustomerOrderQueryRepository,
} from "../../lib/repositories/customer-order-query-repository";
import { CustomerOrderQueryService } from "../../lib/services/customer-order-query-service";

class ScopedOrderQueryRepository implements CustomerOrderQueryRepository {
  calls: Array<{ restaurantId: string; tableId: string; sessionNonce: string }> = [];

  constructor(private readonly result: CustomerActiveOrderRecords) {}

  async findActiveByTable(
    restaurantId: string,
    tableId: string,
    sessionNonce: string,
  ): Promise<CustomerActiveOrderRecords> {
    this.calls.push({ restaurantId, tableId, sessionNonce });
    return this.result;
  }

  /** The table surface never reads a tracked order; see the tracking tests. */
  async findTrackedOrder(): Promise<null> {
    return null;
  }
}

test("active order query preserves table scope and exact decimal snapshots", async () => {
  const createdAt = new Date("2026-08-13T12:00:00.000Z");
  const repository = new ScopedOrderQueryRepository({
    orders: [
      {
        id: "order-a",
        orderNumber: "ORD-000001",
        status: "PREPARING",
        notes: "Masa notu",
        subtotal: "125.00",
        serviceChargeTotal: "0.00",
        taxTotal: "0.00",
        total: "125.00",
        currency: "TRY",
        createdAt,
        updatedAt: createdAt,
      },
    ],
    items: [
      {
        id: "item-a",
        orderId: "order-a",
        productId: "product-a",
        productNameSnapshot: "Ezogelin Çorbası",
        unitPrice: "125.00",
        quantity: 1,
        lineTotal: "125.00",
        notes: null,
        status: "PREPARING",
        sortOrder: 0,
      },
    ],
  });
  const service = new CustomerOrderQueryService(repository);

  const result = await service.getActiveOrders("restaurant-a", "table-a", "sitting-a");

  // The sitting reaches the repository intact: the query is scoped to one
  // guest's orders, not to every open order at the table.
  assert.deepEqual(repository.calls, [
    { restaurantId: "restaurant-a", tableId: "table-a", sessionNonce: "sitting-a" },
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.amounts.total, "125.00");
  assert.equal(result[0]?.items[0]?.productName, "Ezogelin Çorbası");
  assert.equal(result[0]?.items[0]?.unitPrice, "125.00");
  assert.equal(result[0]?.createdAt, createdAt.toISOString());
});

test("active order query returns an empty list without leaking another table", async () => {
  const repository = new ScopedOrderQueryRepository({ orders: [], items: [] });
  const service = new CustomerOrderQueryService(repository);

  assert.deepEqual(await service.getActiveOrders("restaurant-a", "table-b", "sitting-a"), []);
  assert.deepEqual(repository.calls, [
    { restaurantId: "restaurant-a", tableId: "table-b", sessionNonce: "sitting-a" },
  ]);
});

test("a missing sitting is refused instead of widening back to the table", async () => {
  const repository = new ScopedOrderQueryRepository({ orders: [], items: [] });
  const service = new CustomerOrderQueryService(repository);

  await assert.rejects(
    () => service.getActiveOrders("restaurant-a", "table-a", ""),
    (error: unknown) => error instanceof DomainError && error.code === "INVALID_TABLE_TOKEN",
  );
  assert.deepEqual(repository.calls, [], "no query may be issued without a sitting");
});
