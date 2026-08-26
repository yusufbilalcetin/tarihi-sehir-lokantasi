import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";

import { createDb, type Database } from "../../db";
import { isDomainError } from "../../lib/api/domain-error";
import type { RestaurantPrincipal } from "../../lib/domain/restaurant-scope";
import { deriveKitchenStage } from "../../lib/domain/status";
import { DrizzleStaffOrderRepository } from "../../lib/repositories/drizzle-staff-order-repository";
import { generateQrToken } from "../../lib/security/qr-token";
import { StaffOrderService } from "../../lib/services/staff-order-service";
import { readSupabaseIntegrationEnvironment } from "./supabase-test-environment";

/**
 * The kitchen's undo, on real PostgreSQL.
 *
 * What matters beyond the pure rules: that an undo is a compare-and-swap rather
 * than a blind write, so two cooks pressing "Geri Al" at the same moment
 * produce one state change and one history entry; that the history of the first
 * READY survives the undo; and that nothing about the money moves.
 */

const PREFIX = "PHASE8F_";
const readiness = readSupabaseIntegrationEnvironment({ requireDatabaseUrl: true });

if (!readiness.ready) {
  test("Phase 8F kitchen rollback", { skip: readiness.reason }, () => undefined);
} else {
  const environment = readiness.environment;
  const run = randomBytes(6).toString("hex");
  let connection: ReturnType<typeof createDb>;
  let db: Database;
  let sql: ReturnType<typeof createDb>["client"];
  let staffOrders: StaffOrderService;
  const cleanupErrors: string[] = [];
  let assertions = 0;
  let sequence = 96000;

  const ids = {
    restaurant: randomUUID(),
    foreignRestaurant: randomUUID(),
    category: randomUUID(),
    product: randomUUID(),
    table: randomUUID(),
    kitchen: randomUUID(),
    waiter: randomUUID(),
    manager: randomUUID(),
    cashier: randomUUID(),
    foreignKitchen: randomUUID(),
    foreignTable: randomUUID(),
    foreignOrder: randomUUID(),
    foreignItem: randomUUID(),
    foreignCategory: randomUUID(),
    foreignProduct: randomUUID(),
  };

  function check(condition: boolean, message: string): void {
    assertions += 1;
    assert.ok(condition, message);
  }

  const as = (
    role: RestaurantPrincipal["role"],
    userId: string,
    restaurantId = ids.restaurant,
  ): RestaurantPrincipal => ({ userId, restaurantId, role, isActive: true });

  async function code(work: () => Promise<unknown>): Promise<string> {
    try {
      await work();
      return "OK";
    } catch (error) {
      return isDomainError(error) ? error.code : `UNEXPECTED:${(error as Error).message}`;
    }
  }

  async function itemStatus(itemId: string): Promise<string> {
    const [row] = await sql`select status::text as status from order_items where id = ${itemId}`;
    return String(row.status);
  }

  /** A confirmed order with `lines` identical items, ready for the kitchen. */
  async function newOrder(lines = 3): Promise<{ orderId: string; itemIds: string[] }> {
    const orderId = randomUUID();
    sequence += 1;
    const total = (100 * lines).toFixed(2);
    await sql`
      insert into orders (id, restaurant_id, table_id, order_sequence, order_number, status,
          subtotal, total, created_by_type, created_by_user_id)
      values (${orderId}, ${ids.restaurant}, ${ids.table}, ${sequence},
              ${`${PREFIX}${sequence}`}, 'CONFIRMED', ${total}, ${total}, 'STAFF', ${ids.waiter})`;
    const itemIds: string[] = [];
    for (let index = 0; index < lines; index += 1) {
      const itemId = randomUUID();
      itemIds.push(itemId);
      await sql`
        insert into order_items (id, restaurant_id, order_id, product_id, product_name_snapshot,
            unit_price, quantity, line_total, status, sort_order)
        values (${itemId}, ${ids.restaurant}, ${orderId}, ${ids.product}, ${`${PREFIX}Kebap`},
                '100.00', 1, '100.00', 'PENDING', ${index + 1})`;
    }
    return { orderId, itemIds };
  }

  describe("Phase 8F kitchen rollback", { concurrency: false }, () => {
    before(async () => {
      connection = createDb(environment.databaseUrl!, { maxConnections: 6 });
      db = connection.db;
      sql = connection.client;
      staffOrders = new StaffOrderService(new DrizzleStaffOrderRepository(db));

      await sql`insert into restaurants (id, name, slug) values
        (${ids.restaurant}, ${`${PREFIX}Tenant`}, ${`phase8f-${run}`}),
        (${ids.foreignRestaurant}, ${`${PREFIX}Other`}, ${`phase8f-b-${run}`})`;
      await sql`insert into restaurant_settings (restaurant_id) values
        (${ids.restaurant}), (${ids.foreignRestaurant})`;
      for (const [id, restaurantId, role, label] of [
        [ids.kitchen, ids.restaurant, "KITCHEN", "mutfak"],
        [ids.waiter, ids.restaurant, "WAITER", "garson"],
        [ids.manager, ids.restaurant, "MANAGER", "mudur"],
        [ids.cashier, ids.restaurant, "CASHIER", "kasa"],
        [ids.foreignKitchen, ids.foreignRestaurant, "KITCHEN", "yabanci"],
      ] as const) {
        await sql`insert into staff_profiles (id, restaurant_id, name, login_identifier, role,
            is_active) values
          (${id}, ${restaurantId}, ${`${PREFIX}${label}`}, ${`p8f-${run}-${label}`}, ${role}, true)`;
      }
      await sql`insert into categories (id, restaurant_id, name, slug) values
        (${ids.category}, ${ids.restaurant}, ${`${PREFIX}Izgara`}, ${`p8f-cat-${run}`})`;
      await sql`insert into products (id, restaurant_id, category_id, name, slug, price) values
        (${ids.product}, ${ids.restaurant}, ${ids.category}, ${`${PREFIX}Kebap`},
         ${`p8f-urun-${run}`}, '100.00')`;
      await sql`insert into restaurant_tables (id, restaurant_id, name, table_number,
          qr_token_hash) values
        (${ids.table}, ${ids.restaurant}, ${`${PREFIX}Masa`}, 9601,
         ${generateQrToken(randomBytes(32)).tokenHash}),
        (${ids.foreignTable}, ${ids.foreignRestaurant}, ${`${PREFIX}Masa B`}, 9602,
         ${generateQrToken(randomBytes(32)).tokenHash})`;

      await sql`insert into categories (id, restaurant_id, name, slug) values
        (${ids.foreignCategory}, ${ids.foreignRestaurant}, ${`${PREFIX}Izgara B`},
         ${`p8f-cat-b-${run}`})`;
      await sql`insert into products (id, restaurant_id, category_id, name, slug, price) values
        (${ids.foreignProduct}, ${ids.foreignRestaurant}, ${ids.foreignCategory},
         ${`${PREFIX}Kebap B`}, ${`p8f-urun-b-${run}`}, '100.00')`;

      // One foreign order with a READY line, for the cross-tenant case.
      await sql`
        insert into orders (id, restaurant_id, table_id, order_sequence, order_number, status,
            subtotal, total, created_by_type)
        values (${ids.foreignOrder}, ${ids.foreignRestaurant}, ${ids.foreignTable}, 96999,
                ${`${PREFIX}FOREIGN`}, 'READY', '100.00', '100.00', 'CUSTOMER')`;
      await sql`
        insert into order_items (id, restaurant_id, order_id, product_id,
            product_name_snapshot, unit_price, quantity, line_total, status, sort_order)
        values (${ids.foreignItem}, ${ids.foreignRestaurant}, ${ids.foreignOrder},
                ${ids.foreignProduct}, ${`${PREFIX}Kebap B`}, '100.00', 1, '100.00', 'READY', 1)`;
    });

    after(async () => {
      try {
        for (const tenant of [ids.restaurant, ids.foreignRestaurant]) {
          for (const table of [
            "order_events", "audit_logs", "outbox_events", "order_items", "orders",
            "restaurant_tables", "products", "categories", "restaurant_settings",
            "staff_profiles",
          ]) {
            await sql.unsafe(`delete from ${table} where restaurant_id = $1::uuid`, [tenant]);
          }
          await sql.unsafe(`delete from restaurants where id = $1::uuid`, [tenant]);
        }
      } catch (error) {
        cleanupErrors.push((error as Error).message);
      }
      await connection.close();
      if (cleanupErrors.length > 0) {
        console.error("PHASE8F CLEANUP INCOMPLETE:", cleanupErrors.join(" | "));
      }
      console.log(`phase8f assertions executed: ${assertions}`);
    });

    test("a line started by mistake goes back to the queue", async () => {
      const { orderId, itemIds } = await newOrder(1);
      const [itemId] = itemIds;
      await staffOrders.updateItemStatus(as("KITCHEN", ids.kitchen), {
        restaurantId: ids.restaurant, orderItemId: itemId, nextStatus: "PREPARING",
      });
      await sql`update orders set status = 'PREPARING' where id = ${orderId}`;

      const undo = await staffOrders.updateItemStatus(as("KITCHEN", ids.kitchen), {
        restaurantId: ids.restaurant,
        orderItemId: itemId,
        nextStatus: "PENDING",
        reasonCode: "MARKED_BY_MISTAKE",
      });
      check(undo.reverted === true, "the service reports an undo");
      check(await itemStatus(itemId) === "PENDING", "and the line is back in the queue");

      // Forward again, so the correction really is a correction.
      await staffOrders.updateItemStatus(as("KITCHEN", ids.kitchen), {
        restaurantId: ids.restaurant, orderItemId: itemId, nextStatus: "PREPARING",
      });
      check(await itemStatus(itemId) === "PREPARING", "and it can be started again");
    });

    test("a plate marked ready too early goes back to the pass, and forward again", async () => {
      const { orderId, itemIds } = await newOrder(1);
      const [itemId] = itemIds;
      await sql`update orders set status = 'PREPARING' where id = ${orderId}`;
      await staffOrders.updateItemStatus(as("KITCHEN", ids.kitchen), {
        restaurantId: ids.restaurant, orderItemId: itemId, nextStatus: "PREPARING",
      });
      await staffOrders.updateItemStatus(as("KITCHEN", ids.kitchen), {
        restaurantId: ids.restaurant, orderItemId: itemId, nextStatus: "READY",
      });
      await sql`update orders set status = 'READY' where id = ${orderId}`;

      await staffOrders.updateItemStatus(as("KITCHEN", ids.kitchen), {
        restaurantId: ids.restaurant,
        orderItemId: itemId,
        nextStatus: "PREPARING",
        reasonCode: "UNDERCOOKED",
        reasonNote: "İçi soğuk kalmış",
      });
      check(await itemStatus(itemId) === "PREPARING", "back to preparing");

      await staffOrders.updateItemStatus(as("KITCHEN", ids.kitchen), {
        restaurantId: ids.restaurant, orderItemId: itemId, nextStatus: "READY",
      });
      check(await itemStatus(itemId) === "READY", "and ready again");

      // Both READY events survive: the history is appended to, never rewritten.
      const events = await sql`
        select payload->>'status' as status, payload->>'reverted' as reverted
        from order_events where order_id = ${orderId} and event_type = 'ORDER_ITEM_STATUS_CHANGED'
        order by created_at`;
      const readyEvents = events.filter((row) => row.status === "READY");
      check(readyEvents.length === 2, `both READY events are kept (got ${readyEvents.length})`);
      check(
        events.some((row) => row.reverted === "true"),
        "and the undo is on the record as an undo",
      );
    });

    test("the undo is audited with where it came from and why", async () => {
      const audits = await sql`
        select action, old_value::text as old_value, new_value::text as new_value,
               metadata::text as metadata, actor_user_id
        from audit_logs
        where restaurant_id = ${ids.restaurant} and action = 'order_item.status_reverted'
        order by created_at desc limit 1`;
      check(audits.length === 1, "the rollback is audited under its own action");
      const audit = audits[0];
      check(String(audit.actor_user_id) === ids.kitchen, "the actor is the cook who did it");
      check(String(audit.old_value).includes("READY"), "the audit names the state it left");
      check(String(audit.new_value).includes("PREPARING"), "and the state it went to");
      check(String(audit.metadata).includes("UNDERCOOKED"), "and the reason given");
    });

    test("the floor and the till cannot undo kitchen work", async () => {
      const { orderId, itemIds } = await newOrder(1);
      const [itemId] = itemIds;
      await sql`update orders set status = 'PREPARING' where id = ${orderId}`;
      await staffOrders.updateItemStatus(as("KITCHEN", ids.kitchen), {
        restaurantId: ids.restaurant, orderItemId: itemId, nextStatus: "PREPARING",
      });
      await staffOrders.updateItemStatus(as("KITCHEN", ids.kitchen), {
        restaurantId: ids.restaurant, orderItemId: itemId, nextStatus: "READY",
      });
      await sql`update orders set status = 'READY' where id = ${orderId}`;

      for (const [role, userId] of [
        ["WAITER", ids.waiter],
        ["CASHIER", ids.cashier],
      ] as const) {
        const denied = await code(() =>
          staffOrders.updateItemStatus(as(role, userId), {
            restaurantId: ids.restaurant, orderItemId: itemId, nextStatus: "PREPARING",
          }),
        );
        check(denied === "FORBIDDEN", `${role} is refused (got ${denied})`);
      }
      check(await itemStatus(itemId) === "READY", "the line is untouched");

      // A manager may override, because a manager may already do everything else.
      const byManager = await code(() =>
        staffOrders.updateItemStatus(as("MANAGER", ids.manager), {
          restaurantId: ids.restaurant, orderItemId: itemId, nextStatus: "PREPARING",
        }),
      );
      check(byManager === "OK", `a manager may correct it (got ${byManager})`);
    });

    test("a served line cannot be pulled back into the kitchen", async () => {
      const { orderId, itemIds } = await newOrder(1);
      const [itemId] = itemIds;
      await sql`update orders set status = 'PREPARING' where id = ${orderId}`;
      await staffOrders.updateItemStatus(as("KITCHEN", ids.kitchen), {
        restaurantId: ids.restaurant, orderItemId: itemId, nextStatus: "PREPARING",
      });
      await staffOrders.updateItemStatus(as("KITCHEN", ids.kitchen), {
        restaurantId: ids.restaurant, orderItemId: itemId, nextStatus: "READY",
      });
      await sql`update orders set status = 'READY' where id = ${orderId}`;
      await staffOrders.updateItemStatus(as("WAITER", ids.waiter), {
        restaurantId: ids.restaurant, orderItemId: itemId, nextStatus: "SERVED",
      });

      for (const role of ["KITCHEN", "MANAGER", "ADMIN"] as const) {
        const denied = await code(() =>
          staffOrders.updateItemStatus(as(role, ids.kitchen), {
            restaurantId: ids.restaurant, orderItemId: itemId, nextStatus: "READY",
          }),
        );
        check(
          denied === "INVALID_STATUS_TRANSITION",
          `${role} cannot unserve a line (got ${denied})`,
        );
      }
      check(await itemStatus(itemId) === "SERVED", "the served line stands");
    });

    test("a closed order is beyond correction", async () => {
      const { orderId, itemIds } = await newOrder(1);
      const [itemId] = itemIds;
      await sql`update orders set status = 'PREPARING' where id = ${orderId}`;
      await staffOrders.updateItemStatus(as("KITCHEN", ids.kitchen), {
        restaurantId: ids.restaurant, orderItemId: itemId, nextStatus: "PREPARING",
      });
      await sql`update orders set status = 'COMPLETED' where id = ${orderId}`;

      const denied = await code(() =>
        staffOrders.updateItemStatus(as("KITCHEN", ids.kitchen), {
          restaurantId: ids.restaurant, orderItemId: itemId, nextStatus: "PENDING",
        }),
      );
      check(denied === "INVALID_STATUS_TRANSITION", `a closed order is refused (got ${denied})`);
    });

    test("two cooks undoing the same line produce one change", async () => {
      const { orderId, itemIds } = await newOrder(1);
      const [itemId] = itemIds;
      await sql`update orders set status = 'PREPARING' where id = ${orderId}`;
      await staffOrders.updateItemStatus(as("KITCHEN", ids.kitchen), {
        restaurantId: ids.restaurant, orderItemId: itemId, nextStatus: "PREPARING",
      });
      await staffOrders.updateItemStatus(as("KITCHEN", ids.kitchen), {
        restaurantId: ids.restaurant, orderItemId: itemId, nextStatus: "READY",
      });
      await sql`update orders set status = 'READY' where id = ${orderId}`;

      const eventsBefore = await sql`
        select count(*)::int as total from order_events where order_id = ${orderId}`;
      const [first, second] = await Promise.all([
        code(() =>
          staffOrders.updateItemStatus(as("KITCHEN", ids.kitchen), {
            restaurantId: ids.restaurant, orderItemId: itemId, nextStatus: "PREPARING",
          }),
        ),
        code(() =>
          staffOrders.updateItemStatus(as("KITCHEN", ids.kitchen), {
            restaurantId: ids.restaurant, orderItemId: itemId, nextStatus: "PREPARING",
          }),
        ),
      ]);
      const winners = [first, second].filter((result) => result === "OK").length;
      check(winners === 1, `exactly one undo takes effect (got ${first}, ${second})`);
      check(
        [first, second].some((result) => result === "CONFLICT" || result === "INVALID_STATUS_TRANSITION"),
        `the loser is told cleanly, not with a 500 (got ${first}, ${second})`,
      );
      check(await itemStatus(itemId) === "PREPARING", "the line moved exactly once");

      const eventsAfter = await sql`
        select count(*)::int as total from order_events where order_id = ${orderId}`;
      check(
        Number(eventsAfter[0].total) - Number(eventsBefore[0].total) === 1,
        "and exactly one history entry was written",
      );
    });

    test("another restaurant's line is out of reach", async () => {
      const denied = await code(() =>
        staffOrders.updateItemStatus(as("KITCHEN", ids.foreignKitchen, ids.foreignRestaurant), {
          restaurantId: ids.restaurant,
          orderItemId: ids.foreignItem,
          nextStatus: "PREPARING",
        }),
      );
      check(
        denied === "RESTAURANT_SCOPE_VIOLATION" || denied === "NOT_FOUND",
        `a foreign cook is refused (got ${denied})`,
      );
      check(await itemStatus(ids.foreignItem) === "READY", "the foreign line is untouched");
    });

    test("a mixed ticket sits where its outstanding lines put it", async () => {
      const { orderId, itemIds } = await newOrder(3);
      await sql`update orders set status = 'PREPARING' where id = ${orderId}`;
      for (const itemId of itemIds) {
        await staffOrders.updateItemStatus(as("KITCHEN", ids.kitchen), {
          restaurantId: ids.restaurant, orderItemId: itemId, nextStatus: "PREPARING",
        });
        await staffOrders.updateItemStatus(as("KITCHEN", ids.kitchen), {
          restaurantId: ids.restaurant, orderItemId: itemId, nextStatus: "READY",
        });
      }
      const readAll = async () =>
        (await sql`select status::text as status from order_items where order_id = ${orderId}`).map(
          (row) => ({ status: String(row.status) as never }),
        );
      check(deriveKitchenStage(await readAll()) === "READY", "the whole ticket is ready");

      await sql`update orders set status = 'READY' where id = ${orderId}`;
      await staffOrders.updateItemStatus(as("KITCHEN", ids.kitchen), {
        restaurantId: ids.restaurant,
        orderItemId: itemIds[1],
        nextStatus: "PREPARING",
        reasonCode: "REHEAT",
      });
      check(
        deriveKitchenStage(await readAll()) === "PREPARING",
        "one undone line takes the ticket out of the ready column",
      );

      await staffOrders.updateItemStatus(as("KITCHEN", ids.kitchen), {
        restaurantId: ids.restaurant, orderItemId: itemIds[1], nextStatus: "READY",
      });
      check(deriveKitchenStage(await readAll()) === "READY", "and finishing it puts it back");
    });

    test("nothing about the money moves", async () => {
      const { orderId, itemIds } = await newOrder(2);
      const before = await sql`
        select total, subtotal from orders where id = ${orderId}`;
      await sql`update orders set status = 'PREPARING' where id = ${orderId}`;
      await staffOrders.updateItemStatus(as("KITCHEN", ids.kitchen), {
        restaurantId: ids.restaurant, orderItemId: itemIds[0], nextStatus: "PREPARING",
      });
      await staffOrders.updateItemStatus(as("KITCHEN", ids.kitchen), {
        restaurantId: ids.restaurant, orderItemId: itemIds[0], nextStatus: "PENDING",
      });
      const after = await sql`
        select total, subtotal from orders where id = ${orderId}`;
      check(
        String(before[0].total) === String(after[0].total) &&
          String(before[0].subtotal) === String(after[0].subtotal),
        "the order total is exactly what it was",
      );

      const [lines] = await sql`
        select count(*)::int as total from order_items
        where order_id = ${orderId} and (voided_at is not null or cancelled_at is not null)`;
      check(Number(lines.total) === 0, "and no line was cancelled or written off");
    });
  });
}
