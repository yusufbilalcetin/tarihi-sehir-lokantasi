import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";

import { loadEnvConfig } from "@next/env";
import postgres from "postgres";

import { resetFixtureRateLimits } from "./rate-limit-reset";

loadEnvConfig(process.cwd());

/**
 * Phase 9B — one order from the waiter's pad to the till, over real HTTP.
 *
 * Every step is driven through the endpoints the panels themselves call, and
 * each one is checked twice: once in the response, once in the database. The
 * negative cases sit next to the happy path deliberately — a lifecycle that
 * only works when nobody misuses it is not a working lifecycle.
 *
 *   RUN_PHASE9B_HTTP_E2E=true
 *   PHASE9B_HTTP_E2E_CONFIRM=I_UNDERSTAND_THIS_MUTATES_A_DISPOSABLE_TEST_FIXTURE
 *   PHASE9B_HTTP_E2E_BASE_URL=http://localhost:3100
 *   PHASE9B_STAFF_ACCOUNTS={"waiter":{…},"kitchen":{…},"cashier":{…},"manager":{…}}
 *
 * The suite creates one order, one cash register and one shift, and removes all
 * three again. Nothing else in the restaurant is touched.
 */

const CONFIRMATION = "I_UNDERSTAND_THIS_MUTATES_A_DISPOSABLE_TEST_FIXTURE";

type Role = "waiter" | "kitchen" | "cashier" | "manager";

interface Account {
  readonly email: string;
  readonly password: string;
}

function readTarget(): { url: URL; accounts: Record<Role, Account> } | { reason: string } {
  if (process.env.RUN_PHASE9B_HTTP_E2E !== "true") {
    return { reason: "Phase 9B HTTP E2E is opt-in; set RUN_PHASE9B_HTTP_E2E=true." };
  }
  if (process.env.PHASE9B_HTTP_E2E_CONFIRM !== CONFIRMATION) {
    return { reason: `Set PHASE9B_HTTP_E2E_CONFIRM=${CONFIRMATION}.` };
  }
  const raw = process.env.PHASE9B_HTTP_E2E_BASE_URL?.trim();
  if (!raw) return { reason: "PHASE9B_HTTP_E2E_BASE_URL is required." };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { reason: "PHASE9B_HTTP_E2E_BASE_URL must be an absolute URL." };
  }
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    return { reason: "Phase 9B HTTP E2E only targets a loopback server." };
  }
  const json = process.env.PHASE9B_STAFF_ACCOUNTS;
  if (!json) return { reason: "PHASE9B_STAFF_ACCOUNTS (JSON) is required." };
  let accounts: Record<Role, Account>;
  try {
    accounts = JSON.parse(json) as Record<Role, Account>;
  } catch {
    return { reason: "PHASE9B_STAFF_ACCOUNTS must be valid JSON." };
  }
  const missing = (["waiter", "kitchen", "cashier", "manager"] as Role[]).filter(
    (role) => !accounts[role]?.email || !accounts[role]?.password,
  );
  if (missing.length > 0) {
    return { reason: `PHASE9B_STAFF_ACCOUNTS is missing: ${missing.join(", ")}.` };
  }
  return { url, accounts };
}

const databaseUrl =
  process.env.PHASE9B_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
const target = readTarget();

