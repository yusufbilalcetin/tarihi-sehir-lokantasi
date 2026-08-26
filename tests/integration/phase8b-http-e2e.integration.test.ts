import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";

import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

import { generateQrToken } from "../../lib/security/qr-token";
import { resetFixtureRateLimits } from "./rate-limit-reset";
import { readSupabaseIntegrationEnvironment } from "./supabase-test-environment";

/**
 * Phase 8B — X/Z and end-of-day reporting over real HTTP.
 *
 * Self-provisioning, like the Phase 8A suite: it creates a disposable
 * restaurant with its own auth users, drives the reports through the actual
 * route handlers with real cookies, and removes everything again.
 *
 * What only this layer can prove: the route RBAC, the CSV responses and their
 * headers, and that a `restaurantId` on the query string is rejected rather
 * than honoured.
 */

const PREFIX = "PHASE8B_";
const CONFIRMATION = "I_UNDERSTAND_THIS_MUTATES_A_DISPOSABLE_TEST_FIXTURE";

function readTargetUrl(): { url: URL } | { reason: string } {
  if (process.env.RUN_PHASE8B_HTTP_E2E !== "true") {
    return {
      reason:
        "Phase 8B HTTP E2E is opt-in; set RUN_PHASE8B_HTTP_E2E=true with a running disposable server.",
    };
  }
  if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production") {
    return { reason: "Phase 8B HTTP E2E refuses production environments." };
  }
  if (process.env.PHASE8B_HTTP_E2E_CONFIRM !== CONFIRMATION) {
    return { reason: `Set PHASE8B_HTTP_E2E_CONFIRM=${CONFIRMATION}.` };
  }
  const raw = process.env.PHASE8B_HTTP_E2E_BASE_URL?.trim();
  if (!raw) return { reason: "PHASE8B_HTTP_E2E_BASE_URL is required." };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { reason: "PHASE8B_HTTP_E2E_BASE_URL must be an absolute URL." };
  }
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    return { reason: "Phase 8B HTTP E2E only targets a loopback server it can own." };
  }
  return { url };
}

const target = readTargetUrl();
const db = readSupabaseIntegrationEnvironment({ requireDatabaseUrl: true });

