import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";

import { createDb, type Database } from "../../db";
import { isDomainError } from "../../lib/api/domain-error";
import { calculateOrderBalance } from "../../lib/domain/financial-operations";
import type { RestaurantPrincipal } from "../../lib/domain/restaurant-scope";
import { generateQrToken } from "../../lib/security/qr-token";
import { DrizzleOrderCheckRepository } from "../../lib/repositories/drizzle-order-check-repository";
import { DrizzlePaymentRepository } from "../../lib/repositories/drizzle-payment-repository";
import { OrderCheckService } from "../../lib/services/order-check-service";
import { PaymentService } from "../../lib/services/payment-service";
import { readSupabaseIntegrationEnvironment } from "./supabase-test-environment";

/**
 * Phase 7D.2 — money under genuine concurrency, on real PostgreSQL.
 *
 * Every "parallel" case here starts both attempts with `Promise.all` against a
 * connection pool wide enough to run them at once, so two real transactions
 * race for the same row lock. A sequential loop would prove nothing. Each test
 * asserts the final database state, not merely that one call rejected.
 */

const PREFIX = "PHASE7D2C_";
const readiness = readSupabaseIntegrationEnvironment({ requireDatabaseUrl: true });

interface Outcome {
  readonly ok: boolean;
  readonly code: string | null;
}

async function settle(work: () => Promise<unknown>): Promise<Outcome> {
  try {
    await work();
    return { ok: true, code: null };
  } catch (error) {
    return { ok: false, code: isDomainError(error) ? error.code : `UNEXPECTED:${(error as Error).message}` };
  }
}

