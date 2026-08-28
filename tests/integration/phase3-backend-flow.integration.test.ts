import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";

import { asc, eq } from "drizzle-orm";

import type { Database, DatabaseConnection } from "../../db";
import {
  auditLogs,
  categories,
  idempotencyKeys,
  kitchenTickets,
  orderEvents,
  orderItems,
  orders,
  outboxEvents,
  payments,
  products,
  restaurantCounters,
  restaurants,
  restaurantSettings,
  restaurantTables,
  staffProfiles,
  waiterCalls,
} from "../../db/schema";
import { DomainError } from "../../lib/api/domain-error";
import type { RestaurantPrincipal } from "../../lib/domain/restaurant-scope";
import { createCustomerTableSession, verifyCustomerTableSession } from "../../lib/security/customer-session";
import { deriveQrLinkToken, verifyQrLinkToken } from "../../lib/security/qr-link-token";
import { generateQrToken, hashQrToken, verifyQrToken } from "../../lib/security/qr-token";
import { MenuService } from "../../lib/services/menu-service";
import { OrderService, type CustomerOrderItemInput } from "../../lib/services/order-service";
import { TableService, type TableTokenCodec } from "../../lib/services/table-service";
import { WaiterCallService } from "../../lib/services/waiter-call-service";
import { readSupabaseIntegrationEnvironment } from "./supabase-test-environment";

const readiness = readSupabaseIntegrationEnvironment({ requireDatabaseUrl: true });

interface BackendFixture {
  readonly restaurantId: string;
  readonly categoryId: string;
  readonly productId: string;
  readonly tableId: string;
  readonly principals: {
    readonly admin: RestaurantPrincipal;
    readonly waiter: RestaurantPrincipal;
    readonly kitchen: RestaurantPrincipal;
    readonly cashier: RestaurantPrincipal;
  };
  readonly rawToken: string;
  readonly tokenHash: string;
  readonly pepper: Uint8Array;
  readonly sessionSecret: Uint8Array;
}

function expectDomainCode(code: string): (error: unknown) => boolean {
  return (error: unknown) => {
    assert.ok(error instanceof DomainError, `Expected DomainError(${code})`);
    assert.equal(error.code, code);
    return true;
  };
}

function createFixture(): BackendFixture {
  const restaurantId = randomUUID();
  const pepper = randomBytes(32);
  const generated = generateQrToken(pepper);
  const principal = (role: RestaurantPrincipal["role"]): RestaurantPrincipal => ({
    userId: randomUUID(),
    restaurantId,
    role,
    isActive: true,
  });

  return {
    restaurantId,
    categoryId: randomUUID(),
    productId: randomUUID(),
    tableId: randomUUID(),
    principals: {
      admin: principal("ADMIN"),
      waiter: principal("WAITER"),
      kitchen: principal("KITCHEN"),
      cashier: principal("CASHIER"),
    },
    rawToken: generated.rawToken,
    tokenHash: generated.tokenHash,
    pepper,
    sessionSecret: randomBytes(32),
  };
}

async function cleanupRestaurant(db: Database, restaurantId: string): Promise<void> {
  await db.transaction(async (transaction) => {
    await transaction.delete(payments).where(eq(payments.restaurantId, restaurantId));
    await transaction.delete(auditLogs).where(eq(auditLogs.restaurantId, restaurantId));
    await transaction.delete(outboxEvents).where(eq(outboxEvents.restaurantId, restaurantId));
    await transaction.delete(orderEvents).where(eq(orderEvents.restaurantId, restaurantId));
    await transaction.delete(kitchenTickets).where(eq(kitchenTickets.restaurantId, restaurantId));
    await transaction.delete(orderItems).where(eq(orderItems.restaurantId, restaurantId));
    await transaction.delete(waiterCalls).where(eq(waiterCalls.restaurantId, restaurantId));
    await transaction.delete(idempotencyKeys).where(eq(idempotencyKeys.restaurantId, restaurantId));
    await transaction.delete(orders).where(eq(orders.restaurantId, restaurantId));
    await transaction
      .delete(restaurantCounters)
      .where(eq(restaurantCounters.restaurantId, restaurantId));
    await transaction.delete(products).where(eq(products.restaurantId, restaurantId));
    await transaction.delete(categories).where(eq(categories.restaurantId, restaurantId));
    await transaction
      .delete(restaurantSettings)
      .where(eq(restaurantSettings.restaurantId, restaurantId));
    await transaction
      .delete(restaurantTables)
      .where(eq(restaurantTables.restaurantId, restaurantId));
    await transaction.delete(staffProfiles).where(eq(staffProfiles.restaurantId, restaurantId));
    await transaction.delete(restaurants).where(eq(restaurants.id, restaurantId));
  });
}