if ("reason" in target || !databaseUrl) {
  test(
    "Phase 9B order lifecycle HTTP E2E",
    {
      skip:
        "reason" in target
          ? target.reason
          : "PHASE9B_DATABASE_URL or DATABASE_URL is required for the database assertions.",
    },
    () => undefined,
  );
} else {
  const baseUrl = target.url;
  const accounts = target.accounts;
  const identifiers = Object.values(accounts).map((account) => account.email);
  const sql = postgres(databaseUrl, { max: 3, prepare: false, onnotice: () => {} });

  let assertions = 0;
  function check(condition: boolean, message: string): void {
    assertions += 1;
    assert.ok(condition, message);
  }

  interface Reply {
    readonly status: number;
    readonly data: Record<string, unknown> | undefined;
    readonly code: string | undefined;
  }

  class Session {
    private readonly cookies = new Map<string, string>();

    private header(): string {
      return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
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

    async signIn(role: Role): Promise<number> {
      // 5 attempts per 15 minutes, per IP and per identifier. Only the keys
      // these sign-ins produce are cleared; the policy itself is untouched.
      await resetFixtureRateLimits(sql, identifiers);
      const response = await fetch(new URL("/api/staff/login", baseUrl), {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: baseUrl.origin },
        body: JSON.stringify({
          identifier: accounts[role].email,
          password: accounts[role].password,
        }),
        redirect: "manual",
      });
      this.absorb(response);
      return response.status;
    }

    async call(
      method: string,
      path: string,
      body?: unknown,
      extra: Record<string, string> = {},
    ): Promise<Reply> {
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
      const error = parsed.error as { code?: string } | undefined;
      return {
        status: response.status,
        data: parsed.data as Record<string, unknown> | undefined,
        code: error?.code,
      };
    }
  }

  const waiter = new Session();
  const kitchen = new Session();
  const cashier = new Session();
  const manager = new Session();
  const anonymous = new Session();

  const state = {
    tableId: "",
    orderId: "",
    itemIds: [] as string[],
    cancelledItemId: "",
    registerId: "",
    shiftId: "",
    foreignItemId: "",
    foreignOrderId: "",
  };

  describe("Phase 9B order lifecycle over HTTP", { concurrency: false }, () => {
    before(async () => {
      for (const [role, session] of [
        ["waiter", waiter],
        ["kitchen", kitchen],
        ["cashier", cashier],
        ["manager", manager],
      ] as const) {
        const status = await session.signIn(role);
        assert.equal(status, 200, `${role} must be able to sign in (got ${status})`);
      }
    });

    after(async () => {
      // Each step stands alone: one failure must not strand the rows the later
      // steps would have removed.
      const step = async (what: string, run: () => Promise<unknown>) => {
        try {
          await run();
        } catch (error) {
          console.error(`PHASE9B CLEANUP (${what}):`, (error as Error).message);
        }
      };
      // Only a shift this suite opened is closed again.
      if (state.shiftId && state.registerId) {
        await step("close shift", () =>
          cashier.call("POST", `/api/cashier/shifts/${state.shiftId}/close`, {
            countedCash: "0.00",
            note: "phase9b cleanup",
          }),
        );
      }
      if (state.orderId) {
        // Reverse foreign-key order; only this suite's own order is removed.
        const id = state.orderId;
        await step("payment refunds", () => sql`delete from payment_refunds where order_id = ${id}`);
        await step("payments", () => sql`delete from payments where order_id = ${id}`);
        await step("check items", () => sql`delete from order_check_items where check_id in (
          select id from order_checks where order_id = ${id})`);
        await step("checks", () => sql`delete from order_checks where order_id = ${id}`);
        await step("events", () => sql`delete from order_events where order_id = ${id}`);
        await step("outbox", () => sql`delete from outbox_events where aggregate_id = ${id}`);
        await step("tickets", () => sql`delete from kitchen_tickets where order_id = ${id}`);
        await step("lines", () => sql`delete from order_items where order_id = ${id}`);
        await step("order", () => sql`delete from orders where id = ${id}`);
      }
      if (state.shiftId && state.registerId) {
        await step("drawer movements", () =>
          sql`delete from cash_drawer_movements where cashier_shift_id = ${state.shiftId}`);
        await step("shift", () => sql`delete from cashier_shifts where id = ${state.shiftId}`);
      }
      if (state.registerId) {
        await step("register", () => sql`delete from cash_registers where id = ${state.registerId}`);
      }
      if (state.tableId) {
        await step("table", () => sql`update restaurant_tables set current_status = 'AVAILABLE'
          where id = ${state.tableId} and current_status <> 'AVAILABLE'`);
      }
      await step("rate limits", () => resetFixtureRateLimits(sql, identifiers));
      await sql.end({ timeout: 5 });
      console.log(`phase9b http assertions executed: ${assertions}`);
    });

    // ------------------------------------------------------- authentication

    test("an unauthenticated caller is refused with 401, never with a silent success", async () => {
      const cases: [string, string, unknown][] = [
        ["GET", "/api/staff/orders", undefined],
        ["POST", "/api/staff/orders", { tableId: randomUUID(), items: [] }],
        ["PATCH", `/api/orders/${randomUUID()}/status`, { status: "READY" }],
        ["POST", "/api/payments", { orderId: randomUUID(), method: "CASH" }],
      ];
      for (const [method, path, body] of cases) {
        const reply = await anonymous.call(method, path, body, {
          "Idempotency-Key": randomUUID(),
        });
        check(reply.status === 401, `${method} ${path} answers 401 (got ${reply.status})`);
        check(
          reply.code === "AUTHENTICATION_REQUIRED",
          `${method} ${path} names the reason (got ${reply.code})`,
        );
      }
    });

    test("an authenticated caller in the wrong role is refused with 403, not 401", async () => {
      // The distinction is the point: 401 tells the panel to sign in again,
      // which is wrong advice for someone who is already signed in.
      const cases: [Session, string, string, string, unknown][] = [
        [cashier, "waiter's order pad", "POST", "/api/staff/orders", {
          tableId: randomUUID(),
          items: [{ productId: randomUUID(), quantity: 1 }],
        }],
        [cashier, "staff administration", "GET", "/api/admin/staff", undefined],
        [kitchen, "the till", "POST", "/api/payments", {
          orderId: randomUUID(),
          method: "CASH",
        }],
        [waiter, "staff administration", "GET", "/api/admin/staff", undefined],
      ];
      for (const [session, what, method, path, body] of cases) {
        const reply = await session.call(method, path, body, {
          "Idempotency-Key": randomUUID(),
        });
        check(reply.status === 403, `${what}: ${method} ${path} answers 403 (got ${reply.status})`);
        check(reply.code === "FORBIDDEN", `${what}: the code is FORBIDDEN (got ${reply.code})`);
      }
    });

    // -------------------------------------------------------- order opening

    test("the waiter opens one order, and a repeated click does not open a second", async () => {
      const tables = await waiter.call("GET", "/api/staff/tables");
      const table = (tables.data?.tables as { id: string; isActive: boolean }[]).find(
        (candidate) => candidate.isActive,
      )!;
      state.tableId = table.id;

      const menu = await waiter.call("GET", "/api/staff/menu");
      const products = (menu.data?.categories as { products: { id: string; price: string }[] }[])
        .flatMap((category) => category.products);
      const picks = products.slice(0, 3);
      const expected = (
        Number(picks[0].price) + Number(picks[1].price) * 2 + Number(picks[2].price)
      ).toFixed(2);

      const body = {
        tableId: table.id,
        items: [
          { productId: picks[0].id, quantity: 1 },
          { productId: picks[1].id, quantity: 2 },
          { productId: picks[2].id, quantity: 1 },
        ],
      };
      const key = randomUUID();
      // Two identical requests in flight at once — the double click.
      const [first, second] = await Promise.all([
        waiter.call("POST", "/api/staff/orders", body, { "Idempotency-Key": key }),
        waiter.call("POST", "/api/staff/orders", body, { "Idempotency-Key": key }),
      ]);
      const created = first.status === 201 ? first : second;
      const replay = first.status === 201 ? second : first;
      state.orderId = String(created.data?.orderId);

      check(created.status === 201, `the order is created once (got ${created.status})`);
      check(replay.status === 200, `the duplicate is replayed, not re-run (got ${replay.status})`);
      check(
        created.data?.orderId === replay.data?.orderId,
        "both answers name the same order",
      );
      check(
        String(created.data?.total) === expected,
        `the total is the sum of the lines (${created.data?.total} vs ${expected})`,
      );

      const rows = await sql`
        select count(*)::int as total from orders
        where table_id = ${table.id} and created_at > now() - interval '2 minutes'`;
      check(Number(rows[0].total) === 1, `exactly one order row exists (got ${rows[0].total})`);

      const items = await sql`
        select id, line_total, status from order_items where order_id = ${state.orderId}
        order by sort_order`;
      state.itemIds = items.map((item) => String(item.id));
      check(items.length === 3, `three lines were written (got ${items.length})`);
    });

    test("the server prices the order itself and refuses anything the client invents", async () => {
      const menu = await waiter.call("GET", "/api/staff/menu");
      const product = (menu.data?.categories as { products: { id: string }[] }[])[0].products[0];
      const bad: [string, unknown][] = [
        ["a price in the body", {
          tableId: state.tableId,
          items: [{ productId: product.id, quantity: 1, price: "1.00" }],
        }],
        ["a negative quantity", {
          tableId: state.tableId,
          items: [{ productId: product.id, quantity: -3 }],
        }],
        ["no lines at all", { tableId: state.tableId, items: [] }],
      ];
      for (const [what, body] of bad) {
        const reply = await waiter.call("POST", "/api/staff/orders", body, {
          "Idempotency-Key": randomUUID(),
        });
        check(reply.status === 400, `${what} is rejected (got ${reply.status})`);
        check(reply.code === "VALIDATION_ERROR", `${what} is a validation error`);
      }
      const without = await waiter.call("POST", "/api/staff/orders", {
        tableId: state.tableId,
        items: [{ productId: product.id, quantity: 1 }],
      });
      check(without.status === 400, `a missing Idempotency-Key is rejected (got ${without.status})`);
    });

    // ------------------------------------------------------ the status chain

    test("each stage belongs to one role, and no stage can be skipped", async () => {
      const status = (session: Session, next: string) =>
        session.call("PATCH", `/api/orders/${state.orderId}/status`, { status: next });

      const skipped = await status(kitchen, "PREPARING");
      check(skipped.status === 409, `NEW → PREPARING is refused (got ${skipped.status})`);
      check(skipped.code === "INVALID_STATUS_TRANSITION", "and named as an invalid transition");

      const wrongRole = await status(kitchen, "CONFIRMED");
      check(wrongRole.status === 403, `the kitchen cannot confirm (got ${wrongRole.status})`);

      check((await status(waiter, "CONFIRMED")).status === 200, "the waiter confirms");
      check(
        (await status(waiter, "PREPARING")).status === 403,
        "the waiter cannot start preparation",
      );
      check((await status(kitchen, "PREPARING")).status === 200, "the kitchen starts preparation");
      check(
        (await status(kitchen, "SERVED")).status === 409,
        "the kitchen cannot jump from preparing to served",
      );
      check((await status(kitchen, "READY")).status === 200, "the kitchen finishes the food");
      check((await status(kitchen, "SERVED")).status === 403, "the kitchen does not serve");
      check((await status(cashier, "SERVED")).status === 403, "neither does the till");
      check((await status(waiter, "SERVED")).status === 200, "the waiter serves");

      const [order] = await sql`select status from orders where id = ${state.orderId}`;
      check(order.status === "SERVED", `the database agrees (got ${order.status})`);
    });

    test("a status re-sent from a stale screen is refused, and never overwrites", async () => {
      // Two identical writes at once: one wins, the other is told why it lost.
      const [a, b] = await Promise.all([
        waiter.call("PATCH", `/api/orders/${state.orderId}/status`, { status: "SERVED" }),
        waiter.call("PATCH", `/api/orders/${state.orderId}/status`, { status: "SERVED" }),
      ]);
      check(
        a.status === 409 && b.status === 409,
        `a repeated SERVED is refused twice (got ${a.status}/${b.status})`,
      );
      const [order] = await sql`select status from orders where id = ${state.orderId}`;
      check(order.status === "SERVED", "and the order is still SERVED");
    });

    test("an unknown order id is a 404, not a guess", async () => {
      const reply = await waiter.call(
        "PATCH",
        `/api/orders/00000000-0000-4000-8000-000000000000/status`,
        { status: "SERVED" },
      );
      check(reply.status === 404, `an unknown order answers 404 (got ${reply.status})`);
      check(reply.code === "ORDER_NOT_FOUND", "and says so");
    });

    // ----------------------------------------------------- line cancellation

    test("a cancelled line leaves the total, and only that line", async () => {
      const before = await sql`select total from orders where id = ${state.orderId}`;
      const [line] = await sql`
        select id, line_total from order_items
        where order_id = ${state.orderId} and status = 'PENDING' order by line_total desc limit 1`;
      state.cancelledItemId = String(line.id);

      const cancelled = await waiter.call(
        "POST",
        `/api/orders/${state.orderId}/items/${line.id}/cancel`,
        { reason: "Ürün tükendi" },
      );
      check(cancelled.status === 200, `the line is cancelled (got ${cancelled.status})`);

      const expected = (Number(before[0].total) - Number(line.line_total)).toFixed(2);
      const [after] = await sql`select total, subtotal from orders where id = ${state.orderId}`;
      check(
        String(after.total) === expected,
        `the total drops by exactly that line (${after.total} vs ${expected})`,
      );

      const rows = await sql`
        select status from order_items where order_id = ${state.orderId} and id <> ${line.id}`;
      check(
        rows.every((row) => row.status !== "CANCELLED"),
        "no other line was touched",
      );
      const [self] = await sql`
        select status, cancelled_at from order_items where id = ${line.id}`;
      check(self.status === "CANCELLED", "the line is cancelled, not deleted");
      check(self.cancelled_at !== null, "and carries the moment it happened");

      const again = await waiter.call(
        "POST",
        `/api/orders/${state.orderId}/items/${line.id}/cancel`,
        { reason: "Ürün tükendi" },
      );
      check(again.status === 409, `cancelling it twice is refused (got ${again.status})`);
    });

    test("a line belonging to another order cannot be cancelled through this one", async () => {
      const [foreign] = await sql`
        select oi.id, oi.status, oi.order_id from order_items oi
        where oi.order_id <> ${state.orderId} and oi.status = 'PENDING' limit 1`;
      if (!foreign) {
        check(true, "no other open order exists to attack with — skipped");
        return;
      }
      state.foreignItemId = String(foreign.id);
      state.foreignOrderId = String(foreign.order_id);

      const attack = await waiter.call(
        "POST",
        `/api/orders/${state.orderId}/items/${foreign.id}/cancel`,
        { reason: "Ürün tükendi" },
      );
      check(attack.status === 404, `the mismatched pair answers 404 (got ${attack.status})`);
      check(attack.code === "ORDER_ITEM_NOT_FOUND", "and names the item, not the order");

      const [untouched] = await sql`select status from order_items where id = ${foreign.id}`;
      check(untouched.status === foreign.status, "and the other order's line is unchanged");
    });

    // -------------------------------------------------------------- the till

    test("the till collects once, and cannot collect twice", async () => {
      // A drawer the cashier already has open is used as it stands; closing
      // somebody's live shift to run a test would be the test damaging the
      // thing it measures. Only when there is none does the suite make its own,
      // and then it owns the cleanup.
      const current = await cashier.call("GET", "/api/cashier/shifts/current");
      const openShift = current.data?.shift as { id: string } | null;
      if (openShift) {
        state.shiftId = openShift.id;
      } else {
        const register = await manager.call("POST", "/api/admin/cash-registers", {
          name: `Phase9B ${Date.now()}`,
          code: `P9B-${Date.now()}`,
        });
        check(register.status === 201, `a register can be opened (got ${register.status})`);
        state.registerId = String(register.data?.id);

        const opened = await cashier.call("POST", "/api/cashier/shifts", {
          cashRegisterId: state.registerId,
          openingCash: "0.00",
        });
        check(opened.status === 201, `the cashier opens a shift (got ${opened.status})`);
        state.shiftId = String((opened.data?.shift as { id: string }).id);
      }

      const [order] = await sql`select total from orders where id = ${state.orderId}`;
      const key = randomUUID();
      const paid = await cashier.call(
        "POST",
        "/api/payments",
        { orderId: state.orderId, method: "CASH" },
        { "Idempotency-Key": key },
      );
      check(paid.status === 201, `the payment is taken (got ${paid.status})`);
      check(
        paid.data?.amount === String(order.total),
        `for the amount the server derived (${paid.data?.amount} vs ${order.total})`,
      );

      const replay = await cashier.call(
        "POST",
        "/api/payments",
        { orderId: state.orderId, method: "CASH" },
        { "Idempotency-Key": key },
      );
      check(replay.status === 200, `the same click again is replayed (got ${replay.status})`);
      check(replay.data?.paymentId === paid.data?.paymentId, "and returns the same payment");

      const second = await cashier.call(
        "POST",
        "/api/payments",
        { orderId: state.orderId, method: "CASH" },
        { "Idempotency-Key": randomUUID() },
      );
      check(second.status === 409, `a genuinely new collection is refused (got ${second.status})`);
      check(second.code === "ORDER_ALREADY_SETTLED", "because the bill is settled");

      const payments = await sql`
        select amount, status, cashier_shift_id from payments where order_id = ${state.orderId}`;
      check(payments.length === 1, `exactly one payment row exists (got ${payments.length})`);
      check(payments[0].status === "COMPLETED", "and it is completed");
      check(payments[0].cashier_shift_id !== null, "and it belongs to a drawer");
    });

    test("settling closes the order, releases the table and freezes the bill", async () => {
      const [order] = await sql`select status from orders where id = ${state.orderId}`;
      check(order.status === "COMPLETED", `the order is completed (got ${order.status})`);

      const [table] = await sql`
        select current_status from restaurant_tables where id = ${state.tableId}`;
      const [stillOwing] = await sql`
        select count(*)::int as total from orders
        where table_id = ${state.tableId} and status not in ('COMPLETED', 'CANCELLED')`;
      // A table goes back to the floor when it owes nothing — and only then. A
      // second bill running on the same table keeps it occupied, which is what
      // stops the floor seating a new party on top of the guests still eating.
      if (Number(stillOwing.total) === 0) {
        check(
          table.current_status === "AVAILABLE",
          `the settled table is free again (got ${table.current_status})`,
        );
      } else {
        check(
          table.current_status !== "AVAILABLE",
          `the table still owes ${stillOwing.total} bill(s), so it stays busy (got ${table.current_status})`,
        );
      }

      const late = await waiter.call(
        "POST",
        `/api/orders/${state.orderId}/items/${state.itemIds[0]}/cancel`,
        { reason: "Ürün tükendi" },
      );
      check(
        late.status === 409,
        `a settled order refuses further changes (got ${late.status})`,
      );
    });

    test("the whole journey is on the record, and nothing was deleted", async () => {
      const events = await sql`
        select event_type from order_events where order_id = ${state.orderId}
        order by created_at`;
      const types = events.map((event) => String(event.event_type));
      for (const expected of [
        "ORDER_CREATED",
        "ORDER_CONFIRMED",
        "ORDER_PREPARING",
        "ORDER_READY",
        "ORDER_SERVED",
        "ORDER_ITEM_CANCELLED",
        "ORDER_COMPLETED",
      ]) {
        check(types.includes(expected), `${expected} was recorded (${types.join(" → ")})`);
      }

      const lines = await sql`
        select count(*)::int as total from order_items where order_id = ${state.orderId}`;
      check(Number(lines[0].total) === 3, "all three lines are still there, cancelled one included");

      const orphans = await sql`
        select count(*)::int as total from order_items item
        left join orders parent on parent.id = item.order_id where parent.id is null`;
      check(Number(orphans[0].total) === 0, `no order line is orphaned (got ${orphans[0].total})`);
    });

    test("a refresh shows the same state the database holds", async () => {
      // The panels re-read this endpoint on every load; if it disagreed with the
      // database a refresh would appear to undo the shift's work.
      const reply = await waiter.call("GET", `/api/staff/orders?tableId=${state.tableId}`);
      const orders = reply.data?.orders as {
        id: string;
        status: string;
        amounts: { total: string };
        items: { id: string; status: string }[];
      }[];
      const reread = orders.find((order) => order.id === state.orderId)!;
      const [row] = await sql`select status, total from orders where id = ${state.orderId}`;
      check(reread.status === row.status, `the status matches (${reread.status} vs ${row.status})`);
      check(
        reread.amounts.total === String(row.total),
        `the total matches (${reread.amounts.total} vs ${row.total})`,
      );
      const cancelled = reread.items.find((item) => item.id === state.cancelledItemId);
      check(cancelled?.status === "CANCELLED", "and the cancelled line is still cancelled");
    });

    test("a settled order leaves the live screens without leaving the record", async () => {
      // The live list is newest-first and capped, so a settled order that stays
      // in the result set consumes a row a still-open ticket needed. The filter
      // has to be applied by the query, not by the browser.
      const open = await waiter.call("GET", "/api/staff/orders?open=true&limit=100");
      const openIds = (open.data?.orders as { id: string; status: string }[]).map(
        (order) => order.id,
      );
      check(
        !openIds.includes(state.orderId),
        "the settled order is gone from the open list",
      );
      const statuses = new Set(
        (open.data?.orders as { status: string }[]).map((order) => order.status),
      );
      check(
        !statuses.has("COMPLETED") && !statuses.has("CANCELLED"),
        `the open list carries no settled order (${[...statuses].join(", ")})`,
      );

      // …while the unfiltered list, which the history screens use, still has it.
      const all = await waiter.call("GET", "/api/staff/orders?limit=100");
      const allIds = (all.data?.orders as { id: string }[]).map((order) => order.id);
      check(allIds.includes(state.orderId), "the history list still shows it");
    });

    // ------------------------------------------------------------- realtime

    test("every step left an event, and the dispatcher can publish them", async () => {
      const pending = await sql`
        select event_type, status from outbox_events where aggregate_id = ${state.orderId}`;
      check(pending.length > 0, `the order produced outbox events (got ${pending.length})`);

      const secret = process.env.OUTBOX_DISPATCH_SECRET;
      if (!secret) {
        check(true, "OUTBOX_DISPATCH_SECRET is not set — dispatch not exercised");
        return;
      }
      const unauthorized = await fetch(new URL("/api/internal/outbox/dispatch", baseUrl), {
        method: "POST",
      });
      check(unauthorized.status === 401, `dispatch needs its secret (got ${unauthorized.status})`);

      const dispatched = await fetch(new URL("/api/internal/outbox/dispatch", baseUrl), {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}` },
      });
      const body = (await dispatched.json()) as {
        data?: { claimed: number; published: number; failed: number };
      };
      check(dispatched.status === 200, `dispatch answers 200 (got ${dispatched.status})`);
      // The claim query used to reject its own parameters, so nothing was ever
      // published and the queue only grew. Claiming at all is the regression.
      check(
        (body.data?.claimed ?? 0) > 0,
        `the dispatcher claims work (claimed ${body.data?.claimed})`,
      );
      check(
        (body.data?.failed ?? 1) === 0,
        `and publishes without failures (failed ${body.data?.failed})`,
      );
    });
  });
}
