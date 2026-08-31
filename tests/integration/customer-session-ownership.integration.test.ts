import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as relations from "../../db/relations";
import * as schema from "../../db/schema";
import {
  categories,
  orders,
  products,
  restaurantSettings,
  restaurantTables,
  restaurants,
  staffProfiles,
} from "../../db/schema";
import { DomainError } from "../../lib/api/domain-error";
import { DrizzleCustomerOrderQueryRepository } from "../../lib/repositories/drizzle-customer-order-query-repository";
import { DrizzleOrderRepository } from "../../lib/repositories/drizzle-order-repository";
import { DrizzleStaffTableRepository } from "../../lib/repositories/drizzle-staff-table-repository";
import { createCustomerTableSession } from "../../lib/security/customer-session";
import { generateQrToken } from "../../lib/security/qr-token";
import { CustomerOrderQueryService } from "../../lib/services/customer-order-query-service";
import { OrderService } from "../../lib/services/order-service";

/**
 * Two parties at one table, on real PostgreSQL.
 *
 * The bug this pins down: an order left unsettled when a party leaves used to
 * stay visible to whoever scanned that table next, because a guest's orders
 * were owned by `(restaurant, table, not yet settled)` — a proxy for a sitting
 * rather than the sitting itself. Everything below runs through the real
 * services, the real repositories and real rows; nothing is stubbed, so what
 * is asserted is what PostgreSQL actually returns for the query the route runs.
 *
 * DISPOSABLE ONLY. This truncates every table in `public`, so it refuses to
 * run against anything but a loopback host whose database is named
 * `sehir_e2e`, and refuses again if the database looks like a Supabase project.
 * With `E2E_DATABASE_URL` unset the whole suite skips.
 */

const DISPOSABLE_DATABASE = "sehir_e2e";
const LOOPBACK = ["127.0.0.1", "localhost", "::1", "[::1]"];

function disposable(raw: string | undefined): { url: string } | { skip: string } {
  const url = raw?.trim();
  if (!url) return { skip: "E2E_DATABASE_URL is not set" };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { skip: "E2E_DATABASE_URL is not a URL" };
  }
  if (!LOOPBACK.includes(parsed.hostname)) {
    return { skip: `refusing a non-loopback target (${parsed.hostname})` };
  }
  // The name is the second half of the guarantee: a loopback port can be
  // tunnelled to anywhere, so the database must also say it is the throwaway.
  const database = parsed.pathname.replace(/^\//, "");
  if (database !== DISPOSABLE_DATABASE) {
    return { skip: `refusing a database that is not ${DISPOSABLE_DATABASE} (${database})` };
  }
  return { url };
}

const target = disposable(process.env.E2E_DATABASE_URL);
const skipReason = "skip" in target ? target.skip : false;

/** ≥32 bytes, and never a production value: only the nonce shape matters here. */
const SESSION_SECRET = "ownership-e2e-customer-session-secret-not-production";
const QR_PEPPER = "ownership-e2e-qr-pepper-not-a-production-secret";

