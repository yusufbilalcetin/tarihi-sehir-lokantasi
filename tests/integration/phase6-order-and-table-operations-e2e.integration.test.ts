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

const managerCredential = readiness.ready ? readiness.environment.admin : null;

if (!readiness.ready) {
  test("Phase 6 order and table operations E2E", { skip: readiness.reason }, () => undefined);
} else if (!managerCredential) {
  test(
    "Phase 6 order and table operations E2E",
    {
      skip:
        "Set SEHIR_HTTP_E2E_ADMIN_IDENTIFIER/PASSWORD; cancellation and table merge need a supervisory role.",
    },
    () => undefined,
  );
} else {
  const environment = readiness.environment;
  const manager = managerCredential;

  async function request(
    path: string,
    label: string,
    init: RequestInit = {},
    jar?: CookieJar,
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("User-Agent", "sehir-lokantasi-phase6-e2e");
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

  async function staffOrder(jar: CookieJar, orderId: string): Promise<JsonObject> {
    const data = await successData(
      await request("/api/staff/orders", "staff orders", { method: "GET" }, jar),
      200,
      "staff orders",
    );
    const order = objects(data.orders).find((candidate) => candidate.id === orderId);
    assert.ok(order, "the order vanished from the staff order list.");
    return order;
  }

  async function staffTable(jar: CookieJar, tableId: string): Promise<JsonObject> {
    const data = await successData(
      await request("/api/staff/tables", "staff tables", { method: "GET" }, jar),
      200,
      "staff tables",
    );
    const table = objects(data.tables).find((candidate) => candidate.id === tableId);
    assert.ok(table, "the table is missing from the staff floor.");
    return table;
  }

  /** Opens a fresh order the test fully owns, so nothing else is disturbed. */
  async function openOrder(jar: CookieJar, tableId: string): Promise<JsonObject> {
    return successData(
      await post(
        jar,
        "/api/staff/orders",
        { tableId, items: [{ productId: environment.productId, quantity: 1 }] },
        "open order",
        `phase6-${randomUUID()}`,
      ),
      [200, 201],
      "open order",
    );
  }

  async function cancelOrder(jar: CookieJar, orderId: string): Promise<void> {
    await post(
      jar,
      `/api/orders/${orderId}/cancel`,
      { reason: "Diğer", reasonNote: "phase6 e2e cleanup" },
      "cleanup cancel",
    );
  }

  describe("Phase 6 order and table operations E2E", () => {
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

    test("a later round joins the running order and every screen agrees", async () => {
      const jar = await login(manager, "MANAGER");
      const tableId = await resolveTableId();
      const created = await openOrder(jar, tableId);
      const orderId = String(created.orderId);

      try {
        const before = await staffOrder(jar, orderId);
        const beforeTotal = Number((before.amounts as JsonObject).total);
        const beforeItemCount = objects(before.items).length;

        const key = `phase6-add-${randomUUID()}`;
        const added = await successData(
          await post(
            jar,
            `/api/orders/${orderId}/items`,
            { items: [{ productId: environment.productId, quantity: 2 }] },
            "add items",
            key,
          ),
          [200, 201],
          "add items",
        );
        assert.equal(objects(added.addedItems).length, 1);

        // Replaying the same key must not add the round twice.
        const replay = await post(
          jar,
          `/api/orders/${orderId}/items`,
          { items: [{ productId: environment.productId, quantity: 2 }] },
          "add items replay",
          key,
        );
        assert.equal(replay.status, 200, "a replayed addition was not answered with 200.");
        const replayed = await successData(replay, 200, "add items replay");
        assert.equal(replayed.replayed, true);

        const after = await staffOrder(jar, orderId);
        assert.equal(
          objects(after.items).length,
          beforeItemCount + 1,
          "the addition was applied more than once.",
        );
        const afterTotal = Number((after.amounts as JsonObject).total);
        assert.ok(afterTotal > beforeTotal, "the order total did not grow.");
        assert.equal(
          Number((added.amounts as JsonObject).total),
          afterTotal,
          "the add-items response and the orders screen disagree on the total.",
        );

        // The table grid resolves the same order with the same money.
        const table = await staffTable(jar, tableId);
        assert.ok(isObject(table.activeOrder), "the table grid lost the active order.");
        assert.equal(Number(table.activeOrder.total), afterTotal);
      } finally {
        await cancelOrder(jar, orderId);
      }
    });

    test("cancelling a line keeps the row and shrinks the total", async () => {
      const jar = await login(manager, "MANAGER");
      const tableId = await resolveTableId();
      const created = await openOrder(jar, tableId);
      const orderId = String(created.orderId);

      try {
        const before = await staffOrder(jar, orderId);
        const items = objects(before.items);
        assert.ok(items.length > 0, "the new order has no lines.");
        const itemId = String(items[0]?.id);
        const beforeTotal = Number((before.amounts as JsonObject).total);

        const result = await successData(
          await post(
            jar,
            `/api/orders/${orderId}/items/${itemId}/cancel`,
            { reason: "Müşteri vazgeçti" },
            "cancel item",
          ),
          200,
          "cancel item",
        );
        assert.equal(result.status, "CANCELLED");

        const after = await staffOrder(jar, orderId);
        const cancelled = objects(after.items).find((item) => item.id === itemId);
        // Soft cancellation: the line is still there, marked cancelled.
        assert.ok(cancelled, "the cancelled line was deleted instead of marked.");
        assert.equal(cancelled.status, "CANCELLED");
        assert.ok(
          Number((after.amounts as JsonObject).total) < beforeTotal,
          "the total did not drop after the cancellation.",
        );

        // A second attempt is refused rather than silently repeated.
        const again = await post(
          jar,
          `/api/orders/${orderId}/items/${itemId}/cancel`,
          { reason: "Müşteri vazgeçti" },
          "cancel item again",
        );
        assert.equal(again.status, 409, "a repeated line cancellation was accepted.");
      } finally {
        await cancelOrder(jar, orderId);
      }
    });

    test("a party moves to an empty table and the orders follow", async () => {
      const jar = await login(manager, "MANAGER");
      const sourceTableId = await resolveTableId();
      const created = await openOrder(jar, sourceTableId);
      const orderId = String(created.orderId);

      const tables = objects(
        (
          await successData(
            await request("/api/staff/tables", "staff tables", { method: "GET" }, jar),
            200,
            "staff tables",
          )
        ).tables,
      );
      const emptyTarget = tables.find(
        (table) =>
          table.id !== sourceTableId &&
          table.isActive === true &&
          table.activeOrder === null &&
          Number(table.openCallCount ?? 0) === 0,
      );

      try {
        if (!emptyTarget) {
          // A single-table fixture cannot exercise a move; say so rather than pass.
          assert.fail(
            "No second empty table in the fixture; add one to cover table transfer.",
          );
        }
        const targetTableId = String(emptyTarget.id);
        const result = await successData(
          await post(
            jar,
            `/api/staff/tables/${sourceTableId}/transfer`,
            { targetTableId },
            "table transfer",
          ),
          200,
          "table transfer",
        );
        assert.ok(
          (result.movedOrderIds as string[]).includes(orderId),
          "the order was not reported as moved.",
        );

        const moved = await staffOrder(jar, orderId);
        assert.equal(
          (moved.table as JsonObject).id,
          targetTableId,
          "the orders screen still shows the old table.",
        );
        const target = await staffTable(jar, targetTableId);
        assert.ok(isObject(target.activeOrder), "the target table has no active order.");
        assert.equal(target.activeOrder.id, orderId);

        // Move it back so the fixture keeps its shape.
        await post(
          jar,
          `/api/staff/tables/${targetTableId}/transfer`,
          { targetTableId: sourceTableId },
          "table transfer back",
        );
      } finally {
        await cancelOrder(jar, orderId);
      }
    });

    test("a table with an open order refuses to be reset", async () => {
      const jar = await login(manager, "MANAGER");
      const tableId = await resolveTableId();
      const created = await openOrder(jar, tableId);
      const orderId = String(created.orderId);

      try {
        const blocked = await post(jar, `/api/staff/tables/${tableId}/reset`, {}, "reset");
        assert.equal(blocked.status, 409, "reset ignored an open order.");
        const payload: unknown = await blocked.json();
        assert.ok(
          isObject(payload) &&
            isObject(payload.error) &&
            payload.error.code === "TABLE_RESET_BLOCKED",
          "reset did not return the blocked domain error.",
        );
      } finally {
        await cancelOrder(jar, orderId);
      }
    });

    test("the new endpoints are closed to the wrong role and the wrong tenant", async () => {
      const jar = await login(manager, "MANAGER");
      const tableId = await resolveTableId();
      const created = await openOrder(jar, tableId);
      const orderId = String(created.orderId);

      try {
        const kitchen = await login(environment.kitchen, "KITCHEN");
        assert.equal(
          (
            await post(
              kitchen,
              `/api/orders/${orderId}/items`,
              { items: [{ productId: environment.productId, quantity: 1 }] },
              "kitchen add",
              `phase6-${randomUUID()}`,
            )
          ).status,
          403,
          "the kitchen role could append to an order.",
        );

        const waiter = await login(environment.waiter, "WAITER");
        assert.equal(
          (
            await post(
              waiter,
              `/api/orders/${orderId}/cancel`,
              { reason: "Müşteri vazgeçti" },
              "waiter cancel order",
            )
          ).status,
          403,
          "a waiter could cancel a whole order.",
        );
        assert.equal(
          (await post(waiter, `/api/staff/tables/${tableId}/reset`, {}, "waiter reset")).status,
          403,
          "a waiter could reset a table.",
        );

        const foreign = await login(environment.otherTenantStaff, "OTHER_TENANT");
        assert.equal(
          (
            await post(
              foreign,
              `/api/orders/${orderId}/items`,
              { items: [{ productId: environment.productId, quantity: 1 }] },
              "cross-tenant add",
              `phase6-${randomUUID()}`,
            )
          ).status,
          404,
          "a cross-tenant order was reachable.",
        );
        assert.equal(
          (
            await post(
              foreign,
              "/api/staff/tables/merge",
              { sourceTableId: tableId, targetTableId: tableId },
              "cross-tenant merge",
            )
          ).status,
          400,
          "a cross-tenant merge was not rejected.",
        );
      } finally {
        await cancelOrder(jar, orderId);
      }
    });

    test("a paid order can no longer be changed by these endpoints", async () => {
      const jar = await login(manager, "MANAGER");
      const tableId = await resolveTableId();
      const created = await openOrder(jar, tableId);
      const orderId = String(created.orderId);

      // Walk the order to SERVED, then collect payment through the Phase 4 flow.
      for (const status of ["CONFIRMED", "PREPARING", "READY", "SERVED"] as const) {
        const response = await patch(
          jar,
          `/api/orders/${orderId}/status`,
          { status },
          `advance to ${status}`,
        );
        assert.equal(response.status, 200, `could not advance the order to ${status}.`);
      }
      const payment = await post(
        jar,
        "/api/payments",
        { orderId, method: "CASH" },
        "collect payment",
        `phase6-pay-${randomUUID()}`,
      );
      assert.ok([200, 201].includes(payment.status), "the payment was not collected.");

      const addAfterPayment = await post(
        jar,
        `/api/orders/${orderId}/items`,
        { items: [{ productId: environment.productId, quantity: 1 }] },
        "add after payment",
        `phase6-${randomUUID()}`,
      );
      assert.equal(addAfterPayment.status, 409, "a paid order accepted new items.");

      const cancelAfterPayment = await post(
        jar,
        `/api/orders/${orderId}/cancel`,
        { reason: "Müşteri vazgeçti" },
        "cancel after payment",
      );
      assert.equal(cancelAfterPayment.status, 409, "a paid order was cancellable.");
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