if (!readiness.ready) {
  test("Phase 3 transactional backend integration", {
    skip: readiness.reason,
  }, () => undefined);
} else {
  const environment = readiness.environment;
  const fixture = createFixture();
  let connection: DatabaseConnection | undefined;
  let db: Database | undefined;
  let tableService: TableService;
  let menuService: MenuService;
  let orderService: OrderService;
  let waiterCallService: WaiterCallService;

  describe("Phase 3 transactional backend flow", { concurrency: false }, () => {
    before(async () => {
      // These imports intentionally execute only after the integration guard.
      // The documented test command supplies the react-server condition needed
      // by production repository modules carrying the `server-only` marker.
      const [databaseModule, tableRepositoryModule, menuRepositoryModule, orderRepositoryModule, callRepositoryModule] =
        await Promise.all([
          import("../../db/index"),
          import("../../lib/repositories/drizzle-table-repository"),
          import("../../lib/repositories/drizzle-menu-repository"),
          import("../../lib/repositories/drizzle-order-repository"),
          import("../../lib/repositories/drizzle-waiter-call-repository"),
        ]);

      connection = databaseModule.createDb(environment.databaseUrl!, {
        maxConnections: 1,
      });
      db = connection.db;

      const slugSuffix = fixture.restaurantId.replaceAll("-", "");
      await db.insert(restaurants).values({
        id: fixture.restaurantId,
        name: "Phase 3 Backend Integration",
        slug: `phase3-backend-${slugSuffix}`,
      });
      await db.insert(staffProfiles).values(
        Object.values(fixture.principals).map((principal) => ({
          id: principal.userId,
          restaurantId: fixture.restaurantId,
          name: `Phase 3 ${principal.role}`,
          role: principal.role,
          isActive: true,
        })),
      );
      await db.insert(restaurantSettings).values({
        restaurantId: fixture.restaurantId,
        menuEnabled: true,
        orderingEnabled: true,
        waiterCallEnabled: true,
        billRequestEnabled: true,
        serviceFeeRate: "0.00",
        taxRate: "0.00",
        waiterCallCooldownSeconds: 5,
      });
      await db.insert(categories).values({
        id: fixture.categoryId,
        restaurantId: fixture.restaurantId,
        name: "Integration Soups",
        slug: `integration-soups-${slugSuffix}`,
      });
      await db.insert(products).values({
        id: fixture.productId,
        restaurantId: fixture.restaurantId,
        categoryId: fixture.categoryId,
        name: "Integration Mercimek Corbasi",
        slug: `integration-mercimek-${slugSuffix}`,
        price: "12.50",
        isAvailable: true,
      });
      await db.insert(restaurantTables).values({
        id: fixture.tableId,
        restaurantId: fixture.restaurantId,
        name: "Integration Masa 1",
        tableNumber: 1,
        qrTokenHash: fixture.tokenHash,
        qrTokenVersion: 1,
      });

      const codec: TableTokenCodec = {
        generate: () => generateQrToken(fixture.pepper),
        hash: (rawToken) => hashQrToken(rawToken, fixture.pepper),
        verify: (candidate, storedHash) =>
          verifyQrToken(candidate, storedHash, fixture.pepper),
        deriveLink: (claims) => deriveQrLinkToken(claims, fixture.pepper),
        verifyLink: (candidate, claims) =>
          verifyQrLinkToken(candidate, claims, fixture.pepper),
      };
      tableService = new TableService(
        new tableRepositoryModule.DrizzleTableRepository(db),
        codec,
      );
      menuService = new MenuService(
        new menuRepositoryModule.DrizzleMenuRepository(db),
      );
      orderService = new OrderService(
        new orderRepositoryModule.DrizzleOrderRepository(db),
      );
      waiterCallService = new WaiterCallService(
        new callRepositoryModule.DrizzleWaiterCallRepository(db),
      );
    });

    after(async () => {
      try {
        if (db) await cleanupRestaurant(db, fixture.restaurantId);
      } finally {
        await connection?.close();
      }
    });

    test("QR -> menu -> order -> role status chain -> bill -> rotation remains atomic and tenant-scoped", async () => {
      assert.ok(db, "database setup did not complete");

      const tableContext = await tableService.validateToken(fixture.rawToken);
      assert.equal(tableContext.restaurant.id, fixture.restaurantId);
      assert.equal(tableContext.table.id, fixture.tableId);
      assert.equal(tableContext.table.accessVersion, 1);

      const customerSession = createCustomerTableSession(
        {
          restaurantId: fixture.restaurantId,
          tableId: fixture.tableId,
          accessVersion: tableContext.table.accessVersion,
        },
        fixture.sessionSecret,
      );
      const sessionClaims = verifyCustomerTableSession(
        customerSession.token,
        fixture.sessionSecret,
      );
      assert.equal(sessionClaims?.restaurantId, fixture.restaurantId);
      assert.equal(sessionClaims?.tableId, fixture.tableId);
      assert.equal(sessionClaims?.accessVersion, 1);

      const menu = await menuService.getPublicMenu(fixture.restaurantId);
      assert.equal(menu.categories.length, 1);
      assert.equal(menu.categories[0]?.products[0]?.id, fixture.productId);
      assert.equal(menu.categories[0]?.products[0]?.price, "12.50");

      const tamperedItem: CustomerOrderItemInput & {
        readonly name: string;
        readonly price: string;
      } = {
        productId: fixture.productId,
        quantity: 2,
        note: "Az tuzlu",
        name: "Attacker supplied name",
        price: "0.01",
      };
      const createCommand = {
        restaurantId: fixture.restaurantId,
        tableId: fixture.tableId,
        tableAccessVersion: 1,
        idempotencyKey: `phase3-${randomBytes(12).toString("hex")}`,
        items: [tamperedItem],
        notes: "Integration order",
      } as const;
      const created = await orderService.createOrder(createCommand);
      assert.equal(created.replayed, false);
      assert.equal(created.amounts.subtotal, "25.00");
      assert.equal(created.amounts.total, "25.00");
      assert.equal(created.items[0]?.productName, "Integration Mercimek Corbasi");
      assert.equal(created.items[0]?.unitPrice, "12.50");

      await db
        .update(products)
        .set({ name: "Integration Updated Soup", price: "99.00" })
        .where(eq(products.id, fixture.productId));
      const replay = await orderService.createOrder(createCommand);
      assert.equal(replay.replayed, true);
      assert.equal(replay.order.id, created.order.id);
      assert.equal(replay.items[0]?.unitPrice, "12.50");

      const snapshot = await db
        .select({ name: orderItems.productNameSnapshot, price: orderItems.unitPrice })
        .from(orderItems)
        .where(eq(orderItems.orderId, created.order.id));
      assert.deepEqual(snapshot, [
        { name: "Integration Mercimek Corbasi", price: "12.50" },
      ]);

      await db
        .update(products)
        .set({ isAvailable: false })
        .where(eq(products.id, fixture.productId));
      await assert.rejects(
        orderService.createOrder({
          ...createCommand,
          idempotencyKey: `unavailable-${randomBytes(8).toString("hex")}`,
        }),
        expectDomainCode("PRODUCT_UNAVAILABLE"),
      );
      await db
        .update(products)
        .set({ isAvailable: true })
        .where(eq(products.id, fixture.productId));

      await assert.rejects(
        orderService.updateStatus(fixture.principals.kitchen, {
          restaurantId: fixture.restaurantId,
          orderId: created.order.id,
          nextStatus: "CONFIRMED",
        }),
        expectDomainCode("FORBIDDEN"),
      );

      const statusSteps = [
        [fixture.principals.waiter, "CONFIRMED"],
        [fixture.principals.kitchen, "PREPARING"],
        [fixture.principals.kitchen, "READY"],
        [fixture.principals.waiter, "SERVED"],
        [fixture.principals.cashier, "COMPLETED"],
      ] as const;
      for (const [principal, nextStatus] of statusSteps) {
        const result = await orderService.updateStatus(principal, {
          restaurantId: fixture.restaurantId,
          orderId: created.order.id,
          nextStatus,
          requestId: `phase3-${nextStatus.toLowerCase()}`,
        });
        assert.equal(result.status, nextStatus);
      }

      await assert.rejects(
        orderService.updateStatus(fixture.principals.admin, {
          restaurantId: randomUUID(),
          orderId: created.order.id,
          nextStatus: "CANCELLED",
        }),
        expectDomainCode("RESTAURANT_SCOPE_VIOLATION"),
      );

      const waiterCall = await waiterCallService.createWaiterCall({
        restaurantId: fixture.restaurantId,
        tableId: fixture.tableId,
        tableAccessVersion: 1,
      });
      const billRequest = await waiterCallService.createBillRequest({
        restaurantId: fixture.restaurantId,
        tableId: fixture.tableId,
        tableAccessVersion: 1,
      });
      assert.equal(waiterCall.type, "WAITER_CALL");
      assert.equal(billRequest.type, "BILL_REQUEST");

      await db.insert(payments).values({
        restaurantId: fixture.restaurantId,
        orderId: created.order.id,
        amount: created.amounts.total,
        method: "CASH",
        status: "COMPLETED",
        createdByUserId: fixture.principals.cashier.userId,
        processedAt: new Date(),
      });

      const rotated = await tableService.rotateToken(fixture.principals.admin, {
        restaurantId: fixture.restaurantId,
        tableId: fixture.tableId,
        audit: { requestId: "phase3-rotate" },
      });
      assert.equal(rotated.table.accessVersion, 2);
      await assert.rejects(
        tableService.validateToken(fixture.rawToken),
        expectDomainCode("INVALID_TABLE_TOKEN"),
      );
      const rotatedContext = await tableService.validateToken(rotated.rawToken);
      assert.equal(rotatedContext.table.accessVersion, 2);

      // A signed cookie remains tamper-proof but is rejected by the live table
      // version check after rotation.
      assert.equal(
        verifyCustomerTableSession(customerSession.token, fixture.sessionSecret)
          ?.accessVersion,
        1,
      );
      await assert.rejects(
        orderService.createOrder({
          ...createCommand,
          tableAccessVersion: 1,
          idempotencyKey: `old-session-${randomBytes(8).toString("hex")}`,
        }),
        expectDomainCode("INVALID_TABLE_TOKEN"),
      );

      const storedOrder = await db
        .select({ status: orders.status, total: orders.total })
        .from(orders)
        .where(eq(orders.id, created.order.id));
      assert.deepEqual(storedOrder, [{ status: "COMPLETED", total: "25.00" }]);

      const lifecycleEvents = await db
        .select({ type: orderEvents.eventType })
        .from(orderEvents)
        .where(eq(orderEvents.orderId, created.order.id))
        .orderBy(asc(orderEvents.createdAt));
      assert.deepEqual(
        lifecycleEvents.map((event) => event.type),
        [
          "ORDER_CREATED",
          "ORDER_CONFIRMED",
          "ORDER_PREPARING",
          "ORDER_READY",
          "ORDER_SERVED",
          "ORDER_COMPLETED",
        ],
      );

      const outbox = await db
        .select({ type: outboxEvents.eventType, status: outboxEvents.status })
        .from(outboxEvents)
        .where(eq(outboxEvents.restaurantId, fixture.restaurantId));
      assert.deepEqual(
        new Set(outbox.map((event) => event.type)),
        new Set([
          "ORDER_CREATED",
          "ORDER_CONFIRMED",
          "ORDER_PREPARING",
          "ORDER_READY",
          "ORDER_SERVED",
          "ORDER_COMPLETED",
          "WAITER_CALLED",
          "BILL_REQUESTED",
        ]),
      );
      assert.ok(outbox.every((event) => event.status === "PENDING"));

      const calls = await db
        .select({ type: waiterCalls.type, status: waiterCalls.status })
        .from(waiterCalls)
        .where(eq(waiterCalls.restaurantId, fixture.restaurantId));
      assert.deepEqual(
        new Set(calls.map((call) => call.type)),
        new Set(["WAITER_CALL", "BILL_REQUEST"]),
      );
      assert.ok(calls.every((call) => call.status === "OPEN"));

      const storedTable = await db
        .select({
          hash: restaurantTables.qrTokenHash,
          version: restaurantTables.qrTokenVersion,
        })
        .from(restaurantTables)
        .where(eq(restaurantTables.id, fixture.tableId));
      assert.equal(storedTable[0]?.version, 2);
      assert.notEqual(storedTable[0]?.hash, fixture.rawToken);
      assert.notEqual(storedTable[0]?.hash, rotated.rawToken);
    });
  });
}