if (!readiness.ready) {
  test("Phase 7D.2 concurrency integration", { skip: readiness.reason }, () => undefined);
} else {
  const environment = readiness.environment;
  const run = randomBytes(6).toString("hex");
  let connection: ReturnType<typeof createDb>;
  let db: Database;
  let sql: ReturnType<typeof createDb>["client"];
  let payments: PaymentService;
  let checks: OrderCheckService;
  const cleanupErrors: string[] = [];
  let assertions = 0;

  const ids = {
    restaurant: randomUUID(),
    category: randomUUID(),
    product: randomUUID(),
    table: randomUUID(),
    cashier: randomUUID(),
    waiter: randomUUID(),
    register: randomUUID(),
    shift: randomUUID(),
  };
  const createdOrders: string[] = [];

  function check(condition: boolean, message: string): void {
    assertions += 1;
    assert.ok(condition, message);
  }

  const cashier = (): RestaurantPrincipal => ({
    userId: ids.cashier, restaurantId: ids.restaurant, role: "CASHIER", isActive: true,
  });

  let sequence = 97000;
  /** A fresh SERVED order with `quantity` x 100.00, so totals are exact. */
  async function newOrder(quantity: number): Promise<{ orderId: string; itemId: string }> {
    const orderId = randomUUID();
    const itemId = randomUUID();
    const total = (quantity * 100).toFixed(2);
    sequence += 1;
    await sql`insert into orders (id, restaurant_id, table_id, order_sequence, order_number,
        subtotal, total, created_by_type, created_by_user_id, status) values
      (${orderId}, ${ids.restaurant}, ${ids.table}, ${sequence}, ${`${PREFIX}${sequence}`},
       ${total}, ${total}, 'STAFF', ${ids.waiter}, 'SERVED')`;
    await sql`insert into order_items (id, restaurant_id, order_id, product_id,
        product_name_snapshot, unit_price, quantity, line_total, status) values
      (${itemId}, ${ids.restaurant}, ${orderId}, ${ids.product}, ${`${PREFIX}Ana`},
       '100.00', ${quantity}, ${total}, 'SERVED')`;
    createdOrders.push(orderId);
    return { orderId, itemId };
  }

  /** The database's own view of an order's money, independent of the service. */
  async function ledgerOf(orderId: string) {
    const [order] = await sql`select total from orders where id = ${orderId}`;
    const rows = await sql`
      select amount, refunded_amount, status::text as status
      from payments where order_id = ${orderId}`;
    return calculateOrderBalance(
      order.total,
      rows.map((row) => ({
        amount: row.amount,
        refundedAmount: row.refunded_amount,
        counted: row.status === "COMPLETED",
      })),
    );
  }

  describe("Phase 7D.2 money under real concurrency", { concurrency: false }, () => {
    before(async () => {
      // A pool wide enough that parallel calls genuinely overlap rather than
      // queueing behind a single connection.
      connection = createDb(environment.databaseUrl!, { maxConnections: 8 });
      db = connection.db;
      sql = connection.client;
      payments = new PaymentService(new DrizzlePaymentRepository(db));
      checks = new OrderCheckService(new DrizzleOrderCheckRepository(db));

      await sql`insert into restaurants (id, name, slug) values
        (${ids.restaurant}, ${`${PREFIX}Tenant`}, ${`phase7d2c-${run}`})`;
      await sql`insert into restaurant_settings (restaurant_id) values (${ids.restaurant})`;
      await sql`insert into staff_profiles (id, restaurant_id, name, login_identifier, role, is_active) values
        (${ids.cashier}, ${ids.restaurant}, ${`${PREFIX}Cashier`}, ${`p7d2c-${run}-c`}, 'CASHIER', true),
        (${ids.waiter}, ${ids.restaurant}, ${`${PREFIX}Waiter`}, ${`p7d2c-${run}-w`}, 'WAITER', true)`;
      await sql`insert into categories (id, restaurant_id, name, slug) values
        (${ids.category}, ${ids.restaurant}, ${`${PREFIX}Kategori`}, ${`p7d2c-cat-${run}`})`;
      await sql`insert into products (id, restaurant_id, category_id, name, slug, price) values
        (${ids.product}, ${ids.restaurant}, ${ids.category}, ${`${PREFIX}Ana`}, ${`p7d2c-ana-${run}`}, '100.00')`;
      await sql`insert into restaurant_tables (id, restaurant_id, name, table_number, qr_token_hash) values
        (${ids.table}, ${ids.restaurant}, ${`${PREFIX}Masa`}, 8301, ${generateQrToken(randomBytes(32)).tokenHash})`;
      // Phase 8A: money is attributed to the collecting cashier's open drawer,
      // so the fixture needs one. The concurrency behaviour under test — one
      // collection per balance, one refund per remainder — is unchanged.
      await sql`insert into cash_registers (id, restaurant_id, name, code) values
        (${ids.register}, ${ids.restaurant}, ${`${PREFIX}Kasa`}, ${`P7D2${run.slice(0, 6).toUpperCase()}`})`;
      await sql`insert into cashier_shifts (id, restaurant_id, cash_register_id,
          register_name_snapshot, opened_by_staff_id, opening_cash) values
        (${ids.shift}, ${ids.restaurant}, ${ids.register}, ${`${PREFIX}Kasa`},
         ${ids.cashier}, '0.00')`;
    });

    after(async () => {
      const order = [
        "cash_drawer_movements", "payment_refunds", "payments",
        "order_check_items", "order_checks",
        "order_events", "audit_logs", "outbox_events", "idempotency_keys",
        "waiter_calls", "order_items", "orders", "cashier_shifts",
        "cash_registers", "restaurant_tables",
        "products", "categories", "restaurant_settings", "staff_profiles", "restaurants",
      ];
      try {
        for (const table of order) {
          const column = table === "restaurants" ? "id" : "restaurant_id";
          await sql.unsafe(`delete from ${table} where ${column} = $1::uuid`, [ids.restaurant]);
        }
      } catch (error) {
        cleanupErrors.push((error as Error).message);
      }
      await connection.close();
      if (cleanupErrors.length > 0) {
        console.error("PHASE7D2 FIXTURE CLEANUP INCOMPLETE:", cleanupErrors.join(" | "));
      }
      console.log(`phase7d2 concurrency assertions executed: ${assertions}`);
    });

    test("a full payment settles the order exactly once", async () => {
      const { orderId } = await newOrder(2);
      await payments.collect(cashier(), {
        orderId, method: "CASH", idempotencyKey: `${run}-full`,
      });
      const balance = await ledgerOf(orderId);
      check(balance.paidTotal === "200.00", `paid (got ${balance.paidTotal})`);
      check(balance.outstanding === "0.00", `outstanding (got ${balance.outstanding})`);
      const [order] = await sql`select status::text as status from orders where id = ${orderId}`;
      check(order.status === "COMPLETED", `order completed (got ${order.status})`);
    });

    test("a partial payment leaves the order open with an exact remainder", async () => {
      const { orderId } = await newOrder(2);
      await payments.collect(cashier(), {
        orderId, method: "CASH", amount: "80.00", idempotencyKey: `${run}-partial`,
      });
      const balance = await ledgerOf(orderId);
      check(balance.paidTotal === "80.00", `paid (got ${balance.paidTotal})`);
      check(balance.outstanding === "120.00", `outstanding (got ${balance.outstanding})`);
      const [order] = await sql`select status::text as status from orders where id = ${orderId}`;
      check(order.status === "SERVED", `order stays open (got ${order.status})`);

      // Second instalment by a different method closes it.
      await payments.collect(cashier(), {
        orderId, method: "CARD", amount: "120.00", idempotencyKey: `${run}-partial-2`,
      });
      const settled = await ledgerOf(orderId);
      check(settled.paidTotal === "200.00", `multi-payment total (got ${settled.paidTotal})`);
      check(settled.outstanding === "0.00", `multi-payment outstanding (got ${settled.outstanding})`);
      const rows = await sql`select count(*)::int as count from payments where order_id = ${orderId}`;
      check(rows[0].count === 2, `two payment rows survive (got ${rows[0].count})`);
      const [after] = await sql`select status::text as status from orders where id = ${orderId}`;
      check(after.status === "COMPLETED", `order completed (got ${after.status})`);
    });

    test("overpayment and non-positive amounts are refused", async () => {
      const { orderId } = await newOrder(1);
      const over = await settle(() => payments.collect(cashier(), {
        orderId, method: "CASH", amount: "101.00", idempotencyKey: `${run}-over`,
      }));
      check(!over.ok, `overpayment refused (got ${over.code ?? "accepted"})`);
      for (const [label, amount] of [["zero", "0.00"], ["negative", "-1.00"]] as const) {
        const result = await settle(() => payments.collect(cashier(), {
          orderId, method: "CASH", amount, idempotencyKey: `${run}-${label}`,
        }));
        check(!result.ok, `${label} amount refused (got ${result.code ?? "accepted"})`);
      }
      const balance = await ledgerOf(orderId);
      check(balance.paidTotal === "0.00", `nothing was collected (got ${balance.paidTotal})`);
    });

    test("the same idempotency key collects once, in parallel", async () => {
      const { orderId } = await newOrder(1);
      const key = `${run}-idem-parallel`;
      const results = await Promise.all([
        settle(() => payments.collect(cashier(), { orderId, method: "CASH", idempotencyKey: key })),
        settle(() => payments.collect(cashier(), { orderId, method: "CASH", idempotencyKey: key })),
      ]);
      const rows = await sql`select count(*)::int as count from payments where order_id = ${orderId}`;
      check(rows[0].count === 1, `exactly one payment row (got ${rows[0].count})`);
      const balance = await ledgerOf(orderId);
      check(balance.paidTotal === "100.00", `collected once (got ${balance.paidTotal})`);
      check(
        results.some((result) => result.ok),
        `at least one attempt reported success (${results.map((r) => r.code).join(", ")})`,
      );
    });

    test("two parallel payments for the whole balance collect it only once", async () => {
      const { orderId } = await newOrder(1);
      // Same order, same outstanding, different methods and keys: the classic
      // double-collection race between two tills.
      const results = await Promise.all([
        settle(() => payments.collect(cashier(), {
          orderId, method: "CASH", amount: "100.00", idempotencyKey: `${run}-race-cash`,
        })),
        settle(() => payments.collect(cashier(), {
          orderId, method: "CARD", amount: "100.00", idempotencyKey: `${run}-race-card`,
        })),
      ]);
      const succeeded = results.filter((result) => result.ok).length;
      check(succeeded === 1, `exactly one attempt may succeed (got ${succeeded})`);

      const rows = await sql`select count(*)::int as count, coalesce(sum(amount), 0)::text as total
        from payments where order_id = ${orderId} and status = 'COMPLETED'`;
      check(rows[0].count === 1, `one payment row (got ${rows[0].count})`);
      check(Number(rows[0].total) === 100, `total collected is 100.00 (got ${rows[0].total})`);

      const balance = await ledgerOf(orderId);
      check(balance.paidTotal === "100.00", `ledger paid (got ${balance.paidTotal})`);
      check(balance.outstanding === "0.00", `ledger outstanding (got ${balance.outstanding})`);
      check(Number(balance.paidTotal) <= 100, "no double collection");
      const loser = results.find((result) => !result.ok);
      check(loser !== undefined && loser.code !== null, `the loser got a domain error (${loser?.code})`);
    });

    test("two parallel refunds cannot return more than was collected", async () => {
      const { orderId } = await newOrder(1);
      await payments.collect(cashier(), {
        orderId, method: "CASH", idempotencyKey: `${run}-refund-base`,
      });
      const [payment] = await sql`select id from payments where order_id = ${orderId}`;

      const results = await Promise.all([
        settle(() => payments.refund(cashier(), {
          paymentId: payment.id, amount: "100.00", reasonCode: "CUSTOMER_COMPLAINT",
          idempotencyKey: `${run}-refund-a`,
        })),
        settle(() => payments.refund(cashier(), {
          paymentId: payment.id, amount: "100.00", reasonCode: "CUSTOMER_COMPLAINT",
          idempotencyKey: `${run}-refund-b`,
        })),
      ]);
      const succeeded = results.filter((result) => result.ok).length;
      check(succeeded === 1, `exactly one refund may succeed (got ${succeeded})`);

      const [totals] = await sql`
        select coalesce(sum(amount), 0)::text as refunded, count(*)::int as count
        from payment_refunds where payment_id = ${payment.id} and status = 'COMPLETED'`;
      check(Number(totals.refunded) === 100, `total refunded is 100.00 (got ${totals.refunded})`);
      check(totals.count === 1, `one refund row (got ${totals.count})`);

      const [cached] = await sql`select amount, refunded_amount from payments where id = ${payment.id}`;
      check(Number(cached.amount) === 100, "the original payment amount is never rewritten");
      check(Number(cached.refunded_amount) === 100, `denormalised cache agrees (got ${cached.refunded_amount})`);
      check(
        Number(cached.refunded_amount) <= Number(cached.amount),
        "refunds never exceed the payment",
      );
    });

    test("sequential partial refunds stay within the payment and keep the order completed", async () => {
      const { orderId } = await newOrder(2);
      await payments.collect(cashier(), {
        orderId, method: "CARD", idempotencyKey: `${run}-partial-refund-base`,
      });
      const [payment] = await sql`select id from payments where order_id = ${orderId}`;

      await payments.refund(cashier(), {
        paymentId: payment.id, amount: "50.00", reasonCode: "QUALITY_ISSUE",
        idempotencyKey: `${run}-pr-1`,
      });
      await payments.refund(cashier(), {
        paymentId: payment.id, amount: "30.00", reasonCode: "QUALITY_ISSUE",
        idempotencyKey: `${run}-pr-2`,
      });
      const tooMuch = await settle(() => payments.refund(cashier(), {
        paymentId: payment.id, amount: "150.00", reasonCode: "QUALITY_ISSUE",
        idempotencyKey: `${run}-pr-3`,
      }));
      check(!tooMuch.ok, `over-refund refused (got ${tooMuch.code ?? "accepted"})`);

      const [cached] = await sql`select amount, refunded_amount from payments where id = ${payment.id}`;
      check(Number(cached.refunded_amount) === 80, `refunded total (got ${cached.refunded_amount})`);
      const rows = await sql`select count(*)::int as count from payment_refunds where payment_id = ${payment.id}`;
      check(rows[0].count === 2, `two refund rows (got ${rows[0].count})`);

      const balance = await ledgerOf(orderId);
      check(balance.paidTotal === "200.00", `gross collected unchanged (got ${balance.paidTotal})`);
      check(balance.refundedTotal === "80.00", `refunded total (got ${balance.refundedTotal})`);

      // A refund is money, not operations: the order stays closed.
      const [order] = await sql`select status::text as status from orders where id = ${orderId}`;
      check(order.status === "COMPLETED", `order stays COMPLETED (got ${order.status})`);
    });

    test("the same refund key refunds once, in parallel", async () => {
      const { orderId } = await newOrder(1);
      await payments.collect(cashier(), {
        orderId, method: "CASH", idempotencyKey: `${run}-refund-idem-base`,
      });
      const [payment] = await sql`select id from payments where order_id = ${orderId}`;
      const key = `${run}-refund-idem`;
      await Promise.all([
        settle(() => payments.refund(cashier(), {
          paymentId: payment.id, amount: "40.00", reasonCode: "OTHER", idempotencyKey: key,
        })),
        settle(() => payments.refund(cashier(), {
          paymentId: payment.id, amount: "40.00", reasonCode: "OTHER", idempotencyKey: key,
        })),
      ]);
      const [totals] = await sql`
        select coalesce(sum(amount), 0)::text as refunded, count(*)::int as count
        from payment_refunds where payment_id = ${payment.id} and status = 'COMPLETED'`;
      check(totals.count === 1, `one refund row (got ${totals.count})`);
      check(Number(totals.refunded) === 40, `refunded once (got ${totals.refunded})`);
    });

    test("two parallel splits cannot allocate the same item twice", async () => {
      const { orderId, itemId } = await newOrder(2);
      // A valid split of one item with quantity 2 into two checks of 1 each.
      // Both attempts submit it at once: if the second is not serialised behind
      // the first, the order ends up with 4 allocated units of a 2-unit item.
      const split = [
        { label: `${PREFIX}A`, items: [{ orderItemId: itemId, quantity: 1 }] },
        { label: `${PREFIX}B`, items: [{ orderItemId: itemId, quantity: 1 }] },
      ];
      const results = await Promise.all([
        settle(() => checks.createChecks(cashier(), { orderId, mode: "ITEMS", checks: split })),
        settle(() => checks.createChecks(cashier(), { orderId, mode: "ITEMS", checks: split })),
      ]);
      const succeeded = results.filter((result) => result.ok).length;
      check(
        succeeded >= 1,
        `at least one split succeeds (codes: ${results.map((r) => r.code ?? "ok").join(", ")})`,
      );
      check(succeeded === 1, `and only one (got ${succeeded})`);

      const [allocated] = await sql`
        select coalesce(sum(oci.quantity), 0)::int as total
        from order_check_items oci
        join order_checks oc on oc.id = oci.check_id
        where oc.order_id = ${orderId} and oc.status <> 'CANCELLED'`;
      check(
        allocated.total <= 2,
        `active allocation must never exceed the item quantity of 2 (got ${allocated.total})`,
      );
      check(allocated.total === 2, `and the winning split holds exactly it (got ${allocated.total})`);
      const [checkCount] = await sql`
        select count(*)::int as count from order_checks
        where order_id = ${orderId} and status <> 'CANCELLED'`;
      check(checkCount.count === 2, `only one split's checks exist (got ${checkCount.count})`);
    });

    test("an equal split of 100.00 across three checks stays exact", async () => {
      const { orderId } = await newOrder(1);
      const result = await checks.createChecks(cashier(), {
        orderId, mode: "EQUAL", shares: 3,
      });
      const amounts = result.checks.map((entry) => entry.total).sort();
      const sum = amounts.reduce((total, value) => total + Math.round(Number(value) * 100), 0);
      check(sum === 10_000, `the shares add back to exactly 100.00 (got ${sum / 100})`);
      check(amounts.length === 3, `three checks (got ${amounts.length})`);
      // Deterministic rounding: the remainder lands on one share only.
      check(
        amounts.filter((value) => value === "33.34").length === 1,
        `one share carries the extra kuruş (got ${amounts.join(", ")})`,
      );
      check(
        amounts.filter((value) => value === "33.33").length === 2,
        `two shares are 33.33 (got ${amounts.join(", ")})`,
      );
    });

    test("the ledger agrees with the database in every settlement shape", async () => {
      // unpaid
      const unpaid = await newOrder(1);
      let balance = await ledgerOf(unpaid.orderId);
      check(balance.paidTotal === "0.00" && balance.outstanding === "100.00", "unpaid ledger");

      // partially paid
      const partial = await newOrder(2);
      await payments.collect(cashier(), {
        orderId: partial.orderId, method: "CASH", amount: "75.50",
        idempotencyKey: `${run}-ledger-partial`,
      });
      balance = await ledgerOf(partial.orderId);
      check(balance.paidTotal === "75.50", `partial paid (got ${balance.paidTotal})`);
      check(balance.outstanding === "124.50", `partial outstanding (got ${balance.outstanding})`);

      // fully paid then partially refunded
      const refunded = await newOrder(1);
      await payments.collect(cashier(), {
        orderId: refunded.orderId, method: "CARD", idempotencyKey: `${run}-ledger-refund`,
      });
      const [payment] = await sql`select id from payments where order_id = ${refunded.orderId}`;
      await payments.refund(cashier(), {
        paymentId: payment.id, amount: "24.50", reasonCode: "OVERPAYMENT",
        idempotencyKey: `${run}-ledger-refund-1`,
      });
      balance = await ledgerOf(refunded.orderId);
      check(balance.paidTotal === "100.00", `refund keeps gross (got ${balance.paidTotal})`);
      check(balance.refundedTotal === "24.50", `refunded (got ${balance.refundedTotal})`);
      check(balance.outstanding === "24.50", `outstanding reopens by the refund (got ${balance.outstanding})`);

      // The service's own ledger endpoint must say the same thing.
      const serviceLedger = await payments.getLedger(cashier(), refunded.orderId);
      check(
        serviceLedger.balance.paidTotal === balance.paidTotal &&
          serviceLedger.balance.refundedTotal === balance.refundedTotal &&
          serviceLedger.balance.outstanding === balance.outstanding,
        "the ledger service and the database agree exactly",
      );
    });

    test("no money movement leaves the tenant, and every payment is audited", async () => {
      const [audits] = await sql`
        select count(*)::int as count from audit_logs
        where restaurant_id = ${ids.restaurant} and action like 'payment%'`;
      check(audits.count > 0, `payment mutations are audited (got ${audits.count})`);
      const [outbox] = await sql`
        select count(*)::int as count from outbox_events where restaurant_id = ${ids.restaurant}`;
      check(outbox.count > 0, `outbox events are written (got ${outbox.count})`);
      const [foreign] = await sql`
        select count(*)::int as count from payments where restaurant_id <> ${ids.restaurant}
          and order_id = any(${sql.array(createdOrders)}::uuid[])`;
      check(foreign.count === 0, "no payment escaped the tenant");
    });
  });
}
