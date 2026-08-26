import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, test, beforeEach, before} from "node:test";

import {
  readHttpE2eEnvironment,
  type HttpE2eStaffCredential,
} from "./http-test-environment";

const readiness = readHttpE2eEnvironment();

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function objects(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

class CookieJar {
  private readonly values = new Map<string, string>();

  absorb(headers: Headers): void {
    for (const setCookie of headers.getSetCookie()) {
      const firstSeparator = setCookie.indexOf(";");
      const pair = firstSeparator >= 0 ? setCookie.slice(0, firstSeparator) : setCookie;
      const equals = pair.indexOf("=");
      if (equals <= 0) continue;
      const name = pair.slice(0, equals).trim();
      const value = pair.slice(equals + 1).trim();
      if (!value || setCookie.toLowerCase().includes("max-age=0")) this.values.delete(name);
      else this.values.set(name, value);
    }
  }

  header(): string | null {
    if (this.values.size === 0) return null;
    return [...this.values].map(([name, value]) => `${name}=${value}`).join("; ");
  }
}

const supervisor = readiness.ready ? readiness.environment.admin : null;

if (!readiness.ready) {
  test("Phase 7 split and payment E2E", { skip: readiness.reason }, () => undefined);
} else if (!supervisor) {
  test(
    "Phase 7 split and payment E2E",
    {
      skip:
        "Set SEHIR_HTTP_E2E_ADMIN_IDENTIFIER/PASSWORD; splitting, refunding and resetting need a supervisory role.",
    },
    () => undefined,
  );
} else {
  const environment = readiness.environment;
  const manager = supervisor;

  async function request(
    path: string,
    label: string,
    init: RequestInit = {},
    jar?: CookieJar,
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("User-Agent", "sehir-lokantasi-phase7-split-e2e");
    headers.set("Accept", headers.get("Accept") ?? "application/json");
    const cookie = jar?.header();
    if (cookie) headers.set("Cookie", cookie);

    let response: Response;
    try {
      response = await fetch(new URL(path, environment.baseUrl), {
        ...init,
        headers,
        cache: "no-store",
        redirect: "manual",
        signal: init.signal ?? AbortSignal.timeout(30_000),
      });
    } catch {
      throw new Error(`${label} request failed before receiving a response.`);
    }
    jar?.absorb(response.headers);
    return response;
  }

  async function successData(
    response: Response,
    expected: number | readonly number[],
    label: string,
  ): Promise<JsonObject> {
    const statuses = Array.isArray(expected) ? expected : [expected];
    assert.ok(statuses.includes(response.status), `${label} returned HTTP ${response.status}.`);
    const payload: unknown = await response.json();
    assert.ok(isObject(payload) && payload.success === true, `${label} did not succeed.`);
    assert.ok(isObject(payload.data), `${label} returned no data.`);
    return payload.data;
  }

  async function errorCode(response: Response): Promise<string> {
    const payload: unknown = await response.json();
    return isObject(payload) && isObject(payload.error) && typeof payload.error.code === "string"
      ? payload.error.code
      : "";
  }

  async function login(credential: HttpE2eStaffCredential, label: string): Promise<CookieJar> {
    const jar = new CookieJar();
    const response = await request(
      "/api/staff/login",
      `${label} login`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: environment.baseUrl.origin },
        body: JSON.stringify(credential),
      },
      jar,
    );
    assert.equal(response.status, 200, `${label} login failed.`);
    return jar;
  }

  function send(
    jar: CookieJar,
    method: "POST" | "PATCH" | "DELETE",
    path: string,
    body: JsonObject | null,
    label: string,
    key?: string,
  ) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Origin: environment.baseUrl.origin,
    };
    if (key) headers["Idempotency-Key"] = key;
    return request(
      path,
      label,
      { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) },
      jar,
    );
  }

  async function resolveTableId(): Promise<string> {
    const jar = new CookieJar();
    const session = await request(
      "/api/table-sessions",
      "customer session",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: environment.baseUrl.origin },
        body: JSON.stringify({ tableToken: environment.rawTableToken }),
      },
      jar,
    );
    assert.ok([200, 201].includes(session.status), "customer session was not issued.");
    const menu = await successData(
      await request("/api/menu", "customer menu", { method: "GET" }, jar),
      200,
      "customer menu",
    );
    assert.ok(isObject(menu.table) && typeof menu.table.id === "string", "table id is missing.");
    return menu.table.id;
  }

  /** Opens a served order the test fully owns, with `quantity` of the fixture product. */
  async function servedOrder(jar: CookieJar, tableId: string, quantity: number) {
    const created = await successData(
      await send(
        jar,
        "POST",
        "/api/staff/orders",
        { tableId, items: [{ productId: environment.productId, quantity }] },
        "open order",
        `p7split-${randomUUID()}`,
      ),
      [200, 201],
      "open order",
    );
    const orderId = String(created.orderId);
    for (const status of ["CONFIRMED", "PREPARING", "READY", "SERVED"] as const) {
      const response = await send(
        jar,
        "PATCH",
        `/api/orders/${orderId}/status`,
        { status },
        `advance to ${status}`,
      );
      assert.equal(response.status, 200, `could not advance the order to ${status}.`);
    }
    return orderId;
  }

  async function ledger(jar: CookieJar, orderId: string) {
    return successData(
      await request(`/api/orders/${orderId}/ledger`, "ledger", { method: "GET" }, jar),
      200,
      "ledger",
    );
  }

  async function checksOf(jar: CookieJar, orderId: string) {
    return successData(
      await request(`/api/orders/${orderId}/checks`, "checks", { method: "GET" }, jar),
      200,
      "checks",
    );
  }

  /** Best-effort teardown so the disposable fixture keeps its shape. */
  async function cleanup(jar: CookieJar, orderId: string) {
    await send(
      jar,
      "POST",
      `/api/orders/${orderId}/cancel`,
      { reason: "Diğer", reasonNote: "phase7 split e2e cleanup" },
      "cleanup",
    );
  }

  describe("Phase 7 split and payment E2E", () => {
    // The staff-login limiter is 5 attempts per 15 minutes on the client-IP
    // bucket, which a suite signing in as several fixture accounts exhausts on
    // its own. Only this fixture's own buckets are cleared; the policy, the
    // limits and every unrelated row stay exactly as they are.
    before(async () => {
      await withFixtureTransactionReset();
    });

    beforeEach(async () => {
      await withFixtureRateLimitReset(environment);
    });

    test("a bill splits by item, settles check by check and closes the order", async () => {
      const jar = await login(manager, "MANAGER");
      const tableId = await resolveTableId();
      const orderId = await servedOrder(jar, tableId, 4);

      const before = await checksOf(jar, orderId);
      const line = objects(before.allocatableItems)[0];
      assert.ok(line, "the order has no billable line.");
      const orderItemId = String(line.orderItemId);
      assert.equal(Number(line.quantity), 4, "the fixture order should hold four portions.");

      // Split 4 portions across two checks: 1 and 3.
      const split = await successData(
        await send(
          jar,
          "POST",
          `/api/orders/${orderId}/checks`,
          {
            mode: "ITEMS",
            checks: [
              { label: "Ali", items: [{ orderItemId, quantity: 1 }] },
              { label: "Ayşe", items: [{ orderItemId, quantity: 3 }] },
            ],
          },
          "split by items",
        ),
        201,
        "split by items",
      );
      const checks = objects(split.checks);
      assert.equal(checks.length, 2);
      const [first, second] = checks as [JsonObject, JsonObject];
      assert.equal(first.label, "Ali");
      // Server-derived totals; the request carried no prices.
      assert.equal(
        Number(first.total) * 3,
        Number(second.total),
        "one portion against three should be a third of the money.",
      );

      // Edit while untouched: rename and move a portion across.
      const edited = await successData(
        await send(
          jar,
          "PATCH",
          `/api/orders/${orderId}/checks/${String(second.id)}`,
          { label: "Ayşe & Mehmet" },
          "edit check",
        ),
        200,
        "edit check",
      );
      assert.equal(
        objects(edited.checks).find((check) => check.id === second.id)?.label,
        "Ayşe & Mehmet",
      );

      // Paying one check closes it and leaves the order open.
      await successData(
        await send(
          jar,
          "POST",
          "/api/payments",
          { orderId, method: "CASH", checkId: String(first.id) },
          "pay check 1",
          `p7split-${randomUUID()}`,
        ),
        [200, 201],
        "pay check 1",
      );
      const midway = await checksOf(jar, orderId);
      assert.equal(
        objects(midway.checks).find((check) => check.id === first.id)?.status,
        "PAID",
      );
      assert.equal(
        objects(midway.checks).find((check) => check.id === second.id)?.status,
        "OPEN",
      );
      const midLedger = await ledger(jar, orderId);
      assert.equal((midLedger.orderStatus as string) !== "COMPLETED", true);

      // A paid check is immutable.
      const rejected = await send(
        jar,
        "PATCH",
        `/api/orders/${orderId}/checks/${String(first.id)}`,
        { label: "Yeni" },
        "edit paid check",
      );
      assert.equal(rejected.status, 409);
      assert.equal(await errorCode(rejected), "CHECK_NOT_MUTABLE");

      // Part-pay the second check, then finish it: overpaying must be refused.
      const secondTotal = Number(second.total);
      const half = (secondTotal / 2).toFixed(2);
      await successData(
        await send(
          jar,
          "POST",
          "/api/payments",
          { orderId, method: "CASH", checkId: String(second.id), amount: half },
          "part pay check 2",
          `p7split-${randomUUID()}`,
        ),
        [200, 201],
        "part pay check 2",
      );
      const overpay = await send(
        jar,
        "POST",
        "/api/payments",
        {
          orderId,
          method: "CARD",
          checkId: String(second.id),
          amount: (secondTotal).toFixed(2),
        },
        "overpay check 2",
        `p7split-${randomUUID()}`,
      );
      assert.equal(overpay.status, 409, "an overpayment was accepted.");
      assert.equal(await errorCode(overpay), "PAYMENT_EXCEEDS_BALANCE");

      const finalPayment = await successData(
        await send(
          jar,
          "POST",
          "/api/payments",
          { orderId, method: "CARD", checkId: String(second.id) },
          "settle check 2",
          `p7split-${randomUUID()}`,
        ),
        [200, 201],
        "settle check 2",
      );
      assert.equal(isObject(finalPayment.balance) && finalPayment.balance.settled, true);

      const closed = await ledger(jar, orderId);
      assert.equal(closed.orderStatus, "COMPLETED");
      assert.equal(isObject(closed.balance) && closed.balance.outstanding, "0.00");

      // The table is released only now that the whole bill is settled.
      const tables = await successData(
        await request("/api/staff/tables", "staff tables", { method: "GET" }, jar),
        200,
        "staff tables",
      );
      const table = objects(tables.tables).find((candidate) => candidate.id === tableId);
      assert.equal(table?.activeOrder, null, "the table still shows an active order.");

      // A refund is money only: the order stays COMPLETED.
      const payments = objects(closed.payments);
      const refundable = payments.find((payment) => Number(payment.amount) > 0);
      assert.ok(refundable, "no payment to refund.");
      const refundAmount = Math.min(100, Number(refundable.amount)).toFixed(2);
      await successData(
        await send(
          jar,
          "POST",
          `/api/payments/${String(refundable.id)}/refund`,
          { amount: refundAmount, reasonCode: "CUSTOMER_COMPLAINT" },
          "refund",
          `p7split-${randomUUID()}`,
        ),
        [200, 201],
        "refund",
      );
      const afterRefund = await ledger(jar, orderId);
      assert.equal(
        afterRefund.orderStatus,
        "COMPLETED",
        "a refund must not re-open the order",
      );
      assert.equal(
        isObject(afterRefund.balance) && afterRefund.balance.refundedTotal,
        refundAmount,
      );
    });

    test("a part-paid table refuses to reset", async () => {
      const jar = await login(manager, "MANAGER");
      const tableId = await resolveTableId();
      const orderId = await servedOrder(jar, tableId, 2);

      try {
        const current = await ledger(jar, orderId);
        const total = Number(isObject(current.balance) ? current.balance.payableTotal : 0);
        await successData(
          await send(
            jar,
            "POST",
            "/api/payments",
            { orderId, method: "CASH", amount: (total / 2).toFixed(2) },
            "part payment",
            `p7split-${randomUUID()}`,
          ),
          [200, 201],
          "part payment",
        );

        const blocked = await send(jar, "POST", `/api/staff/tables/${tableId}/reset`, {}, "reset");
        assert.equal(blocked.status, 409, "a part-paid table was reset.");
        const payload: unknown = await blocked.json();
        assert.ok(
          isObject(payload) &&
            isObject(payload.error) &&
            payload.error.code === "TABLE_RESET_BLOCKED" &&
            isObject(payload.error.details) &&
            payload.error.details.reason === "OUTSTANDING_BALANCE",
          "reset did not report the outstanding balance.",
        );
      } finally {
        await cleanup(jar, orderId);
      }
    });

    test("an open split check blocks the reset", async () => {
      const jar = await login(manager, "MANAGER");
      const tableId = await resolveTableId();
      const orderId = await servedOrder(jar, tableId, 2);

      try {
        const before = await checksOf(jar, orderId);
        const orderItemId = String(objects(before.allocatableItems)[0]?.orderItemId);
        await successData(
          await send(
            jar,
            "POST",
            `/api/orders/${orderId}/checks`,
            {
              mode: "ITEMS",
              checks: [
                { items: [{ orderItemId, quantity: 1 }] },
                { items: [{ orderItemId, quantity: 1 }] },
              ],
            },
            "split",
          ),
          201,
          "split",
        );

        const blocked = await send(jar, "POST", `/api/staff/tables/${tableId}/reset`, {}, "reset");
        assert.equal(blocked.status, 409);
        assert.equal(await errorCode(blocked), "TABLE_RESET_BLOCKED");
      } finally {
        await cleanup(jar, orderId);
      }
    });

    test("two simultaneous collections cannot together overpay one check", async () => {
      const jar = await login(manager, "MANAGER");
      const tableId = await resolveTableId();
      const orderId = await servedOrder(jar, tableId, 2);

      try {
        const before = await checksOf(jar, orderId);
        const orderItemId = String(objects(before.allocatableItems)[0]?.orderItemId);
        const split = await successData(
          await send(
            jar,
            "POST",
            `/api/orders/${orderId}/checks`,
            {
              mode: "ITEMS",
              checks: [
                { items: [{ orderItemId, quantity: 1 }] },
                { items: [{ orderItemId, quantity: 1 }] },
              ],
            },
            "split",
          ),
          201,
          "split",
        );
        const target = objects(split.checks)[0];
        assert.ok(target, "no check to collect against.");
        const amount = String(target.total);

        // Genuinely concurrent: both requests are in flight at the same time
        // and only the database row lock decides the winner.
        const [first, second] = await Promise.all([
          send(
            jar,
            "POST",
            "/api/payments",
            { orderId, method: "CASH", checkId: String(target.id), amount },
            "concurrent A",
            `p7split-${randomUUID()}`,
          ),
          send(
            jar,
            "POST",
            "/api/payments",
            { orderId, method: "CARD", checkId: String(target.id), amount },
            "concurrent B",
            `p7split-${randomUUID()}`,
          ),
        ]);

        const accepted = [first, second].filter((response) => response.status < 400);
        assert.equal(accepted.length, 1, "both concurrent collections were accepted.");

        const after = await checksOf(jar, orderId);
        const settled = objects(after.checks).find((check) => check.id === target.id);
        assert.equal(Number(settled?.paidTotal), Number(amount), "the check was overpaid.");
      } finally {
        await cleanup(jar, orderId);
      }
    });

    test("a check edit is closed to the wrong role and the wrong tenant", async () => {
      const jar = await login(manager, "MANAGER");
      const tableId = await resolveTableId();
      const orderId = await servedOrder(jar, tableId, 2);

      try {
        const before = await checksOf(jar, orderId);
        const orderItemId = String(objects(before.allocatableItems)[0]?.orderItemId);
        const split = await successData(
          await send(
            jar,
            "POST",
            `/api/orders/${orderId}/checks`,
            {
              mode: "ITEMS",
              checks: [
                { items: [{ orderItemId, quantity: 1 }] },
                { items: [{ orderItemId, quantity: 1 }] },
              ],
            },
            "split",
          ),
          201,
          "split",
        );
        const checkId = String(objects(split.checks)[0]?.id);

        const waiter = await login(environment.waiter, "WAITER");
        assert.equal(
          (
            await send(
              waiter,
              "PATCH",
              `/api/orders/${orderId}/checks/${checkId}`,
              { label: "Yeni" },
              "waiter edit",
            )
          ).status,
          403,
          "a waiter could edit a check.",
        );

        const kitchen = await login(environment.kitchen, "KITCHEN");
        assert.equal(
          (
            await send(
              kitchen,
              "PATCH",
              `/api/orders/${orderId}/checks/${checkId}`,
              { label: "Yeni" },
              "kitchen edit",
            )
          ).status,
          403,
          "the kitchen role could edit a check.",
        );

        const foreign = await login(environment.otherTenantStaff, "OTHER_TENANT");
        const crossTenant = await send(
          foreign,
          "PATCH",
          `/api/orders/${orderId}/checks/${checkId}`,
          { label: "Yeni" },
          "cross-tenant edit",
        );
        assert.equal(crossTenant.status, 404, "a cross-tenant check was reachable.");
        assert.equal(await errorCode(crossTenant), "ORDER_NOT_FOUND");
      } finally {
        await cleanup(jar, orderId);
      }
    });
  });
}

