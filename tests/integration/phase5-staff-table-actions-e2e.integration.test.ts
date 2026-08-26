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

if (!readiness.ready) {
  test("Phase 5 staff table actions E2E", { skip: readiness.reason }, () => undefined);
} else {
  const environment = readiness.environment;

  async function request(
    path: string,
    label: string,
    init: RequestInit = {},
    jar?: CookieJar,
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("User-Agent", "sehir-lokantasi-phase5-table-actions-e2e");
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

  function post(jar: CookieJar, path: string, body: JsonObject, label: string, key?: string) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Origin: environment.baseUrl.origin,
    };
    if (key) headers["Idempotency-Key"] = key;
    return request(path, label, { method: "POST", headers, body: JSON.stringify(body) }, jar);
  }

  function patch(jar: CookieJar, path: string, body: JsonObject, label: string) {
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

  /** The fixture table is identified through its QR session, never hard-coded. */
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

  async function staffTable(jar: CookieJar, tableId: string): Promise<JsonObject> {
    const data = await successData(
      await request("/api/staff/tables", "staff tables", { method: "GET" }, jar),
      200,
      "staff tables",
    );
    const table = objects(data.tables).find((candidate) => candidate.id === tableId);
    assert.ok(table, "the fixture table is missing from the staff floor.");
    return table;
  }

  async function staffCalls(jar: CookieJar): Promise<JsonObject[]> {
    const data = await successData(
      await request("/api/staff/calls", "staff calls", { method: "GET" }, jar),
      200,
      "staff calls",
    );
    return objects(data.calls);
  }

  async function resolveCall(jar: CookieJar, callId: string): Promise<void> {
    const response = await patch(
      jar,
      `/api/staff/calls/${callId}`,
      { status: "RESOLVED" },
      "resolve call",
    );
    assert.ok([200, 409].includes(response.status), "call could not be resolved.");
  }

  describe("Phase 5 staff table actions E2E", () => {
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

    test("a bill request opened from the table card is one row on every screen", async () => {
      const waiter = await login(environment.waiter, "WAITER");
      const tableId = await resolveTableId();

      const first = await post(
        waiter,
        "/api/staff/calls",
        { tableId, type: "BILL_REQUEST" },
        "open bill request",
      );
      const created = await successData(first, [200, 201], "open bill request");
      const callId = String(created.id);

      try {
        // Table grid: the table now reads as bill-requested.
        assert.equal(
          (await staffTable(waiter, tableId)).status,
          "BILL_REQUESTED",
          "the table grid did not follow the bill request.",
        );

        // Calls screen: the same row, still open.
        const listed = (await staffCalls(waiter)).find((call) => call.id === callId);
        assert.ok(listed, "the bill request is missing from the calls screen.");
        assert.ok(
          listed.status === "OPEN" || listed.status === "ACKNOWLEDGED",
          "the calls screen shows a different status than the table card.",
        );

        // A second tap must replay, not open a parallel request.
        const second = await post(
          waiter,
          "/api/staff/calls",
          { tableId, type: "BILL_REQUEST" },
          "repeat bill request",
        );
        assert.equal(second.status, 200, "a repeated bill request was not replayed.");
        const replayed = await successData(second, 200, "repeat bill request");
        assert.equal(replayed.id, callId, "a duplicate bill request row was created.");

        const active = (await staffCalls(waiter)).filter(
          (call) =>
            isObject(call.table) &&
            call.table.id === tableId &&
            call.type === "BILL_REQUEST" &&
            (call.status === "OPEN" || call.status === "ACKNOWLEDGED"),
        );
        assert.equal(active.length, 1, "the table has more than one active bill request.");
      } finally {
        await resolveCall(waiter, callId);
      }

      // Resolving from the table card is visible on the calls screen and clears
      // the table badge, so the two screens never disagree.
      const afterResolve = (await staffCalls(waiter)).find((call) => call.id === callId);
      assert.equal(afterResolve?.status, "RESOLVED", "the resolved call did not persist.");
      assert.notEqual(
        (await staffTable(waiter, tableId)).status,
        "BILL_REQUESTED",
        "the table kept its bill badge after the request was cleared.",
      );
    });

    test("a table note is recorded without repainting the table status", async () => {
      const waiter = await login(environment.waiter, "WAITER");
      const tableId = await resolveTableId();
      const before = String((await staffTable(waiter, tableId)).status);

      const created = await successData(
        await post(
          waiter,
          "/api/staff/calls",
          { tableId, type: "OTHER", requestLabel: "Masa notu", notes: "E2E note" },
          "open table note",
        ),
        [200, 201],
        "open table note",
      );
      const callId = String(created.id);

      try {
        assert.equal(
          (await staffTable(waiter, tableId)).status,
          before,
          "a table note changed the operational table status.",
        );
        const listed = (await staffCalls(waiter)).find((call) => call.id === callId);
        assert.equal(listed?.requestLabel, "Masa notu", "the note lost its label.");
        assert.equal(listed?.notes, "E2E note", "the note text was not persisted.");
      } finally {
        await resolveCall(waiter, callId);
      }
    });

    test("an order opened from the table card reaches the orders screen and the grid", async () => {
      const waiter = await login(environment.waiter, "WAITER");
      const tableId = await resolveTableId();
      const idempotencyKey = `phase5-${randomUUID()}`;
      const body = { tableId, items: [{ productId: environment.productId, quantity: 1 }] };

      const created = await successData(
        await post(waiter, "/api/staff/orders", body, "staff order", idempotencyKey),
        [200, 201],
        "staff order",
      );
      const orderId = String(created.orderId);
      assert.equal(created.status, "NEW", "a staff order did not start at NEW.");

      // Replay: the same key returns the same order rather than charging twice.
      const replay = await post(waiter, "/api/staff/orders", body, "staff order replay", idempotencyKey);
      assert.equal(replay.status, 200, "a replayed staff order was not answered with 200.");
      const replayed = await successData(replay, 200, "staff order replay");
      assert.equal(replayed.orderId, orderId, "the replay created a second order.");
      assert.equal(replayed.replayed, true, "the replay was not reported as a replay.");

      // Orders screen sees it.
      const orders = await successData(
        await request(
          `/api/staff/orders?tableId=${encodeURIComponent(tableId)}`,
          "staff orders",
          { method: "GET" },
          waiter,
        ),
        200,
        "staff orders",
      );
      const listed = objects(orders.orders).find((order) => order.id === orderId);
      assert.ok(listed, "the staff order is missing from the orders screen.");

      // Table grid resolves the very same order as the table's active one.
      const table = await staffTable(waiter, tableId);
      assert.ok(isObject(table.activeOrder), "the table grid shows no active order.");
      assert.equal(
        table.activeOrder.id,
        orderId,
        "the table grid and the orders screen disagree about the active order.",
      );

      // The table-card confirm shortcut is the shared order status endpoint.
      const confirmed = await successData(
        await patch(waiter, `/api/orders/${orderId}/status`, { status: "CONFIRMED" }, "confirm"),
        200,
        "confirm",
      );
      assert.equal(confirmed.status, "CONFIRMED", "the order was not confirmed.");

      const afterConfirm = objects(
        (
          await successData(
            await request(
              `/api/staff/orders?tableId=${encodeURIComponent(tableId)}`,
              "staff orders after confirm",
              { method: "GET" },
              waiter,
            ),
            200,
            "staff orders after confirm",
          )
        ).orders,
      ).find((order) => order.id === orderId);
      assert.equal(
        afterConfirm?.status,
        "CONFIRMED",
        "the orders screen kept a stale status after the table-card action.",
      );

      if (environment.admin) {
        // Leave the disposable fixture without a dangling open order.
        const admin = await login(environment.admin, "ADMIN");
        await patch(admin, `/api/orders/${orderId}/status`, { status: "CANCELLED" }, "cleanup");
      }
    });

    test("the table-card endpoints are closed to the wrong role and the wrong tenant", async () => {
      const tableId = await resolveTableId();

      const kitchen = await login(environment.kitchen, "KITCHEN");
      assert.equal(
        (await post(kitchen, "/api/staff/calls", { tableId, type: "WAITER_CALL" }, "kitchen call"))
          .status,
        403,
        "the kitchen role could open a service request.",
      );

      const cashier = await login(environment.cashier, "CASHIER");
      assert.equal(
        (
          await post(
            cashier,
            "/api/staff/orders",
            { tableId, items: [{ productId: environment.productId, quantity: 1 }] },
            "cashier order",
            `phase5-${randomUUID()}`,
          )
        ).status,
        403,
        "a cashier could open an order.",
      );
      assert.equal(
        (await post(cashier, "/api/staff/calls", { tableId, type: "WAITER_CALL" }, "cashier call"))
          .status,
        403,
        "a cashier could open a waiter call.",
      );

      // Another restaurant's waiter must not reach this table at all.
      const foreign = await login(environment.otherTenantStaff, "OTHER_TENANT");
      const foreignCall = await post(
        foreign,
        "/api/staff/calls",
        { tableId, type: "WAITER_CALL" },
        "cross-tenant call",
      );
      assert.equal(foreignCall.status, 404, "a cross-tenant table was reachable.");
      const foreignOrder = await post(
        foreign,
        "/api/staff/orders",
        { tableId, items: [{ productId: environment.productId, quantity: 1 }] },
        "cross-tenant order",
        `phase5-${randomUUID()}`,
      );
      assert.ok(
        [403, 404].includes(foreignOrder.status),
        "a cross-tenant staff order was not refused.",
      );
    });

    test("an unauthenticated caller cannot touch any table-card endpoint", async () => {
      const tableId = await resolveTableId();
      const anonymous = new CookieJar();

      assert.equal(
        (await post(anonymous, "/api/staff/calls", { tableId, type: "WAITER_CALL" }, "anonymous call"))
          .status,
        401,
        "an anonymous caller could open a service request.",
      );
      assert.equal(
        (
          await post(
            anonymous,
            "/api/staff/orders",
            { tableId, items: [{ productId: environment.productId, quantity: 1 }] },
            "anonymous order",
            `phase5-${randomUUID()}`,
          )
        ).status,
        401,
        "an anonymous caller could open an order.",
      );
      assert.equal(
        (await request("/api/staff/menu", "anonymous menu", { method: "GET" })).status,
        401,
        "the staff menu is readable without a session.",
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
