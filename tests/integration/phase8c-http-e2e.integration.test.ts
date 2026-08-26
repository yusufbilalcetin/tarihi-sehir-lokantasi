import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";

import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

import { generateQrToken } from "../../lib/security/qr-token";
import { resetFixtureRateLimits } from "./rate-limit-reset";
import { readSupabaseIntegrationEnvironment } from "./supabase-test-environment";

/**
 * Phase 8C — printing over real HTTP.
 *
 * Self-provisioning, like the 8A and 8B suites: it builds a disposable
 * restaurant with its own auth users and printers, drives the whole paper path
 * through the actual route handlers, and removes everything again.
 *
 * What only this layer can prove: that an agent authenticates with a bearer
 * token and no session, that the raw token is returned exactly once, that a
 * confirmed order produces a ticket without the order depending on it, that a
 * reprint without a reason is refused, and that a second restaurant sees none
 * of it.
 */

const PREFIX = "PHASE8C_";
const CONFIRMATION = "I_UNDERSTAND_THIS_MUTATES_A_DISPOSABLE_TEST_FIXTURE";

function readTargetUrl(): { url: URL } | { reason: string } {
  if (process.env.RUN_PHASE8C_HTTP_E2E !== "true") {
    return {
      reason:
        "Phase 8C HTTP E2E is opt-in; set RUN_PHASE8C_HTTP_E2E=true with a running disposable server.",
    };
  }
  if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production") {
    return { reason: "Phase 8C HTTP E2E refuses production environments." };
  }
  if (process.env.PHASE8C_HTTP_E2E_CONFIRM !== CONFIRMATION) {
    return { reason: `Set PHASE8C_HTTP_E2E_CONFIRM=${CONFIRMATION}.` };
  }
  const raw = process.env.PHASE8C_HTTP_E2E_BASE_URL?.trim();
  if (!raw) return { reason: "PHASE8C_HTTP_E2E_BASE_URL is required." };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { reason: "PHASE8C_HTTP_E2E_BASE_URL must be an absolute URL." };
  }
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    return { reason: "Phase 8C HTTP E2E only targets a loopback server it can own." };
  }
  return { url };
}

const target = readTargetUrl();
const db = readSupabaseIntegrationEnvironment({ requireDatabaseUrl: true });

