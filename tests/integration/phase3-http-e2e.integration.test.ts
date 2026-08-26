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

function stringProperty(value: JsonObject, key: string): string {
  const property = value[key];
  assert.equal(typeof property, "string", `HTTP E2E response is missing ${key}.`);
  return property as string;
}

class CookieJar {
  private readonly values = new Map<string, string>();

  absorb(headers: Headers): readonly string[] {
    const setCookies = headers.getSetCookie();
    for (const setCookie of setCookies) {
      const firstSeparator = setCookie.indexOf(";");
      const pair = firstSeparator >= 0 ? setCookie.slice(0, firstSeparator) : setCookie;
      const equals = pair.indexOf("=");
      if (equals <= 0) continue;
      const name = pair.slice(0, equals).trim();
      const value = pair.slice(equals + 1).trim();
      const lower = setCookie.toLowerCase();
      if (!value || lower.includes("max-age=0")) this.values.delete(name);
      else this.values.set(name, value);
    }
    return setCookies;
  }

  header(): string | null {
    if (this.values.size === 0) return null;
    return [...this.values].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  has(name: string): boolean {
    return this.values.has(name);
  }

  hasNameStartingWith(prefix: string): boolean {
    return [...this.values.keys()].some((name) => name.startsWith(prefix));
  }
}

if (!readiness.ready) {
  test("Phase 3 HTTP/Auth/cookie E2E", { skip: readiness.reason }, () => undefined);
} else {
  const environment = readiness.environment;

  async function request(
    path: string,
    label: string,
    init: RequestInit = {},
    cookieJar?: CookieJar,
  ): Promise<{ readonly response: Response; readonly setCookies: readonly string[] }> {
    const headers = new Headers(init.headers);
    headers.set("User-Agent", "sehir-lokantasi-phase3-http-e2e");
    headers.set("Accept", headers.get("Accept") ?? "application/json");
    const cookie = cookieJar?.header();
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
      // Do not attach the original fetch error: it can include a URL carrying
      // the raw QR credential.
      throw new Error(`${label} request failed before receiving a response.`);
    }
    const setCookies = cookieJar?.absorb(response.headers) ?? response.headers.getSetCookie();
    return { response, setCookies };
  }

  function assertStatus(
    response: Response,
    expected: number | readonly number[],
    label: string,
  ): void {
    const statuses = Array.isArray(expected) ? expected : [expected];
    assert.ok(
      statuses.includes(response.status),
      `${label} returned unexpected HTTP ${response.status}.`,
    );
  }

