import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";

import { createClient } from "@supabase/supabase-js";
import postgres, { type Sql } from "postgres";

import { generateQrToken } from "../../lib/security/qr-token";
import { readSupabaseIntegrationEnvironment } from "./supabase-test-environment";

const readiness = readSupabaseIntegrationEnvironment({ requireDatabaseUrl: true });

interface FixtureIds {
  readonly restaurants: readonly [string, string];
  readonly staff: readonly [string, string];
  readonly categories: readonly [string, string];
  readonly products: readonly [string, string];
  readonly tables: readonly [string, string];
  readonly orders: readonly [string, string];
  readonly orderItems: readonly [string, string];
  readonly waiterCalls: readonly [string, string];
  readonly payments: readonly [string, string];
  readonly orderEvents: readonly [string, string];
  readonly outboxEvents: readonly [string, string];
  readonly auditLogs: readonly [string, string];
}

interface RlsFixture {
  readonly ids: FixtureIds;
  readonly email: string;
  readonly password: string;
  authUserId: string | null;
}

interface QueryError {
  readonly code?: string;
  readonly message: string;
}

interface QueryResult {
  readonly data: unknown[] | null;
  readonly error: QueryError | null;
}

function makeIds(): FixtureIds {
  return {
    restaurants: [randomUUID(), randomUUID()],
    staff: [randomUUID(), randomUUID()],
    categories: [randomUUID(), randomUUID()],
    products: [randomUUID(), randomUUID()],
    tables: [randomUUID(), randomUUID()],
    orders: [randomUUID(), randomUUID()],
    orderItems: [randomUUID(), randomUUID()],
    waiterCalls: [randomUUID(), randomUUID()],
    payments: [randomUUID(), randomUUID()],
    orderEvents: [randomUUID(), randomUUID()],
    outboxEvents: [randomUUID(), randomUUID()],
    auditLogs: [randomUUID(), randomUUID()],
  };
}

function newFixture(): RlsFixture {
  const suffix = randomBytes(9).toString("hex");
  return {
    ids: makeIds(),
    email: `phase3-rls-${suffix}@example.com`,
    password: `T3st-${randomBytes(18).toString("base64url")}!aA1`,
    authUserId: null,
  };
}

function rowIds(data: unknown[] | null): string[] {
  return (data ?? []).flatMap((value) => {
    if (!value || typeof value !== "object" || !("id" in value)) return [];
    const id = (value as { readonly id?: unknown }).id;
    return typeof id === "string" ? [id] : [];
  });
}

function assertOnlyVisibleIds(
  result: QueryResult,
  expectedIds: readonly string[],
  label: string,
): void {
  assert.equal(result.error, null, `${label}: ${result.error?.message ?? "query failed"}`);
  assert.deepEqual(rowIds(result.data).sort(), [...expectedIds].sort(), label);
}

function assertCannotSeeId(
  result: QueryResult,
  forbiddenId: string,
  label: string,
): void {
  assert.equal(
    rowIds(result.data).includes(forbiddenId),
    false,
    `${label} exposed another restaurant's row`,
  );
}

async function requireMutation(
  label: string,
  mutation: PromiseLike<{ readonly error: QueryError | null }>,
): Promise<void> {
  const { error } = await mutation;
  if (error) throw new Error(`${label} failed: ${error.code ?? "UNKNOWN"} ${error.message}`);
}

/**
 * Fixture rows are written over the pooler connection rather than the Data API.
 * `service_role` holds no INSERT/UPDATE/DELETE grant on the public tables — the
 * application never uses it for data — so provisioning through PostgREST fails
 * with 42501. Setup and teardown are not RLS assertions, so the trusted
 * connection is the right tool; every RLS expectation below still runs through
 * an authenticated Data API session.
 */
interface RowWriter {
  from(table: string): {
    insert(rows: readonly Record<string, unknown>[]): Promise<{ error: QueryError | null }>;
    delete(): { in(column: string, ids: readonly string[]): Promise<{ error: QueryError | null }> };
  };
}

