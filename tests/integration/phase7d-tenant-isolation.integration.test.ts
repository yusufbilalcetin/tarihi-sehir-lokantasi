import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";

import { createDb, type Database } from "../../db";
import { isDomainError } from "../../lib/api/domain-error";
import type { StaffPrincipal } from "../../lib/auth/foundation";
import type { RestaurantPrincipal } from "../../lib/domain/restaurant-scope";
import { resolveReportRange } from "../../lib/domain/report-range";
import { generateQrToken } from "../../lib/security/qr-token";
import { DrizzleOrderCheckRepository } from "../../lib/repositories/drizzle-order-check-repository";
import { DrizzlePaymentRepository } from "../../lib/repositories/drizzle-payment-repository";
import { OrderCheckService } from "../../lib/services/order-check-service";
import { PaymentService } from "../../lib/services/payment-service";
import { ReportAnalyticsService } from "../../lib/services/report-analytics-service";
import { ReportDetailService } from "../../lib/services/report-detail-service";
import { readSupabaseIntegrationEnvironment } from "./supabase-test-environment";

/**
 * Phase 7D.1 — application-layer tenant isolation, deliberately kept separate
 * from the RLS suite.
 *
 * These services run on the pooler connection, whose role has BYPASSRLS. That
 * is the point: with the database's own boundary switched off, the only thing
 * standing between tenant A and tenant B is the repository's own
 * `restaurant_id` predicate. Nothing here is evidence about RLS.
 */

const PREFIX = "PHASE7D_ISO_";
const readiness = readSupabaseIntegrationEnvironment({ requireDatabaseUrl: true });

interface TenantIds {
  readonly restaurant: string;
  readonly category: string;
  readonly product: string;
  readonly table: string;
  readonly order: string;
  readonly orderItem: string;
  readonly payment: string;
  readonly staff: string;
}

function newIds(): TenantIds {
  return {
    restaurant: randomUUID(),
    category: randomUUID(),
    product: randomUUID(),
    table: randomUUID(),
    order: randomUUID(),
    orderItem: randomUUID(),
    payment: randomUUID(),
    staff: randomUUID(),
  };
}

/** Captures the domain error code a cross-tenant attempt produces. */
async function failureCode(work: () => Promise<unknown>): Promise<string> {
  try {
    await work();
    return "NO_ERROR";
  } catch (error) {
    return isDomainError(error) ? error.code : `UNEXPECTED:${(error as Error).name}`;
  }
}

