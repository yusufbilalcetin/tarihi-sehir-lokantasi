import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";

import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

import { resetFixtureRateLimits } from "./rate-limit-reset";
import { readSupabaseIntegrationEnvironment } from "./supabase-test-environment";

/**
 * Phase 8D — staff account management over real HTTP.
 *
 * The whole hiring path runs through the actual route handlers with real
 * cookies: an administrator creates colleagues, one of them signs in, gets a
 * new role, is switched off, and finds the door shut on the very next request.
 *
 * What only this layer can prove: that the route RBAC matches the domain rules,
 * that a deactivation is effective immediately rather than at session expiry,
 * and that a `restaurantId` in the body is rejected rather than honoured.
 */

const PREFIX = "PHASE8D_";
const CONFIRMATION = "I_UNDERSTAND_THIS_MUTATES_A_DISPOSABLE_TEST_FIXTURE";

function readTargetUrl(): { url: URL } | { reason: string } {
  if (process.env.RUN_PHASE8D_HTTP_E2E !== "true") {
    return {
      reason:
        "Phase 8D HTTP E2E is opt-in; set RUN_PHASE8D_HTTP_E2E=true with a running disposable server.",
    };
  }
  if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production") {
    return { reason: "Phase 8D HTTP E2E refuses production environments." };
  }
  if (process.env.PHASE8D_HTTP_E2E_CONFIRM !== CONFIRMATION) {
    return { reason: `Set PHASE8D_HTTP_E2E_CONFIRM=${CONFIRMATION}.` };
  }
  const raw = process.env.PHASE8D_HTTP_E2E_BASE_URL?.trim();
  if (!raw) return { reason: "PHASE8D_HTTP_E2E_BASE_URL is required." };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { reason: "PHASE8D_HTTP_E2E_BASE_URL must be an absolute URL." };
  }
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    return { reason: "Phase 8D HTTP E2E only targets a loopback server it can own." };
  }
  return { url };
}

const target = readTargetUrl();
const db = readSupabaseIntegrationEnvironment({ requireDatabaseUrl: true });

