import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";

import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

import { generateQrToken } from "../../lib/security/qr-token";
import { resetFixtureRateLimits } from "./rate-limit-reset";
import { readSupabaseIntegrationEnvironment } from "./supabase-test-environment";

/**
 * Phase 8A — the full till flow over real HTTP, against a running server.
 *
 * Unlike the older HTTP suites this one provisions and removes its own
 * fixture, so it needs no pre-seeded deployment: it creates a disposable
 * restaurant, its staff auth users, a register, a table and a product, drives
 * the flow through the actual route handlers with real cookies, and deletes
 * everything again.
 *
 * What it proves that the service tests cannot: the route layer's auth, origin
 * guard, validation and status codes, and that the shift a payment lands in is
 * decided by the session rather than by anything on the wire.
 */

const PREFIX = "PHASE8A_";
const CONFIRMATION = "I_UNDERSTAND_THIS_MUTATES_A_DISPOSABLE_TEST_FIXTURE";

function readTargetUrl(): { url: URL } | { reason: string } {
  if (process.env.RUN_PHASE8A_HTTP_E2E !== "true") {
    return {
      reason:
        "Phase 8A HTTP E2E is opt-in; set RUN_PHASE8A_HTTP_E2E=true with a running disposable server.",
    };
  }
  if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production") {
    return { reason: "Phase 8A HTTP E2E refuses production environments." };
  }
  if (process.env.PHASE8A_HTTP_E2E_CONFIRM !== CONFIRMATION) {
    return { reason: `Set PHASE8A_HTTP_E2E_CONFIRM=${CONFIRMATION}.` };
  }
  const raw = process.env.PHASE8A_HTTP_E2E_BASE_URL?.trim();
  if (!raw) return { reason: "PHASE8A_HTTP_E2E_BASE_URL is required." };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { reason: "PHASE8A_HTTP_E2E_BASE_URL must be an absolute URL." };
  }
  // Self-provisioning means this must never point at a shared deployment.
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (!loopback) {
    return { reason: "Phase 8A HTTP E2E only targets a loopback server it can own." };
  }
  return { url };
}

const target = readTargetUrl();
const db = readSupabaseIntegrationEnvironment({ requireDatabaseUrl: true });

