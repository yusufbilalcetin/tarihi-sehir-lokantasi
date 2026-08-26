import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";

import { createDb, type Database } from "../../db";
import { isDomainError } from "../../lib/api/domain-error";
import type { RestaurantPrincipal } from "../../lib/domain/restaurant-scope";
import { estimateCapacity, CAPACITY_HORIZON_YEARS } from "../../lib/domain/data-capacity";
import { DrizzleTableOperationsRepository } from "../../lib/repositories/drizzle-table-operations-repository";
import { generateQrToken } from "../../lib/security/qr-token";
import { DataMaintenanceService } from "../../lib/services/data-maintenance-service";
import { TableOperationsService } from "../../lib/services/table-operations-service";
import { readSupabaseIntegrationEnvironment } from "./supabase-test-environment";

/**
 * Phase 7F — long-term data retention proved on real PostgreSQL.
 *
 * The interesting assertions are the negative ones. Anyone can write a cleanup
 * that deletes rows; this suite exists to prove the cleanup *cannot* touch
 * money, audit history, order events, an undelivered outbox event, or a
 * rate-limit window that is still active.
 *
 * It also closes the one caveat left open by Phase 7D: that a payment still in
 * flight blocks a table reset when the row is a real PENDING payment in
 * PostgreSQL, not a fake in a unit fixture.
 */

const PREFIX = "PHASE7F_";
const readiness = readSupabaseIntegrationEnvironment({ requireDatabaseUrl: true });

/** Passed as text and cast in SQL; the driver does not bind objects directly. */
const PAYLOAD = JSON.stringify({ phase: "7F" });

function hex64(seed: string): string {
  return seed.padEnd(64, "0").slice(0, 64).replace(/[^0-9a-f]/g, "a");
}

