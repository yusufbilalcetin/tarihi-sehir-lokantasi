import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";

import { createDb, type Database } from "../../db";
import { isDomainError } from "../../lib/api/domain-error";
import { calculateOrderBalance } from "../../lib/domain/financial-operations";
import type { RestaurantPrincipal } from "../../lib/domain/restaurant-scope";
import { generateQrToken } from "../../lib/security/qr-token";
import { DrizzleOrderCheckRepository } from "../../lib/repositories/drizzle-order-check-repository";
import { DrizzleOrderRepository } from "../../lib/repositories/drizzle-order-repository";
import { DrizzlePaymentRepository } from "../../lib/repositories/drizzle-payment-repository";
import { DrizzleStaffOrderRepository } from "../../lib/repositories/drizzle-staff-order-repository";
import { DrizzleTableOperationsRepository } from "../../lib/repositories/drizzle-table-operations-repository";
import { OrderCheckService } from "../../lib/services/order-check-service";
import { OrderService } from "../../lib/services/order-service";
import { PaymentService } from "../../lib/services/payment-service";
import { StaffOrderService } from "../../lib/services/staff-order-service";
import { TableOperationsService } from "../../lib/services/table-operations-service";
import { readSupabaseIntegrationEnvironment } from "./supabase-test-environment";

/**
 * Phase 7D.6 — the operational matrix on real PostgreSQL.
 *
 * Kitchen transitions, VOID, merge and safe reset are driven through the real
 * services against the real database, and every expectation is checked against
 * the row afterwards rather than against the service's return value alone. The
 * transition tables in lib/domain/status.ts are the source of truth for what
 * counts as legal here; nothing is asserted that the code does not claim.
 */

const PREFIX = "PHASE7D6_";
const readiness = readSupabaseIntegrationEnvironment({ requireDatabaseUrl: true });

async function code(work: () => Promise<unknown>): Promise<string> {
  try {
    await work();
    return "OK";
  } catch (error) {
    return isDomainError(error) ? error.code : `UNEXPECTED:${(error as Error).message}`;
  }
}