if ("reason" in target || !db.ready) {
  test(
    "Phase 8D HTTP E2E",
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
    admin: randomUUID(),
    secondAdmin: randomUUID(),
    manager: randomUUID(),
    foreignAdmin: randomUUID(),
    foreignWaiter: randomUUID(),
  };
  const authUserIds = new Set<string>();
  const cleanupErrors: string[] = [];
  let assertions = 0;
  function check(condition: boolean, message: string): void {
    assertions += 1;
    assert.ok(condition, message);
  }

  interface Account {
    readonly key: string;
    readonly staffId: string;
    readonly role: string;
    readonly restaurantId: string;
    readonly email: string;
    readonly password: string;
  }
  const accounts: Account[] = (
    [
      ["admin", ids.admin, "ADMIN", ids.restaurant],
      ["admin2", ids.secondAdmin, "ADMIN", ids.restaurant],
      ["manager", ids.manager, "MANAGER", ids.restaurant],
      ["foreign", ids.foreignAdmin, "ADMIN", ids.foreignRestaurant],
    ] as const
  ).map(([key, staffId, role, restaurantId]) => ({
    key,
    staffId,
    role,
    restaurantId,
    email: `phase8d-http-${run}-${key}@example.com`,
    password: `Pw-${randomBytes(18).toString("base64url")}`,
  }));
  const account = (key: string): Account => {
    const found = accounts.find((candidate) => candidate.key === key);
    if (!found) throw new Error(`unknown fixture account ${key}`);
    return found;
  };

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
      options: { body?: unknown } = {},
    ): Promise<{ status: number; body: Record<string, unknown>; text: string }> {
      const headers: Record<string, string> = {
        Cookie: this.header(),
        Origin: baseUrl.origin,
      };
      if (options.body !== undefined) headers["Content-Type"] = "application/json";
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

    async login(email: string, password: string): Promise<number> {
      const result = await this.request("POST", "/api/staff/login", {
        body: { identifier: email, password },
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

  const administrator = new Session();
  const manager = new Session();
  const foreign = new Session();
  const state = { waiterId: "", cashierId: "", waiterEmail: "", waiterPassword: "" };

  /** Creates one fixture profile with a known password, straight through Auth. */
  async function seed(target: Account): Promise<void> {
    const created = await admin.auth.admin.createUser({
      email: target.email,
      password: target.password,
      email_confirm: true,
    });
    if (created.error || !created.data.user) {
      throw new Error(`auth user ${target.key}: ${created.error?.message ?? "missing"}`);
    }
    authUserIds.add(created.data.user.id);
    await sql`insert into staff_profiles (id, restaurant_id, auth_user_id, name, email,
        login_identifier, role, is_active) values
      (${target.staffId}, ${target.restaurantId}, ${created.data.user.id},
       ${`${PREFIX}${target.key}`}, ${target.email}, ${`p8d-http-${run}-${target.key}`},
       ${target.role}, true)`;
  }

  describe("Phase 8D staff accounts over HTTP", { concurrency: false }, () => {
    before(async () => {
      await sql`insert into restaurants (id, name, slug) values
        (${ids.restaurant}, ${`${PREFIX}HTTP Tenant`}, ${`phase8d-http-${run}`}),
        (${ids.foreignRestaurant}, ${`${PREFIX}HTTP Other`}, ${`phase8d-http-b-${run}`})`;
      await sql`insert into restaurant_settings (restaurant_id) values
        (${ids.restaurant}), (${ids.foreignRestaurant})`;
      await sql`insert into staff_profiles (id, restaurant_id, name, login_identifier, role,
          is_active) values
        (${ids.foreignWaiter}, ${ids.foreignRestaurant}, ${`${PREFIX}Yabanci Garson`},
         ${`p8d-http-${run}-fw`}, 'WAITER', true)`;
      for (const target of accounts) await seed(target);
      // The second administrator exists but stays out of the way until needed.
      await sql`update staff_profiles set is_active = false where id = ${ids.secondAdmin}`;

      await resetFixtureRateLimits(sql, accounts.map((target) => target.email.toLowerCase()));
      for (const [session, key] of [
        [administrator, "admin"], [manager, "manager"], [foreign, "foreign"],
      ] as const) {
        const status = await session.login(account(key).email, account(key).password);
        if (status !== 200) throw new Error(`${key} login failed with ${status}`);
      }
    });

    after(async () => {
      try {
        // Collect every login this suite caused, including ones created by a
        // test that failed before it could register them.
        for (const tenant of [ids.restaurant, ids.foreignRestaurant]) {
          const linked = await sql.unsafe(
            "select auth_user_id from staff_profiles where restaurant_id = $1::uuid and auth_user_id is not null",
            [tenant],
          );
          for (const row of linked) authUserIds.add(String(row.auth_user_id));
        }
        for (const tenant of [ids.restaurant, ids.foreignRestaurant]) {
          for (const table of ["audit_logs", "staff_profiles", "restaurant_settings"]) {
            await sql.unsafe(`delete from ${table} where restaurant_id = $1::uuid`, [tenant]);
          }
          await sql.unsafe(`delete from restaurants where id = $1::uuid`, [tenant]);
        }
        await resetFixtureRateLimits(
          sql,
          [
            ...accounts.map((target) => target.email.toLowerCase()),
            state.waiterEmail.toLowerCase(),
            // The password-reset bucket is keyed by the staff member it targets,
            // including the foreign one the cross-tenant case reaches for.
            state.cashierId,
            state.waiterId,
            ids.foreignWaiter,
          ].filter(Boolean),
          [ids.restaurant, ids.foreignRestaurant],
        );
        for (const authUserId of authUserIds) {
          const removed = await admin.auth.admin.deleteUser(authUserId);
          if (removed.error && !/not found/i.test(removed.error.message)) {
            cleanupErrors.push(`auth ${authUserId}: ${removed.error.message}`);
          }
        }
      } catch (error) {
        cleanupErrors.push((error as Error).message);
      }
      await sql.end({ timeout: 5 });
      if (cleanupErrors.length > 0) {
        console.error("PHASE8D HTTP CLEANUP INCOMPLETE:", cleanupErrors.join(" | "));
      }
      console.log(`phase8d http assertions executed: ${assertions}`);
    });

    // ------------------------------------------------------------- creation

    test("an administrator hires a waiter and a cashier", async () => {
      state.waiterEmail = `phase8d-http-${run}-waiter@example.com`;
      const waiter = await administrator.request("POST", "/api/admin/staff", {
        body: { name: `${PREFIX}Garson`, email: state.waiterEmail, role: "WAITER" },
      });
      check(waiter.status === 201, `the waiter is created (got ${waiter.status})`);
      const created = data<{ staff: { id: string; role: string }; passwordSetupEmailRequested: boolean }>(
        waiter.body,
      );
      state.waiterId = created.staff.id;
      check(created.staff.role === "WAITER", "with the role that was asked for");
      // The response says whether a setup email was *requested*, never that one
      // arrived, and never carries a password or a link.
      check(
        typeof created.passwordSetupEmailRequested === "boolean",
        "the response is honest about the setup email",
      );
      // The field *name* `passwordSetupEmailRequested` is expected; a password
      // value, an action link or a session token is not.
      check(
        !/"password"|action_link|access_token|refresh_token/i.test(waiter.text),
        `the response carries no credential of any kind (got ${waiter.text.slice(0, 200)})`,
      );

      const cashier = await administrator.request("POST", "/api/admin/staff", {
        body: {
          name: `${PREFIX}Kasiyer`,
          email: `phase8d-http-${run}-cashier@example.com`,
          role: "CASHIER",
        },
      });
      check(cashier.status === 201, `the cashier is created (got ${cashier.status})`);
      state.cashierId = data<{ staff: { id: string } }>(cashier.body).staff.id;

      const rows = await sql`
        select id, auth_user_id from staff_profiles
        where restaurant_id = ${ids.restaurant} and id in (${state.waiterId}, ${state.cashierId})`;
      check(rows.length === 2, "both profiles exist");
      for (const row of rows) {
        check(row.auth_user_id !== null, "and each is linked to a real login");
        authUserIds.add(String(row.auth_user_id));
      }
    });

    test("the body cannot smuggle a password or another restaurant", async () => {
      for (const body of [
        { name: `${PREFIX}X`, email: `phase8d-http-${run}-x@example.com`, role: "WAITER", password: "hunter2hunter2" },
        { name: `${PREFIX}X`, email: `phase8d-http-${run}-x@example.com`, role: "WAITER", restaurantId: ids.foreignRestaurant },
        { name: `${PREFIX}X`, email: `phase8d-http-${run}-x@example.com`, role: "WAITER", isActive: true },
        { name: `${PREFIX}X`, email: "not-an-address", role: "WAITER" },
        { name: `${PREFIX}X`, email: `phase8d-http-${run}-x@example.com`, role: "OWNER" },
      ]) {
        const refused = await administrator.request("POST", "/api/admin/staff", { body });
        check(
          refused.status === 400,
          `${JSON.stringify(Object.keys(body))} must be refused (got ${refused.status})`,
        );
      }
      const [row] = await sql`
        select count(*)::int as total from staff_profiles
        where email = ${`phase8d-http-${run}-x@example.com`}`;
      check(Number(row.total) === 0, "and nothing was created by any of them");
    });

    test("a duplicate address is a safe conflict, not a provider stack trace", async () => {
      const duplicate = await administrator.request("POST", "/api/admin/staff", {
        body: { name: `${PREFIX}Kopya`, email: state.waiterEmail, role: "WAITER" },
      });
      check(duplicate.status === 409, `a duplicate is a conflict (got ${duplicate.status})`);
      check(
        !/supabase|sql|constraint|stack/i.test(duplicate.text),
        "and the provider's own wording never reaches the operator",
      );
    });

    // ----------------------------------------------------------------- RBAC

    test("a manager may hire the floor and nothing above it", async () => {
      for (const role of ["WAITER", "KITCHEN", "CASHIER"] as const) {
        const created = await manager.request("POST", "/api/admin/staff", {
          body: {
            name: `${PREFIX}Müdürün ${role}`,
            email: `phase8d-http-${run}-mgr-${role.toLowerCase()}@example.com`,
            role,
          },
        });
        check(created.status === 201, `a manager may hire a ${role} (got ${created.status})`);
        const [row] = await sql`
          select auth_user_id from staff_profiles
          where id = ${data<{ staff: { id: string } }>(created.body).staff.id}`;
        authUserIds.add(String(row.auth_user_id));
      }

      for (const role of ["ADMIN", "MANAGER"] as const) {
        const refused = await manager.request("POST", "/api/admin/staff", {
          body: {
            name: `${PREFIX}Olmaz`,
            email: `phase8d-http-${run}-mgr-${role.toLowerCase()}@example.com`,
            role,
          },
        });
        check(refused.status === 403, `a manager cannot create a ${role} (got ${refused.status})`);
      }

      const reachUp = await manager.request("PATCH", `/api/admin/staff/${ids.admin}`, {
        body: { isActive: false },
      });
      check(reachUp.status === 403, `nor touch an administrator (got ${reachUp.status})`);
      const promoteSelf = await manager.request("PATCH", `/api/admin/staff/${ids.manager}`, {
        body: { role: "ADMIN" },
      });
      check(promoteSelf.status === 403, `nor promote themselves (got ${promoteSelf.status})`);
    });

    // ------------------------------------------------- listing and role change

    test("the listing filters and paginates behind the session's own tenant", async () => {
      const all = await administrator.request("GET", "/api/admin/staff?page=1&pageSize=100");
      check(all.status === 200, `the list reads (got ${all.status})`);
      const page = data<{ staff: { id: string; role: string }[]; total: number; activeAdminCount: number }>(
        all.body,
      );
      check(page.total >= 6, `everyone is listed (got ${page.total})`);
      check(page.activeAdminCount === 1, `one active administrator (got ${page.activeAdminCount})`);
      check(
        !page.staff.some((member) => member.id === ids.foreignWaiter),
        "and nobody from the other restaurant",
      );
      check(
        !/password|access_token|refresh_token|service_role/i.test(all.text),
        "no credential appears in the payload",
      );

      const waiters = await administrator.request("GET", "/api/admin/staff?role=WAITER");
      check(
        data<{ staff: { role: string }[] }>(waiters.body).staff.every((m) => m.role === "WAITER"),
        "a role filter returns only that role",
      );

      // A tenant on the query string is refused outright by the strict schema.
      const spoof = await administrator.request(
        "GET",
        `/api/admin/staff?restaurantId=${ids.foreignRestaurant}`,
      );
      check(spoof.status === 400, `a restaurantId query is refused (got ${spoof.status})`);
    });

    test("a new role is in force on the very next request", async () => {
      // The operator sets a password out of band; in production this is the
      // password-setup link the account's holder follows.
      const [row] = await sql`select auth_user_id from staff_profiles where id = ${state.waiterId}`;
      state.waiterPassword = `Pw-${randomBytes(18).toString("base64url")}`;
      const updated = await admin.auth.admin.updateUserById(String(row.auth_user_id), {
        password: state.waiterPassword,
      });
      check(!updated.error, "the account can be given a password out of band");

      await resetFixtureRateLimits(sql, [state.waiterEmail.toLowerCase()]);
      const waiter = new Session();
      check(
        (await waiter.login(state.waiterEmail, state.waiterPassword)) === 200,
        "the waiter can sign in",
      );
      // A waiter has no business on the cashier's endpoints.
      const beforeChange = await waiter.request("GET", "/api/cashier/shifts/current");
      check(beforeChange.status === 403, `and is refused the till (got ${beforeChange.status})`);

      const changed = await administrator.request("PATCH", `/api/admin/staff/${state.waiterId}`, {
        body: { role: "CASHIER" },
      });
      check(changed.status === 200, `the role is changed (got ${changed.status})`);

      // Same cookie, same session, new authority — resolved from the database
      // on every request rather than from anything the browser holds.
      const afterChange = await waiter.request("GET", "/api/cashier/shifts/current");
      check(
        afterChange.status === 200,
        `the same session is now a cashier (got ${afterChange.status})`,
      );
    });

    test("a deactivated account is shut out on its next request, and let back in", async () => {
      const waiter = new Session();
      await resetFixtureRateLimits(sql, [state.waiterEmail.toLowerCase()]);
      check(
        (await waiter.login(state.waiterEmail, state.waiterPassword)) === 200,
        "the account signs in while active",
      );

      const deactivated = await administrator.request(
        "PATCH",
        `/api/admin/staff/${state.waiterId}`,
        { body: { isActive: false } },
      );
      check(deactivated.status === 200, `the account is switched off (got ${deactivated.status})`);

      // The existing session is not waited out: the next request is already denied.
      const denied = await waiter.request("GET", "/api/cashier/shifts/current");
      check(
        denied.status === 401 || denied.status === 403,
        `the live session loses access at once (got ${denied.status})`,
      );

      // And a fresh sign-in with correct credentials is refused by the app.
      await resetFixtureRateLimits(sql, [state.waiterEmail.toLowerCase()]);
      const relogin = new Session();
      const status = await relogin.login(state.waiterEmail, state.waiterPassword);
      check(status === 401, `correct credentials are not enough (got ${status})`);

      const reactivated = await administrator.request(
        "PATCH",
        `/api/admin/staff/${state.waiterId}`,
        { body: { isActive: true } },
      );
      check(reactivated.status === 200, "the account is reactivated");
      await resetFixtureRateLimits(sql, [state.waiterEmail.toLowerCase()]);
      const back = new Session();
      check(
        (await back.login(state.waiterEmail, state.waiterPassword)) === 200,
        "and the same credentials work again",
      );
    });

    // ------------------------------------------------------ last-admin safety

    test("the last administrator cannot be switched off or demoted over HTTP", async () => {
      const deactivate = await administrator.request("PATCH", `/api/admin/staff/${ids.admin}`, {
        body: { isActive: false },
      });
      const demote = await administrator.request("PATCH", `/api/admin/staff/${ids.admin}`, {
        body: { role: "MANAGER" },
      });
      check(deactivate.status === 409, `deactivation is refused (got ${deactivate.status})`);
      check(demote.status === 409, `demotion is refused (got ${demote.status})`);
      check(
        errorCode(deactivate.body) === "CONFLICT",
        "with a conflict the operator can act on, not a 500",
      );

      const [row] = await sql`
        select count(*)::int as total from staff_profiles
        where restaurant_id = ${ids.restaurant} and role = 'ADMIN' and is_active = true`;
      check(Number(row.total) === 1, "the restaurant still has its administrator");
    });

    // --------------------------------------------------------- password reset

    test("a password reset is requested without returning anything secret", async () => {
      const reset = await administrator.request(
        "POST",
        `/api/admin/staff/${state.cashierId}/password-reset`,
      );
      check(reset.status === 200, `the reset is accepted (got ${reset.status})`);
      const result = data<{ emailRequested: boolean; email: string }>(reset.body);
      check(typeof result.emailRequested === "boolean", "and says whether it was requested");
      check(
        !/"password"|action_link|access_token|refresh_token/i.test(reset.text),
        `no link, token or password comes back (got ${reset.text.slice(0, 200)})`,
      );

      // Spam control: the same target cannot be mailed indefinitely.
      const attempts = [reset.status];
      for (let index = 0; index < 4; index += 1) {
        const again = await administrator.request(
          "POST",
          `/api/admin/staff/${state.cashierId}/password-reset`,
        );
        attempts.push(again.status);
      }
      check(
        attempts.includes(429),
        `repeated requests are rate limited (got ${attempts.join(", ")})`,
      );
    });

    // ----------------------------------------------------------- other tenants

    test("another restaurant's staff cannot be read, changed or reset", async () => {
      const read = await administrator.request("GET", `/api/admin/staff/${ids.foreignWaiter}`);
      const patch = await administrator.request("PATCH", `/api/admin/staff/${ids.foreignWaiter}`, {
        body: { isActive: false },
      });
      const reset = await administrator.request(
        "POST",
        `/api/admin/staff/${ids.foreignWaiter}/password-reset`,
      );
      check(read.status === 404, `a foreign profile is absent (got ${read.status})`);
      check(patch.status === 404, `and unchangeable (got ${patch.status})`);
      check(reset.status === 404, `and unreachable by reset (got ${reset.status})`);

      // Identical answer for an id that exists nowhere.
      const missing = await administrator.request("GET", `/api/admin/staff/${randomUUID()}`);
      check(
        missing.status === read.status,
        "a nonexistent profile is indistinguishable from a foreign one",
      );

      const [row] = await sql`select is_active from staff_profiles where id = ${ids.foreignWaiter}`;
      check(row.is_active === true, "the other restaurant is untouched");

      // And from the other side: their administrator sees only their own people.
      const theirs = await foreign.request("GET", "/api/admin/staff?page=1&pageSize=100");
      check(
        data<{ staff: { id: string }[] }>(theirs.body).staff.every(
          (member) => member.id !== state.waiterId,
        ),
        "and cannot see ours",
      );
    });

    test("the administrator's own session survives all of this", async () => {
      const stillWorks = await administrator.request("GET", "/api/admin/staff?page=1&pageSize=5");
      check(stillWorks.status === 200, `the admin is still signed in (got ${stillWorks.status})`);
    });

    test("the changes are audited, and the audit carries no credential", async () => {
      const rows = await sql`
        select action, new_value::text as new_value, metadata::text as metadata
        from audit_logs where restaurant_id = ${ids.restaurant}`;
      const actions = new Set(rows.map((row) => String(row.action)));
      for (const expected of [
        "staff.created",
        "staff.role_changed",
        "staff.deactivated",
        "staff.activated",
        "staff.password_reset_requested",
      ]) {
        check(actions.has(expected), `${expected} is audited (saw ${[...actions].join(", ")})`);
      }
      check(
        rows.every(
          (row) => !/password|action_link|access_token|refresh_token/i.test(
            `${row.new_value ?? ""}${row.metadata ?? ""}`,
          ),
        ),
        "and no audit payload carries a credential",
      );
    });
  });
}
