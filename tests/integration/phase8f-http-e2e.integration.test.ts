import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";

import postgres from "postgres";

import { readSupabaseIntegrationEnvironment } from "./supabase-test-environment";
import { resetFixtureRateLimits } from "./rate-limit-reset";

/**
 * The demo table picker and the kitchen's undo, over real HTTP.
 *
 * These two features meet in one place: a guest opened from the picker orders
 * at the table the operator chose, and the kitchen then corrects its own steps
 * on that order. Both are driven through the same endpoints the browser uses,
 * against the live prototype data, so nothing here is a stand-in.
 */

const CONFIRMATION = "I_UNDERSTAND_THIS_MUTATES_A_DISPOSABLE_TEST_FIXTURE";
const STAFF = {
  waiter: "garson@sehirlokantasi.test",
  kitchen: "mutfak@sehirlokantasi.test",
  cashier: "kasa@sehirlokantasi.test",
} as const;

function readTarget(): { url: URL } | { reason: string } {
  if (process.env.RUN_PHASE8F_HTTP_E2E !== "true") {
    return { reason: "Phase 8F HTTP E2E is opt-in; set RUN_PHASE8F_HTTP_E2E=true." };
  }
  if (process.env.PHASE8F_HTTP_E2E_CONFIRM !== CONFIRMATION) {
    return { reason: `Set PHASE8F_HTTP_E2E_CONFIRM=${CONFIRMATION}.` };
  }
  const raw = process.env.PHASE8F_HTTP_E2E_BASE_URL?.trim();
  if (!raw) return { reason: "PHASE8F_HTTP_E2E_BASE_URL is required." };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { reason: "PHASE8F_HTTP_E2E_BASE_URL must be an absolute URL." };
  }
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    return { reason: "Phase 8F HTTP E2E only targets a loopback server." };
  }
  if (!process.env.PHASE8F_STAFF_PASSWORDS) {
    return { reason: "PHASE8F_STAFF_PASSWORDS (JSON) is required." };
  }
  return { url };
}

const target = readTarget();
const db = readSupabaseIntegrationEnvironment({ requireDatabaseUrl: true });