if ("reason" in target || !db.ready) {
  test("Phase 8A HTTP E2E", {
    skip: "reason" in target ? target.reason : (db as { reason: string }).reason,
  }, () => undefined);
} else {
  const baseUrl = target.url;
  const environment = db.environment;
  const run = randomBytes(6).toString("hex");
  const admin = createClient(environment.url, environment.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const sql = postgres(environment.databaseUrl!, { max: 3, prepare: false, onnotice: () => {} });

  const ids = {
    restaurant: randomUUID(),
    foreignRestaurant: randomUUID(),
    category: randomUUID(),
    product: randomUUID(),
    table: randomUUID(),
    register: randomUUID(),
    order: randomUUID(),
    orderItem: randomUUID(),
    /** Kept unpaid, so late-collection probes hit the shift guard. */
    secondOrder: randomUUID(),
    secondOrderItem: randomUUID(),
  };

  interface Account {
    readonly key: string;
    readonly role: "CASHIER" | "MANAGER" | "WAITER";
    readonly restaurantId: string;
    readonly staffId: string;
    readonly email: string;
    readonly password: string;
    authUserId: string | null;
  }

  const accounts: Account[] = (
    [
      ["cashier", "CASHIER", ids.restaurant],
      ["manager", "MANAGER", ids.restaurant],
      ["waiter", "WAITER", ids.restaurant],
      ["foreign", "CASHIER", ids.foreignRestaurant],
    ] as const
  ).map(([key, role, restaurantId]) => ({
    key,
    role,
    restaurantId,
    staffId: randomUUID(),
    email: `phase8a-${run}-${key}@example.com`,
    password: `Pw-${randomBytes(18).toString("base64url")}`,
    authUserId: null,
  }));
  const account = (key: string): Account => {
    const found = accounts.find((candidate) => candidate.key === key);
    if (!found) throw new Error(`unknown fixture account ${key}`);
    return found;
  };

  const cleanupErrors: string[] = [];
  let assertions = 0;
  function check(condition: boolean, message: string): void {
    assertions += 1;
    assert.ok(condition, message);
  }

  /** A minimal cookie jar; the suite drives several sessions at once. */
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
      options: { body?: unknown; origin?: string | null; idempotencyKey?: string } = {},
    ): Promise<{ status: number; body: Record<string, unknown> }> {
      const headers: Record<string, string> = { Cookie: this.header() };
      if (options.body !== undefined) headers["Content-Type"] = "application/json";
      // `origin: null` deliberately omits the header, to exercise the guard.
      if (options.origin !== null) headers.Origin = options.origin ?? baseUrl.origin;
      if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;

      const response = await fetch(new URL(path, baseUrl), {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        redirect: "manual",
      });
      this.absorb(response);
      const text = await response.text();
      let body: Record<string, unknown> = {};
      try {
        body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      } catch {
        body = { raw: text.slice(0, 200) };
      }
      return { status: response.status, body };
    }

    async login(target: Account): Promise<number> {
      const result = await this.request("POST", "/api/staff/login", {
        body: { identifier: target.email, password: target.password },
      });
      return result.status;
    }
  }

  function errorCode(body: Record<string, unknown>): string {
    const error = body.error as { code?: string } | undefined;
    return error?.code ?? "NONE";
  }

  function data<T = Record<string, unknown>>(body: Record<string, unknown>): T {
    return body.data as T;
  }

  const cashier = new Session();
  const manager = new Session();
  const waiter = new Session();
  const foreign = new Session();
  let openShiftId = "";
  let firstPaymentId = "";

  describe("Phase 8A till flow over HTTP", { concurrency: false }, () => {
    before(async () => {
      for (const target of accounts) {
        const created = await admin.auth.admin.createUser({
          email: target.email,
          password: target.password,
          email_confirm: true,
        });
        if (created.error || !created.data.user) {
          throw new Error(`auth user ${target.key}: ${created.error?.message ?? "missing"}`);
        }
        target.authUserId = created.data.user.id;
      }

      await sql`insert into restaurants (id, name, slug) values
        (${ids.restaurant}, ${`${PREFIX}HTTP Tenant`}, ${`phase8a-http-${run}`}),
        (${ids.foreignRestaurant}, ${`${PREFIX}HTTP Other`}, ${`phase8a-http-b-${run}`})`;
      await sql`insert into restaurant_settings (restaurant_id) values
        (${ids.restaurant}), (${ids.foreignRestaurant})`;
      for (const target of accounts) {
        await sql`insert into staff_profiles (id, restaurant_id, auth_user_id, name, email,
            login_identifier, role, is_active) values
          (${target.staffId}, ${target.restaurantId}, ${target.authUserId},
           ${`${PREFIX}${target.key}`}, ${target.email}, ${`p8a-http-${run}-${target.key}`},
           ${target.role}, true)`;
      }
      await sql`insert into cash_registers (id, restaurant_id, name, code) values
        (${ids.register}, ${ids.restaurant}, ${`${PREFIX}Ana Kasa`},
         ${`P8H${run.slice(0, 6).toUpperCase()}`})`;
      await sql`insert into categories (id, restaurant_id, name, slug) values
        (${ids.category}, ${ids.restaurant}, ${`${PREFIX}Kategori`}, ${`p8a-http-cat-${run}`})`;
      await sql`insert into products (id, restaurant_id, category_id, name, slug, price) values
        (${ids.product}, ${ids.restaurant}, ${ids.category}, ${`${PREFIX}Ana`},
         ${`p8a-http-ana-${run}`}, '100.00')`;
      await sql`insert into restaurant_tables (id, restaurant_id, name, table_number, qr_token_hash) values
        (${ids.table}, ${ids.restaurant}, ${`${PREFIX}Masa`}, 8901,
         ${generateQrToken(randomBytes(32)).tokenHash})`;
      await sql`insert into orders (id, restaurant_id, table_id, order_sequence, order_number,
          subtotal, total, created_by_type, created_by_user_id, status) values
        (${ids.order}, ${ids.restaurant}, ${ids.table}, 89001, ${`${PREFIX}89001`},
         '200.00', '200.00', 'STAFF', ${account("waiter").staffId}, 'SERVED')`;
      await sql`insert into order_items (id, restaurant_id, order_id, product_id,
          product_name_snapshot, unit_price, quantity, line_total, status) values
        (${ids.orderItem}, ${ids.restaurant}, ${ids.order}, ${ids.product}, ${`${PREFIX}Ana`},
         '100.00', 2, '200.00', 'SERVED')`;
      await sql`insert into orders (id, restaurant_id, table_id, order_sequence, order_number,
          subtotal, total, created_by_type, created_by_user_id, status) values
        (${ids.secondOrder}, ${ids.restaurant}, ${ids.table}, 89002, ${`${PREFIX}89002`},
         '100.00', '100.00', 'STAFF', ${account("waiter").staffId}, 'SERVED')`;
      await sql`insert into order_items (id, restaurant_id, order_id, product_id,
          product_name_snapshot, unit_price, quantity, line_total, status) values
        (${ids.secondOrderItem}, ${ids.restaurant}, ${ids.secondOrder}, ${ids.product},
         ${`${PREFIX}Ana`}, '100.00', 1, '100.00', 'SERVED')`;

      // The login limiter is strict and correct; only this fixture's own
      // buckets are cleared, never the policy.
      await resetFixtureRateLimits(
        sql,
        accounts.map((target) => target.email.toLowerCase()),
      );

      for (const [session, key] of [
        [cashier, "cashier"], [manager, "manager"], [waiter, "waiter"], [foreign, "foreign"],
      ] as const) {
        const status = await session.login(account(key));
        if (status !== 200) throw new Error(`${key} login failed with ${status}`);
      }
    });

    after(async () => {
      try {
        const order = [
          "cash_drawer_movements", "payment_refunds", "payments", "order_check_items",
          "order_checks", "order_events", "audit_logs", "outbox_events", "idempotency_keys",
          "waiter_calls", "kitchen_tickets", "order_items", "orders", "cashier_shifts",
          "cash_registers", "restaurant_tables", "products", "categories",
          "restaurant_settings", "staff_profiles", "restaurants",
        ];
        for (const tenant of [ids.restaurant, ids.foreignRestaurant]) {
          for (const table of order) {
            const column = table === "restaurants" ? "id" : "restaurant_id";
            await sql.unsafe(`delete from ${table} where ${column} = $1::uuid`, [tenant]);
          }
        }
        await resetFixtureRateLimits(
          sql,
          accounts.map((target) => target.email.toLowerCase()),
        );
        for (const target of accounts) {
          if (!target.authUserId) continue;
          const removed = await admin.auth.admin.deleteUser(target.authUserId);
          if (removed.error) cleanupErrors.push(`auth ${target.key}: ${removed.error.message}`);
        }
      } catch (error) {
        cleanupErrors.push((error as Error).message);
      }
      await sql.end({ timeout: 5 });
      if (cleanupErrors.length > 0) {
        console.error("PHASE8A HTTP CLEANUP INCOMPLETE:", cleanupErrors.join(" | "));
      }
      console.log(`phase8a http assertions executed: ${assertions}`);
    });

    test("the till starts closed and refuses money", async () => {
      const current = await cashier.request("GET", "/api/cashier/shifts/current");
      check(current.status === 200, `current shift reads (got ${current.status})`);
      const state = data<{ shift: unknown; availableRegisters: { id: string }[] }>(current.body);
      check(state.shift === null, "no shift is open yet");
      check(
        state.availableRegisters.some((register) => register.id === ids.register),
        "the fixture register is offered",
      );

      const payment = await cashier.request("POST", "/api/payments", {
        body: { orderId: ids.order, method: "CASH", amount: "50.00" },
        idempotencyKey: `p8a-http-${run}-denied`,
      });
      check(payment.status === 409, `collection is refused (got ${payment.status})`);
      check(
        errorCode(payment.body) === "CASHIER_SHIFT_REQUIRED",
        `with the right reason (got ${errorCode(payment.body)})`,
      );

      const [row] = await sql`
        select count(*)::int as count from payments where order_id = ${ids.order}`;
      check(Number(row.count) === 0, `no payment row exists (got ${row.count})`);
    });

    test("a waiter cannot open a till, and a missing Origin is refused", async () => {
      const forbidden = await waiter.request("POST", "/api/cashier/shifts", {
        body: { cashRegisterId: ids.register, openingCash: "0.00" },
      });
      check(forbidden.status === 403, `a waiter is forbidden (got ${forbidden.status})`);

      const noOrigin = await cashier.request("POST", "/api/cashier/shifts", {
        body: { cashRegisterId: ids.register, openingCash: "0.00" },
        origin: null,
      });
      check(noOrigin.status === 403, `a cross-origin write is refused (got ${noOrigin.status})`);

      const wrongOrigin = await cashier.request("POST", "/api/cashier/shifts", {
        body: { cashRegisterId: ids.register, openingCash: "0.00" },
        origin: "https://evil.example",
      });
      check(wrongOrigin.status === 403, `a forged Origin is refused (got ${wrongOrigin.status})`);
    });

    test("opening the till validates its input and then succeeds", async () => {
      const negative = await cashier.request("POST", "/api/cashier/shifts", {
        body: { cashRegisterId: ids.register, openingCash: "-5.00" },
      });
      check(negative.status === 400, `a negative float is rejected (got ${negative.status})`);

      const opened = await cashier.request("POST", "/api/cashier/shifts", {
        body: { cashRegisterId: ids.register, openingCash: "500.00" },
      });
      check(opened.status === 201, `the shift opens (got ${opened.status})`);
      const detail = data<{
        shift: { id: string; status: string; openingCash: string };
        summary: { expectedCash: string };
      }>(opened.body);
      check(detail.shift.status === "OPEN", "and reports itself open");
      check(detail.summary.expectedCash === "500.00", "the drawer starts at its float");
      openShiftId = detail.shift.id;

      const again = await cashier.request("POST", "/api/cashier/shifts", {
        body: { cashRegisterId: ids.register, openingCash: "0.00" },
      });
      check(again.status === 409, `a second shift is refused (got ${again.status})`);
    });

    test("collections, a drawer movement and a refund all land on the open shift", async () => {
      const cash = await cashier.request("POST", "/api/payments", {
        body: { orderId: ids.order, method: "CASH", amount: "120.00" },
        idempotencyKey: `p8a-http-${run}-cash`,
      });
      check(cash.status === 201, `the cash collection succeeds (got ${cash.status})`);
      firstPaymentId = data<{ paymentId: string }>(cash.body).paymentId;

      const card = await cashier.request("POST", "/api/payments", {
        body: { orderId: ids.order, method: "CARD", amount: "80.00" },
        idempotencyKey: `p8a-http-${run}-card`,
      });
      check(card.status === 201, `the card collection succeeds (got ${card.status})`);

      const movement = await cashier.request(
        "POST",
        `/api/cashier/shifts/${openShiftId}/movements`,
        { body: { type: "CASH_OUT", amount: "20.00", reason: `${PREFIX}Tedarikci` } },
      );
      check(movement.status === 201, `the drawer movement is recorded (got ${movement.status})`);

      const unexplained = await cashier.request(
        "POST",
        `/api/cashier/shifts/${openShiftId}/movements`,
        { body: { type: "CASH_IN", amount: "10.00", reason: "  " } },
      );
      check(unexplained.status === 400, `an unexplained movement is refused (got ${unexplained.status})`);

      const refund = await cashier.request("POST", `/api/payments/${firstPaymentId}/refund`, {
        body: { amount: "30.00", reasonCode: "CUSTOMER_COMPLAINT" },
        idempotencyKey: `p8a-http-${run}-refund`,
      });
      check(refund.status === 201, `the refund succeeds (got ${refund.status})`);

      const attributed = await sql`
        select count(*)::int as count from payments
        where restaurant_id = ${ids.restaurant} and cashier_shift_id = ${openShiftId}`;
      check(Number(attributed[0].count) === 2, `both collections are attributed`);
      const refundRows = await sql`
        select count(*)::int as count from payment_refunds where cashier_shift_id = ${openShiftId}`;
      check(Number(refundRows[0].count) === 1, "the refund is attributed to the same shift");
    });

    test("the live summary is exact, and card money stays out of the drawer", async () => {
      const current = await cashier.request("GET", "/api/cashier/shifts/current");
      const state = data<{
        summary: {
          expectedCash: string;
          grossCollected: string;
          netCollected: string;
          payments: { cash: string; card: string };
          refunds: { cash: string; card: string };
          cashOut: string;
        };
        movements: unknown[];
      }>(current.body);

      check(state.summary.payments.cash === "120.00", `cash collected (got ${state.summary.payments.cash})`);
      check(state.summary.payments.card === "80.00", `card collected (got ${state.summary.payments.card})`);
      check(state.summary.refunds.cash === "30.00", `cash refunded (got ${state.summary.refunds.cash})`);
      check(state.summary.cashOut === "20.00", `cash out (got ${state.summary.cashOut})`);
      // 500 float + 120 cash − 30 cash refund − 20 out = 570. Card is absent.
      check(
        state.summary.expectedCash === "570.00",
        `expected drawer (got ${state.summary.expectedCash})`,
      );
      check(state.summary.grossCollected === "200.00", "gross includes card");
      check(state.summary.netCollected === "170.00", "net drops by the refund");
      check(state.movements.length === 1, `the movement is listed (got ${state.movements.length})`);
    });

    test("a client cannot attribute money to another shift by asking", async () => {
      // A second, foreign-owned shift the cashier must not be able to reach.
      const managerShift = await manager.request("POST", "/api/cashier/shifts", {
        body: { cashRegisterId: ids.register, openingCash: "0.00" },
      });
      check(managerShift.status === 409, "the register already has an open shift");

      const spoofed = await cashier.request("POST", "/api/payments", {
        body: {
          orderId: ids.order,
          method: "CASH",
          amount: "10.00",
          cashierShiftId: randomUUID(),
        },
        idempotencyKey: `p8a-http-${run}-spoof`,
      });
      // The body schema is strict, so an unknown field is refused outright.
      check(spoofed.status === 400, `an unknown body field is rejected (got ${spoofed.status})`);

      const [row] = await sql`
        select count(*)::int as count from payments
        where restaurant_id = ${ids.restaurant} and cashier_shift_id is distinct from ${openShiftId}`;
      check(Number(row.count) === 0, `nothing landed elsewhere (got ${row.count})`);
    });

    test("another restaurant's cashier sees nothing of this till", async () => {
      const detail = await foreign.request("GET", `/api/cashier/shifts/${openShiftId}`);
      check(detail.status === 404, `foreign shift detail is 404 (got ${detail.status})`);

      const close = await foreign.request("POST", `/api/cashier/shifts/${openShiftId}/close`, {
        body: { countedCash: "0.00", note: "x" },
      });
      check(close.status === 404, `foreign close is 404 (got ${close.status})`);

      const movement = await foreign.request(
        "POST",
        `/api/cashier/shifts/${openShiftId}/movements`,
        { body: { type: "CASH_OUT", amount: "500.00", reason: "x" } },
      );
      check(movement.status === 404, `foreign movement is 404 (got ${movement.status})`);

      const open = await foreign.request("POST", "/api/cashier/shifts", {
        body: { cashRegisterId: ids.register, openingCash: "0.00" },
      });
      check(open.status === 404, `a foreign register is 404 (got ${open.status})`);

      const history = await foreign.request("GET", "/api/cashier/shifts?page=1&pageSize=50");
      check(
        data<{ rows: unknown[] }>(history.body).rows.length === 0,
        "and no shift leaks into their history",
      );

      const missing = await manager.request("GET", `/api/cashier/shifts/${randomUUID()}`);
      check(missing.status === 404, "a nonexistent shift answers identically");
    });

    test("closing counts the drawer, needs a note for a difference, and then bites", async () => {
      const unexplained = await cashier.request(
        "POST",
        `/api/cashier/shifts/${openShiftId}/close`,
        { body: { countedCash: "560.00" } },
      );
      check(unexplained.status === 400, `an unexplained difference is refused (got ${unexplained.status})`);
      check(
        errorCode(unexplained.body) === "CASHIER_SHIFT_NOTE_REQUIRED",
        `with the right reason (got ${errorCode(unexplained.body)})`,
      );

      const closed = await cashier.request("POST", `/api/cashier/shifts/${openShiftId}/close`, {
        body: { countedCash: "560.00", note: `${PREFIX}Bozuk para eksik.` },
      });
      check(closed.status === 200, `the till closes (got ${closed.status})`);
      const detail = data<{
        shift: {
          status: string;
          expectedCashAtClose: string;
          countedCash: string;
          cashVariance: string;
        };
      }>(closed.body);
      check(detail.shift.status === "CLOSED", "and is marked closed");
      check(detail.shift.expectedCashAtClose === "570.00", "against the derived expectation");
      check(detail.shift.countedCash === "560.00", "with the counted figure kept");
      check(detail.shift.cashVariance === "-10.00", `variance −10.00 (got ${detail.shift.cashVariance})`);

      // Money is refused again the moment the drawer is closed. A *fresh*
      // order is used: the first one is fully settled by now, and the order
      // guard would answer before the shift guard ever ran.
      const late = await cashier.request("POST", "/api/payments", {
        body: { orderId: ids.secondOrder, method: "CASH" },
        idempotencyKey: `p8a-http-${run}-late`,
      });
      check(
        late.status === 409 && errorCode(late.body) === "CASHIER_SHIFT_REQUIRED",
        `a late collection is refused (got ${late.status}/${errorCode(late.body)})`,
      );

      const reclose = await cashier.request("POST", `/api/cashier/shifts/${openShiftId}/close`, {
        body: { countedCash: "1.00", note: "tekrar" },
      });
      check(reclose.status === 409, `a closed till cannot be reclosed (got ${reclose.status})`);
    });

    test("a manager closes another cashier's till, and history shows both", async () => {
      const opened = await cashier.request("POST", "/api/cashier/shifts", {
        body: { cashRegisterId: ids.register, openingCash: "40.00" },
      });
      check(opened.status === 201, `a new shift opens after the close (got ${opened.status})`);
      const secondShift = data<{ shift: { id: string } }>(opened.body).shift.id;

      const withoutNote = await manager.request(
        "POST",
        `/api/cashier/shifts/${secondShift}/close`,
        { body: { countedCash: "40.00" } },
      );
      check(
        withoutNote.status === 400 && errorCode(withoutNote.body) === "CASHIER_SHIFT_NOTE_REQUIRED",
        `an override needs a reason (got ${withoutNote.status})`,
      );

      const override = await manager.request("POST", `/api/cashier/shifts/${secondShift}/close`, {
        body: { countedCash: "40.00", note: `${PREFIX}Kasiyer ayrildi.` },
      });
      check(override.status === 200, `the manager may close it (got ${override.status})`);
      const closed = data<{
        shift: { openedBy: { id: string }; closedBy: { id: string } | null };
      }>(override.body);
      check(
        closed.shift.openedBy.id === account("cashier").staffId,
        "the shift still belongs to the cashier",
      );
      check(
        closed.shift.closedBy?.id === account("manager").staffId,
        "and the manager is recorded as the closer",
      );

      const history = await manager.request("GET", "/api/cashier/shifts?page=1&pageSize=10");
      const page = data<{ rows: { id: string }[]; total: number }>(history.body);
      check(page.total === 2, `the manager sees both shifts (got ${page.total})`);
      check(page.rows.length === 2, "on one page");

      const cashierHistory = await cashier.request("GET", "/api/cashier/shifts?page=1&pageSize=10");
      const own = data<{ rows: { id: string }[] }>(cashierHistory.body);
      check(own.rows.length === 2, "the cashier sees their own two shifts");
    });

    test("the audit trail records the whole lifecycle", async () => {
      const actions = await sql`
        select distinct action from audit_logs where restaurant_id = ${ids.restaurant}
          and (action like 'cashier_shift%' or action like 'cash_drawer%')
        order by action`;
      const names = actions.map((row) => String(row.action));
      for (const expected of [
        "cash_drawer.cash_out",
        "cashier_shift.closed",
        "cashier_shift.closed_by_supervisor",
        "cashier_shift.opened",
      ]) {
        check(names.includes(expected), `${expected} is audited (have ${names.join(", ")})`);
      }
    });
  });
}