  async function jsonObject(response: Response, label: string): Promise<JsonObject> {
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error(`${label} did not return a JSON object.`);
    }
    assert.ok(isObject(payload), `${label} did not return a JSON object.`);
    return payload;
  }

  async function successData(
    response: Response,
    expectedStatus: number | readonly number[],
    label: string,
  ): Promise<JsonObject> {
    assertStatus(response, expectedStatus, label);
    const payload = await jsonObject(response, label);
    assert.equal(payload.success, true, `${label} did not return a success envelope.`);
    assert.ok(isObject(payload.data), `${label} did not return response data.`);
    return payload.data;
  }

  async function login(
    credential: HttpE2eStaffCredential,
    label: string,
  ): Promise<CookieJar> {
    const jar = new CookieJar();
    const { response } = await request(
      "/api/staff/login",
      `${label} login`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: environment.baseUrl.origin,
        },
        body: JSON.stringify(credential),
      },
      jar,
    );
    assertStatus(response, 200, `${label} login`);
    const payload = await jsonObject(response, `${label} login`);
    assert.equal(typeof payload.redirectTo, "string", `${label} login lacked a redirect.`);
    assert.ok(
      jar.hasNameStartingWith("sb-"),
      `${label} login did not issue a Supabase Auth session cookie.`,
    );
    return jar;
  }

  async function staffOrders(jar: CookieJar, label: string): Promise<JsonObject[]> {
    const { response } = await request(
      "/api/staff/orders?limit=100",
      `${label} staff orders`,
      { method: "GET" },
      jar,
    );
    const data = await successData(response, 200, `${label} staff orders`);
    return objects(data.orders);
  }

  async function changeOrderStatus(
    jar: CookieJar,
    orderId: string,
    status: string,
    label: string,
  ): Promise<void> {
    const { response } = await request(
      `/api/orders/${encodeURIComponent(orderId)}/status`,
      label,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Origin: environment.baseUrl.origin,
          "X-Request-Id": `phase3-http-${randomUUID()}`,
        },
        body: JSON.stringify({ status }),
      },
      jar,
    );
    const data = await successData(response, 200, label);
    assert.equal(data.status, status, `${label} returned an unexpected status.`);
  }

  describe("Phase 3 real HTTP boundary", { concurrency: false }, () => {
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

    test("secure table cookie, customer APIs and Supabase-authenticated role flow work end to end", {
      timeout: 180_000,
    }, async () => {
      const customer = new CookieJar();
      const { response: gateResponse, setCookies: gateCookies } = await request(
        `/menu/${encodeURIComponent(environment.rawTableToken)}`,
        "secure menu gate",
        { method: "GET", headers: { Accept: "text/html" } },
        customer,
      );
      assertStatus(gateResponse, 200, "secure menu gate");
      const tableCookie = gateCookies.find((value) =>
        value.startsWith("sehir_table_session="),
      );
      assert.ok(tableCookie, "secure menu gate did not issue the table session cookie.");
      assert.ok(/;\s*httponly(?:;|$)/i.test(tableCookie), "table cookie is not HttpOnly.");
      assert.ok(/;\s*samesite=lax(?:;|$)/i.test(tableCookie), "table cookie is not SameSite=Lax.");
      if (environment.baseUrl.protocol === "https:") {
        assert.ok(/;\s*secure(?:;|$)/i.test(tableCookie), "remote table cookie is not Secure.");
      }
      assert.equal(
        tableCookie.includes(environment.rawTableToken),
        false,
        "raw QR credential was copied into the session cookie.",
      );
      assert.ok(customer.has("sehir_table_session"));

      const { response: menuResponse } = await request(
        "/api/menu",
        "customer menu",
        { method: "GET" },
        customer,
      );
      const menu = await successData(menuResponse, 200, "customer menu");
      const menuProducts = objects(menu.categories).flatMap((category) =>
        objects(category.products),
      );
      assert.ok(
        menuProducts.some((product) => product.id === environment.productId),
        "configured order product is absent from the secured menu.",
      );

      const idempotencyKey = `phase3-http-${randomUUID()}`;
      const orderBody = JSON.stringify({
        items: [{ productId: environment.productId, quantity: 1 }],
        notes: "Phase 3 disposable HTTP E2E",
      });
      const { response: csrfResponse } = await request(
        "/api/orders",
        "cross-site request protection",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": `${idempotencyKey}-csrf-check`,
          },
          body: orderBody,
        },
        customer,
      );
      assertStatus(csrfResponse, 403, "cross-site request protection");

      const createOrder = () => request(
        "/api/orders",
        "customer order",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey,
            Origin: environment.baseUrl.origin,
          },
          body: orderBody,
        },
        customer,
      );
      const firstOrderResponse = (await createOrder()).response;
      const created = await successData(firstOrderResponse, 201, "customer order");
      const orderId = stringProperty(created, "orderId");
      assert.equal(created.status, "NEW");
      assert.equal(created.replayed, false);

      const replayResponse = (await createOrder()).response;
      const replayed = await successData(replayResponse, 200, "idempotent order replay");
      assert.equal(replayed.orderId, orderId);
      assert.equal(replayed.replayed, true);

      const { response: activeResponse } = await request(
        "/api/orders/active",
        "active customer orders",
        { method: "GET" },
        customer,
      );
      const active = await successData(activeResponse, 200, "active customer orders");
      assert.ok(
        objects(active.orders).some((order) => order.id === orderId),
        "new order is absent from the table-scoped active-order endpoint.",
      );

      const { response: callResponse } = await request(
        "/api/calls",
        "waiter call",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: environment.baseUrl.origin,
          },
          body: JSON.stringify({ notes: "Phase 3 HTTP E2E" }),
        },
        customer,
      );
      const call = await successData(callResponse, [200, 201], "waiter call");
      const waiterCallId = stringProperty(call, "id");

      const { response: billResponse } = await request(
        "/api/bill-requests",
        "bill request",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: environment.baseUrl.origin,
          },
          body: JSON.stringify({ notes: "Phase 3 HTTP E2E" }),
        },
        customer,
      );
      const bill = await successData(billResponse, [200, 201], "bill request");
      const billRequestId = stringProperty(bill, "id");

      const [waiter, kitchen, cashier] = await Promise.all([
        login(environment.waiter, "WAITER"),
        login(environment.kitchen, "KITCHEN"),
        login(environment.cashier, "CASHIER"),
      ]);
      for (const [jar, role] of [
        [waiter, "WAITER"],
        [kitchen, "KITCHEN"],
        [cashier, "CASHIER"],
      ] as const) {
        assert.ok(
          (await staffOrders(jar, role)).some((order) => order.id === orderId),
          `${role} cannot see the restaurant-scoped order.`,
        );
      }

      const otherTenant = await login(
        environment.otherTenantStaff,
        "OTHER TENANT STAFF",
      );
      assert.equal(
        (await staffOrders(otherTenant, "OTHER TENANT STAFF")).some(
          (order) => order.id === orderId,
        ),
        false,
        "another restaurant's staff could read the created order",
      );

      const { response: staffCallsResponse } = await request(
        "/api/staff/calls?limit=100",
        "WAITER staff calls",
        { method: "GET" },
        waiter,
      );
      const staffCalls = await successData(staffCallsResponse, 200, "WAITER staff calls");
      const waiterVisibleCallIds = new Set(
        objects(staffCalls.calls).map((item) => item.id),
      );
      assert.ok(waiterVisibleCallIds.has(waiterCallId));
      assert.ok(waiterVisibleCallIds.has(billRequestId));

      const { response: cashierCallsResponse } = await request(
        "/api/staff/calls?limit=100",
        "CASHIER staff calls",
        { method: "GET" },
        cashier,
      );
      const cashierCalls = await successData(
        cashierCallsResponse,
        200,
        "CASHIER staff calls",
      );
      const cashierVisibleCallIds = new Set(
        objects(cashierCalls.calls).map((item) => item.id),
      );
      assert.ok(cashierVisibleCallIds.has(billRequestId));
      assert.equal(cashierVisibleCallIds.has(waiterCallId), false);

      await changeOrderStatus(waiter, orderId, "CONFIRMED", "WAITER confirm");
      await changeOrderStatus(kitchen, orderId, "PREPARING", "KITCHEN prepare");
      await changeOrderStatus(kitchen, orderId, "READY", "KITCHEN ready");
      await changeOrderStatus(waiter, orderId, "SERVED", "WAITER serve");
      await changeOrderStatus(cashier, orderId, "COMPLETED", "CASHIER complete");

      const completedOrders = await staffOrders(cashier, "CASHIER completed");
      const completed = completedOrders.find((order) => order.id === orderId);
      assert.equal(completed?.status, "COMPLETED");

      const { response: closedActiveResponse } = await request(
        "/api/orders/active",
        "active orders after completion",
        { method: "GET" },
        customer,
      );
      const closedActive = await successData(
        closedActiveResponse,
        200,
        "active orders after completion",
      );
      assert.equal(
        objects(closedActive.orders).some((order) => order.id === orderId),
        false,
        "completed order remained in the active customer list.",
      );
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