if ("reason" in target || !db.ready) {
  test(
    "Phase 8C HTTP E2E",
    { skip: "reason" in target ? target.reason : (db as { reason: string }).reason },
    () => undefined,
  );
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
    foreignTable: randomUUID(),
  };

  interface Account {
    readonly key: string;
    readonly role: "MANAGER" | "WAITER" | "CASHIER" | "KITCHEN";
    readonly restaurantId: string;
    readonly staffId: string;
    readonly email: string;
    readonly password: string;
    authUserId: string | null;
  }

  const accounts: Account[] = (
    [
      ["manager", "MANAGER", ids.restaurant],
      ["waiter", "WAITER", ids.restaurant],
      ["cashier", "CASHIER", ids.restaurant],
      ["cook", "KITCHEN", ids.restaurant],
      ["foreign", "MANAGER", ids.foreignRestaurant],
    ] as const
  ).map(([key, role, restaurantId]) => ({
    key,
    role,
    restaurantId,
    staffId: randomUUID(),
    email: `phase8c-${run}-${key}@example.com`,
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

    async request(
      method: string,
      path: string,
      options: { body?: unknown; idempotencyKey?: string } = {},
    ): Promise<{ status: number; body: Record<string, unknown>; text: string }> {
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
      const text = await response.text();
      let body: Record<string, unknown> = {};
      try {
        body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      } catch {
        body = { raw: text.slice(0, 200) };
      }
      return { status: response.status, body, text };
    }

    async login(who: Account): Promise<number> {
      const result = await this.request("POST", "/api/staff/login", {
        body: { identifier: who.email, password: who.password },
      });
      return result.status;
    }
  }

  /** The agent speaks no cookies at all: a bearer token and nothing else. */
  async function agentCall(
    path: string,
    token: string | null,
    body: unknown,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(new URL(`/api/internal/printer-agent/${path}`, baseUrl), {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      redirect: "manual",
    });
    const text = await response.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      parsed = { raw: text.slice(0, 200) };
    }
    return { status: response.status, body: parsed };
  }

  function errorCode(body: Record<string, unknown>): string {
    return (body.error as { code?: string } | undefined)?.code ?? "NONE";
  }
  function data<T = Record<string, unknown>>(body: Record<string, unknown>): T {
    return body.data as T;
  }

  const manager = new Session();
  const waiter = new Session();
  const cashier = new Session();
  const cook = new Session();
  const foreign = new Session();

  const state = {
    agentId: "",
    agentToken: "",
    foreignAgentToken: "",
    printerId: "",
    orderId: "",
    kitchenJobId: "",
    billJobId: "",
  };

  interface ClaimedJob {
    readonly jobId: string;
    readonly deviceKey: string;
    readonly escposBase64: string;
    readonly documentType: string;
    readonly attemptNumber: number;
    readonly leaseUntilIso: string;
  }

  describe("Phase 8C printing over HTTP", { concurrency: false }, () => {
    before(async () => {
      for (const who of accounts) {
        const created = await admin.auth.admin.createUser({
          email: who.email,
          password: who.password,
          email_confirm: true,
        });
        if (created.error || !created.data.user) {
          throw new Error(`auth user ${who.key}: ${created.error?.message ?? "missing"}`);
        }
        who.authUserId = created.data.user.id;
      }

      await sql`insert into restaurants (id, name, slug) values
        (${ids.restaurant}, ${`${PREFIX}Print Tenant`}, ${`phase8c-http-${run}`}),
        (${ids.foreignRestaurant}, ${`${PREFIX}Print Other`}, ${`phase8c-http-b-${run}`})`;
      await sql`insert into restaurant_settings (restaurant_id) values
        (${ids.restaurant}), (${ids.foreignRestaurant})`;
      for (const who of accounts) {
        await sql`insert into staff_profiles (id, restaurant_id, auth_user_id, name, email,
            login_identifier, role, is_active) values
          (${who.staffId}, ${who.restaurantId}, ${who.authUserId},
           ${`${PREFIX}${who.key}`}, ${who.email}, ${`p8c-http-${run}-${who.key}`},
           ${who.role}, true)`;
      }
      await sql`insert into cash_registers (id, restaurant_id, name, code) values
        (${ids.register}, ${ids.restaurant}, ${`${PREFIX}Kasa`},
         ${`P8C${run.slice(0, 6).toUpperCase()}`})`;
      await sql`insert into categories (id, restaurant_id, name, slug) values
        (${ids.category}, ${ids.restaurant}, ${`${PREFIX}Izgara`}, ${`p8c-http-cat-${run}`})`;
      // A Turkish name with characters that only survive a correct code page.
      await sql`insert into products (id, restaurant_id, category_id, name, slug, price,
          is_available) values
        (${ids.product}, ${ids.restaurant}, ${ids.category}, ${`${PREFIX}Kuzu Şiş`},
         ${`p8c-http-sis-${run}`}, '180.00', true)`;
      await sql`insert into restaurant_tables (id, restaurant_id, name, table_number,
          qr_token_hash) values
        (${ids.table}, ${ids.restaurant}, ${`${PREFIX}Masa`}, 9301,
         ${generateQrToken(randomBytes(32)).tokenHash}),
        (${ids.foreignTable}, ${ids.foreignRestaurant}, ${`${PREFIX}Masa B`}, 9302,
         ${generateQrToken(randomBytes(32)).tokenHash})`;

      await resetFixtureRateLimits(sql, accounts.map((who) => who.email.toLowerCase()));
      for (const [session, key] of [
        [manager, "manager"], [waiter, "waiter"], [cashier, "cashier"],
        [cook, "cook"], [foreign, "foreign"],
      ] as const) {
        const status = await session.login(account(key));
        if (status !== 200) throw new Error(`${key} login failed with ${status}`);
      }
    });

    after(async () => {
      try {
        const order = [
          "print_job_attempts", "print_jobs", "printer_routes", "restaurant_printers",
          "printer_agents", "cash_drawer_movements", "payment_refunds", "payments",
          "order_check_items", "order_checks", "order_events", "audit_logs", "outbox_events",
          "idempotency_keys", "waiter_calls", "kitchen_tickets", "order_items", "orders",
          "cashier_shifts", "cash_registers", "restaurant_tables", "products", "categories",
          // The order number sequence is created by the service on first use.
          "restaurant_counters", "restaurant_settings", "staff_profiles", "restaurants",
        ];
        for (const tenant of [ids.restaurant, ids.foreignRestaurant]) {
          for (const table of order) {
            const column = table === "restaurants" ? "id" : "restaurant_id";
            await sql.unsafe(`delete from ${table} where ${column} = $1::uuid`, [tenant]);
          }
        }
        await resetFixtureRateLimits(sql, accounts.map((who) => who.email.toLowerCase()));
        for (const who of accounts) {
          if (!who.authUserId) continue;
          const removed = await admin.auth.admin.deleteUser(who.authUserId);
          if (removed.error) cleanupErrors.push(`auth ${who.key}: ${removed.error.message}`);
        }
      } catch (error) {
        cleanupErrors.push((error as Error).message);
      }
      await sql.end({ timeout: 5 });
      if (cleanupErrors.length > 0) {
        console.error("PHASE8C HTTP CLEANUP INCOMPLETE:", cleanupErrors.join(" | "));
      }
      console.log(`phase8c http assertions executed: ${assertions}`);
    });

    // ------------------------------------------------------------ provisioning

    test("a manager provisions an agent, a printer and its routes", async () => {
      const created = await manager.request("POST", "/api/admin/printer-agents", {
        body: { name: `${PREFIX}Salon PC` },
      });
      check(created.status === 201, `the agent is created (got ${created.status})`);
      const payload = data<{ agent: { id: string }; rawToken: string }>(created.body);
      state.agentId = payload.agent.id;
      state.agentToken = payload.rawToken;
      check(
        /^[A-Za-z0-9_-]{43}$/.test(state.agentToken),
        "the response carries a usable raw token exactly once",
      );

      // And never again: neither the list nor the stored row hands it back.
      const listed = await manager.request("GET", "/api/admin/printer-agents");
      check(listed.status === 200, `the agent list reads (got ${listed.status})`);
      check(
        !listed.text.includes(state.agentToken),
        "the raw token is absent from every later response",
      );
      check(
        !/token_hash|tokenHash/.test(listed.text),
        "and the digest is not exposed either",
      );

      const printer = await manager.request("POST", "/api/admin/printers", {
        body: {
          agentId: state.agentId,
          name: `${PREFIX}Mutfak`,
          code: `P8CK${run.slice(0, 5).toUpperCase()}`,
          stationType: "KITCHEN",
          deviceKey: "kitchen-main",
          charactersPerLine: 48,
          encoding: "CP857",
        },
      });
      check(printer.status === 201, `the printer is created (got ${printer.status})`);
      state.printerId = data<{ id: string }>(printer.body).id;

      for (const documentType of ["KITCHEN_ORDER", "KITCHEN_CANCEL", "CUSTOMER_BILL"]) {
        const route = await manager.request("POST", "/api/admin/printer-routes", {
          body: { documentType, printerId: state.printerId, copies: 1 },
        });
        check(route.status === 201, `${documentType} routes somewhere (got ${route.status})`);
      }

      // A waiter is not an administrator, whatever the screen shows.
      const refused = await waiter.request("POST", "/api/admin/printer-agents", {
        body: { name: `${PREFIX}Kacak` },
      });
      check(refused.status === 403, `a waiter cannot create an agent (got ${refused.status})`);
    });

    test("a test print goes straight to the named printer", async () => {
      const sent = await manager.request("POST", "/api/print", {
        body: { documentType: "TEST_PRINT", printerId: state.printerId },
      });
      check(sent.status === 201, `the test print is queued (got ${sent.status})`);
      check(
        data<{ created: string[] }>(sent.body).created.length === 1,
        "one job, on the printer that was named",
      );

      // A cook may not reach a physical device on demand.
      const refused = await cook.request("POST", "/api/print", {
        body: { documentType: "TEST_PRINT", printerId: state.printerId },
      });
      check(refused.status === 403, `the kitchen cannot test-print (got ${refused.status})`);
    });

    // -------------------------------------------------------- the order path

    test("confirming an order puts a kitchen ticket in the queue", async () => {
      const placed = await waiter.request("POST", "/api/staff/orders", {
        body: {
          tableId: ids.table,
          items: [{ productId: ids.product, quantity: 2, note: `${PREFIX}az pişmiş` }],
        },
        idempotencyKey: `p8c-http-${run}-order`,
      });
      check(placed.status === 201, `the order is placed (got ${placed.status})`);
      state.orderId = data<{ orderId: string }>(placed.body).orderId;

      const confirmed = await waiter.request(
        "PATCH",
        `/api/orders/${state.orderId}/status`,
        { body: { status: "CONFIRMED" } },
      );
      check(confirmed.status === 200, `the order is confirmed (got ${confirmed.status})`);

      const jobs = await sql`
        select id, status::text as status, document_type::text as document_type,
               dedupe_key, payload_snapshot::text as payload
        from print_jobs
        where restaurant_id = ${ids.restaurant} and source_id = ${state.orderId}`;
      check(jobs.length === 1, `exactly one kitchen ticket exists (got ${jobs.length})`);
      check(jobs[0].document_type === "KITCHEN_ORDER", "and it is a kitchen ticket");
      check(String(jobs[0].payload).includes("Kuzu Şiş"), "the ordered line is on it");
      state.kitchenJobId = String(jobs[0].id);

      // The kitchen screen reports the same thing, in one word.
      const status = await cook.request(
        "GET",
        `/api/print/status?orderIds=${state.orderId}`,
      );
      check(status.status === 200, `the kitchen may read ticket status (got ${status.status})`);
      check(
        data<{ statuses: Record<string, string> }>(status.body).statuses[state.orderId] ===
          "PENDING",
        "and it says the ticket is still waiting",
      );
    });

    test("a waiter and a cashier can put the bill on paper", async () => {
      for (const [session, who] of [[waiter, "waiter"], [cashier, "cashier"]] as const) {
        const sent = await session.request("POST", "/api/print", {
          body: { documentType: "CUSTOMER_BILL", orderId: state.orderId },
        });
        check(sent.status === 201, `${who} prints the adisyon (got ${sent.status})`);
        check(
          data<{ created: string[] }>(sent.body).created.length === 1,
          `${who} gets one document, not several`,
        );
      }
      // The kitchen has no business with the money side of the ticket.
      const refused = await cook.request("POST", "/api/print", {
        body: { documentType: "CUSTOMER_BILL", orderId: state.orderId },
      });
      check(refused.status === 403, `the kitchen cannot print a bill (got ${refused.status})`);

      const [row] = await sql`
        select id from print_jobs
        where restaurant_id = ${ids.restaurant} and document_type = 'CUSTOMER_BILL'
        order by created_at desc limit 1`;
      state.billJobId = String(row.id);
    });

    // -------------------------------------------------------------- the agent

    test("only a valid bearer token gets the agent anywhere", async () => {
      for (const token of [null, "not-a-token", randomBytes(32).toString("base64url")]) {
        const refused = await agentCall("heartbeat", token, {});
        check(
          refused.status === 401 && errorCode(refused.body) === "PRINTER_AGENT_UNAUTHORIZED",
          `an unusable token is refused identically (got ${refused.status})`,
        );
      }

      const beat = await agentCall("heartbeat", state.agentToken, {
        softwareVersion: "test-1.0.0",
      });
      check(beat.status === 200, `the real agent checks in (got ${beat.status})`);

      const listed = await manager.request("GET", "/api/admin/printer-agents");
      const agent = data<{ agents: { id: string; presence: string; softwareVersion: string }[] }>(
        listed.body,
      ).agents.find((row) => row.id === state.agentId);
      check(agent?.presence === "ONLINE", `the admin screen sees it online (got ${agent?.presence})`);
      check(agent?.softwareVersion === "test-1.0.0", "and knows which build it is");
    });

    test("the agent claims rendered bytes, never a payload it has to compose", async () => {
      const claimed = await agentCall("claim", state.agentToken, { limit: 10 });
      check(claimed.status === 200, `the agent claims work (got ${claimed.status})`);
      const jobs = data<{ jobs: ClaimedJob[] }>(claimed.body).jobs;
      check(jobs.length >= 3, `the queued documents come back (got ${jobs.length})`);

      const kitchen = jobs.find((job) => job.jobId === state.kitchenJobId);
      check(kitchen !== undefined, "including the kitchen ticket");
      const bytes = Buffer.from(kitchen!.escposBase64, "base64");
      check(
        bytes[0] === 0x1b && bytes[1] === 0x40,
        "the bytes are ready to send: the printer is reset first",
      );
      check(kitchen!.deviceKey === "kitchen-main", "the agent is told which device, not which IP");
      check(
        !JSON.stringify(claimed.body).includes("postgres://"),
        "no database credential travels to the restaurant floor",
      );
      check(new Date(kitchen!.leaseUntilIso).getTime() > Date.now(), "the claim carries a lease");

      // A second claim finds nothing: the lease is held, not shared.
      const again = await agentCall("claim", state.agentToken, { limit: 10 });
      check(
        data<{ jobs: ClaimedJob[] }>(again.body).jobs.length === 0,
        "a claimed job is not handed out twice",
      );
    });

    test("a completed job is printed, a failed one comes back", async () => {
      const done = await agentCall("complete", state.agentToken, {
        jobId: state.kitchenJobId,
        bytesWritten: 512,
      });
      check(done.status === 200, `the agent reports success (got ${done.status})`);

      const failed = await agentCall("fail", state.agentToken, {
        jobId: state.billJobId,
        errorCode: "PRINTER_CONNECTION_FAILED",
        errorSummary: "connection refused",
      });
      check(failed.status === 200, `the agent reports a failure (got ${failed.status})`);
      check(
        data<{ status: string }>(failed.body).status === "PENDING",
        "a transient failure returns the job to the queue rather than losing it",
      );

      const history = await manager.request("GET", "/api/admin/print-jobs?page=1&pageSize=50");
      check(history.status === 200, `the history reads (got ${history.status})`);
      const rows = data<{ rows: { id: string; status: string; lastErrorCode: string | null }[] }>(
        history.body,
      ).rows;
      check(
        rows.find((row) => row.id === state.kitchenJobId)?.status === "PRINTED",
        "the kitchen ticket is recorded as printed",
      );
      const bill = rows.find((row) => row.id === state.billJobId);
      check(
        bill?.lastErrorCode === "PRINTER_CONNECTION_FAILED",
        `the failure is kept with its cause (got ${bill?.lastErrorCode})`,
      );

      const attempts = await manager.request("GET", `/api/admin/print-jobs/${state.kitchenJobId}`);
      check(
        data<{ attempts: { succeeded: boolean }[] }>(attempts.body).attempts.some(
          (attempt) => attempt.succeeded,
        ),
        "and the attempt itself is on the record",
      );
    });

    // ------------------------------------------------------------- reprinting

    test("a reprint must say why, and never overwrites the original", async () => {
      const bare = await manager.request("POST", `/api/admin/print-jobs/${state.kitchenJobId}`, {
        body: { action: "REPRINT" },
      });
      check(bare.status === 400, `a reason-less reprint is refused (got ${bare.status})`);

      const blank = await manager.request("POST", `/api/admin/print-jobs/${state.kitchenJobId}`, {
        body: { action: "REPRINT", reason: "   " },
      });
      check(blank.status === 400, `and so is a blank one (got ${blank.status})`);

      const reprint = await manager.request("POST", `/api/admin/print-jobs/${state.kitchenJobId}`, {
        body: { action: "REPRINT", reason: `${PREFIX}fiş yırtıldı` },
      });
      check(reprint.status === 200, `an explained reprint is accepted (got ${reprint.status})`);
      const newJobId = data<{ jobId: string }>(reprint.body).jobId;
      check(newJobId !== state.kitchenJobId, "the reprint is a new job");

      const [original] = await sql`
        select status::text as status from print_jobs where id = ${state.kitchenJobId}`;
      check(original.status === "PRINTED", "the original is left exactly as it was");
      const [copy] = await sql`
        select reprint_of_job_id, reprint_reason, status::text as status,
               payload_snapshot::text as payload
        from print_jobs where id = ${newJobId}`;
      check(
        String(copy.reprint_of_job_id) === state.kitchenJobId,
        "the copy points at what it copies",
      );
      check(
        String(copy.reprint_reason).includes("yırtıldı"),
        "and carries the reason it was made",
      );
      check(String(copy.payload).includes("Kuzu Şiş"), "the reprint is the original document");
    });

    // --------------------------------------------------------- other tenants

    test("another restaurant sees none of this and can touch none of it", async () => {
      const history = await foreign.request("GET", "/api/admin/print-jobs?page=1&pageSize=50");
      check(history.status === 200, `the other tenant may read its own history (got ${history.status})`);
      check(
        data<{ rows: unknown[]; total: number }>(history.body).total === 0,
        "which is empty",
      );

      const printers = await foreign.request("GET", "/api/admin/printers");
      check(
        data<{ printers: unknown[] }>(printers.body).printers.length === 0,
        "and it sees no printer of ours",
      );

      const stolen = await foreign.request("POST", "/api/print", {
        body: { documentType: "TEST_PRINT", printerId: state.printerId },
      });
      check(stolen.status === 404, `our printer is simply absent to them (got ${stolen.status})`);

      const reprint = await foreign.request("POST", `/api/admin/print-jobs/${state.kitchenJobId}`, {
        body: { action: "REPRINT", reason: `${PREFIX}deneme` },
      });
      check(reprint.status === 404, `so is our job (got ${reprint.status})`);

      // An agent of the other restaurant is authenticated, and still finds
      // nothing: the queue is scoped to its own tenant.
      const created = await foreign.request("POST", "/api/admin/printer-agents", {
        body: { name: `${PREFIX}Diger Salon` },
      });
      state.foreignAgentToken = data<{ rawToken: string }>(created.body).rawToken;
      const claimed = await agentCall("claim", state.foreignAgentToken, { limit: 10 });
      check(claimed.status === 200, `their agent authenticates (got ${claimed.status})`);
      check(
        data<{ jobs: ClaimedJob[] }>(claimed.body).jobs.length === 0,
        "and is handed none of our paper",
      );

      const foreignComplete = await agentCall("complete", state.foreignAgentToken, {
        jobId: state.kitchenJobId,
      });
      check(
        foreignComplete.status === 404,
        `their agent cannot close our job either (got ${foreignComplete.status})`,
      );
    });

    test("a revoked agent stops working on the very next call", async () => {
      const revoked = await manager.request("PATCH", `/api/admin/printer-agents/${state.agentId}`, {
        body: { action: "REVOKE" },
      });
      check(revoked.status === 200, `the agent is revoked (got ${revoked.status})`);

      const refused = await agentCall("claim", state.agentToken, { limit: 5 });
      check(
        refused.status === 401,
        `the token it still holds is worthless (got ${refused.status})`,
      );
    });
  });
}
