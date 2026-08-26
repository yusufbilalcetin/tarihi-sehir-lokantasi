import assert from "node:assert/strict";
import test from "node:test";

import type {
  CustomerActiveOrderRecords,
  CustomerOrderQueryRepository,
} from "../../lib/repositories/customer-order-query-repository";
import { CustomerOrderQueryService } from "../../lib/services/customer-order-query-service";

class ScopedOrderQueryRepository implements CustomerOrderQueryRepository {
  calls: Array<{ restaurantId: string; tableId: string }> = [];

  constructor(private readonly result: CustomerActiveOrderRecords) {}

  async findActiveByTable(
    restaurantId: string,
    tableId: string,
  ): Promise<CustomerActiveOrderRecords> {
    this.calls.push({ restaurantId, tableId });
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

  const result = await service.getActiveOrders("restaurant-a", "table-a");

  assert.deepEqual(repository.calls, [
    { restaurantId: "restaurant-a", tableId: "table-a" },
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

  assert.deepEqual(await service.getActiveOrders("restaurant-a", "table-b"), []);
  assert.deepEqual(repository.calls, [
    { restaurantId: "restaurant-a", tableId: "table-b" },
  ]);
});