if ("reason" in target || !db.ready) {
  test("Phase 8B HTTP E2E", {
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
      ["foreign", "MANAGER", ids.foreignRestaurant],
    ] as const
  ).map(([key, role, restaurantId]) => ({
    key,
    role,
    restaurantId,
    staffId: randomUUID(),
    email: `phase8b-${run}-${key}@example.com`,
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

    async raw(
      method: string,
      path: string,
      options: { body?: unknown; idempotencyKey?: string } = {},
    ): Promise<{ status: number; text: string; headers: Headers }> {
      const headers: Record<string, string> = {
        Cookie: this.header(),
        Origin: baseUrl.origin,
      };
      if (options.body !== undefined) headers["Content-Type"] = "application/json";
      if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;

      const response = await fetch(new URL(path, baseUrl), {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        redirect: "manual",
      });
      this.absorb(response);
      // `Response.text()` strips a leading BOM per the fetch spec, which would
      // hide whether the CSV actually carries one. The bytes are decoded here
      // with `ignoreBOM` so the marker survives into the assertion.
      const bytes = await response.arrayBuffer();
      const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
      return { status: response.status, text, headers: response.headers };
    }

    async request(
      method: string,
      path: string,
      options: { body?: unknown; idempotencyKey?: string } = {},
    ): Promise<{ status: number; body: Record<string, unknown> }> {
      const result = await this.raw(method, path, options);
      let body: Record<string, unknown> = {};
      try {
        // A JSON body never carries a BOM, but strip one defensively rather
        // than let `JSON.parse` fail on an unrelated response.
        const json = result.text.replace(/^﻿/, "");
        body = json ? (JSON.parse(json) as Record<string, unknown>) : {};
      } catch {
        body = { raw: result.text.slice(0, 200) };
      }
      return { status: result.status, body };
    }

    async login(target: Account): Promise<number> {
      const result = await this.request("POST", "/api/staff/login", {
        body: { identifier: target.email, password: target.password },
      });
      return result.status;
    }
  }

  function errorCode(body: Record<string, unknown>): string {
    return (body.error as { code?: string } | undefined)?.code ?? "NONE";
  }
  function data<T = Record<string, unknown>>(body: Record<string, unknown>): T {
    return body.data as T;
  }

  const cashier = new Session();
  const manager = new Session();
  const waiter = new Session();
  const foreign = new Session();
  let shiftId = "";
  let paymentId = "";
  /** Today in the restaurant's own timezone, which is what the report keys on. */
  const businessDate = new Date(Date.now() + 180 * 60_000).toISOString().slice(0, 10);

  describe("Phase 8B reporting over HTTP", { concurrency: false }, () => {
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
        (${ids.restaurant}, ${`${PREFIX}HTTP Tenant`}, ${`phase8b-http-${run}`}),
        (${ids.foreignRestaurant}, ${`${PREFIX}HTTP Other`}, ${`phase8b-http-b-${run}`})`;
      await sql`insert into restaurant_settings (restaurant_id) values
        (${ids.restaurant}), (${ids.foreignRestaurant})`;
      for (const target of accounts) {
        await sql`insert into staff_profiles (id, restaurant_id, auth_user_id, name, email,
            login_identifier, role, is_active) values
          (${target.staffId}, ${target.restaurantId}, ${target.authUserId},
           ${`${PREFIX}${target.key}`}, ${target.email}, ${`p8b-http-${run}-${target.key}`},
           ${target.role}, true)`;
      }
      // A hostile register name, so the CSV escaping is exercised end to end.
      await sql`insert into cash_registers (id, restaurant_id, name, code) values
        (${ids.register}, ${ids.restaurant}, ${`=${PREFIX}Ana Kasa`},
         ${`P8B${run.slice(0, 6).toUpperCase()}`})`;
      await sql`insert into categories (id, restaurant_id, name, slug) values
        (${ids.category}, ${ids.restaurant}, ${`${PREFIX}Kategori`}, ${`p8b-http-cat-${run}`})`;
      await sql`insert into products (id, restaurant_id, category_id, name, slug, price) values
        (${ids.product}, ${ids.restaurant}, ${ids.category}, ${`${PREFIX}Ana`},
         ${`p8b-http-ana-${run}`}, '100.00')`;
      await sql`insert into restaurant_tables (id, restaurant_id, name, table_number, qr_token_hash) values
        (${ids.table}, ${ids.restaurant}, ${`${PREFIX}Masa`}, 9201,
         ${generateQrToken(randomBytes(32)).tokenHash})`;

      await resetFixtureRateLimits(sql, accounts.map((target) => target.email.toLowerCase()));
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
        await resetFixtureRateLimits(sql, accounts.map((target) => target.email.toLowerCase()));
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
        console.error("PHASE8B HTTP CLEANUP INCOMPLETE:", cleanupErrors.join(" | "));
      }
      console.log(`phase8b http assertions executed: ${assertions}`);
    });

    async function newOrder(total: number): Promise<string> {
      const orderId = randomUUID();
      const amount = total.toFixed(2);
      const sequence = 92000 + Math.floor(Math.random() * 5000);
      await sql`insert into orders (id, restaurant_id, table_id, order_sequence, order_number,
          subtotal, total, created_by_type, created_by_user_id, status) values
        (${orderId}, ${ids.restaurant}, ${ids.table}, ${sequence}, ${`${PREFIX}${sequence}-${randomBytes(2).toString("hex")}`},
         ${amount}, ${amount}, 'STAFF', ${account("waiter").staffId}, 'SERVED')`;
      await sql`insert into order_items (id, restaurant_id, order_id, product_id,
          product_name_snapshot, unit_price, quantity, line_total, status) values
        (${randomUUID()}, ${ids.restaurant}, ${orderId}, ${ids.product}, ${`${PREFIX}Ana`},
         ${amount}, 1, ${amount}, 'SERVED')`;
      return orderId;
    }

    test("the till opens and takes money through the API", async () => {
      const opened = await cashier.request("POST", "/api/cashier/shifts", {
        body: { cashRegisterId: ids.register, openingCash: "200.00" },
      });
      check(opened.status === 201, `the shift opens (got ${opened.status})`);
      shiftId = data<{ shift: { id: string } }>(opened.body).shift.id;

      const cashOrder = await newOrder(300);
      const cash = await cashier.request("POST", "/api/payments", {
        body: { orderId: cashOrder, method: "CASH" },
        idempotencyKey: `p8b-http-${run}-cash`,
      });
      check(cash.status === 201, `cash collected (got ${cash.status})`);
      paymentId = data<{ paymentId: string }>(cash.body).paymentId;

      const cardOrder = await newOrder(150);
      const card = await cashier.request("POST", "/api/payments", {
        body: { orderId: cardOrder, method: "CARD" },
        idempotencyKey: `p8b-http-${run}-card`,
      });
      check(card.status === 201, `card collected (got ${card.status})`);

      const movement = await cashier.request(
        "POST",
        `/api/cashier/shifts/${shiftId}/movements`,
        { body: { type: "CASH_OUT", amount: "50.00", reason: `${PREFIX}Tedarikci` } },
      );
      check(movement.status === 201, `movement recorded (got ${movement.status})`);

      const refund = await cashier.request("POST", `/api/payments/${paymentId}/refund`, {
        body: { amount: "20.00", reasonCode: "CUSTOMER_COMPLAINT" },
        idempotencyKey: `p8b-http-${run}-refund`,
      });
      check(refund.status === 201, `refund taken (got ${refund.status})`);
    });

    test("the X report is served live and leaves the drawer open", async () => {
      const response = await cashier.request("GET", `/api/cashier/shifts/${shiftId}/x-report`);
      check(response.status === 200, `X report served (got ${response.status})`);
      const report = data<{
        reportType: string;
        shiftStatus: string;
        expectedCash: string;
        grossCollected: string;
        totalRefunds: string;
        netCollected: string;
        nonFiscalNotice: string;
        paymentMethodBreakdown: { method: string; amount: string }[];
      }>(response.body);

      check(report.reportType === "X" && report.shiftStatus === "OPEN", "it is a live X report");
      // 200 float + 300 cash − 20 cash refund − 50 out = 430; card is absent.
      check(report.expectedCash === "430.00", `expected cash (got ${report.expectedCash})`);
      check(report.grossCollected === "450.00", `gross (got ${report.grossCollected})`);
      check(report.totalRefunds === "20.00", `refunds (got ${report.totalRefunds})`);
      check(report.netCollected === "430.00", `net (got ${report.netCollected})`);
      check(
        report.paymentMethodBreakdown.find((row) => row.method === "CARD")?.amount === "150.00",
        "the card leg is reported but not in the drawer",
      );
      check(
        /mali cihaz\/ÖKC Z raporu değildir/.test(report.nonFiscalNotice),
        "the non-fiscal notice travels with the document",
      );

      // Still collectable afterwards.
      const stillOpen = await cashier.request("GET", "/api/cashier/shifts/current");
      check(
        data<{ shift: { id: string } | null }>(stillOpen.body).shift?.id === shiftId,
        "the drawer is still open after the report",
      );
    });

    test("the X CSV is served as a download, with formulas neutralised", async () => {
      const response = await cashier.raw(
        "GET",
        `/api/cashier/shifts/${shiftId}/x-report?format=csv`,
      );
      check(response.status === 200, `CSV served (got ${response.status})`);
      check(
        response.headers.get("content-type")?.includes("text/csv") === true,
        `served as CSV (got ${response.headers.get("content-type")})`,
      );
      check(
        response.headers.get("content-disposition")?.includes("attachment") === true,
        "as an attachment",
      );
      check(response.text.startsWith("﻿"), "with a BOM for Excel");
      check(response.text.includes('"430.00"'), "exact money, not locale-formatted");
      check(response.text.includes("OPERASYONEL X RAPORU"), "titled as operational");
      check(
        response.text.includes(`"'=${PREFIX}Ana Kasa"`),
        "the hostile register name is neutralised end to end",
      );
      check(
        !response.text.includes(`,"=${PREFIX}Ana Kasa"`),
        "and never left executable",
      );
    });

    test("a Z report is refused while the drawer is open, and served once closed", async () => {
      const early = await cashier.request("GET", `/api/cashier/shifts/${shiftId}/z-report`);
      check(early.status === 409, `Z refused while open (got ${early.status})`);
      check(
        errorCode(early.body) === "CASHIER_SHIFT_NOT_CLOSED",
        `with the right reason (got ${errorCode(early.body)})`,
      );

      const closed = await cashier.request("POST", `/api/cashier/shifts/${shiftId}/close`, {
        body: { countedCash: "425.00", note: `${PREFIX}Bes lira eksik.` },
      });
      check(closed.status === 200, `the drawer closes (got ${closed.status})`);

      const response = await cashier.request("GET", `/api/cashier/shifts/${shiftId}/z-report`);
      check(response.status === 200, `Z served (got ${response.status})`);
      const report = data<{
        reportType: string;
        version: number;
        expectedCash: string;
        countedCash: string;
        cashVariance: string;
        grossCollected: string;
        managerOverride: boolean;
        closeNote: string;
      }>(response.body);
      check(report.reportType === "Z" && report.version === 1, "a versioned Z report");
      check(report.expectedCash === "430.00", `expected (got ${report.expectedCash})`);
      check(report.countedCash === "425.00", `counted (got ${report.countedCash})`);
      check(report.cashVariance === "-5.00", `variance (got ${report.cashVariance})`);
      check(report.grossCollected === "450.00", `gross (got ${report.grossCollected})`);
      check(report.managerOverride === false, "the cashier closed their own drawer");

      // An X report is now refused, and the Z repeats identically.
      const lateX = await cashier.request("GET", `/api/cashier/shifts/${shiftId}/x-report`);
      check(
        lateX.status === 409 && errorCode(lateX.body) === "CASHIER_SHIFT_CLOSED",
        `X refused after close (got ${lateX.status}/${errorCode(lateX.body)})`,
      );
      const again = await cashier.request("GET", `/api/cashier/shifts/${shiftId}/z-report`);
      assert.deepEqual(again.body, response.body, "the Z report is read, never recomputed");
      assertions += 1;
    });

    test("a refund from a later drawer leaves the old Z untouched", async () => {
      const evening = await cashier.request("POST", "/api/cashier/shifts", {
        body: { cashRegisterId: ids.register, openingCash: "0.00" },
      });
      check(evening.status === 201, `a new drawer opens (got ${evening.status})`);
      const eveningId = data<{ shift: { id: string } }>(evening.body).shift.id;

      const before = await cashier.request("GET", `/api/cashier/shifts/${shiftId}/z-report`);
      const refund = await cashier.request("POST", `/api/payments/${paymentId}/refund`, {
        body: { amount: "30.00", reasonCode: "QUALITY_ISSUE" },
        idempotencyKey: `p8b-http-${run}-late-refund`,
      });
      check(refund.status === 201, `the later refund succeeds (got ${refund.status})`);

      const after = await cashier.request("GET", `/api/cashier/shifts/${shiftId}/z-report`);
      assert.deepEqual(after.body, before.body, "yesterday's Z report did not move");
      assertions += 1;

      const live = await cashier.request("GET", `/api/cashier/shifts/${eveningId}/x-report`);
      check(
        data<{ totalRefunds: string }>(live.body).totalRefunds === "30.00",
        "and the refund landed on the drawer that issued it",
      );
    });

    test("the end-of-day report is supervisory, exact, and tenant-locked", async () => {
      const forbidden = await cashier.request(
        "GET",
        `/api/admin/reports/cashier-day?date=${businessDate}`,
      );
      check(forbidden.status === 403, `a cashier is refused (got ${forbidden.status})`);
      const waiterDenied = await waiter.request(
        "GET",
        `/api/admin/reports/cashier-day?date=${businessDate}`,
      );
      check(waiterDenied.status === 403, `a waiter is refused (got ${waiterDenied.status})`);

      const response = await manager.request(
        "GET",
        `/api/admin/reports/cashier-day?date=${businessDate}`,
      );
      check(response.status === 200, `a manager may read it (got ${response.status})`);
      const report = data<{
        grossCollected: string;
        totalRefunds: string;
        netCollected: string;
        cashPaymentTotal: string;
        cashOut: string;
        openShiftCount: number;
        closedShiftCount: number;
        zReportCount: number;
        warnings: string[];
        registerBreakdown: { id: string; grossCollected: string }[];
        cashierBreakdown: { grossCollected: string }[];
      }>(response.body);

      check(report.grossCollected === "450.00", `gross (got ${report.grossCollected})`);
      check(report.totalRefunds === "50.00", `both refunds (got ${report.totalRefunds})`);
      check(report.netCollected === "400.00", `net (got ${report.netCollected})`);
      check(report.cashPaymentTotal === "300.00", `cash taken (got ${report.cashPaymentTotal})`);
      check(report.cashOut === "50.00", `cash out (got ${report.cashOut})`);
      check(report.closedShiftCount === 1, `one drawer closed (got ${report.closedShiftCount})`);
      check(report.zReportCount === 1, `with its Z (got ${report.zReportCount})`);
      check(report.openShiftCount === 1, `one still open (got ${report.openShiftCount})`);
      check(
        report.warnings.some((warning) => warning.includes("açık kasa vardiyası")),
        `the open drawer is flagged (got ${JSON.stringify(report.warnings)})`,
      );
      check(
        report.registerBreakdown.some((row) => row.grossCollected === "450.00"),
        "the register breakdown reconciles",
      );
      check(report.cashierBreakdown.length === 1, "one cashier worked the day");

      // A tenant named on the query string is rejected outright.
      const spoofed = await manager.request(
        "GET",
        `/api/admin/reports/cashier-day?date=${businessDate}&restaurantId=${ids.foreignRestaurant}`,
      );
      check(spoofed.status === 400, `an unknown query key is refused (got ${spoofed.status})`);

      // And another restaurant's manager sees their own empty day.
      const theirs = await foreign.request(
        "GET",
        `/api/admin/reports/cashier-day?date=${businessDate}`,
      );
      check(theirs.status === 200, "their own report is served");
      check(
        data<{ grossCollected: string }>(theirs.body).grossCollected === "0.00",
        "with none of this restaurant's money in it",
      );
      const theirZ = await foreign.request("GET", `/api/cashier/shifts/${shiftId}/z-report`);
      check(theirZ.status === 404, `and our Z is invisible to them (got ${theirZ.status})`);
    });

    test("the daily CSV is served server-side and escaped", async () => {
      const response = await manager.raw(
        "GET",
        `/api/admin/reports/cashier-day?date=${businessDate}&format=csv`,
      );
      check(response.status === 200, `daily CSV served (got ${response.status})`);
      check(
        response.headers.get("content-type")?.includes("text/csv") === true,
        "as CSV",
      );
      check(response.text.includes("GÜN SONU KASA RAPORU"), "titled as the day report");
      check(response.text.includes('"400.00"'), "with exact net money");
      check(
        response.text.includes(`"'=${PREFIX}Ana Kasa"`),
        "and the hostile register name neutralised",
      );
      check(
        !/resmi mali|vergi Z raporu/i.test(response.text),
        "never presented as a fiscal document",
      );
    });

    test("a waiter reaches no cash report at all", async () => {
      for (const path of [
        `/api/cashier/shifts/${shiftId}/x-report`,
        `/api/cashier/shifts/${shiftId}/z-report`,
      ]) {
        const response = await waiter.request("GET", path);
        check(response.status === 403, `${path} is forbidden for a waiter (got ${response.status})`);
      }
    });

    test("a Z report has no write surface", async () => {
      for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
        const response = await cashier.request(
          method,
          `/api/cashier/shifts/${shiftId}/z-report`,
          { body: { countedCash: "1.00" } },
        );
        check(
          response.status === 405 || response.status === 404,
          `${method} must not be handled (got ${response.status})`,
        );
      }
      const [row] = await sql`
        select (z_report_snapshot->>'countedCash') as counted from cashier_shifts
        where id = ${shiftId}`;
      check(String(row.counted) === "425.00", "and the stored report is unchanged");
    });
  });
}
