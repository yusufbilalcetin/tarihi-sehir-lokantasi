import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ErpService } from "../../lib/services/erp-service";
import type { ErpRepository } from "../../lib/repositories/erp-repository";

test("ERP admin route derives restaurant and actor from the authenticated principal", () => {
  const source = readFileSync(new URL("../../app/api/admin/erp/route.ts", import.meta.url), "utf8");
  assert.match(source, /principal\.restaurantId/);
  assert.match(source, /principal\.user\.id/);
  assert.match(source, /adminMutation/);
  assert.doesNotMatch(source, /body\.restaurantId|command\.restaurantId/);
});

test("attendance endpoint cannot accept another staff identity or client timestamp", () => {
  const route = readFileSync(new URL("../../app/api/staff/attendance/route.ts", import.meta.url), "utf8");
  const service = readFileSync(new URL("../../lib/services/attendance-service.ts", import.meta.url), "utf8");
  assert.match(route, /principal\.user\.id/);
  assert.match(route, /z\.object\(\{ action:/);
  assert.doesNotMatch(route, /staffId:\s*z\.|clockInAt:\s*z\.|clockOutAt:\s*z\./);
  assert.match(service, /clockInAt:\s*new Date\(\)/);
});

test("customer feedback is table-session scoped, anonymous and order scoped", () => {
  const route = readFileSync(new URL("../../app/api/feedback/route.ts", import.meta.url), "utf8");
  const service = readFileSync(new URL("../../lib/services/customer-feedback-service.ts", import.meta.url), "utf8");
  assert.match(route, /requireCustomerTableContext/);
  assert.match(route, /context\.restaurantId/);
  assert.match(route, /context\.tableId/);
  assert.doesNotMatch(route, /customerName|email|phone/);
  assert.match(service, /eq\(orders\.restaurantId, input\.restaurantId\)/);
  assert.match(service, /eq\(orders\.tableId, input\.tableId\)/);
  assert.match(service, /sha256/);
});

test("ERP service rejects an incoming sign for consumption movements", () => {
  const repository = { postStockMovement: async () => assert.fail("repository must not be called") } as unknown as ErpRepository;
  const service = new ErpService(repository);
  assert.throws(() => service.execute("restaurant", "staff", "request", {
    command: "POST_STOCK_MOVEMENT",
    inventoryItemId: "11111111-1111-4111-8111-111111111111",
    warehouseId: "22222222-2222-4222-8222-222222222222",
    movementType: "PRODUCTION_CONSUMPTION",
    quantityDelta: "1.000000",
    unitCost: null,
    sourceType: "TEST",
    sourceId: null,
    idempotencyKey: "phase38-test",
    reason: "test movement",
  }), /negatif miktar/);
});

test("purchase order totals are computed server-side with fixed precision", async () => {
  let captured: Parameters<ErpRepository["createPurchaseOrder"]>[0] | undefined;
  const repository = { createPurchaseOrder: async (input: Parameters<ErpRepository["createPurchaseOrder"]>[0]) => { captured = input; return { id: "po", status: "DRAFT" as const }; } } as unknown as ErpRepository;
  const service = new ErpService(repository);
  await service.execute("restaurant", "staff", "request", {
    command: "CREATE_PURCHASE_ORDER",
    supplierId: "11111111-1111-4111-8111-111111111111",
    orderNumber: "PO-1",
    expectedAt: null,
    notes: null,
    items: [{ inventoryItemId: "22222222-2222-4222-8222-222222222222", orderedQuantity: "1.500000", unit: "KG", unitPrice: "12.35" }],
  });
  assert.equal(captured?.items[0]?.lineTotal, "18.53");
});

test("popular snapshot query is bounded, excludes cancelled/voided and does not run in menu history", () => {
  const erp = readFileSync(new URL("../../lib/repositories/drizzle-erp-repository.ts", import.meta.url), "utf8");
  const menu = readFileSync(new URL("../../lib/repositories/drizzle-menu-repository.ts", import.meta.url), "utf8");
  assert.match(erp, /limit\(12\)/);
  assert.match(erp, /\["SERVED", "COMPLETED"\]/);
  assert.match(erp, /\["CANCELLED", "VOIDED"\]/);
  assert.match(menu, /popularProductSnapshots/);
  assert.doesNotMatch(menu, /orderItems|orders\.status|groupBy\(orderItems/);
});