function sqlRowWriter(sql: Sql): RowWriter {
  return {
    from(table: string) {
      return {
        async insert(rows: readonly Record<string, unknown>[]) {
          try {
            // Rows in one call may omit different optional columns, so the
            // union of keys is used and gaps are written as NULL.
            const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
            const normalised = rows.map((row) =>
              Object.fromEntries(columns.map((column) => [column, row[column] ?? null])),
            );
            await sql`insert into ${sql(table)} ${sql(normalised, ...columns)}`;
            return { error: null };
          } catch (error) {
            return { error: { message: (error as Error).message } };
          }
        },
        delete() {
          return {
            async in(column: string, ids: readonly string[]) {
              try {
                await sql`delete from ${sql(table)} where ${sql(column)} in ${sql([...ids])}`;
                return { error: null };
              } catch (error) {
                return { error: { message: (error as Error).message } };
              }
            },
          };
        },
      };
    },
  };
}

async function deleteExactRows(
  writer: RowWriter,
  table: string,
  ids: readonly string[],
  cleanupErrors: string[],
): Promise<void> {
  const { error } = await writer.from(table).delete().in("id", [...ids]);
  if (error) cleanupErrors.push(`${table}: ${error.code ?? "UNKNOWN"} ${error.message}`);
}

if (!readiness.ready) {
  test("Phase 3 Supabase RLS integration", {
    skip: readiness.reason,
  }, () => undefined);
} else {
  const environment = readiness.environment;
  const fixture = newFixture();
  const service = createClient(environment.url, environment.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const anonymous = createClient(environment.url, environment.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const waiter = createClient(environment.url, environment.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const fixtureSql = postgres(environment.databaseUrl!, {
    max: 2,
    prepare: false,
    onnotice: () => {},
  });
  const provisioner = sqlRowWriter(fixtureSql);

  describe("Phase 3 Supabase RLS isolation", { concurrency: false }, () => {
    before(async () => {
      const createdUser = await service.auth.admin.createUser({
        email: fixture.email,
        password: fixture.password,
        email_confirm: true,
      });
      if (createdUser.error || !createdUser.data.user) {
        throw new Error(
          `Test auth user creation failed: ${createdUser.error?.message ?? "missing user"}`,
        );
      }
      fixture.authUserId = createdUser.data.user.id;

      const runSlug = fixture.ids.restaurants[0].replaceAll("-", "");
      const pepper = randomBytes(32);
      const qrA = generateQrToken(pepper);
      const qrB = generateQrToken(pepper);

      await requireMutation(
        "restaurants fixture",
        provisioner.from("restaurants").insert([
          {
            id: fixture.ids.restaurants[0],
            name: "Phase 3 RLS Restaurant A",
            slug: `phase3-rls-a-${runSlug}`,
          },
          {
            id: fixture.ids.restaurants[1],
            name: "Phase 3 RLS Restaurant B",
            slug: `phase3-rls-b-${runSlug}`,
          },
        ]),
      );
      await requireMutation(
        "staff fixture",
        provisioner.from("staff_profiles").insert([
          {
            id: fixture.ids.staff[0],
            auth_user_id: fixture.authUserId,
            restaurant_id: fixture.ids.restaurants[0],
            name: "Phase 3 Waiter A",
            email: fixture.email,
            login_identifier: `rls-a-${runSlug.slice(0, 20)}`,
            role: "WAITER",
          },
          {
            id: fixture.ids.staff[1],
            restaurant_id: fixture.ids.restaurants[1],
            name: "Phase 3 Admin B",
            role: "ADMIN",
          },
        ]),
      );
      await requireMutation(
        "categories fixture",
        provisioner.from("categories").insert([
          {
            id: fixture.ids.categories[0],
            restaurant_id: fixture.ids.restaurants[0],
            name: "RLS Category A",
            slug: `rls-category-a-${runSlug}`,
          },
          {
            id: fixture.ids.categories[1],
            restaurant_id: fixture.ids.restaurants[1],
            name: "RLS Category B",
            slug: `rls-category-b-${runSlug}`,
          },
        ]),
      );
      await requireMutation(
        "products fixture",
        provisioner.from("products").insert([
          {
            id: fixture.ids.products[0],
            restaurant_id: fixture.ids.restaurants[0],
            category_id: fixture.ids.categories[0],
            name: "RLS Product A",
            slug: `rls-product-a-${runSlug}`,
            price: "11.00",
          },
          {
            id: fixture.ids.products[1],
            restaurant_id: fixture.ids.restaurants[1],
            category_id: fixture.ids.categories[1],
            name: "RLS Product B",
            slug: `rls-product-b-${runSlug}`,
            price: "22.00",
          },
        ]),
      );
      await requireMutation(
        "tables fixture",
        provisioner.from("restaurant_tables").insert([
          {
            id: fixture.ids.tables[0],
            restaurant_id: fixture.ids.restaurants[0],
            name: "RLS Table A",
            table_number: 9101,
            qr_token_hash: qrA.tokenHash,
          },
          {
            id: fixture.ids.tables[1],
            restaurant_id: fixture.ids.restaurants[1],
            name: "RLS Table B",
            table_number: 9102,
            qr_token_hash: qrB.tokenHash,
          },
        ]),
      );
      await requireMutation(
        "orders fixture",
        provisioner.from("orders").insert([
          {
            id: fixture.ids.orders[0],
            restaurant_id: fixture.ids.restaurants[0],
            table_id: fixture.ids.tables[0],
            order_sequence: 1,
            order_number: `RLS-A-${runSlug.slice(0, 8)}`,
            subtotal: "11.00",
            total: "11.00",
            created_by_type: "CUSTOMER",
          },
          {
            id: fixture.ids.orders[1],
            restaurant_id: fixture.ids.restaurants[1],
            table_id: fixture.ids.tables[1],
            order_sequence: 1,
            order_number: `RLS-B-${runSlug.slice(0, 8)}`,
            subtotal: "22.00",
            total: "22.00",
            created_by_type: "CUSTOMER",
          },
        ]),
      );
      await requireMutation(
        "order items fixture",
        provisioner.from("order_items").insert([
          {
            id: fixture.ids.orderItems[0],
            restaurant_id: fixture.ids.restaurants[0],
            order_id: fixture.ids.orders[0],
            product_id: fixture.ids.products[0],
            product_name_snapshot: "RLS Product A",
            unit_price: "11.00",
            quantity: 1,
            line_total: "11.00",
          },
          {
            id: fixture.ids.orderItems[1],
            restaurant_id: fixture.ids.restaurants[1],
            order_id: fixture.ids.orders[1],
            product_id: fixture.ids.products[1],
            product_name_snapshot: "RLS Product B",
            unit_price: "22.00",
            quantity: 1,
            line_total: "22.00",
          },
        ]),
      );
      await requireMutation(
        "waiter calls fixture",
        provisioner.from("waiter_calls").insert([
          {
            id: fixture.ids.waiterCalls[0],
            restaurant_id: fixture.ids.restaurants[0],
            table_id: fixture.ids.tables[0],
            type: "WAITER_CALL",
            table_token_version: 1,
          },
          {
            id: fixture.ids.waiterCalls[1],
            restaurant_id: fixture.ids.restaurants[1],
            table_id: fixture.ids.tables[1],
            type: "BILL_REQUEST",
            table_token_version: 1,
          },
        ]),
      );
      await requireMutation(
        "payments fixture",
        provisioner.from("payments").insert([
          {
            id: fixture.ids.payments[0],
            restaurant_id: fixture.ids.restaurants[0],
            order_id: fixture.ids.orders[0],
            amount: "11.00",
            method: "CASH",
            created_by_user_id: fixture.ids.staff[0],
          },
          {
            id: fixture.ids.payments[1],
            restaurant_id: fixture.ids.restaurants[1],
            order_id: fixture.ids.orders[1],
            amount: "22.00",
            method: "CARD",
            created_by_user_id: fixture.ids.staff[1],
          },
        ]),
      );
      await requireMutation(
        "order events fixture",
        provisioner.from("order_events").insert([
          {
            id: fixture.ids.orderEvents[0],
            restaurant_id: fixture.ids.restaurants[0],
            order_id: fixture.ids.orders[0],
            event_type: "ORDER_CREATED",
          },
          {
            id: fixture.ids.orderEvents[1],
            restaurant_id: fixture.ids.restaurants[1],
            order_id: fixture.ids.orders[1],
            event_type: "ORDER_CREATED",
          },
        ]),
      );
      await requireMutation(
        "outbox fixture",
        provisioner.from("outbox_events").insert([
          {
            id: fixture.ids.outboxEvents[0],
            restaurant_id: fixture.ids.restaurants[0],
            aggregate_type: "ORDER",
            aggregate_id: fixture.ids.orders[0],
            event_type: "ORDER_CREATED",
            payload: { orderId: fixture.ids.orders[0] },
          },
          {
            id: fixture.ids.outboxEvents[1],
            restaurant_id: fixture.ids.restaurants[1],
            aggregate_type: "ORDER",
            aggregate_id: fixture.ids.orders[1],
            event_type: "ORDER_CREATED",
            payload: { orderId: fixture.ids.orders[1] },
          },
        ]),
      );
      await requireMutation(
        "audit fixture",
        provisioner.from("audit_logs").insert([
          {
            id: fixture.ids.auditLogs[0],
            restaurant_id: fixture.ids.restaurants[0],
            actor_user_id: fixture.ids.staff[0],
            action: "RLS_TEST",
            entity_type: "PRODUCT",
            entity_id: fixture.ids.products[0],
          },
          {
            id: fixture.ids.auditLogs[1],
            restaurant_id: fixture.ids.restaurants[1],
            actor_user_id: fixture.ids.staff[1],
            action: "RLS_TEST",
            entity_type: "PRODUCT",
            entity_id: fixture.ids.products[1],
          },
        ]),
      );

      const signedIn = await waiter.auth.signInWithPassword({
        email: fixture.email,
        password: fixture.password,
      });
      if (signedIn.error || !signedIn.data.session) {
        throw new Error(
          `Test waiter sign-in failed: ${signedIn.error?.message ?? "missing session"}`,
        );
      }
    });

    after(async () => {
      await waiter.auth.signOut();
      const cleanupErrors: string[] = [];
      await deleteExactRows(provisioner, "payments", fixture.ids.payments, cleanupErrors);
      await deleteExactRows(provisioner, "audit_logs", fixture.ids.auditLogs, cleanupErrors);
      await deleteExactRows(provisioner, "outbox_events", fixture.ids.outboxEvents, cleanupErrors);
      await deleteExactRows(provisioner, "order_events", fixture.ids.orderEvents, cleanupErrors);
      await deleteExactRows(provisioner, "order_items", fixture.ids.orderItems, cleanupErrors);
      await deleteExactRows(provisioner, "waiter_calls", fixture.ids.waiterCalls, cleanupErrors);
      await deleteExactRows(provisioner, "orders", fixture.ids.orders, cleanupErrors);
      await deleteExactRows(provisioner, "products", fixture.ids.products, cleanupErrors);
      await deleteExactRows(provisioner, "categories", fixture.ids.categories, cleanupErrors);
      await deleteExactRows(provisioner, "restaurant_tables", fixture.ids.tables, cleanupErrors);
      await deleteExactRows(provisioner, "staff_profiles", fixture.ids.staff, cleanupErrors);
      await deleteExactRows(provisioner, "restaurants", fixture.ids.restaurants, cleanupErrors);

      if (fixture.authUserId) {
        const deleted = await service.auth.admin.deleteUser(fixture.authUserId);
        if (deleted.error) cleanupErrors.push(`auth user: ${deleted.error.message}`);
      }
      await fixtureSql.end({ timeout: 5 });
      assert.deepEqual(cleanupErrors, [], `Integration cleanup failed: ${cleanupErrors.join("; ")}`);
    });

    test("an authenticated waiter sees only restaurant A products, orders, calls, and own profile", async () => {
      assertOnlyVisibleIds(
        await waiter.from("products").select("id,restaurant_id"),
        [fixture.ids.products[0]],
        "products",
      );
      assertOnlyVisibleIds(
        await waiter.from("orders").select("id,restaurant_id"),
        [fixture.ids.orders[0]],
        "orders",
      );
      assertOnlyVisibleIds(
        await waiter.from("waiter_calls").select("id,restaurant_id"),
        [fixture.ids.waiterCalls[0]],
        "waiter calls",
      );
      assertOnlyVisibleIds(
        await waiter.from("staff_profiles").select("id,restaurant_id,role"),
        [fixture.ids.staff[0]],
        "staff profile",
      );
    });

    test("restaurant B tables and payments are never exposed to restaurant A", async () => {
      const tables = await waiter
        .from("restaurant_tables")
        .select("id,restaurant_id,qr_token_hash");
      assertCannotSeeId(tables, fixture.ids.tables[1], "restaurant tables");

      const payments = await waiter.from("payments").select("id,restaurant_id");
      assertCannotSeeId(payments, fixture.ids.payments[1], "payments");
    });

    test("anonymous/customer access cannot read staff, private events, or QR hashes", async () => {
      for (const [tableName, projection] of [
        ["staff_profiles", "id,restaurant_id,role"],
        ["audit_logs", "id,restaurant_id"],
        ["outbox_events", "id,restaurant_id"],
      ] as const) {
        const result = await anonymous.from(tableName).select(projection);
        assert.deepEqual(
          rowIds(result.data),
          [],
          `anonymous access exposed ${tableName}`,
        );
      }

      const tableResult = await anonymous
        .from("restaurant_tables")
        .select("id,qr_token_hash");
      assert.deepEqual(rowIds(tableResult.data), [], "anonymous access exposed QR hashes");
    });

    test("WAITER cannot perform a direct product/admin mutation", async () => {
      const attempted = await waiter
        .from("products")
        .update({ price: "0.01" })
        .eq("id", fixture.ids.products[0])
        .select("id");
      assert.ok(attempted.error, "direct WAITER mutation unexpectedly succeeded");

      // Verified over the trusted connection: the Data API refuses the service
      // role as well, so the database itself is asked whether anything moved.
      const [persisted] = await fixtureSql`
        select price from products where id = ${fixture.ids.products[0]}`;
      assert.equal(Number(persisted.price), 11, "the price is untouched");
    });

    test("the service role has no data access to public tables at all", async () => {
      // Stronger than "bypass is limited": `service_role` was never granted
      // SELECT/INSERT/UPDATE/DELETE on the business tables, so the Data API
      // refuses it outright. Trusted server work goes through the pooler
      // connection instead, which is why provisioning above uses it.
      for (const tableName of [
        "products", "orders", "restaurant_tables", "waiter_calls", "payments",
      ] as const) {
        const result = await service.from(tableName).select("id").limit(1);
        assert.equal(
          result.error?.code,
          "42501",
          `service role must be refused ${tableName}, got ${result.error?.code ?? "rows"}`,
        );
      }

      // The rows do exist — read over the trusted connection to prove the
      // refusal above is a permission decision, not an empty table.
      const qrRows = await fixtureSql`
        select id, qr_token_hash from restaurant_tables
        where id in ${fixtureSql([...fixture.ids.tables])}`;
      assert.equal(qrRows.length, 2);
      assert.ok(qrRows.every((row) => String(row.qr_token_hash).startsWith("v1.")));
    });
  });
}