if ("reason" in target || !db.ready) {
  test(
    "Phase 8F HTTP E2E",
    { skip: "reason" in target ? target.reason : (db as { reason: string }).reason },
    () => undefined,
  );
} else {
  const baseUrl = target.url;
  const environment = db.environment;
  const passwords: Record<string, string> = JSON.parse(process.env.PHASE8F_STAFF_PASSWORDS!);
  const sql = postgres(environment.databaseUrl!, { max: 3, prepare: false, onnotice: () => {} });
  let assertions = 0;
  function check(condition: boolean, message: string): void {
    assertions += 1;
    assert.ok(condition, message);
  }

  class Session {
    private readonly cookies = new Map<string, string>();
    private header(): string {
      return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
    }
    private absorb(response: Response): void {
      for (const raw of response.headers.getSetCookie()) {
        const [pair] = raw.split(";");
        const index = pair.indexOf("=");
        if (index <= 0) continue;
        const name = pair.slice(0, index).trim();
        const value = pair.slice(index + 1).trim();
        if (value === "" || /expires=Thu, 01 Jan 1970/i.test(raw)) this.cookies.delete(name);
        else this.cookies.set(name, value);
      }
    }
    async request(
      method: string,
      path: string,
      body?: unknown,
      extra: Record<string, string> = {},
    ): Promise<{ status: number; body: Record<string, unknown>; text: string; location: string | null }> {
      const headers: Record<string, string> = {
        Cookie: this.header(),
        Origin: baseUrl.origin,
        ...extra,
      };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      const response = await fetch(new URL(path, baseUrl), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "manual",
      });
      this.absorb(response);
      const text = await response.text();
      let parsed: Record<string, unknown> = {};
      try {
        parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      } catch {
        parsed = {};
      }
      return {
        status: response.status,
        body: parsed,
        text,
        location: response.headers.get("location"),
      };
    }
  }

  function data<T = Record<string, unknown>>(body: Record<string, unknown>): T {
    return body.data as T;
  }

  const state = { orderId: "", tableId: "", tableName: "", itemIds: [] as string[] };
  let restaurantId = "";

  async function login(role: keyof typeof STAFF): Promise<Session> {
    await resetFixtureRateLimits(sql, Object.values(STAFF));
    const session = new Session();
    const result = await session.request("POST", "/api/staff/login", {
      identifier: STAFF[role],
      password: passwords[role],
    });
    if (result.status !== 200) throw new Error(`${role} login failed with ${result.status}`);
    return session;
  }

  describe("Phase 8F demo picker and kitchen undo over HTTP", { concurrency: false }, () => {
    before(async () => {
      const [restaurant] = await sql`
        select id from restaurants where slug = 'tarihi-sehir-lokantasi'`;
      restaurantId = String(restaurant.id);
    });

    after(async () => {
      // The demo data is permanent by design; only the order this suite placed
      // is removed, so the prototype is left as it was found.
      try {
        if (state.orderId) {
          for (const table of ["order_events", "outbox_events", "order_items", "orders"]) {
            const column = table === "orders" ? "id" : "order_id";
            await sql.unsafe(`delete from ${table} where ${column} = $1::uuid`, [state.orderId]);
          }
          await sql`
            update restaurant_tables set current_status = 'AVAILABLE'
            where id = ${state.tableId}`;
        }
        await resetFixtureRateLimits(sql, Object.values(STAFF));
      } catch (error) {
        console.error("PHASE8F HTTP CLEANUP:", (error as Error).message);
      }
      await sql.end({ timeout: 5 });
      console.log(`phase8f http assertions executed: ${assertions}`);
    });

    // ------------------------------------------------------------ the picker

    test("the picker lists exactly the restaurant's active tables", async () => {
      const guest = new Session();
      const listed = await guest.request("GET", "/api/demo/tables");
      check(listed.status === 200, `the list loads (got ${listed.status})`);
      const payload = data<{
        restaurant: { name: string };
        tables: { id: string; name: string; tableNumber: number; status: string }[];
      }>(listed.body);

      const [expected] = await sql`
        select count(*)::int as total from restaurant_tables
        where restaurant_id = ${restaurantId} and is_active = true
          and qr_token_revoked_at is null`;
      check(
        payload.tables.length === Number(expected.total),
        `every active table is offered (${payload.tables.length} vs ${expected.total})`,
      );
      check(payload.tables.length > 0, "and there is at least one");
      check(
        payload.tables.every((table) => /^Masa \d+$/.test(table.name)),
        "each entry is a real table row",
      );
      check(
        !listed.text.includes("qr_token") && !/[A-Za-z0-9_-]{43}/.test(listed.text),
        "and the list carries no QR token",
      );

      // Nothing inactive leaks in.
      const inactive = await sql`
        select count(*)::int as total from restaurant_tables
        where restaurant_id = ${restaurantId} and (is_active = false or qr_token_revoked_at is not null)`;
      const listedIds = new Set(payload.tables.map((table) => table.id));
      const hidden = await sql`
        select id from restaurant_tables
        where restaurant_id = ${restaurantId} and (is_active = false or qr_token_revoked_at is not null)`;
      check(
        hidden.every((row) => !listedIds.has(String(row.id))),
        `no inactive table is offered (${inactive[0].total} hidden)`,
      );
    });

    test("choosing a table opens that table's menu, and only that table's", async () => {
      const guest = new Session();
      const listed = await guest.request("GET", "/api/demo/tables");
      const tables = data<{ tables: { id: string; name: string; tableNumber: number }[] }>(
        listed.body,
      ).tables;

      for (const wanted of [1, 4, 12]) {
        const table = tables.find((row) => row.tableNumber === wanted);
        check(Boolean(table), `Masa ${wanted} is offered`);
        if (!table) continue;

        const session = new Session();
        const issued = await session.request("POST", "/api/demo/table-menu", {
          tableId: table.id,
        });
        check(issued.status === 200, `Masa ${wanted} issues a menu path (got ${issued.status})`);
        const path = data<{ path: string }>(issued.body).path;
        check(/^\/menu\/[A-Za-z0-9_-]{43}$/.test(path), `and it is a real QR path`);

        // Walking that path is the ordinary gate: it must land on the menu and
        // resolve to the table that was chosen.
        const page = await session.request("GET", path);
        check(page.status === 200, `Masa ${wanted} menu renders (got ${page.status})`);
        const menu = await session.request("GET", "/api/menu");
        const menuTable = data<{ table: { name: string; number: number } }>(menu.body).table;
        check(
          menuTable.number === wanted,
          `the session resolves to Masa ${wanted} (got ${menuTable.number})`,
        );
      }
    });

    test("an invalid or foreign table is refused, and a bad QR still fails", async () => {
      const guest = new Session();
      const missing = await guest.request("POST", "/api/demo/table-menu", {
        tableId: randomUUID(),
      });
      check(missing.status === 404, `an unknown table is refused (got ${missing.status})`);

      const malformed = await guest.request("POST", "/api/demo/table-menu", { tableId: "abc" });
      check(malformed.status === 400, `a malformed id is refused (got ${malformed.status})`);

      const spoof = await guest.request("POST", "/api/demo/table-menu", {
        tableId: randomUUID(),
        restaurantId: randomUUID(),
      });
      check(spoof.status === 400, `a restaurantId in the body is refused (got ${spoof.status})`);

      // The QR gate itself is untouched: a random token still fails closed.
      const random = await guest.request("GET", `/menu/${randomBytes(32).toString("base64url")}`);
      check(
        random.status === 307 || random.status === 302 || random.status === 308,
        `a random token redirects (got ${random.status})`,
      );
      check(
        (random.location ?? "").includes("/menu/invalid"),
        `and lands on the invalid-QR screen (got ${random.location})`,
      );
    });

    // ------------------------------------------- order from the chosen table

    test("an order placed from the picker belongs to the chosen table", async () => {
      const guest = new Session();
      const listed = await guest.request("GET", "/api/demo/tables");
      const tables = data<{ tables: { id: string; name: string; tableNumber: number }[] }>(
        listed.body,
      ).tables;
      const table = tables.find((row) => row.tableNumber === 4)!;
      state.tableId = table.id;
      state.tableName = table.name;

      const issued = await guest.request("POST", "/api/demo/table-menu", { tableId: table.id });
      await guest.request("GET", data<{ path: string }>(issued.body).path);

      const menu = await guest.request("GET", "/api/menu");
      const categories = data<{
        categories: { products: { id: string; name: string }[] }[];
      }>(menu.body).categories;
      const products = categories.flatMap((category) => category.products ?? []).slice(0, 2);
      check(products.length === 2, "the menu offers products to order");

      const placed = await guest.request(
        "POST",
        "/api/orders",
        { items: products.map((product) => ({ productId: product.id, quantity: 2 })) },
        { "Idempotency-Key": randomUUID() },
      );
      check(placed.status === 201, `the order is placed (got ${placed.status})`);
      state.orderId = data<{ orderId: string }>(placed.body).orderId;

      const [row] = await sql`
        select o.table_id, t.table_number from orders o
        join restaurant_tables t on t.id = o.table_id where o.id = ${state.orderId}`;
      check(
        String(row.table_id) === table.id && Number(row.table_number) === 4,
        `the order is attached to Masa 4 (got Masa ${row.table_number})`,
      );
    });

    test("the waiter and the kitchen both see it on that table", async () => {
      const waiter = await login("waiter");
      const confirmed = await waiter.request("PATCH", `/api/orders/${state.orderId}/status`, {
        status: "CONFIRMED",
      });
      check(confirmed.status === 200, `the waiter confirms it (got ${confirmed.status})`);

      const waiterBoard = await waiter.request("GET", "/api/staff/orders");
      const mine = data<{ orders: { id: string; table: { name: string } }[] }>(
        waiterBoard.body,
      ).orders.find((order) => order.id === state.orderId);
      check(mine?.table.name === state.tableName, `the waiter sees it on ${state.tableName}`);

      const kitchen = await login("kitchen");
      const kitchenBoard = await kitchen.request("GET", "/api/staff/orders");
      const theirs = data<{ orders: { id: string; items: { id: string }[] }[] }>(
        kitchenBoard.body,
      ).orders.find((order) => order.id === state.orderId);
      check(Boolean(theirs), "the kitchen sees the same order");
      state.itemIds = (theirs?.items ?? []).map((item) => item.id);
      check(state.itemIds.length === 2, "with both of its lines");
    });

    // ------------------------------------------------------------ the undo

    test("the kitchen can undo a step it took by mistake", async () => {
      const kitchen = await login("kitchen");
      const [itemId] = state.itemIds;

      const started = await kitchen.request("PATCH", `/api/order-items/${itemId}/status`, {
        status: "PREPARING",
      });
      check(started.status === 200, `the line is started (got ${started.status})`);

      const undone = await kitchen.request("PATCH", `/api/order-items/${itemId}/status`, {
        status: "PENDING",
        reasonCode: "MARKED_BY_MISTAKE",
      });
      check(undone.status === 200, `and put back (got ${undone.status})`);
      check(
        data<{ reverted: boolean; status: string }>(undone.body).reverted === true,
        "the response says it was an undo",
      );

      await kitchen.request("PATCH", `/api/order-items/${itemId}/status`, { status: "PREPARING" });
      // A line may only be plated while the order itself is in the kitchen.
      await kitchen.request("PATCH", `/api/orders/${state.orderId}/status`, {
        status: "PREPARING",
      });
      const ready = await kitchen.request("PATCH", `/api/order-items/${itemId}/status`, {
        status: "READY",
      });
      check(ready.status === 200, `the line reaches ready (got ${ready.status})`);

      const backToPass = await kitchen.request("PATCH", `/api/order-items/${itemId}/status`, {
        status: "PREPARING",
        reasonCode: "UNDERCOOKED",
      });
      check(backToPass.status === 200, `ready can be undone too (got ${backToPass.status})`);

      const [row] = await sql`select status::text as status from order_items where id = ${itemId}`;
      check(String(row.status) === "PREPARING", "and the line really moved back");
    });

    test("the floor cannot undo the kitchen, and the kitchen cannot unserve", async () => {
      const waiter = await login("waiter");
      const [itemId] = state.itemIds;
      const byWaiter = await waiter.request("PATCH", `/api/order-items/${itemId}/status`, {
        status: "PENDING",
      });
      check(byWaiter.status === 403, `a waiter is refused (got ${byWaiter.status})`);

      // Serve the line properly, then try to pull it back.
      const kitchen = await login("kitchen");
      await kitchen.request("PATCH", `/api/order-items/${itemId}/status`, { status: "READY" });
      await kitchen.request("PATCH", `/api/orders/${state.orderId}/status`, { status: "READY" });
      const waiter2 = await login("waiter");
      const served = await waiter2.request("PATCH", `/api/order-items/${itemId}/status`, {
        status: "SERVED",
      });
      check(served.status === 200, `the waiter serves it (got ${served.status})`);

      const kitchen2 = await login("kitchen");
      const unserve = await kitchen2.request("PATCH", `/api/order-items/${itemId}/status`, {
        status: "READY",
      });
      check(unserve.status === 409, `a served line cannot be pulled back (got ${unserve.status})`);

      const [row] = await sql`select status::text as status from order_items where id = ${itemId}`;
      check(String(row.status) === "SERVED", "the served line stands");
    });

    test("the undo is on the record, and the money is not", async () => {
      const audits = await sql`
        select count(*)::int as total from audit_logs
        where restaurant_id = ${restaurantId} and action = 'order_item.status_reverted'`;
      check(Number(audits[0].total) >= 2, `the undos are audited (got ${audits[0].total})`);

      const [order] = await sql`
        select total, subtotal from orders where id = ${state.orderId}`;
      const [items] = await sql`
        select coalesce(sum(line_total), 0)::text as total from order_items
        where order_id = ${state.orderId} and voided_at is null and cancelled_at is null`;
      check(
        String(order.total) === String(items.total),
        `the order total still matches its lines (${order.total} vs ${items.total})`,
      );
      const [payments] = await sql`
        select count(*)::int as total from payments where order_id = ${state.orderId}`;
      check(Number(payments.total) === 0, "and no payment was touched");
    });
  });
}
