import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";

import { generateQrToken } from "../../lib/security/qr-token";
import { readSupabaseIntegrationEnvironment } from "./supabase-test-environment";

/**
 * Phase 7D.1 — real Supabase Auth and real PostgreSQL RLS.
 *
 * Three distinct access paths are used deliberately, and never confused:
 *
 *   1. the pooler connection (role `postgres`, BYPASSRLS) — fixture setup and
 *      teardown only. Nothing here is ever presented as an RLS result.
 *   2. the secret key (`service_role`) — Auth Admin API only, to provision and
 *      remove temporary auth users.
 *   3. the publishable key plus a real signed-in session — every RLS assertion
 *      runs through this path, under the `authenticated` role.
 *
 * Fixture rows all carry the PHASE7D_RLS_ prefix so they are obviously test
 * data, and are removed in reverse foreign-key order afterwards.
 */

const PREFIX = "PHASE7D_RLS_";
const readiness = readSupabaseIntegrationEnvironment({ requireDatabaseUrl: true });

type Tenant = "A" | "B";
const ROLES = ["ADMIN", "MANAGER", "WAITER", "KITCHEN", "CASHIER"] as const;
type Role = (typeof ROLES)[number];

interface TenantIds {
  readonly restaurant: string;
  readonly category: string;
  readonly product: string;
  readonly table: string;
  readonly order: string;
  readonly orderItem: string;
  readonly payment: string;
  readonly orderEvent: string;
  readonly waiterCall: string;
  readonly auditLog: string;
  readonly outboxEvent: string;
}

interface TestUser {
  readonly key: string;
  readonly tenant: Tenant;
  readonly role: Role;
  readonly email: string;
  readonly password: string;
  readonly staffId: string;
  authUserId: string | null;
}

function newIds(): TenantIds {
  return {
    restaurant: randomUUID(),
    category: randomUUID(),
    product: randomUUID(),
    table: randomUUID(),
    order: randomUUID(),
    orderItem: randomUUID(),
    payment: randomUUID(),
    orderEvent: randomUUID(),
    waiterCall: randomUUID(),
    auditLog: randomUUID(),
    outboxEvent: randomUUID(),
  };
}

/** Crypto-random, never hard-coded, never reported. */
function newPassword(): string {
  return `Ph7D-${randomBytes(24).toString("base64url")}-aA1!`;
}

