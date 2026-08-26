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

const adminCredential = readiness.ready ? readiness.environment.admin : null;

if (!readiness.ready) {
  test("Phase 4 admin/payment E2E", { skip: readiness.reason }, () => undefined);
} else if (!adminCredential) {
  test(
    "Phase 4 admin/payment E2E",
    { skip: "Set SEHIR_HTTP_E2E_ADMIN_IDENTIFIER/PASSWORD to run the admin CRUD flow." },
    () => undefined,
  );
} else {
  const environment = readiness.environment;
  const admin = adminCredential;

  async function request(
    path: string,
    label: string,
    init: RequestInit = {},
    jar?: CookieJar,
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("User-Agent", "sehir-lokantasi-phase4-admin-e2e");
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
      // The original error can carry the raw QR credential in a URL.
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

  async function openCustomerSession(): Promise<CookieJar> {
    const jar = new CookieJar();
    const response = await request(
      "/api/table-sessions",
      "customer session",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: environment.baseUrl.origin },
        body: JSON.stringify({ tableToken: environment.rawTableToken }),
      },
      jar,
    );
    assert.ok([200, 201].includes(response.status), "customer session was not issued.");
    return jar;
  }

  async function customerMenuProduct(jar: CookieJar): Promise<JsonObject | undefined> {
    const response = await request("/api/menu", "customer menu", { method: "GET" }, jar);
    const data = await successData(response, 200, "customer menu");
    return objects(data.categories)
      .flatMap((category) => objects(category.products))
      .find((product) => product.id === environment.productId);
  }

  function adminPatch(jar: CookieJar, path: string, body: JsonObject, label: string) {
    return request(
      path,
      label,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Origin: environment.baseUrl.origin },
        body: JSON.stringify(body),
      },
      jar,
    );
  }

  describe("Phase 4 admin/payment E2E", () => {
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

    test("an admin price change reaches the customer menu on the next read", async () => {
      const adminJar = await login(admin, "ADMIN");
      const customer = await openCustomerSession();

      const before = await customerMenuProduct(customer);
      assert.ok(before, "test product is not visible on the customer menu.");
      const originalPrice = String(before.price);
      const bumped = (Number(originalPrice) + 1).toFixed(2);

      try {
        await successData(
          await adminPatch(
            adminJar,
            `/api/admin/products/${environment.productId}`,
            { price: bumped },
            "admin price change",
          ),
          200,
          "admin price change",
        );

        const after = await customerMenuProduct(customer);
        assert.equal(after?.price, bumped, "customer menu kept the previous price.");
      } finally {
        await adminPatch(
          adminJar,
          `/api/admin/products/${environment.productId}`,
          { price: originalPrice },
          "admin price restore",
        );
      }
    });

    test("a sold-out product is rejected by the order API, not only hidden in the UI", async () => {
      const adminJar = await login(admin, "ADMIN");
      const customer = await openCustomerSession();

      await successData(
        await adminPatch(
          adminJar,
          `/api/admin/products/${environment.productId}`,
          { isAvailable: false },
          "admin sold out",
        ),
        200,
        "admin sold out",
      );

      try {
        const menuProduct = await customerMenuProduct(customer);
        assert.equal(menuProduct?.isAvailable, false, "menu still advertises the item.");

        const rejected = await request(
          "/api/orders",
          "sold-out order",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Origin: environment.baseUrl.origin,
              "Idempotency-Key": randomUUID(),
            },
            body: JSON.stringify({ items: [{ productId: environment.productId, quantity: 1 }] }),
          },
          customer,
        );
        assert.equal(rejected.status, 409, "sold-out order was not rejected.");
        const payload: unknown = await rejected.json();
        assert.ok(isObject(payload) && isObject(payload.error));
        assert.equal(payload.error.code, "PRODUCT_UNAVAILABLE");
      } finally {
        await adminPatch(
          adminJar,
          `/api/admin/products/${environment.productId}`,
          { isAvailable: true },
          "admin restore availability",
        );
      }
    });

    test("a waiter cannot reach admin menu mutations", async () => {
      const waiter = await login(environment.waiter, "WAITER");
      const forbidden = await adminPatch(
        waiter,
        `/api/admin/products/${environment.productId}`,
        { isAvailable: false },
        "waiter admin mutation",
      );
      assert.equal(forbidden.status, 403, "waiter reached an admin mutation.");
    });

    test("a kitchen account cannot take a payment", async () => {
      const kitchen = await login(environment.kitchen, "KITCHEN");
      const forbidden = await request(
        "/api/payments",
        "kitchen payment",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: environment.baseUrl.origin,
            "Idempotency-Key": randomUUID(),
          },
          body: JSON.stringify({ orderId: randomUUID(), method: "CASH" }),
        },
        kitchen,
      );
      assert.equal(forbidden.status, 403, "kitchen reached the payment endpoint.");
    });

    test("the payment endpoint refuses a second collection for the same order", async () => {
      const customer = await openCustomerSession();
      const waiter = await login(environment.waiter, "WAITER");
      const kitchen = await login(environment.kitchen, "KITCHEN");
      const cashier = await login(environment.cashier, "CASHIER");

      const created = await successData(
        await request(
          "/api/orders",
          "payment flow order",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Origin: environment.baseUrl.origin,
              "Idempotency-Key": randomUUID(),
            },
            body: JSON.stringify({ items: [{ productId: environment.productId, quantity: 1 }] }),
          },
          customer,
        ),
        [200, 201],
        "payment flow order",
      );
      const orderId = String(created.orderId);

      async function advance(jar: CookieJar, status: string) {
        const response = await request(
          `/api/orders/${encodeURIComponent(orderId)}/status`,
          `advance to ${status}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json", Origin: environment.baseUrl.origin },
            body: JSON.stringify({ status }),
          },
          jar,
        );
        assert.equal(response.status, 200, `advance to ${status} failed.`);
      }

      await advance(waiter, "CONFIRMED");
      await advance(kitchen, "PREPARING");
      await advance(kitchen, "READY");
      await advance(waiter, "SERVED");

      const idempotencyKey = randomUUID();
      function collect(key: string) {
        return request(
          "/api/payments",
          "cashier payment",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Origin: environment.baseUrl.origin,
              "Idempotency-Key": key,
            },
            body: JSON.stringify({ orderId, method: "CASH" }),
          },
          cashier,
        );
      }

      const first = await successData(await collect(idempotencyKey), [200, 201], "cashier payment");
      assert.equal(first.status, "COMPLETED");

      // Same key replays the receipt; a different key must be refused.
      const replay = await successData(await collect(idempotencyKey), 200, "payment replay");
      assert.equal(replay.paymentId, first.paymentId);
      assert.equal(replay.replayed, true);

      const duplicate = await collect(randomUUID());
      assert.equal(duplicate.status, 409, "a second collection was accepted.");
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