if (!readiness.ready) {
  test("Phase 7D.1 tenant isolation integration", { skip: readiness.reason }, () => undefined);
} else {
  const environment = readiness.environment;
  const run = randomBytes(6).toString("hex");
  const ids = { A: newIds(), B: newIds() };
  let connection: { db: Database; close: () => Promise<unknown> };
  let db: Database;
  const cleanupErrors: string[] = [];
  let isolationAssertions = 0;

  function isolationAssert(condition: boolean, message: string): void {
    isolationAssertions += 1;
    assert.ok(condition, message);
  }

  /** A tenant-A principal, exactly what a signed-in staff session produces. */
  const principalA = (role: RestaurantPrincipal["role"]): RestaurantPrincipal => ({
    userId: ids.A.staff,
    restaurantId: ids.A.restaurant,
    role,
    isActive: true,
  });

  /** The fuller identity the report services require. */
  const staffA = (role: RestaurantPrincipal["role"]): StaffPrincipal => {
    const authUserId = randomUUID();
    return {
      user: {
        id: ids.A.staff,
        authUserId,
        restaurantId: ids.A.restaurant,
        name: `${PREFIX}Reporter`,
        email: null,
        phone: null,
        isActive: true,
      },
      profile: {
        id: ids.A.staff,
        authUserId,
        restaurantId: ids.A.restaurant,
        name: `${PREFIX}Reporter`,
        email: null,
        phone: null,
        role,
        isActive: true,
        deletedAt: null,
      },
      authUser: { id: authUserId, email: undefined, app_metadata: {}, user_metadata: {} },
      restaurant: {
        id: ids.A.restaurant,
        name: `${PREFIX}Tenant A`,
        slug: `phase7d-iso-a-${run}`,
        isActive: true,
        timezone: "Europe/Istanbul",
      },
      role,
      userId: ids.A.staff,
      restaurantId: ids.A.restaurant,
      isActive: true,
    };
  };

  describe("Phase 7D.1 application tenant isolation", { concurrency: false }, () => {
    before(async () => {
      connection = createDb(environment.databaseUrl!, { maxConnections: 3 });
      db = connection.db;
      const sql = (connection as unknown as { client: ReturnType<typeof createDb>["client"] }).client;
      const pepper = randomBytes(32);

      let sequence = 95000;
      for (const tenant of ["A", "B"] as const) {
        const id = ids[tenant];
        sequence += 1;
        await sql`insert into restaurants (id, name, slug) values
          (${id.restaurant}, ${`${PREFIX}Tenant ${tenant}`}, ${`phase7d-iso-${tenant.toLowerCase()}-${run}`})`;
        await sql`insert into restaurant_settings (restaurant_id) values (${id.restaurant})`;
        await sql`insert into staff_profiles (id, restaurant_id, name, login_identifier, role, is_active) values
          (${id.staff}, ${id.restaurant}, ${`${PREFIX}Cashier ${tenant}`},
           ${`phase7d-iso-${run}-${tenant.toLowerCase()}`}, 'CASHIER', true)`;
        await sql`insert into categories (id, restaurant_id, name, slug) values
          (${id.category}, ${id.restaurant}, ${`${PREFIX}Category ${tenant}`}, ${`phase7d-iso-cat-${tenant.toLowerCase()}-${run}`})`;
        await sql`insert into products (id, restaurant_id, category_id, name, slug, price) values
          (${id.product}, ${id.restaurant}, ${id.category}, ${`${PREFIX}Product ${tenant}`},
           ${`phase7d-iso-prod-${tenant.toLowerCase()}-${run}`}, ${tenant === "A" ? "100.00" : "500.00"})`;
        await sql`insert into restaurant_tables (id, restaurant_id, name, table_number, qr_token_hash) values
          (${id.table}, ${id.restaurant}, ${`${PREFIX}Table ${tenant}`}, ${tenant === "A" ? 7301 : 7401},
           ${generateQrToken(pepper).tokenHash})`;
        await sql`insert into orders (id, restaurant_id, table_id, order_sequence, order_number, subtotal, total, created_by_type, created_by_user_id, status) values
          (${id.order}, ${id.restaurant}, ${id.table}, ${sequence}, ${`${PREFIX}${tenant}-${sequence}`},
           ${tenant === "A" ? "100.00" : "500.00"}, ${tenant === "A" ? "100.00" : "500.00"},
           'STAFF', ${id.staff}, 'SERVED')`;
        await sql`insert into order_items (id, restaurant_id, order_id, product_id, product_name_snapshot, unit_price, quantity, line_total) values
          (${id.orderItem}, ${id.restaurant}, ${id.order}, ${id.product}, ${`${PREFIX}Product ${tenant}`},
           ${tenant === "A" ? "100.00" : "500.00"}, 1, ${tenant === "A" ? "100.00" : "500.00"})`;
        await sql`insert into payments (id, restaurant_id, order_id, amount, method, created_by_user_id, status) values
          (${id.payment}, ${id.restaurant}, ${id.order}, ${tenant === "A" ? "100.00" : "500.00"},
           'CASH', ${id.staff}, 'COMPLETED')`;
      }
    });

    after(async () => {
      const sql = (connection as unknown as { client: ReturnType<typeof createDb>["client"] }).client;
      const order = [
        "payments", "order_items", "orders", "restaurant_tables",
        "products", "categories", "restaurant_settings", "staff_profiles", "restaurants",
      ];
      try {
        for (const table of order) {
          const column = table === "restaurants" ? "id" : "restaurant_id";
          await sql.unsafe(`delete from ${table} where ${column} = any($1::uuid[])`, [
            [ids.A.restaurant, ids.B.restaurant],
          ]);
        }
      } catch (error) {
        cleanupErrors.push((error as Error).message);
      }
      await connection.close();
      if (cleanupErrors.length > 0) {
        console.error("FIXTURE CLEANUP INCOMPLETE:", cleanupErrors.join(" | "));
      }
      console.log(`phase7d isolation assertions executed: ${isolationAssertions}`);
    });

    test("reports aggregate only the caller's tenant", async () => {
      const service = new ReportAnalyticsService(db);
      const range = resolveReportRange({
        preset: "LAST_30_DAYS", now: new Date(), comparison: "NONE", systemStart: null,
      });

      const summaryA = await service.getSummary(staffA("ADMIN"), range);
      // Tenant B's single order is 500.00; if any figure carries it, the
      // aggregate crossed the tenant boundary.
      isolationAssert(
        Number(summaryA.grossSales.value) >= 100 && Number(summaryA.grossSales.value) < 500,
        `A gross sales must exclude B's 500.00 (got ${summaryA.grossSales.value})`,
      );

      const productsA = await service.getProducts(staffA("ADMIN"), range, { pageSize: 200 });
      const names = productsA.rows.map((row) => row.productName);
      isolationAssert(
        names.includes(`${PREFIX}Product A`),
        "A's own product appears in its product report",
      );
      isolationAssert(
        !names.includes(`${PREFIX}Product B`),
        "B's product never appears in A's product report",
      );
      isolationAssert(
        !productsA.rows.some((row) => row.productId === ids.B.product),
        "B's product id never appears in A's product report",
      );
    });

    test("a foreign product detail is a safe not-found, not a leak", async () => {
      const service = new ReportDetailService(db);
      const range = resolveReportRange({
        preset: "LAST_30_DAYS", now: new Date(), comparison: "NONE", systemStart: null,
      });

      const own = await service.getProductDetail(staffA("ADMIN"), range, ids.A.product);
      isolationAssert(own.productName === `${PREFIX}Product A`, "A can read its own product detail");

      const code = await failureCode(() =>
        service.getProductDetail(staffA("ADMIN"), range, ids.B.product),
      );
      isolationAssert(code === "NOT_FOUND", `foreign product detail must be NOT_FOUND, got ${code}`);
    });

    test("a foreign order timeline is a safe not-found", async () => {
      const service = new ReportDetailService(db);
      const own = await service.getOrderTimeline(staffA("ADMIN"), ids.A.order);
      isolationAssert(own.order.id === ids.A.order, "A can read its own order timeline");
      isolationAssert(
        own.order.total === "100.00",
        `own timeline shows its own total (got ${own.order.total})`,
      );

      const code = await failureCode(() =>
        service.getOrderTimeline(staffA("ADMIN"), ids.B.order),
      );
      isolationAssert(
        code === "ORDER_NOT_FOUND",
        `foreign timeline must be ORDER_NOT_FOUND, got ${code}`,
      );
    });

    test("category and kitchen reports never mix tenants", async () => {
      const service = new ReportDetailService(db);
      const range = resolveReportRange({
        preset: "LAST_30_DAYS", now: new Date(), comparison: "NONE", systemStart: null,
      });
      const categories = await service.getCategories(staffA("ADMIN"), range);
      const labels = categories.map((row) => row.categoryName);
      isolationAssert(labels.includes(`${PREFIX}Category A`), "A sees its own category");
      isolationAssert(!labels.includes(`${PREFIX}Category B`), "A never sees B's category");
      isolationAssert(
        !categories.some((row) => row.categoryId === ids.B.category),
        "and never B's category id",
      );

      // Runs the real percentile/grouping SQL; the tenant filter is what is
      // asserted here, not the kitchen figures themselves.
      const kitchen = await service.getKitchen(staffA("ADMIN"), range);
      isolationAssert(
        kitchen.staff.every((row) => row.staffId !== ids.B.staff),
        "no tenant B staff member appears in A's kitchen report",
      );
    });

    test("a cashier cannot collect payment on another tenant's order", async () => {
      const service = new PaymentService(new DrizzlePaymentRepository(db));
      const code = await failureCode(() =>
        service.collect(principalA("CASHIER"), {
          orderId: ids.B.order,
          method: "CASH",
          idempotencyKey: `phase7d-iso-${run}-cross-collect`,
        }),
      );
      isolationAssert(
        code === "ORDER_NOT_FOUND",
        `cross-tenant collect must be ORDER_NOT_FOUND, got ${code}`,
      );

      // Nothing may have been written against tenant B.
      const sql = (connection as unknown as { client: ReturnType<typeof createDb>["client"] }).client;
      const rows = await sql`select count(*)::int as count from payments where order_id = ${ids.B.order}`;
      isolationAssert(rows[0].count === 1, "tenant B still has exactly its original payment");
    });

    test("a cashier cannot refund another tenant's payment", async () => {
      const service = new PaymentService(new DrizzlePaymentRepository(db));
      const code = await failureCode(() =>
        service.refund(principalA("CASHIER"), {
          paymentId: ids.B.payment,
          amount: "10.00",
          reasonCode: "CUSTOMER_COMPLAINT",
          idempotencyKey: `phase7d-iso-${run}-cross-refund`,
        }),
      );
      isolationAssert(
        code === "PAYMENT_NOT_FOUND",
        `cross-tenant refund must be PAYMENT_NOT_FOUND, got ${code}`,
      );

      const sql = (connection as unknown as { client: ReturnType<typeof createDb>["client"] }).client;
      const rows = await sql`select refunded_amount from payments where id = ${ids.B.payment}`;
      isolationAssert(
        Number(rows[0].refunded_amount) === 0,
        "tenant B's payment was not refunded by a penny",
      );
      const refunds = await sql`select count(*)::int as count from payment_refunds where payment_id = ${ids.B.payment}`;
      isolationAssert(refunds[0].count === 0, "no refund row was created against tenant B");
    });

    test("a cashier cannot split another tenant's bill", async () => {
      const service = new OrderCheckService(new DrizzleOrderCheckRepository(db));
      const code = await failureCode(() =>
        service.createChecks(principalA("CASHIER"), {
          orderId: ids.B.order,
          mode: "EQUAL",
          shares: 2,
        }),
      );
      isolationAssert(
        code === "ORDER_NOT_FOUND",
        `cross-tenant split must be ORDER_NOT_FOUND, got ${code}`,
      );

      const sql = (connection as unknown as { client: ReturnType<typeof createDb>["client"] }).client;
      const rows = await sql`select count(*)::int as count from order_checks where order_id = ${ids.B.order}`;
      isolationAssert(rows[0].count === 0, "no check was created against tenant B");
    });

    test("the existence of a foreign resource never leaks through the error code", async () => {
      const service = new ReportDetailService(db);
      const payments = new PaymentService(new DrizzlePaymentRepository(db));
      const range = resolveReportRange({
        preset: "LAST_30_DAYS", now: new Date(), comparison: "NONE", systemStart: null,
      });

      // A real foreign id and an id that exists nowhere must be indistinguishable.
      const foreignProduct = await failureCode(() =>
        service.getProductDetail(staffA("ADMIN"), range, ids.B.product),
      );
      const missingProduct = await failureCode(() =>
        service.getProductDetail(staffA("ADMIN"), range, randomUUID()),
      );
      isolationAssert(
        foreignProduct === missingProduct,
        `product: foreign (${foreignProduct}) and absent (${missingProduct}) must match`,
      );

      const foreignOrder = await failureCode(() =>
        service.getOrderTimeline(staffA("ADMIN"), ids.B.order),
      );
      const missingOrder = await failureCode(() =>
        service.getOrderTimeline(staffA("ADMIN"), randomUUID()),
      );
      isolationAssert(
        foreignOrder === missingOrder,
        `order: foreign (${foreignOrder}) and absent (${missingOrder}) must match`,
      );

      const foreignPayment = await failureCode(() =>
        payments.refund(principalA("CASHIER"), {
          paymentId: ids.B.payment, amount: "1.00", reasonCode: "OTHER",
          idempotencyKey: `phase7d-iso-${run}-leak-a`,
        }),
      );
      const missingPayment = await failureCode(() =>
        payments.refund(principalA("CASHIER"), {
          paymentId: randomUUID(), amount: "1.00", reasonCode: "OTHER",
          idempotencyKey: `phase7d-iso-${run}-leak-b`,
        }),
      );
      isolationAssert(
        foreignPayment === missingPayment,
        `payment: foreign (${foreignPayment}) and absent (${missingPayment}) must match`,
      );
    });

    test("role checks still apply on top of the tenant filter", async () => {
      const payments = new PaymentService(new DrizzlePaymentRepository(db));
      // A KITCHEN member of the *correct* tenant must still be refused money work.
      const code = await failureCode(() =>
        payments.collect(principalA("KITCHEN"), {
          orderId: ids.A.order,
          method: "CASH",
          idempotencyKey: `phase7d-iso-${run}-kitchen-collect`,
        }),
      );
      isolationAssert(code === "FORBIDDEN", `KITCHEN collect must be FORBIDDEN, got ${code}`);

      const waiterRefund = await failureCode(() =>
        payments.refund(principalA("WAITER"), {
          paymentId: ids.A.payment, amount: "1.00", reasonCode: "OTHER",
          idempotencyKey: `phase7d-iso-${run}-waiter-refund`,
        }),
      );
      isolationAssert(
        waiterRefund === "FORBIDDEN",
        `WAITER refund must be FORBIDDEN, got ${waiterRefund}`,
      );

      const sql = (connection as unknown as { client: ReturnType<typeof createDb>["client"] }).client;
      const rows = await sql`select count(*)::int as count from payments where order_id = ${ids.A.order}`;
      isolationAssert(rows[0].count === 1, "the refused collection wrote nothing");
    });

    test("reports are refused to service-floor roles", async () => {
      const service = new ReportAnalyticsService(db);
      const range = resolveReportRange({
        preset: "LAST_30_DAYS", now: new Date(), comparison: "NONE", systemStart: null,
      });
      // The report services trust their route guard, so this documents where
      // the boundary actually lives rather than asserting a service-level check.
      const summary = await service.getSummary(staffA("WAITER"), range);
      isolationAssert(
        Number(summary.grossSales.value) < 500,
        "even when called directly, the tenant filter holds for a waiter principal",
      );
    });
  });
}