/** Clears only this fixture's rate-limit buckets between tests. */
async function withFixtureRateLimitReset(
  e: { waiter: { identifier: string }; kitchen: { identifier: string };
       cashier: { identifier: string }; otherTenantStaff: { identifier: string };
       admin: { identifier: string } | null },
): Promise<void> {
  const { readSupabaseIntegrationEnvironment } = await import("./supabase-test-environment");
  const readiness = readSupabaseIntegrationEnvironment({ requireDatabaseUrl: true });
  if (!readiness.ready) return;
  const { resetFixtureRateLimits } = await import("./rate-limit-reset");
  const postgresModule = await import("postgres");
  const sql = postgresModule.default(readiness.environment.databaseUrl!, {
    max: 1, prepare: false, onnotice: () => {},
  });
  try {
    await resetFixtureRateLimits(sql, [
      e.waiter.identifier, e.kitchen.identifier, e.cashier.identifier,
      e.otherTenantStaff.identifier, ...(e.admin ? [e.admin.identifier] : []),
    ].map((value) => value.toLowerCase()));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Clears transactional rows left by an earlier suite on the shared fixture. */
async function withFixtureTransactionReset(): Promise<void> {
  const fs = await import("node:fs");
  if (!fs.existsSync(".phase7d3-fixture.json")) return;
  const fixture = JSON.parse(fs.readFileSync(".phase7d3-fixture.json", "utf8")) as {
    restaurantA: string; restaurantB: string;
  };
  const { readSupabaseIntegrationEnvironment } = await import("./supabase-test-environment");
  const readiness = readSupabaseIntegrationEnvironment({ requireDatabaseUrl: true });
  if (!readiness.ready) return;
  const { resetFixtureTransactions } = await import("./rate-limit-reset");
  const postgresModule = await import("postgres");
  const sql = postgresModule.default(readiness.environment.databaseUrl!, {
    max: 1, prepare: false, onnotice: () => {},
  });
  try {
    await resetFixtureTransactions(sql, [fixture.restaurantA, fixture.restaurantB]);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