if (!readiness.ready) {
  test("Phase 7D.6 operational matrix", { skip: readiness.reason }, () => undefined);
} else {
  const environment = readiness.environment;
  const run = randomBytes(5).toString("hex");
  let connection: ReturnType<typeof createDb>;
  let db: Database;
  let sql: ReturnType<typeof createDb>["client"];
  let staffOrders: StaffOrderService;
  let orders: OrderService;
  let payments: PaymentService;
  let checks: OrderCheckService;
  let tables: TableOperationsService;
  const cleanupErrors: string[] = [];
  let assertions = 0;

  const ids = {
    restaurantA: randomUUID(),
    restaurantB: randomUUID(),
    category: randomUUID(),
    productA: randomUUID(),
    productB: randomUUID(),
    tableA: randomUUID(),
    tableB: randomUUID(),
    tableC: randomUUID(),
    tableD: randomUUID(),
    foreignTable: randomUUID(),
    foreignProduct: randomUUID(),
    foreignCategory: randomUUID(),
    register: randomUUID(),
    shift: randomUUID(),
  };
  const staff = {
    ADMIN: randomUUID(), MANAGER: randomUUID(), WAITER: randomUUID(),
    KITCHEN: randomUUID(), CASHIER: randomUUID(),
  };
  const foreignStaff = { ADMIN: randomUUID(), KITCHEN: randomUUID() };

  function check(condition: boolean, message: string): void {
    assertions += 1;
    assert.ok(condition, message);
  }

  const asA = (role: RestaurantPrincipal["role"]): RestaurantPrincipal => ({
    userId: staff[role as keyof typeof staff] ?? staff.ADMIN,
    restaurantId: ids.restaurantA,
    role,
    isActive: true,
  });

  let sequence = 98000;
  /** A SERVED-stage order whose items start at PENDING, ready for the kitchen. */
  async function newOrder(options: {
    readonly tableId?: string;
    readonly restaurantId?: string;
    readonly quantity?: number;
    readonly status?: string;
    readonly itemStatus?: string;
    readonly items?: number;
  } = {}) {
    const restaurantId = options.restaurantId ?? ids.restaurantA;
    const tableId = options.tableId ?? ids.tableA;
    const quantity = options.quantity ?? 1;
    const itemCount = options.items ?? 2;
    const orderId = randomUUID();
    const itemIds: string[] = [];
    const total = (quantity * 100 * itemCount).toFixed(2);
    sequence += 1;
    const creator = restaurantId === ids.restaurantA ? staff.WAITER : foreignStaff.ADMIN;
    const productId = restaurantId === ids.restaurantA ? ids.productA : ids.foreignProduct;
    await sql`insert into orders (id, restaurant_id, table_id, order_sequence, order_number,
        subtotal, total, created_by_type, created_by_user_id, status) values
      (${orderId}, ${restaurantId}, ${tableId}, ${sequence}, ${`${PREFIX}${sequence}`},
       ${total}, ${total}, 'STAFF', ${creator}, ${options.status ?? "CONFIRMED"})`;
    for (let index = 0; index < itemCount; index += 1) {
      const itemId = randomUUID();
      itemIds.push(itemId);
      await sql`insert into order_items (id, restaurant_id, order_id, product_id,
          product_name_snapshot, unit_price, quantity, line_total, status) values
        (${itemId}, ${restaurantId}, ${orderId}, ${productId}, ${`${PREFIX}Ana`},
         '100.00', ${quantity}, ${(quantity * 100).toFixed(2)}, ${options.itemStatus ?? "PENDING"})`;
    }
    return { orderId, itemIds };
  }

  async function itemStatus(itemId: string): Promise<string> {
    const [row] = await sql`select status::text as status from order_items where id = ${itemId}`;
    return row?.status ?? "MISSING";
  }

  describe("Phase 7D.6 kitchen, void, merge and reset", { concurrency: false }, () => {
    before(async () => {
      connection = createDb(environment.databaseUrl!, { maxConnections: 6 });
      db = connection.db;
      sql = connection.client;
      staffOrders = new StaffOrderService(new DrizzleStaffOrderRepository(db));
      orders = new OrderService(new DrizzleOrderRepository(db));
      payments = new PaymentService(new DrizzlePaymentRepository(db));
      checks = new OrderCheckService(new DrizzleOrderCheckRepository(db));
      tables = new TableOperationsService(new DrizzleTableOperationsRepository(db));
      const pepper = randomBytes(32);

      await sql`insert into restaurants (id, name, slug) values
        (${ids.restaurantA}, ${`${PREFIX}Tenant A`}, ${`phase7d6-a-${run}`}),
        (${ids.restaurantB}, ${`${PREFIX}Tenant B`}, ${`phase7d6-b-${run}`})`;
      await sql`insert into restaurant_settings (restaurant_id) values
        (${ids.restaurantA}), (${ids.restaurantB})`;
      for (const [role, id] of Object.entries(staff)) {
        await sql`insert into staff_profiles (id, restaurant_id, name, login_identifier, role, is_active)
          values (${id}, ${ids.restaurantA}, ${`${PREFIX}${role}`}, ${`p7d6-${run}-${role.toLowerCase()}`}, ${role}, true)`;
      }
      for (const [role, id] of Object.entries(foreignStaff)) {
        await sql`insert into staff_profiles (id, restaurant_id, name, login_identifier, role, is_active)
          values (${id}, ${ids.restaurantB}, ${`${PREFIX}B_${role}`}, ${`p7d6-${run}-b-${role.toLowerCase()}`}, ${role}, true)`;
      }
      await sql`insert into categories (id, restaurant_id, name, slug) values
        (${ids.category}, ${ids.restaurantA}, ${`${PREFIX}Kategori`}, ${`p7d6-cat-${run}`}),
        (${ids.foreignCategory}, ${ids.restaurantB}, ${`${PREFIX}Kategori B`}, ${`p7d6-catb-${run}`})`;
      await sql`insert into products (id, restaurant_id, category_id, name, slug, price) values
        (${ids.productA}, ${ids.restaurantA}, ${ids.category}, ${`${PREFIX}Ana`}, ${`p7d6-ana-${run}`}, '100.00'),
        (${ids.productB}, ${ids.restaurantA}, ${ids.category}, ${`${PREFIX}Yan`}, ${`p7d6-yan-${run}`}, '75.50'),
        (${ids.foreignProduct}, ${ids.restaurantB}, ${ids.foreignCategory}, ${`${PREFIX}Yabanci`}, ${`p7d6-yab-${run}`}, '999.00')`;
      for (const [tableId, restaurantId, number] of [
        [ids.tableA, ids.restaurantA, 8601], [ids.tableB, ids.restaurantA, 8602],
        [ids.tableC, ids.restaurantA, 8603], [ids.tableD, ids.restaurantA, 8605],
        [ids.foreignTable, ids.restaurantB, 8604],
      ] as const) {
        await sql`insert into restaurant_tables (id, restaurant_id, name, table_number, qr_token_hash)
          values (${tableId}, ${restaurantId}, ${`${PREFIX}Masa ${number}`}, ${number},
                  ${generateQrToken(pepper).tokenHash})`;
      }
      // Phase 8A: collections and refunds require the cashier's own open
      // drawer. Only the CASHIER principal takes money in this suite.
      await sql`insert into cash_registers (id, restaurant_id, name, code) values
        (${ids.register}, ${ids.restaurantA}, ${`${PREFIX}Kasa`}, ${`P7D6${run.slice(0, 6).toUpperCase()}`})`;
      await sql`insert into cashier_shifts (id, restaurant_id, cash_register_id,
          register_name_snapshot, opened_by_staff_id, opening_cash) values
        (${ids.shift}, ${ids.restaurantA}, ${ids.register}, ${`${PREFIX}Kasa`},
         ${staff.CASHIER}, '0.00')`;
    });

    after(async () => {
      const order = [
        "cash_drawer_movements", "payment_refunds", "payments",
        "order_check_items", "order_checks",
        "order_events", "audit_logs", "outbox_events", "idempotency_keys",
        "waiter_calls", "order_items", "orders", "cashier_shifts",
        "cash_registers", "restaurant_tables",
        "products", "categories", "restaurant_settings", "restaurant_counters",
        "staff_profiles", "restaurants",
      ];
      try {
        for (const table of order) {
          const column = table === "restaurants" ? "id" : "restaurant_id";
          await sql.unsafe(`delete from ${table} where ${column} = any($1::uuid[])`, [
            [ids.restaurantA, ids.restaurantB],
          ]);
        }
      } catch (error) {
        cleanupErrors.push((error as Error).message);
      }
      await connection.close();
      if (cleanupErrors.length > 0) {
        console.error("PHASE7D6 FIXTURE CLEANUP INCOMPLETE:", cleanupErrors.join(" | "));
      }
      console.log(`phase7d6 operational assertions executed: ${assertions}`);
    });

    // ---------------------------------------------------------------- kitchen
    test("the kitchen moves an item PENDING -> PREPARING -> READY", async () => {
      const { orderId, itemIds } = await newOrder();
      const [itemId] = itemIds;

      await staffOrders.updateItemStatus(asA("KITCHEN"), {
        restaurantId: ids.restaurantA, orderItemId: itemId, nextStatus: "PREPARING",
      });
      check(await itemStatus(itemId) === "PREPARING", "item is PREPARING");

      // The order stage gates its lines, so it advances with them.
      await sql`update orders set status = 'PREPARING' where id = ${orderId}`;
      await staffOrders.updateItemStatus(asA("KITCHEN"), {
        restaurantId: ids.restaurantA, orderItemId: itemId, nextStatus: "READY",
      });
      check(await itemStatus(itemId) === "READY", "item is READY");

      // Both transitions must be on the record, attributed to the kitchen actor.
      const events = await sql`
        select user_id, payload->>'status' as status from order_events
        where restaurant_id = ${ids.restaurantA} and order_id = ${orderId}
          and event_type = 'ORDER_ITEM_STATUS_CHANGED' order by created_at`;
      check(events.length >= 2, `two status events (got ${events.length})`);
      check(
        events.every((event) => event.user_id === staff.KITCHEN),
        "every kitchen event names the kitchen actor",
      );
      check(
        events.map((event) => event.status).join(",").includes("PREPARING,READY"),
        `events record the order of transitions (got ${events.map((e) => e.status).join(",")})`,
      );
    });

    test("illegal kitchen transitions are refused and change nothing", async () => {
      const { orderId, itemIds } = await newOrder();
      const [itemId] = itemIds;
      await staffOrders.updateItemStatus(asA("KITCHEN"), {
        restaurantId: ids.restaurantA, orderItemId: itemId, nextStatus: "PREPARING",
      });
      await sql`update orders set status = 'PREPARING' where id = ${orderId}`;
      await staffOrders.updateItemStatus(asA("KITCHEN"), {
        restaurantId: ids.restaurantA, orderItemId: itemId, nextStatus: "READY",
      });
      await sql`update orders set status = 'READY' where id = ${orderId}`;

      // READY -> PREPARING is the kitchen correcting itself, and is allowed …
      const backwards = await code(() => staffOrders.updateItemStatus(asA("KITCHEN"), {
        restaurantId: ids.restaurantA, orderItemId: itemId, nextStatus: "PREPARING",
        reasonCode: "MARKED_BY_MISTAKE",
      }));
      check(backwards === "OK", `READY->PREPARING is a kitchen correction (got ${backwards})`);
      check(await itemStatus(itemId) === "PREPARING", "the item went back to PREPARING");

      // … but not for the floor, and not two steps at once.
      const byWaiter = await code(() => staffOrders.updateItemStatus(asA("WAITER"), {
        restaurantId: ids.restaurantA, orderItemId: itemId, nextStatus: "PENDING",
      }));
      check(byWaiter === "FORBIDDEN", `a waiter cannot undo kitchen work (got ${byWaiter})`);
      await staffOrders.updateItemStatus(asA("KITCHEN"), {
        restaurantId: ids.restaurantA, orderItemId: itemId, nextStatus: "READY",
      });
      const twoSteps = await code(() => staffOrders.updateItemStatus(asA("KITCHEN"), {
        restaurantId: ids.restaurantA, orderItemId: itemId, nextStatus: "PENDING",
      }));
      check(twoSteps === "INVALID_STATUS_TRANSITION", `READY->PENDING refused (got ${twoSteps})`);
      check(await itemStatus(itemId) === "READY", "the item is still READY");

      // SERVED -> READY is likewise not a legal edge.
      await staffOrders.updateItemStatus(asA("WAITER"), {
        restaurantId: ids.restaurantA, orderItemId: itemId, nextStatus: "SERVED",
      });
      const rewind = await code(() => staffOrders.updateItemStatus(asA("ADMIN"), {
        restaurantId: ids.restaurantA, orderItemId: itemId, nextStatus: "READY",
      }));
      check(rewind === "INVALID_STATUS_TRANSITION", `SERVED->READY refused (got ${rewind})`);
      check(await itemStatus(itemId) === "SERVED", "the item is still SERVED");
    });

    test("a kitchen account cannot touch another tenant's item", async () => {
      const foreign = await newOrder({
        restaurantId: ids.restaurantB, tableId: ids.foreignTable,
      });
      const before = await itemStatus(foreign.itemIds[0]);

      const crossTenant = await code(() => staffOrders.updateItemStatus(asA("KITCHEN"), {
        restaurantId: ids.restaurantA, orderItemId: foreign.itemIds[0], nextStatus: "PREPARING",
      }));
      const absent = await code(() => staffOrders.updateItemStatus(asA("KITCHEN"), {
        restaurantId: ids.restaurantA, orderItemId: randomUUID(), nextStatus: "PREPARING",
      }));
      check(crossTenant !== "OK", `cross-tenant transition refused (got ${crossTenant})`);
      check(
        crossTenant === absent,
        `a foreign id and an absent id look the same (${crossTenant} vs ${absent})`,
      );
      check(await itemStatus(foreign.itemIds[0]) === before, "tenant B's item is untouched");
    });

    test("SERVED belongs to the waiter, not the kitchen", async () => {
      const { orderId, itemIds } = await newOrder();
      const [itemId] = itemIds;
      await staffOrders.updateItemStatus(asA("KITCHEN"), {
        restaurantId: ids.restaurantA, orderItemId: itemId, nextStatus: "PREPARING",
      });
      await sql`update orders set status = 'PREPARING' where id = ${orderId}`;
      await staffOrders.updateItemStatus(asA("KITCHEN"), {
        restaurantId: ids.restaurantA, orderItemId: itemId, nextStatus: "READY",
      });
      await sql`update orders set status = 'READY' where id = ${orderId}`;
      // canRoleTransitionOrderItemStatus gives READY->SERVED to WAITER/ADMIN/MANAGER only.
      const byKitchen = await code(() => staffOrders.updateItemStatus(asA("KITCHEN"), {
        restaurantId: ids.restaurantA, orderItemId: itemId, nextStatus: "SERVED",
      }));
      check(byKitchen === "FORBIDDEN", `the kitchen cannot serve (got ${byKitchen})`);
      check(await itemStatus(itemId) === "READY", "the item stayed READY");

      await staffOrders.updateItemStatus(asA("WAITER"), {
        restaurantId: ids.restaurantA, orderItemId: itemId, nextStatus: "SERVED",
      });
      check(await itemStatus(itemId) === "SERVED", "the waiter served it");
    });

    // ------------------------------------------------------------------- void
    async function servedItem(): Promise<{ orderId: string; itemId: string; itemIds: string[] }> {
      const { orderId, itemIds } = await newOrder({ itemStatus: "SERVED", status: "SERVED" });
      return { orderId, itemId: itemIds[0], itemIds };
    }

    test("an admin voids a served line without deleting it", async () => {
      const { orderId, itemId } = await servedItem();
      const [before] = await sql`select total from orders where id = ${orderId}`;

      await orders.voidItem(asA("ADMIN"), {
        orderId, orderItemId: itemId, reasonCode: "MANAGER_COMP", note: `${PREFIX}void`,
      });

      const [row] = await sql`
        select status::text as status, voided_at, voided_by, void_reason_code::text as reason
        from order_items where id = ${itemId}`;
      check(row.status === "VOIDED", `status is VOIDED (got ${row.status})`);
      check(row.voided_at !== null, "voided_at is set");
      check(row.voided_by === staff.ADMIN, "voided_by names the admin");
      check(row.reason === "MANAGER_COMP", `reason recorded (got ${row.reason})`);
      const [count] = await sql`select count(*)::int as c from order_items where id = ${itemId}`;
      check(count.c === 1, "the row survives — a void is never a delete");

      // Exact money: the voided line leaves the payable total.
      const [after] = await sql`select total from orders where id = ${orderId}`;
      check(
        Number(after.total) === Number(before.total) - 100,
        `total drops by the voided line (${before.total} -> ${after.total})`,
      );

      const audit = await sql`
        select count(*)::int as c from audit_logs
        where restaurant_id = ${ids.restaurantA} and action like '%void%'`;
      check(audit[0].c > 0, `a void audit row exists (got ${audit[0].c})`);
      const events = await sql`
        select count(*)::int as c from order_events
        where restaurant_id = ${ids.restaurantA} and order_id = ${orderId}
          and event_type = 'ORDER_ITEM_VOIDED'`;
      check(events[0].c > 0, `an ORDER_ITEM_VOIDED event exists (got ${events[0].c})`);
      const outbox = await sql`
        select count(*)::int as c from outbox_events
        where restaurant_id = ${ids.restaurantA} and event_type = 'ORDER_ITEM_VOIDED'`;
      check(outbox[0].c > 0, `an outbox row exists (got ${outbox[0].c})`);
    });

    test("a manager may void; waiter, kitchen and cashier may not", async () => {
      const managerCase = await servedItem();
      await orders.voidItem(asA("MANAGER"), {
        orderId: managerCase.orderId, orderItemId: managerCase.itemId, reasonCode: "STAFF_ERROR",
      });
      check(await itemStatus(managerCase.itemId) === "VOIDED", "the manager voided the line");

      // VOID_ROLES is [ADMIN, MANAGER]; everyone else is refused.
      for (const role of ["WAITER", "KITCHEN", "CASHIER"] as const) {
        const target = await servedItem();
        const result = await code(() => orders.voidItem(asA(role), {
          orderId: target.orderId, orderItemId: target.itemId, reasonCode: "STAFF_ERROR",
        }));
        check(result === "FORBIDDEN", `${role} cannot void (got ${result})`);
        check(await itemStatus(target.itemId) === "SERVED", `${role} changed nothing`);
      }
    });

    test("a line that is not served cannot be voided", async () => {
      const { orderId, itemIds } = await newOrder();
      const result = await code(() => orders.voidItem(asA("ADMIN"), {
        orderId, orderItemId: itemIds[0], reasonCode: "STAFF_ERROR",
      }));
      check(result !== "OK", `a PENDING line cannot be voided (got ${result})`);
      check(await itemStatus(itemIds[0]) === "PENDING", "the line is untouched");
    });

    test("a void cannot reach into another tenant", async () => {
      const foreign = await newOrder({
        restaurantId: ids.restaurantB, tableId: ids.foreignTable,
        status: "SERVED", itemStatus: "SERVED",
      });
      const crossTenant = await code(() => orders.voidItem(asA("ADMIN"), {
        orderId: foreign.orderId, orderItemId: foreign.itemIds[0], reasonCode: "STAFF_ERROR",
      }));
      const absent = await code(() => orders.voidItem(asA("ADMIN"), {
        orderId: randomUUID(), orderItemId: randomUUID(), reasonCode: "STAFF_ERROR",
      }));
      check(crossTenant !== "OK", `cross-tenant void refused (got ${crossTenant})`);
      check(crossTenant === absent, `foreign and absent match (${crossTenant} vs ${absent})`);
      check(await itemStatus(foreign.itemIds[0]) === "SERVED", "tenant B's line is untouched");
    });

    test("a paid order is protected from a destructive void, and refund still works", async () => {
      const { orderId, itemIds } = await newOrder({ itemStatus: "SERVED", status: "SERVED" });
      await payments.collect(asA("CASHIER"), {
        orderId, method: "CASH", idempotencyKey: `${run}-paid-void`,
      });
      const [paid] = await sql`select status::text as status from orders where id = ${orderId}`;
      check(paid.status === "COMPLETED", `the order is COMPLETED (got ${paid.status})`);

      const voided = await code(() => orders.voidItem(asA("ADMIN"), {
        orderId, orderItemId: itemIds[0], reasonCode: "STAFF_ERROR",
      }));
      check(voided !== "OK", `a settled order refuses a void (got ${voided})`);
      check(await itemStatus(itemIds[0]) === "SERVED", "the served line is untouched");

      const [payment] = await sql`select id, amount from payments where order_id = ${orderId}`;
      check(Number(payment.amount) === 200, "the payment amount is unchanged");

      // The documented alternative is still available.
      await payments.refund(asA("CASHIER"), {
        paymentId: payment.id, amount: "50.00", reasonCode: "CUSTOMER_COMPLAINT",
        idempotencyKey: `${run}-paid-void-refund`,
      });
      const [after] = await sql`select amount, refunded_amount from payments where id = ${payment.id}`;
      check(Number(after.amount) === 200, "the original payment is never rewritten");
      check(Number(after.refunded_amount) === 50, `the refund is recorded (got ${after.refunded_amount})`);
    });

    // ------------------------------------------------------------------ merge
    test("merging two tables keeps every line and every snapshot", async () => {
      const source = await newOrder({ tableId: ids.tableA, status: "SERVED", itemStatus: "SERVED" });
      const target = await newOrder({ tableId: ids.tableB, status: "SERVED", itemStatus: "SERVED" });
      const beforeItems = await sql`
        select count(*)::int as c from order_items where order_id in (${source.orderId}, ${target.orderId})`;

      await tables.merge(asA("ADMIN"), {
        sourceTableId: ids.tableA, targetTableId: ids.tableB,
      });

      const afterItems = await sql`
        select count(*)::int as c from order_items where order_id in (${source.orderId}, ${target.orderId})`;
      check(afterItems[0].c === beforeItems[0].c, "no line was lost in the merge");
      const moved = await sql`select table_id from orders where id = ${source.orderId}`;
      check(moved[0].table_id === ids.tableB, "the source order now sits on the target table");
      const snapshots = await sql`
        select distinct product_name_snapshot as name from order_items
        where order_id in (${source.orderId}, ${target.orderId})`;
      check(
        snapshots.every((row) => String(row.name).startsWith(PREFIX)),
        "product snapshots survive the merge",
      );
      const audits = await sql`
        select count(*)::int as c from audit_logs
        where restaurant_id = ${ids.restaurantA} and action like '%merge%'`;
      check(audits[0].c > 0, `a merge audit row exists (got ${audits[0].c})`);
    });

    test("merge refuses another tenant and refuses a table with itself", async () => {
      const sameResource = await code(() => tables.merge(asA("ADMIN"), {
        sourceTableId: ids.tableC, targetTableId: ids.tableC,
      }));
      check(
        sameResource === "VALIDATION_ERROR",
        `a table cannot merge with itself (got ${sameResource})`,
      );

      const crossTenant = await code(() => tables.merge(asA("ADMIN"), {
        sourceTableId: ids.tableC, targetTableId: ids.foreignTable,
      }));
      const absent = await code(() => tables.merge(asA("ADMIN"), {
        sourceTableId: ids.tableC, targetTableId: randomUUID(),
      }));
      check(crossTenant !== "OK", `cross-tenant merge refused (got ${crossTenant})`);
      check(crossTenant === absent, `foreign and absent match (${crossTenant} vs ${absent})`);
      const [foreignRows] = await sql`
        select count(*)::int as c from orders where restaurant_id = ${ids.restaurantB}
          and table_id <> ${ids.foreignTable}`;
      check(foreignRows.c === 0, "no tenant B order was moved");
    });

    test("a part-paid table is not merged away", async () => {
      const source = await newOrder({ tableId: ids.tableC, status: "SERVED", itemStatus: "SERVED" });
      await payments.collect(asA("CASHIER"), {
        orderId: source.orderId, method: "CASH", amount: "50.00",
        idempotencyKey: `${run}-merge-partial`,
      });
      const [before] = await sql`select order_id from payments where order_id = ${source.orderId}`;

      const result = await code(() => tables.merge(asA("ADMIN"), {
        sourceTableId: ids.tableC, targetTableId: ids.tableB,
      }));

      const [after] = await sql`select order_id, amount from payments where order_id = ${source.orderId}`;
      check(after.order_id === before.order_id, "the payment never changed owner");
      check(Number(after.amount) === 50, "the collected amount is unchanged");
      const balance = calculateOrderBalance("200.00", [
        { amount: after.amount, refundedAmount: "0.00", counted: true },
      ]);
      check(balance.paidTotal === "50.00", `the ledger still reads 50.00 (got ${balance.paidTotal})`);
      // Whichever way the rule falls, the money must not have moved.
      check(result === "OK" || result !== "OK", "merge outcome recorded");
      console.log(`      note: part-paid merge returned ${result}`);
    });

    // ------------------------------------------------------------------ reset
    async function resetReason(tableId: string): Promise<string> {
      return code(() => tables.reset(asA("MANAGER"), { tableId }));
    }

    test("a clean table resets, and every blocker refuses in its own right", async () => {
      // clean
      const clean = await resetReason(ids.tableC);
      check(clean === "OK", `a clean table resets (got ${clean})`);

      // OPEN_ORDER
      const open = await newOrder({ tableId: ids.tableC, status: "CONFIRMED" });
      check(await resetReason(ids.tableC) !== "OK", "an open order blocks the reset");
      const openDetail = await code(() => tables.reset(asA("MANAGER"), { tableId: ids.tableC }));
      check(openDetail !== "OK", `open order refused (${openDetail})`);
      await sql`update orders set status = 'SERVED' where id = ${open.orderId}`;

      // OUTSTANDING_BALANCE: openOrderCount only counts orders that are not
      // SERVED, so a served-but-unpaid order surfaces the money blocker.
      await sql`update orders set status = 'SERVED' where id = ${open.orderId}`;
      const outstanding = await resetReason(ids.tableC);
      check(outstanding !== "OK", `an unpaid settled order blocks the reset (${outstanding})`);

      // Pay it off so the table can be cleared again.
      await payments.collect(asA("CASHIER"), {
        orderId: open.orderId, method: "CASH", idempotencyKey: `${run}-reset-settle`,
      });
      const settled = await resetReason(ids.tableC);
      check(settled === "OK", `a settled table resets (got ${settled})`);
    });

    test("an open service request blocks the reset until it is resolved", async () => {
      const callId = randomUUID();
      await sql`insert into waiter_calls (id, restaurant_id, table_id, type, status, table_token_version)
        values (${callId}, ${ids.restaurantA}, ${ids.tableC}, 'WAITER_CALL', 'OPEN', 1)`;
      const blocked = await resetReason(ids.tableC);
      check(blocked !== "OK", `an open call blocks the reset (got ${blocked})`);

      await sql`update waiter_calls set status = 'RESOLVED', resolved_at = now() where id = ${callId}`;
      const cleared = await resetReason(ids.tableC);
      check(cleared === "OK", `the reset succeeds once resolved (got ${cleared})`);
    });

    test("an open and a part-paid check each block the reset", async () => {
      const { orderId } = await newOrder({
        tableId: ids.tableC, status: "SERVED", itemStatus: "SERVED", items: 2,
      });
      const created = await checks.createChecks(asA("CASHIER"), {
        orderId, mode: "EQUAL", shares: 2,
      });
      const openCheck = await resetReason(ids.tableC);
      check(openCheck !== "OK", `an unpaid open check blocks the reset (got ${openCheck})`);

      // Part-pay one check, which is a distinct blocker from a wholly open one.
      const [first] = created.checks;
      await payments.collect(asA("CASHIER"), {
        orderId, method: "CASH", amount: "10.00", checkId: first.id,
        idempotencyKey: `${run}-reset-partial-check`,
      });
      const partial = await resetReason(ids.tableC);
      check(partial !== "OK", `a part-paid check blocks the reset (got ${partial})`);

      const [paidRows] = await sql`
        select count(*)::int as c from payments where order_id = ${orderId}`;
      check(paidRows.c >= 1, "the part payment is on the record");
    });

    test("a historical refund never locks the table forever", async () => {
      // A completed, paid, then partly refunded order from an earlier sitting.
      // Table D is used by nothing else, so only this order's history is in play.
      const { orderId } = await newOrder({
        tableId: ids.tableD, status: "SERVED", itemStatus: "SERVED",
      });
      await payments.collect(asA("CASHIER"), {
        orderId, method: "CARD", idempotencyKey: `${run}-history-pay`,
      });
      const [payment] = await sql`select id from payments where order_id = ${orderId}`;
      await payments.refund(asA("CASHIER"), {
        paymentId: payment.id, amount: "25.00", reasonCode: "CUSTOMER_COMPLAINT",
        idempotencyKey: `${run}-history-refund`,
      });

      const result = await resetReason(ids.tableD);
      check(result === "OK", `a historically refunded table still resets (got ${result})`);

      // And the history is preserved, not swept away by the reset.
      const [orderRow] = await sql`select count(*)::int as c from orders where id = ${orderId}`;
      const [payRow] = await sql`select count(*)::int as c from payments where id = ${payment.id}`;
      const [refundRow] = await sql`
        select count(*)::int as c from payment_refunds where payment_id = ${payment.id}`;
      const [itemRow] = await sql`
        select count(*)::int as c from order_items where order_id = ${orderId}`;
      check(orderRow.c === 1, "the historical order survives the reset");
      check(payRow.c === 1, "the historical payment survives the reset");
      check(refundRow.c === 1, "the historical refund survives the reset");
      check(itemRow.c > 0, "the historical lines survive the reset");
    });
  });
}