describe("customer session order ownership, on real PostgreSQL", { skip: skipReason }, () => {
  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema & typeof relations>>;

  const ids = {
    restaurant: randomUUID(),
    otherRestaurant: randomUUID(),
    category: randomUUID(),
    soup: randomUUID(),
    table: randomUUID(),
    otherTable: randomUUID(),
    foreignCategory: randomUUID(),
    foreignSoup: randomUUID(),
    foreignTable: randomUUID(),
    waiter: randomUUID(),
  };

  /** One scan of a QR code, as the menu gate mints it. */
  function sitting(restaurantId: string, tableId: string, accessVersion = 1): string {
    return createCustomerTableSession(
      { restaurantId, tableId, accessVersion },
      SESSION_SECRET,
    ).claims.nonce;
  }

  // The first party, the second party who sits down after them, and a third
  // scan at the neighbouring table.
  const partyA = sitting(ids.restaurant, ids.table);
  const partyB = sitting(ids.restaurant, ids.table);
  const partyOtherTable = sitting(ids.restaurant, ids.otherTable);
  const partyForeign = sitting(ids.otherRestaurant, ids.foreignTable);

  const orderService = () => new OrderService(new DrizzleOrderRepository(db));
  const customerOrders = () =>
    new CustomerOrderQueryService(new DrizzleCustomerOrderQueryRepository(db));
  const staffTables = () => new DrizzleStaffTableRepository(db);

  let orderA = "";
  let orderB = "";
  /** An order with no sitting at all, the way a waiter's order is written. */
  let orderWithoutSitting = "";

  before(async () => {
    client = postgres((target as { url: string }).url, { max: 5, prepare: false });
    db = drizzle(client, { schema: { ...schema, ...relations } });

    const [{ supabase }] = await client<{ supabase: boolean }[]>`
      select exists (select 1 from pg_extension where extname = 'supabase_vault') as supabase
    `;
    assert.equal(supabase, false, "refusing to run against a Supabase project");

    const [{ database }] = await client<{ database: string }[]>`
      select current_database() as database
    `;
    // Asked of the server rather than parsed out of the URL, so a connection
    // string that lies about where it points cannot get past the guard.
    assert.equal(
      database,
      DISPOSABLE_DATABASE,
      "refusing to truncate a database that is not the disposable one",
    );

    await seed();
  });

  after(async () => {
    if (client) await client.end({ timeout: 5 });
  });

  async function seed(): Promise<void> {
    const tables = await client<{ name: string }[]>`
      select quote_ident(table_name) as name
      from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
    `;
    await client.unsafe(
      `truncate table ${tables.map((t) => t.name).join(", ")} restart identity cascade`,
    );

    for (const [id, slug] of [
      [ids.restaurant, "ownership-e2e"],
      [ids.otherRestaurant, "ownership-e2e-other"],
    ]) {
      await db.insert(restaurants).values({
        id, name: `Ownership ${slug}`, slug, currency: "TRY",
        timezone: "Europe/Istanbul", defaultLocale: "tr", isActive: true,
      });
      await db.insert(restaurantSettings).values({
        restaurantId: id, menuEnabled: true, orderingEnabled: true,
      });
    }

    await db.insert(staffProfiles).values({
      id: ids.waiter, restaurantId: ids.restaurant, name: "Ownership Garson",
      role: "WAITER", isActive: true,
    });

    await db.insert(categories).values([
      { id: ids.category, restaurantId: ids.restaurant, name: "Çorbalar", slug: "corbalar",
        sortOrder: 1, isActive: true },
      { id: ids.foreignCategory, restaurantId: ids.otherRestaurant, name: "Çorbalar",
        slug: "corbalar-b", sortOrder: 1, isActive: true },
    ]);
    await db.insert(products).values([
      { id: ids.soup, restaurantId: ids.restaurant, categoryId: ids.category,
        name: "Mercimek Çorbası", slug: "mercimek", price: "120.00",
        isActive: true, isAvailable: true },
      { id: ids.foreignSoup, restaurantId: ids.otherRestaurant, categoryId: ids.foreignCategory,
        name: "Mercimek Çorbası", slug: "mercimek-b", price: "120.00",
        isActive: true, isAvailable: true },
    ]);
    await db.insert(restaurantTables).values([
      { id: ids.table, restaurantId: ids.restaurant, name: "Masa 1", tableNumber: 1, seats: 4,
        isActive: true, qrTokenHash: generateQrToken(QR_PEPPER).tokenHash },
      { id: ids.otherTable, restaurantId: ids.restaurant, name: "Masa 2", tableNumber: 2, seats: 2,
        isActive: true, qrTokenHash: generateQrToken(QR_PEPPER).tokenHash },
      { id: ids.foreignTable, restaurantId: ids.otherRestaurant, name: "Masa 1", tableNumber: 1,
        seats: 4, isActive: true, qrTokenHash: generateQrToken(QR_PEPPER).tokenHash },
    ]);
  }

  /** Places a real order the way the customer route does. */
  async function order(
    restaurantId: string,
    tableId: string,
    productId: string,
    sessionNonce: string,
    quantity: number,
  ): Promise<string> {
    const result = await orderService().createOrder({
      restaurantId,
      tableId,
      tableAccessVersion: 1,
      sessionNonce,
      idempotencyKey: randomUUID(),
      items: [{ productId, quantity }],
    });
    return result.order.id;
  }

  const idsOf = (list: readonly { readonly id: string }[]) => list.map((o) => o.id).sort();

  test("SETUP — two parties order at the same table, and one order has no sitting", async () => {
    orderA = await order(ids.restaurant, ids.table, ids.soup, partyA, 1);
    // The first party never settles and leaves. The second party scans the
    // same QR code and gets a session of their own.
    orderB = await order(ids.restaurant, ids.table, ids.soup, partyB, 2);

    // A third real order at the same table whose sitting is then cleared: what
    // a staff-created order and every row written before migration 0017 look
    // like to this query — an open order that belongs to no sitting.
    orderWithoutSitting = await order(ids.restaurant, ids.table, ids.soup, partyA, 3);
    await db
      .update(orders)
      .set({ customerSessionNonce: null })
      .where(eq(orders.id, orderWithoutSitting));

    assert.notEqual(partyA, partyB, "each scan must mint its own sitting");
    assert.equal(partyA.length, 22, "the nonce is 16 random bytes, base64url");

    const rows = await db
      .select({ id: orders.id, nonce: orders.customerSessionNonce })
      .from(orders)
      .where(eq(orders.restaurantId, ids.restaurant));
    assert.equal(rows.length, 3);
    // The column is actually written — the half this fix existed to add.
    assert.equal(rows.find((r) => r.id === orderA)?.nonce, partyA);
    assert.equal(rows.find((r) => r.id === orderB)?.nonce, partyB);
    assert.equal(rows.find((r) => r.id === orderWithoutSitting)?.nonce, null);
  });

  test("OWNERSHIP — each party sees its own order and nothing else at that table", async () => {
    const seenByA = await customerOrders().getActiveOrders(ids.restaurant, ids.table, partyA);
    const seenByB = await customerOrders().getActiveOrders(ids.restaurant, ids.table, partyB);

    assert.deepEqual(idsOf(seenByA), [orderA]);
    assert.deepEqual(idsOf(seenByB), [orderB]);
    // The regression in one line: the party who sat down second must not be
    // shown the unsettled order the first party walked out on.
    assert.ok(!idsOf(seenByB).includes(orderA), "a later sitting inherited an earlier one's order");
    assert.ok(!idsOf(seenByA).includes(orderB));

    // And the money that came back is the party's own, not the table's total.
    assert.equal(seenByA[0]?.amounts.total, "120.00");
    assert.equal(seenByB[0]?.amounts.total, "240.00");
    // Line items follow the same boundary; nothing of the other party's order
    // arrives attached to this one.
    assert.equal(seenByA[0]?.items.length, 1);
    assert.equal(seenByA[0]?.items[0]?.quantity, 1);
    assert.equal(seenByB[0]?.items[0]?.quantity, 2);
  });

  test("NULL — an order that belongs to no sitting is shown to no guest", async () => {
    // `customer_session_nonce = $1` is null for these rows, and null is not
    // true, so they drop out. This is the fail-closed direction: a staff order
    // and every row written before the column existed stay invisible.
    for (const nonce of [partyA, partyB, partyOtherTable]) {
      const seen = await customerOrders().getActiveOrders(ids.restaurant, ids.table, nonce);
      assert.ok(
        !idsOf(seen).includes(orderWithoutSitting),
        "an order with no sitting was handed to a guest",
      );
    }
  });

  test("WRONG NONCE — a guessed sitting returns nothing at all", async () => {
    const stranger = sitting(ids.restaurant, ids.table);
    const seen = await customerOrders().getActiveOrders(ids.restaurant, ids.table, stranger);
    assert.deepEqual(seen, [], "an unknown sitting must see an empty list");

    // Not merely empty: nothing leaks through the shape of the answer either.
    // A near-miss on the real nonce is as empty as anything else.
    for (const near of [
      partyA.slice(0, -1),
      `${partyA.slice(0, -1)}${partyA.endsWith("A") ? "B" : "A"}`,
      partyA.toUpperCase() === partyA ? partyA.toLowerCase() : partyA.toUpperCase(),
      "%",
      "' or '1'='1",
    ]) {
      if (near === partyA) continue;
      assert.deepEqual(
        await customerOrders().getActiveOrders(ids.restaurant, ids.table, near),
        [],
        `a near-miss sitting (${JSON.stringify(near)}) returned rows`,
      );
    }

    // An empty sitting is refused before a query is issued rather than being
    // allowed to widen the predicate back to the whole table.
    await assert.rejects(
      () => customerOrders().getActiveOrders(ids.restaurant, ids.table, ""),
      (error: unknown) => error instanceof DomainError && error.code === "INVALID_TABLE_TOKEN",
    );
  });

  test("CROSS-TABLE — the same nonce at two tables stays on its own table", async () => {
    // Written with partyA's *exact* nonce string. Sixteen random bytes will not
    // collide in the wild, so forcing the collision is the only way to show the
    // table dimension is what separates these rows, rather than the nonce
    // happening to be unique.
    const collision = await order(ids.restaurant, ids.otherTable, ids.soup, partyA, 1);
    // A genuine second sitting at table 2, so the nonce still has work to do
    // inside the table as well as across it.
    const orderAtOtherTable = await order(
      ids.restaurant, ids.otherTable, ids.soup, partyOtherTable, 1,
    );

    // One nonce, two tables: each table hands back only the order written
    // against it. The colliding order does not follow the nonce to table 1,
    // and partyA's own order does not follow it to table 2.
    assert.deepEqual(
      idsOf(await customerOrders().getActiveOrders(ids.restaurant, ids.table, partyA)),
      [orderA],
    );
    assert.deepEqual(
      idsOf(await customerOrders().getActiveOrders(ids.restaurant, ids.otherTable, partyA)),
      [collision],
    );

    // And the table predicate still holds for a nonce that is genuinely table
    // 2's: their own order there, nothing at table 1, and nothing of the
    // colliding order even though it sits at the same table.
    assert.deepEqual(
      idsOf(await customerOrders().getActiveOrders(ids.restaurant, ids.otherTable, partyOtherTable)),
      [orderAtOtherTable],
    );
    assert.deepEqual(
      await customerOrders().getActiveOrders(ids.restaurant, ids.table, partyOtherTable),
      [],
    );
  });

  test("CROSS-TENANT — the same nonce in another restaurant cannot reach across", async () => {
    // Again partyA's exact nonce, this time in the other tenant: an attacker
    // who somehow learned a nonce still has to get past `restaurant_id`.
    const foreignCollision = await order(
      ids.otherRestaurant, ids.foreignTable, ids.foreignSoup, partyA, 1,
    );
    const foreignOrder = await order(
      ids.otherRestaurant, ids.foreignTable, ids.foreignSoup, partyForeign, 1,
    );

    // The colliding order is visible only where it was written, and tenant A's
    // guest is unchanged by its existence.
    assert.deepEqual(
      idsOf(
        await customerOrders().getActiveOrders(ids.otherRestaurant, ids.foreignTable, partyA),
      ),
      [foreignCollision],
    );
    assert.deepEqual(
      idsOf(await customerOrders().getActiveOrders(ids.restaurant, ids.table, partyA)),
      [orderA],
      "an identical nonce in another tenant leaked into this one",
    );
    // Right nonce, right table id, wrong tenant — and the reverse. The tenant
    // predicate is not something the nonce can talk its way past.
    assert.deepEqual(
      await customerOrders().getActiveOrders(ids.restaurant, ids.foreignTable, partyA),
      [],
    );
    assert.deepEqual(
      await customerOrders().getActiveOrders(ids.otherRestaurant, ids.table, partyA),
      [],
    );

    // The foreign tenant's own sitting is unaffected by the collision.
    assert.deepEqual(
      idsOf(
        await customerOrders().getActiveOrders(
          ids.otherRestaurant, ids.foreignTable, partyForeign,
        ),
      ),
      [foreignOrder],
    );
    assert.deepEqual(
      await customerOrders().getActiveOrders(ids.restaurant, ids.foreignTable, partyForeign),
      [],
    );
  });

  test("STAFF — the floor still sees every open order at the table", async () => {
    // The sitting narrows the *guest's* view only. A waiter who could not see
    // the order a guest just placed could not serve it, and a table showing
    // one of its three open orders would be worse than the bug being fixed.
    const tables = await staffTables().listTables(ids.restaurant);
    const table1 = tables.find((t) => t.id === ids.table);
    assert.ok(table1, "the staff floor lost the table");
    assert.deepEqual(
      idsOf(table1.activeOrders),
      [orderA, orderB, orderWithoutSitting].sort(),
      "staff visibility must not be narrowed by the customer ownership column",
    );

    // Tenant scoping on the staff side is unchanged too.
    assert.ok(
      !tables.some((t) => t.id === ids.foreignTable),
      "the staff floor crossed a tenant boundary",
    );
  });

  test("IDEMPOTENCY — a second sitting cannot inherit the first one's result", async () => {
    const sharedKey = randomUUID();
    const items = [{ productId: ids.soup, quantity: 1 }];
    const command = {
      restaurantId: ids.restaurant,
      tableId: ids.table,
      tableAccessVersion: 1,
      idempotencyKey: sharedKey,
      items,
    };

    const first = await orderService().createOrder({ ...command, sessionNonce: partyA });
    // The same key from the same sitting is still one order, replayed.
    const replay = await orderService().createOrder({ ...command, sessionNonce: partyA });
    assert.equal(replay.order.id, first.order.id);
    assert.equal(replay.replayed, true);

    // The same key from a different sitting is a conflict. Without the sitting
    // in the request fingerprint this returned the first party's order number
    // and total to the second party as a successful replay.
    await assert.rejects(
      () => orderService().createOrder({ ...command, sessionNonce: partyB }),
      (error: unknown) => error instanceof DomainError && error.code === "IDEMPOTENCY_CONFLICT",
    );

    const stored = await db
      .select({ id: orders.id, nonce: orders.customerSessionNonce })
      .from(orders)
      .where(eq(orders.id, first.order.id));
    assert.equal(stored[0]?.nonce, partyA, "the replayed order still belongs to the first sitting");
    assert.deepEqual(
      idsOf(await customerOrders().getActiveOrders(ids.restaurant, ids.table, partyB)),
      [orderB],
      "the conflicting request left nothing of the first sitting visible to the second",
    );
  });
});