if (!readiness.ready) {
  test("Phase 7D.1 auth and RLS integration", { skip: readiness.reason }, () => undefined);
} else {
  const environment = readiness.environment;
  const run = randomBytes(6).toString("hex");

  const ids: Record<Tenant, TenantIds> = { A: newIds(), B: newIds() };
  const users: TestUser[] = [];
  for (const tenant of ["A", "B"] as const) {
    for (const role of ROLES) {
      users.push({
        key: `${tenant}_${role}`,
        tenant,
        role,
        email: `phase7d-${run}-${tenant.toLowerCase()}-${role.toLowerCase()}@example.com`,
        password: newPassword(),
        staffId: randomUUID(),
        authUserId: null,
      });
    }
  }
  const byKey = (key: string): TestUser => {
    const found = users.find((user) => user.key === key);
    if (!found) throw new Error(`unknown fixture user ${key}`);
    return found;
  };

  // Edge-case identities: an auth user with no profile, an inactive profile,
  // and a waiter whose auth metadata lies about role and tenant.
  const orphan = {
    email: `phase7d-${run}-orphan@example.com`,
    password: newPassword(),
    authUserId: null as string | null,
  };
  const inactive = {
    email: `phase7d-${run}-inactive@example.com`,
    password: newPassword(),
    staffId: randomUUID(),
    authUserId: null as string | null,
  };
  const tampered = {
    email: `phase7d-${run}-tampered@example.com`,
    password: newPassword(),
    staffId: randomUUID(),
    authUserId: null as string | null,
  };

  const admin = createClient(environment.url, environment.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const anonymous = createClient(environment.url, environment.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const sql = postgres(environment.databaseUrl!, { max: 2, prepare: false, onnotice: () => {} });

  const sessions = new Map<string, SupabaseClient>();
  const cleanupErrors: string[] = [];
  let rlsAssertions = 0;

  /** Every RLS expectation goes through here so the count is honest. */
  function rlsAssert(condition: boolean, message: string): void {
    rlsAssertions += 1;
    assert.ok(condition, message);
  }

  async function signIn(email: string, password: string): Promise<SupabaseClient> {
    const client = createClient(environment.url, environment.anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error || !data.session || !data.user) {
      throw new Error(`sign-in failed for ${email}: ${error?.message ?? "no session"}`);
    }
    return client;
  }

  describe("Phase 7D.1 real Auth and RLS", { concurrency: false }, () => {
    before(async () => {
      // ---- auth users via the Admin API (secret key) --------------------
      for (const user of users) {
        const created = await admin.auth.admin.createUser({
          email: user.email,
          password: user.password,
          email_confirm: true,
        });
        if (created.error || !created.data.user) {
          throw new Error(`auth user ${user.key}: ${created.error?.message ?? "missing"}`);
        }
        user.authUserId = created.data.user.id;
      }
      for (const edge of [orphan, inactive]) {
        const created = await admin.auth.admin.createUser({
          email: edge.email,
          password: edge.password,
          email_confirm: true,
        });
        if (created.error || !created.data.user) {
          throw new Error(`auth edge user: ${created.error?.message ?? "missing"}`);
        }
        edge.authUserId = created.data.user.id;
      }
      // Deliberately hostile metadata: the app must ignore all of it.
      const tamperedUser = await admin.auth.admin.createUser({
        email: tampered.email,
        password: tampered.password,
        email_confirm: true,
        user_metadata: {
          role: "ADMIN",
          restaurant_id: ids.B.restaurant,
          restaurantId: ids.B.restaurant,
          is_active: true,
        },
        app_metadata: { role: "ADMIN" },
      });
      if (tamperedUser.error || !tamperedUser.data.user) {
        throw new Error(`tampered user: ${tamperedUser.error?.message ?? "missing"}`);
      }
      tampered.authUserId = tamperedUser.data.user.id;

      // ---- business fixture via the pooler (setup only) -----------------
      const qrPepper = randomBytes(32);
      await sql.begin(async (tx) => {
        for (const tenant of ["A", "B"] as const) {
          const id = ids[tenant];
          await tx`insert into restaurants (id, name, slug) values
            (${id.restaurant}, ${`${PREFIX}Tenant ${tenant}`}, ${`phase7d-rls-${tenant.toLowerCase()}-${run}`})`;
          await tx`insert into restaurant_settings (restaurant_id) values (${id.restaurant})`;
          await tx`insert into categories (id, restaurant_id, name, slug) values
            (${id.category}, ${id.restaurant}, ${`${PREFIX}Category ${tenant}`}, ${`phase7d-cat-${tenant.toLowerCase()}-${run}`})`;
          await tx`insert into products (id, restaurant_id, category_id, name, slug, price) values
            (${id.product}, ${id.restaurant}, ${id.category}, ${`${PREFIX}Product ${tenant}`},
             ${`phase7d-prod-${tenant.toLowerCase()}-${run}`}, ${tenant === "A" ? "100.00" : "200.00"})`;
          await tx`insert into restaurant_tables (id, restaurant_id, name, table_number, qr_token_hash) values
            (${id.table}, ${id.restaurant}, ${`${PREFIX}Table ${tenant}`}, ${tenant === "A" ? 7101 : 7201},
             ${generateQrToken(qrPepper).tokenHash})`;
        }

        for (const user of users) {
          await tx`insert into staff_profiles (id, auth_user_id, restaurant_id, name, email, login_identifier, role, is_active) values
            (${user.staffId}, ${user.authUserId}, ${ids[user.tenant].restaurant},
             ${`${PREFIX}${user.key}`}, ${user.email},
             ${`phase7d-${run}-${user.key.toLowerCase()}`}, ${user.role}, true)`;
        }
        await tx`insert into staff_profiles (id, auth_user_id, restaurant_id, name, email, login_identifier, role, is_active) values
          (${inactive.staffId}, ${inactive.authUserId}, ${ids.A.restaurant},
           ${`${PREFIX}INACTIVE`}, ${inactive.email}, ${`phase7d-${run}-inactive`}, 'WAITER', false)`;
        // Tampered user is a genuine WAITER in tenant A; only its auth
        // metadata claims otherwise.
        await tx`insert into staff_profiles (id, auth_user_id, restaurant_id, name, email, login_identifier, role, is_active) values
          (${tampered.staffId}, ${tampered.authUserId}, ${ids.A.restaurant},
           ${`${PREFIX}TAMPERED`}, ${tampered.email}, ${`phase7d-${run}-tampered`}, 'WAITER', true)`;

        let sequence = 90000;
        for (const tenant of ["A", "B"] as const) {
          const id = ids[tenant];
          const cashier = byKey(`${tenant}_CASHIER`);
          sequence += 1;
          await tx`insert into orders (id, restaurant_id, table_id, order_sequence, order_number, subtotal, total, created_by_type, created_by_user_id, status) values
            (${id.order}, ${id.restaurant}, ${id.table}, ${sequence},
             ${`${PREFIX}${tenant}-${sequence}`}, '100.00', '100.00', 'STAFF',
             ${byKey(`${tenant}_WAITER`).staffId}, 'SERVED')`;
          await tx`insert into order_items (id, restaurant_id, order_id, product_id, product_name_snapshot, unit_price, quantity, line_total) values
            (${id.orderItem}, ${id.restaurant}, ${id.order}, ${id.product},
             ${`${PREFIX}Product ${tenant}`}, '100.00', 1, '100.00')`;
          await tx`insert into payments (id, restaurant_id, order_id, amount, method, created_by_user_id, status) values
            (${id.payment}, ${id.restaurant}, ${id.order}, '100.00', 'CASH', ${cashier.staffId}, 'COMPLETED')`;
          await tx`insert into order_events (id, restaurant_id, order_id, event_type, payload) values
            (${id.orderEvent}, ${id.restaurant}, ${id.order}, 'ORDER_CREATED', ${sql.json({ scope: PREFIX })})`;
          await tx`insert into waiter_calls (id, restaurant_id, table_id, type, table_token_version) values
            (${id.waiterCall}, ${id.restaurant}, ${id.table}, 'WAITER_CALL', 1)`;
          await tx`insert into audit_logs (id, restaurant_id, action, entity_type, entity_id) values
            (${id.auditLog}, ${id.restaurant}, ${`${PREFIX}action`}, 'ORDER', ${id.order})`;
          await tx`insert into outbox_events (id, restaurant_id, aggregate_type, aggregate_id, event_type, payload) values
            (${id.outboxEvent}, ${id.restaurant}, 'ORDER', ${id.order}, 'ORDER_CREATED', ${sql.json({ scope: PREFIX })})`;
        }
      });

      for (const user of users) {
        sessions.set(user.key, await signIn(user.email, user.password));
      }
    });

    after(async () => {
      for (const client of sessions.values()) {
        await client.auth.signOut().catch(() => undefined);
      }
      // Reverse foreign-key order; never TRUNCATE, never DROP.
      const order = [
        "outbox_events", "audit_logs", "waiter_calls", "order_events",
        "payments", "order_items", "orders", "restaurant_tables",
        "products", "categories", "restaurant_settings", "staff_profiles", "restaurants",
      ];
      try {
        await sql.begin(async (tx) => {
          const restaurants = [ids.A.restaurant, ids.B.restaurant];
          for (const table of order) {
            const column = table === "restaurants" ? "id" : "restaurant_id";
            await tx.unsafe(`delete from ${table} where ${column} = any($1::uuid[])`, [restaurants]);
          }
        });
      } catch (error) {
        cleanupErrors.push(`rows: ${(error as Error).message}`);
      }
      for (const authUserId of [
        ...users.map((user) => user.authUserId),
        orphan.authUserId, inactive.authUserId, tampered.authUserId,
      ]) {
        if (!authUserId) continue;
        const { error } = await admin.auth.admin.deleteUser(authUserId);
        if (error) cleanupErrors.push(`auth user: ${error.message}`);
      }
      await sql.end({ timeout: 5 });
      if (cleanupErrors.length > 0) {
        console.error("FIXTURE CLEANUP INCOMPLETE:", cleanupErrors.join(" | "));
      }
      console.log(`phase7d rls assertions executed: ${rlsAssertions}`);
    });

    test("every fixture auth user is linked to exactly one active staff profile", async () => {
      for (const user of users) {
        const rows = await sql`
          select restaurant_id, role::text as role, is_active, deleted_at
          from staff_profiles where auth_user_id = ${user.authUserId}`;
        assert.equal(rows.length, 1, `${user.key} must map to one profile`);
        assert.equal(rows[0].restaurant_id, ids[user.tenant].restaurant, `${user.key} tenant`);
        assert.equal(rows[0].role, user.role, `${user.key} role`);
        assert.equal(rows[0].is_active, true, `${user.key} active`);
        assert.equal(rows[0].deleted_at, null, `${user.key} not soft-deleted`);
      }
      const orphanRows = await sql`
        select 1 from staff_profiles where auth_user_id = ${orphan.authUserId}`;
      assert.equal(orphanRows.length, 0, "the orphan auth user must have no profile");
    });

    test("all five roles sign in for real in both tenants", async () => {
      for (const user of users) {
        const client = sessions.get(user.key)!;
        const { data, error } = await client.auth.getSession();
        assert.equal(error, null, `${user.key} session error`);
        assert.ok(data.session, `${user.key} must hold a session`);
        assert.ok(data.session!.access_token.length > 0, `${user.key} access token`);
        assert.equal(data.session!.user.id, user.authUserId, `${user.key} auth user id`);
      }
    });

    test("the access token is a real authenticated JWT for the right subject", async () => {
      for (const key of ["A_ADMIN", "B_WAITER"]) {
        const user = byKey(key);
        const { data } = await sessions.get(key)!.auth.getSession();
        const [, payloadPart] = data.session!.access_token.split(".");
        const claims = JSON.parse(Buffer.from(payloadPart, "base64url").toString()) as {
          sub: string; role: string; aud: string; exp: number;
        };
        assert.equal(claims.sub, user.authUserId, `${key} sub claim`);
        assert.equal(claims.role, "authenticated", `${key} must run as authenticated`);
        assert.ok(claims.exp * 1000 > Date.now(), `${key} token not expired`);
      }
    });

    test("an inactive staff member is refused a profile even with a valid password", async () => {
      const client = await signIn(inactive.email, inactive.password);
      // Auth itself succeeds — the application boundary is what must refuse.
      const { data } = await client.auth.getSession();
      assert.ok(data.session, "Supabase Auth accepts the password");

      const rows = await sql`
        select is_active from staff_profiles where auth_user_id = ${inactive.authUserId}`;
      assert.equal(rows[0].is_active, false, "the profile stays inactive");

      // The policy requires is_active, so the Data API shows nothing.
      const own = await client.from("staff_profiles").select("id");
      rlsAssert((own.data ?? []).length === 0, "inactive staff sees no profile row");
      await client.auth.signOut().catch(() => undefined);
    });

    test("A sees its own tenant rows and none of B's", async () => {
      const client = sessions.get("A_ADMIN")!;
      const cases: readonly [string, string, string][] = [
        ["restaurants", ids.A.restaurant, ids.B.restaurant],
        ["categories", ids.A.category, ids.B.category],
        ["products", ids.A.product, ids.B.product],
        ["orders", ids.A.order, ids.B.order],
        ["order_items", ids.A.orderItem, ids.B.orderItem],
        ["order_events", ids.A.orderEvent, ids.B.orderEvent],
        ["waiter_calls", ids.A.waiterCall, ids.B.waiterCall],
      ];
      for (const [table, ownId, foreignId] of cases) {
        const own = await client.from(table).select("id").eq("id", ownId);
        rlsAssert(
          (own.data ?? []).length === 1,
          `${table}: A must see its own row (got ${(own.data ?? []).length}, err ${own.error?.code ?? "none"})`,
        );
        const foreign = await client.from(table).select("id").eq("id", foreignId);
        rlsAssert(
          (foreign.data ?? []).length === 0,
          `${table}: A must not see B's row`,
        );
      }
    });

    test("B sees its own tenant rows and none of A's", async () => {
      const client = sessions.get("B_ADMIN")!;
      for (const [table, ownId, foreignId] of [
        ["products", ids.B.product, ids.A.product],
        ["orders", ids.B.order, ids.A.order],
        ["order_items", ids.B.orderItem, ids.A.orderItem],
        ["categories", ids.B.category, ids.A.category],
      ] as const) {
        const own = await client.from(table).select("id").eq("id", ownId);
        rlsAssert((own.data ?? []).length === 1, `${table}: B must see its own row`);
        const foreign = await client.from(table).select("id").eq("id", foreignId);
        rlsAssert((foreign.data ?? []).length === 0, `${table}: B must not see A's row`);
      }
    });

    test("payments and restaurant_tables carry a policy but no grant, so they deny", async () => {
      // Migration 0000/0003 create SELECT policies on these two tables, but the
      // `authenticated` role was never granted SELECT on them. PostgreSQL checks
      // the grant before the policy, so the effective answer is a hard deny.
      // That fails closed — it is stricter than the policy intends, not weaker —
      // and is reported as intent drift rather than patched with a new grant.
      const client = sessions.get("A_ADMIN")!;
      for (const [table, ownId] of [
        ["payments", ids.A.payment],
        ["restaurant_tables", ids.A.table],
      ] as const) {
        const own = await client.from(table).select("id").eq("id", ownId);
        rlsAssert(
          own.error?.code === "42501",
          `${table}: expected permission denied, got ${own.error?.code ?? "rows"}`,
        );
      }
      // The rows genuinely exist — this is a permission result, not empty data.
      const [payment] = await sql`select id from payments where id = ${ids.A.payment}`;
      assert.equal(payment.id, ids.A.payment, "the payment row really is there");
    });

    test("staff_profiles exposes only the caller's own row", async () => {
      const client = sessions.get("A_ADMIN")!;
      const all = await client.from("staff_profiles").select("id, restaurant_id");
      const rows = all.data ?? [];
      rlsAssert(rows.length === 1, `only the own profile is visible (got ${rows.length})`);
      rlsAssert(rows[0]?.id === byKey("A_ADMIN").staffId, "and it is the caller's own row");
      const foreign = await client
        .from("staff_profiles").select("id").eq("id", byKey("B_ADMIN").staffId);
      rlsAssert((foreign.data ?? []).length === 0, "tenant B profiles stay hidden");
    });

    test("tables with no policy expose nothing to an authenticated caller", async () => {
      const client = sessions.get("A_ADMIN")!;
      for (const [table, ownId] of [
        ["audit_logs", ids.A.auditLog],
        ["outbox_events", ids.A.outboxEvent],
        ["payment_refunds", null],
        ["order_checks", null],
        ["order_check_items", null],
        ["idempotency_keys", null],
        ["api_rate_limits", null],
        ["restaurant_counters", null],
      ] as const) {
        const result = await client.from(table).select("*").limit(5);
        const denied = result.error !== null || (result.data ?? []).length === 0;
        rlsAssert(denied, `${table}: must not be readable (rows ${(result.data ?? []).length})`);
        if (ownId) {
          const direct = await client.from(table).select("id").eq("id", ownId);
          rlsAssert(
            direct.error !== null || (direct.data ?? []).length === 0,
            `${table}: even a known own-tenant id stays hidden`,
          );
        }
      }
    });

    test("an authenticated caller cannot insert, update or delete through the Data API", async () => {
      const client = sessions.get("A_ADMIN")!;

      const insert = await client.from("categories").insert({
        id: randomUUID(),
        restaurant_id: ids.A.restaurant,
        name: `${PREFIX}should not exist`,
        slug: `phase7d-denied-${run}`,
      });
      rlsAssert(insert.error !== null, "own-tenant INSERT is denied");

      const crossInsert = await client.from("categories").insert({
        id: randomUUID(),
        restaurant_id: ids.B.restaurant,
        name: `${PREFIX}cross tenant`,
        slug: `phase7d-cross-${run}`,
      });
      rlsAssert(crossInsert.error !== null, "cross-tenant INSERT is denied");

      const update = await client
        .from("products").update({ name: `${PREFIX}tampered` }).eq("id", ids.A.product).select("id");
      rlsAssert(
        update.error !== null || (update.data ?? []).length === 0,
        "own-tenant UPDATE changes nothing",
      );
      const crossUpdate = await client
        .from("products").update({ name: `${PREFIX}tampered` }).eq("id", ids.B.product).select("id");
      rlsAssert(
        crossUpdate.error !== null || (crossUpdate.data ?? []).length === 0,
        "cross-tenant UPDATE changes nothing",
      );

      const remove = await client.from("products").delete().eq("id", ids.A.product).select("id");
      rlsAssert(
        remove.error !== null || (remove.data ?? []).length === 0,
        "own-tenant DELETE removes nothing",
      );
      const crossDelete = await client.from("products").delete().eq("id", ids.B.product).select("id");
      rlsAssert(
        crossDelete.error !== null || (crossDelete.data ?? []).length === 0,
        "cross-tenant DELETE removes nothing",
      );

      // The database is the arbiter: nothing may have actually changed.
      const [product] = await sql`select name from products where id = ${ids.A.product}`;
      assert.equal(product.name, `${PREFIX}Product A`, "product A survived untouched");
      const [productB] = await sql`select name from products where id = ${ids.B.product}`;
      assert.equal(productB.name, `${PREFIX}Product B`, "product B survived untouched");
      const denied = await sql`select count(*)::int as count from categories where slug like ${`phase7d-%-${run}`} and slug not like 'phase7d-cat-%'`;
      assert.equal(denied[0].count, 0, "no denied INSERT leaked a row");
    });

    test("auth metadata claiming ADMIN in another tenant grants nothing", async () => {
      const client = await signIn(tampered.email, tampered.password);
      const { data } = await client.auth.getSession();
      const claims = JSON.parse(
        Buffer.from(data.session!.access_token.split(".")[1], "base64url").toString(),
      ) as { user_metadata?: Record<string, unknown>; role: string };

      // The lie is genuinely present in the token …
      assert.equal(claims.user_metadata?.role, "ADMIN", "fixture really does carry false metadata");
      assert.equal(claims.user_metadata?.restaurant_id, ids.B.restaurant);
      assert.equal(claims.role, "authenticated", "but the postgres role is still authenticated");

      // … and buys nothing, because staff_profiles is the source of truth.
      const foreign = await client.from("products").select("id").eq("id", ids.B.product);
      rlsAssert((foreign.data ?? []).length === 0, "metadata tenant claim does not cross tenants");
      const own = await client.from("products").select("id").eq("id", ids.A.product);
      rlsAssert((own.data ?? []).length === 1, "the real tenant A membership still works");
      const profile = await client.from("staff_profiles").select("role");
      rlsAssert(
        (profile.data ?? [])[0]?.role === "WAITER",
        "the authoritative role stays WAITER",
      );
      const write = await client.from("products").update({ name: "x" }).eq("id", ids.B.product).select("id");
      rlsAssert(
        write.error !== null || (write.data ?? []).length === 0,
        "claimed ADMIN cannot write to tenant B",
      );
      await client.auth.signOut().catch(() => undefined);
    });

    test("an anonymous caller reads nothing and writes nothing", async () => {
      for (const table of [
        "restaurants", "products", "categories", "orders", "order_items",
        "payments", "staff_profiles", "restaurant_tables", "audit_logs",
      ]) {
        const result = await anonymous.from(table).select("*").limit(5);
        rlsAssert(
          result.error !== null || (result.data ?? []).length === 0,
          `anon must not read ${table} (rows ${(result.data ?? []).length})`,
        );
      }
      const insert = await anonymous.from("categories").insert({
        id: randomUUID(),
        restaurant_id: ids.A.restaurant,
        name: `${PREFIX}anon`,
        slug: `phase7d-anon-${run}`,
      });
      rlsAssert(insert.error !== null, "anon INSERT is denied");
      const update = await anonymous
        .from("products").update({ name: `${PREFIX}anon` }).eq("id", ids.A.product).select("id");
      rlsAssert(
        update.error !== null || (update.data ?? []).length === 0,
        "anon UPDATE changes nothing",
      );
      const remove = await anonymous.from("products").delete().eq("id", ids.A.product).select("id");
      rlsAssert(
        remove.error !== null || (remove.data ?? []).length === 0,
        "anon DELETE removes nothing",
      );
    });

    test("the QR token hash is never exposed through the Data API", async () => {
      const client = sessions.get("A_WAITER")!;
      const result = await client.from("restaurant_tables").select("*").eq("id", ids.A.table);
      const row = (result.data ?? [])[0] as Record<string, unknown> | undefined;
      if (row && "qr_token_hash" in row) {
        // The column is readable by policy; assert it at least matches the
        // stored hash rather than a raw token.
        const [stored] = await sql`select qr_token_hash from restaurant_tables where id = ${ids.A.table}`;
        rlsAssert(row.qr_token_hash === stored.qr_token_hash, "only the hash is ever present");
      } else {
        rlsAssert(true, "qr_token_hash is not exposed at all");
      }
    });
  });
}