if (!readiness.ready) {
  test("Phase 7F maintenance integration", { skip: readiness.reason }, () => undefined);
} else {
  const environment = readiness.environment;
  const run = randomBytes(6).toString("hex");
  let connection: ReturnType<typeof createDb>;
  let db: Database;
  let sql: ReturnType<typeof createDb>["client"];
  let maintenance: DataMaintenanceService;
  let tableOperations: TableOperationsService;
  const cleanupErrors: string[] = [];
  let assertions = 0;

  const ids = {
    restaurant: randomUUID(),
    category: randomUUID(),
    product: randomUUID(),
    table: randomUUID(),
    settledTable: randomUUID(),
    cashier: randomUUID(),
    waiter: randomUUID(),
    order: randomUUID(),
    orderItem: randomUUID(),
    settledOrder: randomUUID(),
    payment: randomUUID(),
    refund: randomUUID(),
    pendingPayment: randomUUID(),
    check: randomUUID(),
    checkItem: randomUUID(),
    publishedOutbox: randomUUID(),
    pendingOutbox: randomUUID(),
    deadOutbox: randomUUID(),
    processingOutbox: randomUUID(),
    expiredKey: randomUUID(),
    activeKey: randomUUID(),
  };

  const expiredRateLimitKey = `${PREFIX}expired-${run}`;
  const activeRateLimitKey = `${PREFIX}active-${run}`;
  /** Extra rows used only by the concurrency case. */
  const raceKeys = Array.from({ length: 12 }, (_, index) => `${PREFIX}race-${run}-${index}`);

  function check(condition: boolean, message: string): void {
    assertions += 1;
    assert.ok(condition, message);
  }

  const manager = (): RestaurantPrincipal => ({
    userId: ids.cashier,
    restaurantId: ids.restaurant,
    role: "MANAGER",
    isActive: true,
  });

  async function countWhere(table: string, where: string, value: string): Promise<number> {
    const [row] = await sql.unsafe(
      `select count(*)::int as count from public.${table} where ${where}`,
      [value],
    );
    return Number(row.count);
  }

  /** Row counts of everything Phase 7F promises never to touch. */
  async function protectedCounts(): Promise<Record<string, number>> {
    const tables = [
      "orders",
      "order_items",
      "payments",
      "payment_refunds",
      "order_checks",
      "order_check_items",
      "audit_logs",
      "order_events",
      "waiter_calls",
      "products",
      "categories",
      "staff_profiles",
      "restaurant_tables",
    ];
    const counts: Record<string, number> = {};
    for (const table of tables) {
      counts[table] = await countWhere(table, "restaurant_id = $1::uuid", ids.restaurant);
    }
    return counts;
  }

  /** The three technical rows the fixture expects to survive every cleanup. */
  async function survivorCounts(): Promise<Record<string, number>> {
    return {
      activeRateLimit: await countWhere("api_rate_limits", "key_hash = $1", activeRateLimitKey),
      activeIdempotency: await countWhere("idempotency_keys", "id = $1::uuid", ids.activeKey),
      pendingOutbox: await countWhere("outbox_events", "id = $1::uuid", ids.pendingOutbox),
      deadOutbox: await countWhere("outbox_events", "id = $1::uuid", ids.deadOutbox),
      processingOutbox: await countWhere("outbox_events", "id = $1::uuid", ids.processingOutbox),
    };
  }

  async function seedCleanable(): Promise<void> {
    await sql`
      insert into api_rate_limits (key_hash, request_count, created_at, expires_at)
      values (${expiredRateLimitKey}, 3, now() - interval '2 hours', now() - interval '1 hour')
      on conflict (key_hash) do update set expires_at = now() - interval '1 hour'`;
    await sql`
      insert into idempotency_keys (id, restaurant_id, scope, key_hash, request_hash,
        status, created_at, expires_at)
      values (${ids.expiredKey}, ${ids.restaurant}, ${`${PREFIX}order.create`},
        ${hex64(`e${run}`)}, ${hex64(`r${run}`)}, 'COMPLETED',
        now() - interval '30 days', now() - interval '29 days')
      on conflict (restaurant_id, scope, key_hash) do nothing`;
    await sql`
      insert into outbox_events (id, restaurant_id, aggregate_type, aggregate_id, event_type,
        payload, status, published_at, created_at)
      values (${ids.publishedOutbox}, ${ids.restaurant}, 'ORDER', ${ids.order},
        ${`${PREFIX}ORDER_PUBLISHED`}, ${PAYLOAD}::jsonb, 'PUBLISHED',
        now() - interval '30 days', now() - interval '30 days')
      on conflict (id) do nothing`;
  }

  async function eligibleCounts(): Promise<Record<string, number>> {
    return {
      expiredRateLimit: await countWhere("api_rate_limits", "key_hash = $1", expiredRateLimitKey),
      expiredIdempotency: await countWhere("idempotency_keys", "id = $1::uuid", ids.expiredKey),
      publishedOutbox: await countWhere("outbox_events", "id = $1::uuid", ids.publishedOutbox),
    };
  }

  describe("Phase 7F retention, maintenance and long-term safety", { concurrency: false }, () => {
    before(async () => {
      // Wide enough that the concurrency case genuinely overlaps.
      connection = createDb(environment.databaseUrl!, { maxConnections: 6 });
      db = connection.db;
      sql = connection.client;
      maintenance = new DataMaintenanceService(db);
      tableOperations = new TableOperationsService(new DrizzleTableOperationsRepository(db));

      await sql`insert into restaurants (id, name, slug) values
        (${ids.restaurant}, ${`${PREFIX}Tenant`}, ${`phase7f-${run}`})`;
      await sql`insert into restaurant_settings (restaurant_id) values (${ids.restaurant})`;
      await sql`insert into staff_profiles (id, restaurant_id, name, login_identifier, role, is_active) values
        (${ids.cashier}, ${ids.restaurant}, ${`${PREFIX}Cashier`}, ${`p7f-${run}-c`}, 'CASHIER', true),
        (${ids.waiter}, ${ids.restaurant}, ${`${PREFIX}Waiter`}, ${`p7f-${run}-w`}, 'WAITER', true)`;
      await sql`insert into categories (id, restaurant_id, name, slug) values
        (${ids.category}, ${ids.restaurant}, ${`${PREFIX}Kategori`}, ${`p7f-cat-${run}`})`;
      await sql`insert into products (id, restaurant_id, category_id, name, slug, price) values
        (${ids.product}, ${ids.restaurant}, ${ids.category}, ${`${PREFIX}Ana`}, ${`p7f-ana-${run}`}, '100.00')`;
      await sql`insert into restaurant_tables (id, restaurant_id, name, table_number, qr_token_hash) values
        (${ids.table}, ${ids.restaurant}, ${`${PREFIX}Masa 1`}, 8701, ${generateQrToken(randomBytes(32)).tokenHash}),
        (${ids.settledTable}, ${ids.restaurant}, ${`${PREFIX}Masa 2`}, 8702, ${generateQrToken(randomBytes(32)).tokenHash})`;

      // ---- financial history the maintenance job must never be able to reach
      await sql`insert into orders (id, restaurant_id, table_id, order_sequence, order_number,
          subtotal, total, created_by_type, created_by_user_id, status) values
        (${ids.order}, ${ids.restaurant}, ${ids.table}, 98701, ${`${PREFIX}98701`},
         '200.00', '200.00', 'STAFF', ${ids.waiter}, 'SERVED')`;
      await sql`insert into order_items (id, restaurant_id, order_id, product_id,
          product_name_snapshot, unit_price, quantity, line_total, status) values
        (${ids.orderItem}, ${ids.restaurant}, ${ids.order}, ${ids.product}, ${`${PREFIX}Ana`},
         '100.00', 2, '200.00', 'SERVED')`;
      await sql`insert into payments (id, restaurant_id, order_id, amount, refunded_amount,
          method, status, created_by_user_id, processed_at) values
        (${ids.payment}, ${ids.restaurant}, ${ids.order}, '200.00', '50.00',
         'CASH', 'COMPLETED', ${ids.cashier}, now())`;
      await sql`insert into payment_refunds (id, restaurant_id, payment_id, order_id, amount,
          reason_code, created_by_user_id) values
        (${ids.refund}, ${ids.restaurant}, ${ids.payment}, ${ids.order}, '50.00',
         'CUSTOMER_COMPLAINT', ${ids.cashier})`;
      await sql`insert into order_checks (id, restaurant_id, order_id, label, status, total,
          created_by_user_id) values
        (${ids.check}, ${ids.restaurant}, ${ids.order}, ${`${PREFIX}Hesap`}, 'PAID', '100.00',
         ${ids.cashier})`;
      await sql`insert into order_check_items (id, restaurant_id, check_id, order_item_id,
          quantity, unit_price_snapshot, line_total) values
        (${ids.checkItem}, ${ids.restaurant}, ${ids.check}, ${ids.orderItem}, 1, '100.00', '100.00')`;
      // Deliberately old, to prove age alone never makes history a candidate.
      await sql`insert into order_events (restaurant_id, order_id, event_type, user_id, payload, created_at) values
        (${ids.restaurant}, ${ids.order}, 'ORDER_CREATED', ${ids.waiter}, ${PAYLOAD}::jsonb, now() - interval '900 days'),
        (${ids.restaurant}, ${ids.order}, 'ORDER_PREPARING', ${ids.waiter}, ${PAYLOAD}::jsonb, now() - interval '900 days'),
        (${ids.restaurant}, ${ids.order}, 'ORDER_READY', ${ids.waiter}, ${PAYLOAD}::jsonb, now() - interval '900 days')`;
      await sql`insert into audit_logs (restaurant_id, actor_user_id, action, entity_type, entity_id, created_at) values
        (${ids.restaurant}, ${ids.cashier}, ${`${PREFIX}payment.collected`}, 'PAYMENT', ${ids.payment}, now() - interval '900 days'),
        (${ids.restaurant}, ${ids.cashier}, ${`${PREFIX}payment.refunded`}, 'PAYMENT', ${ids.payment}, now() - interval '900 days')`;
      await sql`insert into waiter_calls (restaurant_id, table_id, type, status, table_token_version,
          resolved_at, resolved_by, created_at) values
        (${ids.restaurant}, ${ids.table}, 'WAITER_CALL', 'RESOLVED', 1,
         now() - interval '900 days', ${ids.waiter}, now() - interval '900 days')`;

      // ---- a fully settled order carrying one payment still in flight
      await sql`insert into orders (id, restaurant_id, table_id, order_sequence, order_number,
          subtotal, total, created_by_type, created_by_user_id, status, closed_at) values
        (${ids.settledOrder}, ${ids.restaurant}, ${ids.settledTable}, 98702, ${`${PREFIX}98702`},
         '100.00', '100.00', 'STAFF', ${ids.waiter}, 'COMPLETED', now())`;
      await sql`insert into payments (id, restaurant_id, order_id, amount, method, status,
          created_by_user_id, processed_at) values
        (${randomUUID()}, ${ids.restaurant}, ${ids.settledOrder}, '100.00', 'CASH', 'COMPLETED',
         ${ids.cashier}, now())`;

      // ---- technical rows: one cleanable and one protected of each kind
      await sql`
        insert into api_rate_limits (key_hash, request_count, created_at, expires_at)
        values (${activeRateLimitKey}, 1, now(), now() + interval '1 hour')`;
      await sql`
        insert into idempotency_keys (id, restaurant_id, scope, key_hash, request_hash,
          status, created_at, expires_at)
        values (${ids.activeKey}, ${ids.restaurant}, ${`${PREFIX}order.create`},
          ${hex64(`a${run}`)}, ${hex64(`b${run}`)}, 'PROCESSING', now(), now() + interval '24 hours')`;
      await sql`
        insert into outbox_events (id, restaurant_id, aggregate_type, aggregate_id, event_type,
          payload, status, attempts, created_at, available_at) values
        (${ids.pendingOutbox}, ${ids.restaurant}, 'ORDER', ${ids.order}, ${`${PREFIX}ORDER_PENDING`},
         ${PAYLOAD}::jsonb, 'PENDING', 0, now() - interval '400 days', now() - interval '400 days'),
        (${ids.processingOutbox}, ${ids.restaurant}, 'ORDER', ${ids.order}, ${`${PREFIX}ORDER_PROCESSING`},
         ${PAYLOAD}::jsonb, 'PROCESSING', 1, now() - interval '400 days', now() - interval '400 days')`;
      await sql`
        insert into outbox_events (id, restaurant_id, aggregate_type, aggregate_id, event_type,
          payload, status, attempts, dead_lettered_at, last_error, created_at) values
        (${ids.deadOutbox}, ${ids.restaurant}, 'ORDER', ${ids.order}, ${`${PREFIX}ORDER_DEAD`},
         ${PAYLOAD}::jsonb, 'FAILED', 50, now() - interval '300 days',
         ${`${PREFIX}retries exhausted`}, now() - interval '400 days')`;
      await seedCleanable();
    });

    after(async () => {
      try {
        await sql`delete from api_rate_limits where key_hash like ${`${PREFIX}%`}`;
        const order = [
          "payment_refunds", "payments", "order_check_items", "order_checks",
          "order_events", "audit_logs", "outbox_events", "idempotency_keys",
          "waiter_calls", "kitchen_tickets", "order_items", "orders", "restaurant_tables",
          "products", "categories", "restaurant_settings", "staff_profiles", "restaurants",
        ];
        for (const table of order) {
          const column = table === "restaurants" ? "id" : "restaurant_id";
          await sql.unsafe(`delete from ${table} where ${column} = $1::uuid`, [ids.restaurant]);
        }
        const [leftover] = await sql`
          select count(*)::int as count from api_rate_limits where key_hash like ${`${PREFIX}%`}`;
        if (Number(leftover.count) !== 0) {
          cleanupErrors.push(`${leftover.count} PHASE7F rate-limit rows survived cleanup`);
        }
      } catch (error) {
        cleanupErrors.push((error as Error).message);
      }
      await connection.close();
      if (cleanupErrors.length > 0) {
        console.error("PHASE7F FIXTURE CLEANUP INCOMPLETE:", cleanupErrors.join(" | "));
      }
      console.log(`phase7f assertions executed: ${assertions}`);
    });

    // ------------------------------------------------------------------ dry run
    test("a dry run counts candidates and changes nothing at all", async () => {
      await seedCleanable();
      const before = { ...(await protectedCounts()), ...(await eligibleCounts()), ...(await survivorCounts()) };

      const result = await maintenance.run({ dryRun: true });
      check(result.dryRun === true, "the result reports itself as a dry run");
      check(result.errors.length === 0, `no errors (got ${result.errors.join(", ")})`);
      check(result.operations.length === 3, `three operations ran (got ${result.operations.length})`);
      for (const operation of result.operations) {
        check(operation.deleted === 0, `${operation.operation} deleted nothing in a dry run`);
        check(operation.scanned >= 1, `${operation.operation} found its candidate (got ${operation.scanned})`);
        check(operation.error === null, `${operation.operation} reported no error`);
      }

      const after = { ...(await protectedCounts()), ...(await eligibleCounts()), ...(await survivorCounts()) };
      assert.deepEqual(after, before, "a dry run must not change a single row count");
      assertions += 1;
    });

    // ------------------------------------------------------------------ cleanup
    test("cleanup removes exactly the expired and processed rows", async () => {
      await seedCleanable();
      const financialBefore = await protectedCounts();
      const eligible = await eligibleCounts();
      check(
        Object.values(eligible).every((count) => count === 1),
        `precondition: all three candidates exist (${JSON.stringify(eligible)})`,
      );

      const result = await maintenance.run({ dryRun: false, batchSize: 100 });
      check(result.errors.length === 0, `cleanup ran clean (got ${result.errors.join(", ")})`);
      for (const operation of result.operations) {
        check(operation.error === null, `${operation.operation}: ${operation.error}`);
      }

      const remaining = await eligibleCounts();
      check(remaining.expiredRateLimit === 0, "the expired rate-limit window was removed");
      check(remaining.expiredIdempotency === 0, "the expired idempotency key was removed");
      check(remaining.publishedOutbox === 0, "the published outbox event was removed");

      const survivors = await survivorCounts();
      check(survivors.activeRateLimit === 1, "an active rate-limit window is preserved");
      check(survivors.activeIdempotency === 1, "an unexpired idempotency key is preserved");
      check(survivors.pendingOutbox === 1, "an undelivered PENDING outbox event is preserved");
      check(survivors.processingOutbox === 1, "an in-flight PROCESSING outbox event is preserved");
      check(survivors.deadOutbox === 1, "a dead-lettered outbox event is preserved for manual retry");

      assert.deepEqual(
        await protectedCounts(),
        financialBefore,
        "no financial, audit, order-event or master-data row may be touched",
      );
      assertions += 1;
    });

    test("financial and history rows survive with their values intact", async () => {
      const [payment] = await sql`
        select amount, refunded_amount, status::text as status from payments where id = ${ids.payment}`;
      check(payment?.amount === "200.00", `the payment amount is unchanged (got ${payment?.amount})`);
      check(payment?.refunded_amount === "50.00", "the refunded amount is unchanged");
      const [refund] = await sql`select amount from payment_refunds where id = ${ids.refund}`;
      check(refund?.amount === "50.00", "the refund row is unchanged");
      const [item] = await sql`
        select product_name_snapshot, unit_price from order_items where id = ${ids.orderItem}`;
      check(
        item?.product_name_snapshot === `${PREFIX}Ana` && item?.unit_price === "100.00",
        "the historical product name and price snapshots survive",
      );
      const events = await countWhere("order_events", "restaurant_id = $1::uuid", ids.restaurant);
      check(events === 3, `900-day-old order events are retained (got ${events})`);
      const audits = await countWhere("audit_logs", "restaurant_id = $1::uuid", ids.restaurant);
      check(audits === 2, `900-day-old audit rows are retained (got ${audits})`);
      const calls = await countWhere("waiter_calls", "restaurant_id = $1::uuid", ids.restaurant);
      check(calls === 1, `a resolved waiter call is retained (got ${calls})`);
    });

    // ------------------------------------------------------------- idempotency
    test("running the same job twice deletes nothing the second time", async () => {
      await seedCleanable();
      const first = await maintenance.run({ dryRun: false });
      check(first.errors.length === 0, `the first run succeeds (got ${first.errors.join(", ")})`);
      const firstDeleted = first.operations.reduce((sum, o) => sum + o.deleted, 0);
      check(firstDeleted >= 3, `the first run removed the backlog (got ${firstDeleted})`);

      const second = await maintenance.run({ dryRun: false });
      check(second.errors.length === 0, "the second run succeeds");
      for (const operation of second.operations) {
        check(operation.deleted === 0, `${operation.operation} deleted 0 on the second run`);
        check(operation.scanned === 0, `${operation.operation} found no candidates left`);
        check(operation.error === null, `${operation.operation} still reports success`);
      }
    });

    // ------------------------------------------------------------- concurrency
    test("two schedulers firing at once neither collide nor double-count", async () => {
      for (const key of raceKeys) {
        await sql`
          insert into api_rate_limits (key_hash, request_count, created_at, expires_at)
          values (${key}, 1, now() - interval '2 hours', now() - interval '1 hour')
          on conflict (key_hash) do update set expires_at = now() - interval '1 hour'`;
      }
      const planted = await countWhere("api_rate_limits", "key_hash like $1", `${PREFIX}race-${run}-%`);
      check(planted === raceKeys.length, `precondition: ${raceKeys.length} rows planted (got ${planted})`);

      // Small batches, so both runs interleave over several rounds.
      const options = {
        dryRun: false,
        batchSize: 2,
        operations: ["EXPIRED_RATE_LIMITS"] as const,
      };
      const [left, right] = await Promise.all([
        maintenance.run({ ...options }),
        maintenance.run({ ...options }),
      ]);

      for (const [label, result] of [["left", left], ["right", right]] as const) {
        check(result.errors.length === 0, `${label} run had no error (got ${result.errors.join(", ")})`);
        check(
          result.operations.every((operation) => operation.deleted >= 0),
          `${label} run never reports a negative deletion count`,
        );
      }
      const total = [left, right].reduce(
        (sum, result) => sum + result.operations.reduce((inner, o) => inner + o.deleted, 0),
        0,
      );
      check(total >= raceKeys.length, `together they removed the backlog (got ${total})`);

      const survivors = await countWhere("api_rate_limits", "key_hash like $1", `${PREFIX}race-${run}-%`);
      check(survivors === 0, `every expired race row is gone (got ${survivors})`);
      check(
        await countWhere("api_rate_limits", "key_hash = $1", activeRateLimitKey) === 1,
        "the active window survived the concurrent runs",
      );
    });

    // -------------------------------------------------------------- boundaries
    test("the batch ceiling is honoured and the remainder is reported, not lost", async () => {
      for (const key of raceKeys.slice(0, 6)) {
        await sql`
          insert into api_rate_limits (key_hash, request_count, created_at, expires_at)
          values (${key}, 1, now() - interval '2 hours', now() - interval '1 hour')
          on conflict (key_hash) do update set expires_at = now() - interval '1 hour'`;
      }
      const result = await maintenance.run({
        dryRun: false,
        batchSize: 2,
        maxBatches: 1,
        operations: ["EXPIRED_RATE_LIMITS"],
      });
      const operation = result.operations[0];
      check(operation.error === null, `the operation succeeded (got ${operation.error})`);
      check(operation.deleted === 2, `exactly one batch of two ran (got ${operation.deleted})`);
      check(operation.batches === 1, `exactly one batch (got ${operation.batches})`);
      check(operation.truncated === true, "the unfinished backlog is reported as truncated");

      // The remainder is still there; it is deferred, never silently dropped.
      const left = await countWhere("api_rate_limits", "key_hash like $1", `${PREFIX}race-${run}-%`);
      check(left === 4, `the remaining rows wait for the next run (got ${left})`);
      await maintenance.run({ dryRun: false, operations: ["EXPIRED_RATE_LIMITS"] });
    });

    test("an out-of-range batch size is refused before any row is read", async () => {
      for (const batchSize of [0, -1, 1.5, 100_000]) {
        await assert.rejects(
          () => maintenance.run({ dryRun: false, batchSize }),
          TypeError,
          `batch size ${batchSize} must be refused`,
        );
      }
      await assert.rejects(
        () =>
          maintenance.run({
            dryRun: false,
            operations: ["DROP_EVERYTHING" as never],
          }),
        /Unknown operation/,
        "an unknown operation must be refused",
      );
      assertions += 5;
    });

    // ------------------------------------------------------------------ health
    test("the health report surfaces stale pending outbox events without deleting them", async () => {
      const report = await maintenance.health();
      check(report.connected === true, "the health check reached the database");
      check(report.appliedMigrations >= 10, `the migration ledger is readable (got ${report.appliedMigrations})`);
      check(report.databaseBytes > 0, "a database size was measured");
      check(report.tables.length >= 20, `every public table is sized (got ${report.tables.length})`);
      check(report.outbox.pending >= 1, "the undelivered event is counted as pending");
      check(report.outbox.stalePending >= 1, "the 400-day-old pending event is flagged as stale");
      check(report.outbox.deadLettered >= 1, "the dead-lettered event is counted");
      check(
        report.needsAttention.some((note) => note.includes("undelivered")),
        `a stale pending event needs attention (got ${JSON.stringify(report.needsAttention)})`,
      );
      check(
        report.needsAttention.some((note) => note.includes("dead-lettered")),
        "a dead-lettered event needs attention",
      );
      check(
        (await survivorCounts()).pendingOutbox === 1,
        "the health check itself deleted nothing",
      );
    });

    // ------------------------------------------- Phase 7D caveat: PENDING_PAYMENT
    test("a real PENDING payment row blocks a table reset", async () => {
      const clean = await tableOperations
        .reset(manager(), { tableId: ids.settledTable })
        .then(() => "OK")
        .catch((error: unknown) => (isDomainError(error) ? error.code : "UNEXPECTED"));
      check(clean === "OK", `precondition: the settled table resets (got ${clean})`);

      await sql`insert into payments (id, restaurant_id, order_id, amount, method, status,
          created_by_user_id) values
        (${ids.pendingPayment}, ${ids.restaurant}, ${ids.settledOrder}, '10.00', 'CARD', 'PENDING',
         ${ids.cashier})`;

      const blocked = await tableOperations
        .reset(manager(), { tableId: ids.settledTable })
        .then(() => null)
        .catch((error: unknown) => (isDomainError(error) ? error : null));
      check(blocked?.code === "TABLE_RESET_BLOCKED", `the reset is refused (got ${blocked?.code})`);
      const details = (blocked?.details ?? {}) as Record<string, unknown>;
      check(
        details.reason === "PENDING_PAYMENT",
        `the blocker is named as PENDING_PAYMENT (got ${String(details.reason)})`,
      );

      // Nothing was written: a blocked reset leaves the table exactly as it was.
      const [table] = await sql`
        select current_status::text as status from restaurant_tables where id = ${ids.settledTable}`;
      check(table?.status === "AVAILABLE", `the table status is untouched (got ${table?.status})`);
      const [payment] = await sql`
        select status::text as status from payments where id = ${ids.pendingPayment}`;
      check(payment?.status === "PENDING", "the in-flight payment is untouched");

      // Settle it and the table clears again, proving the block is the payment.
      await sql`update payments set status = 'CANCELLED' where id = ${ids.pendingPayment}`;
      const cleared = await tableOperations
        .reset(manager(), { tableId: ids.settledTable })
        .then(() => "OK")
        .catch((error: unknown) => (isDomainError(error) ? error.code : "UNEXPECTED"));
      check(cleared === "OK", `the reset succeeds once nothing is in flight (got ${cleared})`);
    });

    // ------------------------------------------------- measured capacity inputs
    test("the capacity model runs on row sizes measured from this database", async () => {
      const widths = await sql`
        select 'orders' as name, avg(pg_column_size(t.*))::float8 as bytes from orders t
        union all select 'order_items', avg(pg_column_size(t.*))::float8 from order_items t
        union all select 'order_events', avg(pg_column_size(t.*))::float8 from order_events t
        union all select 'payments', avg(pg_column_size(t.*))::float8 from payments t
        union all select 'audit_logs', avg(pg_column_size(t.*))::float8 from audit_logs t
        union all select 'waiter_calls', avg(pg_column_size(t.*))::float8 from waiter_calls t`;

      const measured: Record<string, number> = {};
      for (const row of widths) {
        if (row.bytes !== null) measured[String(row.name)] = Number(row.bytes);
      }
      check(Object.keys(measured).length >= 5, "row widths were measurable on the fixture");

      const input = {
        ordersPerDay: 120,
        averageItemsPerOrder: 4,
        averageEventsPerOrder: 6,
        averagePaymentsPerOrder: 1.2,
        averageCallsPerDay: 40,
        averageAuditRowsPerOrder: 2,
        years: 10,
      };
      const estimate = estimateCapacity(input, measured);
      check(estimate.totalRows > 0, "the model produced a row estimate");
      check(estimate.bytesUnknown === false, "every modelled table had a measured width");

      // Reported, never asserted against: this fixture is a handful of rows, so
      // the byte figures are an order of magnitude, not a production forecast.
      console.log(
        "PHASE7F CAPACITY (illustrative inputs, TEST-measured row widths):",
        JSON.stringify(
          {
            measuredRowBytes: measured,
            horizons: CAPACITY_HORIZON_YEARS.map((years) => {
              const horizon = estimateCapacity({ ...input, years }, measured);
              return {
                years,
                totalRows: horizon.totalRows,
                totalHeapMB: Math.round((horizon.totalEstimatedBytes ?? 0) / 1_048_576),
              };
            }),
          },
          null,
          2,
        ),
      );
    });

    test("the database size baseline is measurable and reported", async () => {
      const report = await maintenance.health();
      const largest = [...report.tables].sort((a, b) => b.totalBytes - a.totalBytes).slice(0, 6);
      console.log(
        "PHASE7F DATABASE BASELINE (TEST project, not a production forecast):",
        JSON.stringify(
          {
            databaseBytes: report.databaseBytes,
            databaseMB: Math.round(report.databaseBytes / 1_048_576),
            expiredIdempotencyKeys: report.expiredIdempotencyKeys,
            expiredRateLimits: report.expiredRateLimits,
            largestTables: largest.map((table) => ({
              table: table.table,
              totalBytes: table.totalBytes,
              tableBytes: table.tableBytes,
              indexBytes: table.indexBytes,
            })),
          },
          null,
          2,
        ),
      );
      check(largest.length === 6, "the largest tables were ranked");
      check(
        largest.every((table) => table.totalBytes === table.tableBytes + table.indexBytes),
        "table and index storage are reported separately and add up",
      );
    });
  });
}
