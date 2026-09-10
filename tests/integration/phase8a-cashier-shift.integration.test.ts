import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";

import { createDb, type Database } from "../../db";
import { isDomainError } from "../../lib/api/domain-error";
import type { RestaurantPrincipal } from "../../lib/domain/restaurant-scope";
import { DrizzleCashierShiftRepository } from "../../lib/repositories/drizzle-cashier-shift-repository";
import { DrizzleOrderCheckRepository } from "../../lib/repositories/drizzle-order-check-repository";
import { DrizzlePaymentRepository } from "../../lib/repositories/drizzle-payment-repository";
import { generateQrToken } from "../../lib/security/qr-token";
import { CashierShiftService } from "../../lib/services/cashier-shift-service";
import { DataMaintenanceService } from "../../lib/services/data-maintenance-service";
import { OrderCheckService } from "../../lib/services/order-check-service";
import { PaymentService } from "../../lib/services/payment-service";
import { readSupabaseIntegrationEnvironment } from "./supabase-test-environment";

/**
 * Phase 8A — cash drawer accountability on real PostgreSQL.
 *
 * The cases that matter are the races. A shift close takes a snapshot of money
 * that other requests are still writing, so "close vs payment", "close vs
 * refund", "close vs movement" and "double close" are each driven with genuine
 * `Promise.all` overlap against a pool wide enough to run them at once.
 *
 * The invariant every one of them asserts is the same: a closed shift's
 * snapshot and the rows attributed to that shift must agree, and no row may
 * ever attach itself to a shift that is already closed.
 */

const PREFIX = "PHASE8A_";
const readiness = readSupabaseIntegrationEnvironment({ requireDatabaseUrl: true });

if (!readiness.ready) {
  test("Phase 8A cashier shift integration", { skip: readiness.reason }, () => undefined);
} else {
  const environment = readiness.environment;
  const run = randomBytes(6).toString("hex");
  let connection: ReturnType<typeof createDb>;
  let db: Database;
  let sql: ReturnType<typeof createDb>["client"];
  let shifts: CashierShiftService;
  let payments: PaymentService;
  let checks: OrderCheckService;
  const cleanupErrors: string[] = [];
  let assertions = 0;

  const ids = {
    restaurant: randomUUID(),
    foreignRestaurant: randomUUID(),
    category: randomUUID(),
    product: randomUUID(),
    table: randomUUID(),
    cashier: randomUUID(),
    otherCashier: randomUUID(),
    manager: randomUUID(),
    waiter: randomUUID(),
    registerA: randomUUID(),
    registerB: randomUUID(),
    inactiveRegister: randomUUID(),
    foreignCashier: randomUUID(),
    foreignRegister: randomUUID(),
  };
  let sequence = 88000;

  function check(condition: boolean, message: string): void {
    assertions += 1;
    assert.ok(condition, message);
  }

  const as = (
    role: RestaurantPrincipal["role"],
    userId: string,
    restaurantId = ids.restaurant,
  ): RestaurantPrincipal => ({ userId, restaurantId, role, isActive: true });

  const cashier = () => as("CASHIER", ids.cashier);
  const otherCashier = () => as("CASHIER", ids.otherCashier);
  const manager = () => as("MANAGER", ids.manager);

  async function code(work: () => Promise<unknown>): Promise<string> {
    try {
      await work();
      return "OK";
    } catch (error) {
      return isDomainError(error) ? error.code : `UNEXPECTED:${(error as Error).message}`;
    }
  }

  /** A fresh SERVED order worth `quantity` x 100.00. */
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
    return { orderId, itemId };
  }

  async function openFor(
    principal: RestaurantPrincipal,
    registerId: string,
    openingCash: string,
  ): Promise<string> {
    const result = await shifts.open(principal, { cashRegisterId: registerId, openingCash });
    return result.shift.id;
  }

  /** Closes whatever the given staff member has open, so cases stay isolated. */
  async function forceClose(staffId: string): Promise<void> {
    await sql`
      update cashier_shifts set status = 'CLOSED', closed_at = now(), closed_by_staff_id = ${staffId},
        counted_cash_at_close = coalesce(counted_cash_at_close, '0.00'),
        expected_cash_at_close = coalesce(expected_cash_at_close, '0.00'),
        cash_variance = coalesce(cash_variance, '0.00'),
        close_note = coalesce(close_note, ${`${PREFIX}test teardown`})
      where restaurant_id = ${ids.restaurant} and opened_by_staff_id = ${staffId}
        and status = 'OPEN'`;
  }

  async function shiftRow(shiftId: string) {
    const [row] = await sql`
      select status::text as status, opening_cash, counted_cash_at_close, expected_cash_at_close,
        cash_variance, close_note, opened_by_staff_id, closed_by_staff_id
      from cashier_shifts where id = ${shiftId}`;
    return row;
  }

  async function shiftPaymentCount(shiftId: string): Promise<number> {
    const [row] = await sql`
      select count(*)::int as count from payments where cashier_shift_id = ${shiftId}`;
    return Number(row.count);
  }

  describe("Phase 8A cash drawer accountability", { concurrency: false }, () => {
    before(async () => {
      connection = createDb(environment.databaseUrl!, { maxConnections: 8 });
      db = connection.db;
      sql = connection.client;
      shifts = new CashierShiftService(new DrizzleCashierShiftRepository(db));
      payments = new PaymentService(new DrizzlePaymentRepository(db));
      checks = new OrderCheckService(new DrizzleOrderCheckRepository(db));

      await sql`insert into restaurants (id, name, slug) values
        (${ids.restaurant}, ${`${PREFIX}Tenant`}, ${`phase8a-a-${run}`}),
        (${ids.foreignRestaurant}, ${`${PREFIX}Tenant B`}, ${`phase8a-b-${run}`})`;
      await sql`insert into restaurant_settings (restaurant_id) values
        (${ids.restaurant}), (${ids.foreignRestaurant})`;
      await sql`insert into staff_profiles (id, restaurant_id, name, login_identifier, role, is_active) values
        (${ids.cashier}, ${ids.restaurant}, ${`${PREFIX}Kasiyer`}, ${`p8a-${run}-c1`}, 'CASHIER', true),
        (${ids.otherCashier}, ${ids.restaurant}, ${`${PREFIX}Kasiyer 2`}, ${`p8a-${run}-c2`}, 'CASHIER', true),
        (${ids.manager}, ${ids.restaurant}, ${`${PREFIX}Mudur`}, ${`p8a-${run}-m`}, 'MANAGER', true),
        (${ids.waiter}, ${ids.restaurant}, ${`${PREFIX}Garson`}, ${`p8a-${run}-w`}, 'WAITER', true),
        (${ids.foreignCashier}, ${ids.foreignRestaurant}, ${`${PREFIX}B Kasiyer`}, ${`p8a-${run}-fb`}, 'CASHIER', true)`;
      await sql`insert into cash_registers (id, restaurant_id, name, code) values
        (${ids.registerA}, ${ids.restaurant}, ${`${PREFIX}Ana Kasa`}, ${`P8AA${run.slice(0, 6).toUpperCase()}`}),
        (${ids.registerB}, ${ids.restaurant}, ${`${PREFIX}Bar Kasa`}, ${`P8AB${run.slice(0, 6).toUpperCase()}`}),
        (${ids.inactiveRegister}, ${ids.restaurant}, ${`${PREFIX}Kapali`}, ${`P8AC${run.slice(0, 6).toUpperCase()}`}),
        (${ids.foreignRegister}, ${ids.foreignRestaurant}, ${`${PREFIX}B Kasa`}, ${`P8AF${run.slice(0, 6).toUpperCase()}`})`;
      await sql`update cash_registers set is_active = false where id = ${ids.inactiveRegister}`;
      await sql`insert into categories (id, restaurant_id, name, slug) values
        (${ids.category}, ${ids.restaurant}, ${`${PREFIX}Kategori`}, ${`p8a-cat-${run}`})`;
      await sql`insert into products (id, restaurant_id, category_id, name, slug, price) values
        (${ids.product}, ${ids.restaurant}, ${ids.category}, ${`${PREFIX}Ana`}, ${`p8a-ana-${run}`}, '100.00')`;
      await sql`insert into restaurant_tables (id, restaurant_id, name, table_number, qr_token_hash) values
        (${ids.table}, ${ids.restaurant}, ${`${PREFIX}Masa`}, 8801, ${generateQrToken(randomBytes(32)).tokenHash})`;
    });

    after(async () => {
      // Dependency-safe, and scoped to the two fixture tenants only.
      const order = [
        "cash_drawer_movements", "payment_refunds", "payments", "order_check_items",
        "order_checks", "order_events", "audit_logs", "outbox_events", "idempotency_keys",
        "waiter_calls", "kitchen_tickets", "order_items", "orders", "cashier_shifts",
        "cash_registers", "restaurant_tables", "products", "categories",
        "restaurant_settings", "staff_profiles", "restaurants",
      ];
      try {
        for (const tenant of [ids.restaurant, ids.foreignRestaurant]) {
          for (const table of order) {
            const column = table === "restaurants" ? "id" : "restaurant_id";
            await sql.unsafe(`delete from ${table} where ${column} = $1::uuid`, [tenant]);
          }
        }
      } catch (error) {
        cleanupErrors.push((error as Error).message);
      }
      await connection.close();
      if (cleanupErrors.length > 0) {
        console.error("PHASE8A FIXTURE CLEANUP INCOMPLETE:", cleanupErrors.join(" | "));
      }
      console.log(`phase8a assertions executed: ${assertions}`);
    });

    // ------------------------------------------------------------------ open
    test("one register, one open shift — decided by the database under real concurrency", async () => {
      const results = await Promise.all([
        code(() => shifts.open(cashier(), { cashRegisterId: ids.registerA, openingCash: "500.00" })),
        code(() =>
          shifts.open(otherCashier(), { cashRegisterId: ids.registerA, openingCash: "300.00" }),
        ),
      ]);
      const winners = results.filter((result) => result === "OK");
      check(winners.length === 1, `exactly one open succeeded (got ${results.join(", ")})`);

      const [row] = await sql`
        select count(*)::int as count from cashier_shifts
        where restaurant_id = ${ids.restaurant} and cash_register_id = ${ids.registerA}
          and status = 'OPEN'`;
      check(Number(row.count) === 1, `exactly one OPEN shift row (got ${row.count})`);
      await forceClose(ids.cashier);
      await forceClose(ids.otherCashier);
    });

    test("one cashier cannot straddle two registers at once", async () => {
      const results = await Promise.all([
        code(() => shifts.open(cashier(), { cashRegisterId: ids.registerA, openingCash: "0.00" })),
        code(() => shifts.open(cashier(), { cashRegisterId: ids.registerB, openingCash: "0.00" })),
      ]);
      check(
        results.filter((result) => result === "OK").length === 1,
        `exactly one of the two succeeded (got ${results.join(", ")})`,
      );
      const [row] = await sql`
        select count(*)::int as count from cashier_shifts
        where restaurant_id = ${ids.restaurant} and opened_by_staff_id = ${ids.cashier}
          and status = 'OPEN'`;
      check(Number(row.count) === 1, `the cashier holds one drawer (got ${row.count})`);
      await forceClose(ids.cashier);
    });

    test("a deactivated register and a foreign register both refuse a shift", async () => {
      check(
        (await code(() =>
          shifts.open(cashier(), { cashRegisterId: ids.inactiveRegister, openingCash: "0.00" }),
        )) === "CONFLICT",
        "a deactivated register cannot host a shift",
      );
      check(
        (await code(() =>
          shifts.open(cashier(), { cashRegisterId: ids.foreignRegister, openingCash: "0.00" }),
        )) === "NOT_FOUND",
        "another restaurant's register is invisible",
      );
      const [row] = await sql`
        select count(*)::int as count from cashier_shifts where restaurant_id = ${ids.restaurant}
          and status = 'OPEN'`;
      check(Number(row.count) === 0, `no shift was created (got ${row.count})`);
    });

    // ------------------------------------------------------- money attribution
    test("cash, card, split and part payments all land on the open shift", async () => {
      const shiftId = await openFor(cashier(), ids.registerA, "500.00");

      // Full cash collection.
      const cashOrder = await newOrder(2);
      await payments.collect(cashier(), {
        orderId: cashOrder.orderId, method: "CASH", idempotencyKey: `${run}-cash`,
      });

      // Part cash + part card on one order.
      const splitPay = await newOrder(2);
      await payments.collect(cashier(), {
        orderId: splitPay.orderId, method: "CASH", amount: "80.00",
        idempotencyKey: `${run}-part-cash`,
      });
      await payments.collect(cashier(), {
        orderId: splitPay.orderId, method: "CARD", amount: "120.00",
        idempotencyKey: `${run}-part-card`,
      });

      // A split check collection.
      const checkOrder = await newOrder(2);
      const created = await checks.createChecks(manager(), {
        orderId: checkOrder.orderId, mode: "EQUAL", shares: 2,
      });
      const firstCheck = created.checks[0]!;
      await payments.collect(cashier(), {
        orderId: checkOrder.orderId, checkId: firstCheck.id, method: "CARD",
        idempotencyKey: `${run}-check`,
      });

      const attributed = await sql`
        select method::text as method, amount, cashier_shift_id
        from payments where restaurant_id = ${ids.restaurant} order by created_at`;
      check(
        attributed.every((row) => row.cashier_shift_id === shiftId),
        "every collection, split or not, is attributed to the open shift",
      );
      check(attributed.length === 4, `four collections were taken (got ${attributed.length})`);

      const detail = await shifts.detail(cashier(), shiftId);
      check(
        detail.summary.payments.cash === "280.00",
        `cash total 200 + 80 (got ${detail.summary.payments.cash})`,
      );
      check(
        detail.summary.payments.card === "220.00",
        `card total 120 + 100 (got ${detail.summary.payments.card})`,
      );
      check(
        detail.summary.grossCollected === "500.00",
        `gross collected (got ${detail.summary.grossCollected})`,
      );
      // Only the cash half reaches the drawer: 500 float + 280 cash.
      check(
        detail.summary.expectedCash === "780.00",
        `card money never enters the drawer (got ${detail.summary.expectedCash})`,
      );
      check(detail.summary.paymentCount === 4, "the payment count is server-derived");
    });

    test("cash in and cash out move the drawer by exactly their net", async () => {
      const [current] = await sql`
        select id from cashier_shifts where restaurant_id = ${ids.restaurant}
          and opened_by_staff_id = ${ids.cashier} and status = 'OPEN'`;
      const shiftId = String(current.id);

      await shifts.recordMovement(cashier(), {
        shiftId, type: "CASH_IN", amount: "50.00", reason: `${PREFIX}Bozuk para`,
        idempotencyKey: `${PREFIX}cash-in-1`,
      });
      const after = await shifts.recordMovement(cashier(), {
        shiftId, type: "CASH_OUT", amount: "20.00", reason: `${PREFIX}Tedarikci`,
        idempotencyKey: `${PREFIX}cash-out-1`,
      });
      check(
        after.summary.expectedCash === "810.00",
        `780 + 50 − 20 (got ${after.summary.expectedCash})`,
      );
      check(after.summary.cashIn === "50.00" && after.summary.cashOut === "20.00", "both directions recorded");

      const rows = await sql`
        select type::text as type, amount from cash_drawer_movements
        where cashier_shift_id = ${shiftId} order by created_at`;
      check(rows.length === 2, `two movement rows (got ${rows.length})`);
      check(
        rows.every((row) => Number(row.amount) > 0),
        "amounts are always positive; direction lives in the type",
      );
    });

    test("a cash refund lowers the drawer and a card refund does not", async () => {
      const [current] = await sql`
        select id from cashier_shifts where restaurant_id = ${ids.restaurant}
          and opened_by_staff_id = ${ids.cashier} and status = 'OPEN'`;
      const shiftId = String(current.id);
      const before = await shifts.detail(cashier(), shiftId);

      const cashPayment = await sql`
        select id from payments where restaurant_id = ${ids.restaurant}
          and method = 'CASH' and amount = '200.00' limit 1`;
      const cardPayment = await sql`
        select id from payments where restaurant_id = ${ids.restaurant}
          and method = 'CARD' and amount = '120.00' limit 1`;

      await payments.refund(cashier(), {
        paymentId: String(cashPayment[0]!.id), amount: "30.00",
        reasonCode: "CUSTOMER_COMPLAINT", idempotencyKey: `${run}-refund-cash`,
      });
      const afterCash = await shifts.detail(cashier(), shiftId);
      check(
        Number(afterCash.summary.expectedCash) === Number(before.summary.expectedCash) - 30,
        `a cash refund lowers the drawer by 30 (got ${afterCash.summary.expectedCash})`,
      );

      await payments.refund(cashier(), {
        paymentId: String(cardPayment[0]!.id), amount: "40.00",
        reasonCode: "WRONG_CHARGE", idempotencyKey: `${run}-refund-card`,
      });
      const afterCard = await shifts.detail(cashier(), shiftId);
      check(
        afterCard.summary.expectedCash === afterCash.summary.expectedCash,
        `a card refund leaves the drawer alone (got ${afterCard.summary.expectedCash})`,
      );
      check(
        afterCard.summary.refunds.cash === "30.00" && afterCard.summary.refunds.card === "40.00",
        "refunds are split by the method of the payment they reverse",
      );
      check(
        Number(afterCard.summary.netCollected) ===
          Number(afterCard.summary.grossCollected) - 70,
        "net collection drops by both refunds",
      );
    });

    test("no open shift means no money, and the order is left untouched", async () => {
      const { orderId } = await newOrder(1);
      // The waiter has no shift, and no role for it either.
      check(
        (await code(() =>
          payments.collect(as("CASHIER", ids.otherCashier), {
            orderId, method: "CASH", idempotencyKey: `${run}-noshift`,
          }),
        )) === "CASHIER_SHIFT_REQUIRED",
        "a cashier with no open drawer cannot collect",
      );
      const [row] = await sql`
        select count(*)::int as count from payments where order_id = ${orderId}`;
      check(Number(row.count) === 0, `no payment row was written (got ${row.count})`);
      const [order] = await sql`select status::text as status from orders where id = ${orderId}`;
      check(order.status === "SERVED", `the order is unchanged (got ${order.status})`);
    });

    // ------------------------------------------------------------- concurrency
    test("close versus payment: the collection is either counted or refused", async () => {
      // Repeated, because a race that only sometimes interleaves proves little.
      for (let attempt = 0; attempt < 6; attempt += 1) {
        await forceClose(ids.otherCashier);
        const shiftId = await openFor(otherCashier(), ids.registerB, "0.00");
        const { orderId } = await newOrder(1);

        const [closeResult, payResult] = await Promise.all([
          code(() => shifts.close(otherCashier(), { shiftId, countedCash: "0.00", note: `${PREFIX}race` })),
          code(() =>
            payments.collect(otherCashier(), {
              orderId, method: "CASH", idempotencyKey: `${run}-race-${attempt}`,
            }),
          ),
        ]);

        const row = await shiftRow(shiftId);
        const attached = await shiftPaymentCount(shiftId);
        if (payResult === "OK") {
          // The payment won: it must be inside the snapshot the close took.
          check(attached === 1, `attempt ${attempt}: the payment is attributed to the shift`);
          if (row.status === "CLOSED") {
            check(
              Number(row.expected_cash_at_close) === 100,
              `attempt ${attempt}: the close counted the payment (expected ${row.expected_cash_at_close})`,
            );
          }
        } else {
          check(
            payResult === "CASHIER_SHIFT_REQUIRED",
            `attempt ${attempt}: a late payment is refused, not mis-attributed (got ${payResult})`,
          );
          check(attached === 0, `attempt ${attempt}: nothing attached to the closed shift`);
          check(
            row.status === "CLOSED" && Number(row.expected_cash_at_close) === 0,
            `attempt ${attempt}: the snapshot matches an empty drawer`,
          );
        }
        check(
          closeResult === "OK" || closeResult === "CASHIER_SHIFT_CLOSED",
          `attempt ${attempt}: the close either succeeded or was already done (got ${closeResult})`,
        );
        await forceClose(ids.otherCashier);
      }
    });

    test("close versus refund holds the same guarantee", async () => {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        await forceClose(ids.otherCashier);
        const setupShift = await openFor(otherCashier(), ids.registerB, "0.00");
        const { orderId } = await newOrder(1);
        const payment = await payments.collect(otherCashier(), {
          orderId, method: "CASH", idempotencyKey: `${run}-refund-setup-${attempt}`,
        });
        await shifts.close(otherCashier(), {
          shiftId: setupShift, countedCash: "100.00",
        });

        // A second shift gives the money back while it is being closed.
        const shiftId = await openFor(otherCashier(), ids.registerB, "0.00");
        const [closeResult, refundResult] = await Promise.all([
          code(() => shifts.close(otherCashier(), { shiftId, countedCash: "0.00", note: `${PREFIX}race` })),
          code(() =>
            payments.refund(otherCashier(), {
              paymentId: payment.paymentId, amount: "10.00", reasonCode: "OTHER",
              idempotencyKey: `${run}-refund-race-${attempt}`,
            }),
          ),
        ]);

        const row = await shiftRow(shiftId);
        const [refunded] = await sql`
          select count(*)::int as count from payment_refunds where cashier_shift_id = ${shiftId}`;
        if (refundResult === "OK") {
          check(Number(refunded.count) === 1, `attempt ${attempt}: the refund is attributed here`);
          if (row.status === "CLOSED") {
            check(
              Number(row.expected_cash_at_close) === -10,
              `attempt ${attempt}: the close counted the refund (got ${row.expected_cash_at_close})`,
            );
          }
        } else {
          check(
            refundResult === "CASHIER_SHIFT_REQUIRED",
            `attempt ${attempt}: a late refund is refused (got ${refundResult})`,
          );
          check(Number(refunded.count) === 0, `attempt ${attempt}: nothing attached`);
        }
        check(
          closeResult === "OK" || closeResult === "CASHIER_SHIFT_CLOSED",
          `attempt ${attempt}: close outcome (got ${closeResult})`,
        );
        await forceClose(ids.otherCashier);
      }
    });

    test("close versus movement never leaves a movement outside the snapshot", async () => {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        await forceClose(ids.otherCashier);
        const shiftId = await openFor(otherCashier(), ids.registerB, "100.00");

        const [closeResult, movementResult] = await Promise.all([
          code(() => shifts.close(otherCashier(), { shiftId, countedCash: "100.00", note: `${PREFIX}race` })),
          code(() =>
            shifts.recordMovement(otherCashier(), {
              shiftId, type: "CASH_OUT", amount: "25.00", reason: `${PREFIX}race`,
              idempotencyKey: `${PREFIX}race-movement`,
            }),
          ),
        ]);

        check(
          closeResult === "OK",
          `attempt ${attempt}: the close itself always succeeds here (got ${closeResult})`,
        );
        const row = await shiftRow(shiftId);
        const [moved] = await sql`
          select coalesce(sum(amount), 0) as total from cash_drawer_movements
          where cashier_shift_id = ${shiftId}`;
        if (movementResult === "OK") {
          check(Number(moved.total) === 25, `attempt ${attempt}: the movement was written`);
          if (row.status === "CLOSED") {
            check(
              Number(row.expected_cash_at_close) === 75,
              `attempt ${attempt}: the snapshot includes it (got ${row.expected_cash_at_close})`,
            );
          }
        } else {
          check(
            movementResult === "CASHIER_SHIFT_CLOSED",
            `attempt ${attempt}: a late movement is refused (got ${movementResult})`,
          );
          check(Number(moved.total) === 0, `attempt ${attempt}: no movement row exists`);
          check(
            Number(row.expected_cash_at_close) === 100,
            `attempt ${attempt}: the snapshot is the untouched float`,
          );
        }
        await forceClose(ids.otherCashier);
      }
    });

    test("two parallel closes produce exactly one close", async () => {
      await forceClose(ids.otherCashier);
      const shiftId = await openFor(otherCashier(), ids.registerB, "250.00");

      // Either racer may win; what must hold is that exactly one does, and the
      // stored count is that one's — never a blend of the two.
      const counts = ["250.00", "999.00"] as const;
      const results = await Promise.all(
        counts.map((countedCash) =>
          code(() =>
            shifts.close(otherCashier(), { shiftId, countedCash, note: `${PREFIX}race` }),
          ),
        ),
      );
      const winners = results
        .map((result, index) => (result === "OK" ? index : -1))
        .filter((index) => index >= 0);
      check(
        winners.length === 1,
        `exactly one close succeeded (got ${results.join(", ")})`,
      );
      check(
        results.some((result) => result === "CASHIER_SHIFT_CLOSED"),
        `the loser is told it is already closed (got ${results.join(", ")})`,
      );

      const row = await shiftRow(shiftId);
      check(row.status === "CLOSED", "the shift is closed once");
      check(
        row.counted_cash_at_close === counts[winners[0]!],
        `the stored count is the winner's (${counts[winners[0]!]}), got ${row.counted_cash_at_close}`,
      );
      check(
        Number(row.cash_variance) ===
          Number(row.counted_cash_at_close) - Number(row.expected_cash_at_close),
        "the snapshot is internally consistent",
      );
    });

    test("every shift write completes on a single-connection pool", async () => {
      // Regression: `close()` once read its movement list through the outer
      // repository while holding its own transaction. With the runtime pool's
      // default of one connection that outer read waits for the connection the
      // transaction is holding, and the request never returns. The service
      // tests missed it because they run against a pool of eight, so this case
      // deliberately uses a pool of exactly one — as `next start` does.
      const single = createDb(environment.databaseUrl!, { maxConnections: 1 });
      const scoped = new CashierShiftService(new DrizzleCashierShiftRepository(single.db));
      try {
        await forceClose(ids.otherCashier);
        const opened = await scoped.open(otherCashier(), {
          cashRegisterId: ids.registerB,
          openingCash: "30.00",
        });
        await scoped.recordMovement(otherCashier(), {
          shiftId: opened.shift.id, type: "CASH_IN", amount: "5.00", reason: `${PREFIX}tek baglanti`,
          idempotencyKey: `${PREFIX}single-connection`,
        });
        const closed = await scoped.close(otherCashier(), {
          shiftId: opened.shift.id,
          countedCash: "35.00",
        });
        check(closed.shift.status === "CLOSED", "the close returns instead of hanging");
        check(
          closed.movements.length === 1,
          `and still reports its movements (got ${closed.movements.length})`,
        );
        check(closed.shift.cashVariance === "0.00", "30 float + 5 in, counted 35");
      } finally {
        await single.close();
      }
    });

    // ----------------------------------------------------------- immutability
    test("a closed shift's snapshot survives a later refund of its own takings", async () => {
      await forceClose(ids.otherCashier);
      const morning = await openFor(otherCashier(), ids.registerB, "100.00");
      const { orderId } = await newOrder(1);
      const payment = await payments.collect(otherCashier(), {
        orderId, method: "CASH", idempotencyKey: `${run}-stability`,
      });
      const closed = await shifts.close(otherCashier(), {
        shiftId: morning, countedCash: "200.00",
      });
      check(closed.shift.expectedCashAtClose === "200.00", "100 float + 100 cash");
      check(closed.shift.cashVariance === "0.00", "the drawer balanced");

      // The evening shift returns some of the morning's money.
      const evening = await openFor(otherCashier(), ids.registerB, "0.00");
      await payments.refund(otherCashier(), {
        paymentId: payment.paymentId, amount: "40.00", reasonCode: "QUALITY_ISSUE",
        idempotencyKey: `${run}-stability-refund`,
      });

      const morningRow = await shiftRow(morning);
      check(
        Number(morningRow.expected_cash_at_close) === 200 &&
          Number(morningRow.counted_cash_at_close) === 200 &&
          Number(morningRow.cash_variance) === 0,
        "the morning snapshot did not move retroactively",
      );
      const morningDetail = await shifts.detail(otherCashier(), morning);
      check(
        morningDetail.summary.expectedCash === "200.00",
        `the reported figure is the snapshot (got ${morningDetail.summary.expectedCash})`,
      );

      const eveningDetail = await shifts.detail(otherCashier(), evening);
      check(
        eveningDetail.summary.refunds.cash === "40.00",
        `the refund belongs to the evening drawer (got ${eveningDetail.summary.refunds.cash})`,
      );
      check(
        eveningDetail.summary.expectedCash === "-40.00",
        `and lowers it (got ${eveningDetail.summary.expectedCash})`,
      );

      const [refundRow] = await sql`
        select cashier_shift_id from payment_refunds where payment_id = ${payment.paymentId}`;
      check(
        String(refundRow.cashier_shift_id) === evening,
        "the refund row points at the refunding shift, not the collecting one",
      );
      await forceClose(ids.otherCashier);
    });

    test("the database itself refuses to reopen or blank a closed shift", async () => {
      await forceClose(ids.otherCashier);
      const shiftId = await openFor(otherCashier(), ids.registerB, "10.00");
      await shifts.close(otherCashier(), { shiftId, countedCash: "10.00" });

      // The closure-consistency check constraint, not application code.
      const reopen = await sql`
        update cashier_shifts set status = 'OPEN' where id = ${shiftId}`.catch(
        (error: Error) => error.message,
      );
      check(typeof reopen === "string", `a raw reopen is rejected (got ${JSON.stringify(reopen)})`);
      const blank = await sql`
        update cashier_shifts set closed_at = null where id = ${shiftId}`.catch(
        (error: Error) => error.message,
      );
      check(typeof blank === "string", "clearing closed_at is rejected");
      const lie = await sql`
        update cashier_shifts set counted_cash_at_close = '99999.00' where id = ${shiftId}`.catch(
        (error: Error) => error.message,
      );
      check(typeof lie === "string", "editing the count without the variance is rejected");

      const row = await shiftRow(shiftId);
      check(row.status === "CLOSED" && Number(row.counted_cash_at_close) === 10, "unchanged");
    });

    test("a pending payment blocks the close until it is resolved", async () => {
      await forceClose(ids.otherCashier);
      const shiftId = await openFor(otherCashier(), ids.registerB, "0.00");
      const { orderId } = await newOrder(1);
      // PENDING is not reachable through the service, so the row is planted.
      const pendingId = randomUUID();
      await sql`insert into payments (id, restaurant_id, order_id, cashier_shift_id, amount,
          method, status, created_by_user_id) values
        (${pendingId}, ${ids.restaurant}, ${orderId}, ${shiftId}, '25.00', 'CARD', 'PENDING',
         ${ids.otherCashier})`;

      check(
        (await code(() => shifts.close(otherCashier(), { shiftId, countedCash: "0.00" }))) ===
          "CASHIER_SHIFT_HAS_PENDING_PAYMENT",
        "an in-flight collection makes the expectation unknowable",
      );
      const stillOpen = await shiftRow(shiftId);
      check(stillOpen.status === "OPEN", "the shift stayed open");

      await sql`update payments set status = 'CANCELLED' where id = ${pendingId}`;
      check(
        (await code(() => shifts.close(otherCashier(), { shiftId, countedCash: "0.00" }))) === "OK",
        "and closes once nothing is in flight",
      );
      await forceClose(ids.otherCashier);
    });

    test("an open order elsewhere in the restaurant does not block a close", async () => {
      await forceClose(ids.otherCashier);
      const shiftId = await openFor(otherCashier(), ids.registerB, "0.00");
      await newOrder(3); // left SERVED and unpaid on purpose
      check(
        (await code(() => shifts.close(otherCashier(), { shiftId, countedCash: "0.00" }))) === "OK",
        "a shift is an accountability period, not a table lifecycle",
      );
    });

    // -------------------------------------------------------------- supervisor
    test("a manager closes another cashier's drawer, and ownership does not move", async () => {
      await forceClose(ids.otherCashier);
      const shiftId = await openFor(otherCashier(), ids.registerB, "60.00");

      check(
        (await code(() => shifts.close(cashier(), { shiftId, countedCash: "60.00" }))) ===
          "NOT_FOUND",
        "another cashier is told nothing about it",
      );
      check(
        (await code(() => shifts.close(manager(), { shiftId, countedCash: "60.00" }))) ===
          "CASHIER_SHIFT_NOTE_REQUIRED",
        "an override always carries a reason",
      );

      await shifts.close(manager(), {
        shiftId, countedCash: "55.00", note: `${PREFIX}Kasiyer erken ayrildi.`,
      });
      const row = await shiftRow(shiftId);
      check(String(row.opened_by_staff_id) === ids.otherCashier, "the owner is unchanged");
      check(String(row.closed_by_staff_id) === ids.manager, "the manager is recorded as closer");
      check(Number(row.cash_variance) === -5, `variance −5.00 (got ${row.cash_variance})`);

      const [audit] = await sql`
        select action from audit_logs where entity_id = ${shiftId}
          and action = 'cashier_shift.closed_by_supervisor'`;
      check(Boolean(audit), "the override is its own audited action");
    });

    // ------------------------------------------------------------ tenant scope
    test("a foreign cashier can reach nothing here", async () => {
      const foreign = as("CASHIER", ids.foreignCashier, ids.foreignRestaurant);
      const [mine] = await sql`
        select id from cashier_shifts where restaurant_id = ${ids.restaurant} limit 1`;
      const shiftId = String(mine.id);

      check((await code(() => shifts.detail(foreign, shiftId))) === "NOT_FOUND", "detail");
      check(
        (await code(() => shifts.close(foreign, { shiftId, countedCash: "0.00", note: "x" }))) ===
          "NOT_FOUND",
        "close",
      );
      check(
        (await code(() =>
          shifts.recordMovement(foreign, {
            shiftId, type: "CASH_IN", amount: "1.00", reason: "x",
            idempotencyKey: `${run}-foreign-movement`,
          }),
        )) === "NOT_FOUND",
        "movement",
      );
      check(
        (await code(() =>
          shifts.open(foreign, { cashRegisterId: ids.registerA, openingCash: "0.00" }),
        )) === "NOT_FOUND",
        "register",
      );
      const history = await shifts.history(foreign, { page: 1, pageSize: 50 });
      check(history.rows.length === 0, `no rows leak across tenants (got ${history.rows.length})`);

      // A nonexistent id answers identically to a foreign one.
      check(
        (await code(() => shifts.detail(manager(), randomUUID()))) === "NOT_FOUND",
        "a nonexistent shift is the same NOT_FOUND",
      );
    });

    // ---------------------------------------------------------------- history
    test("history filters and paginates server-side with a stable order", async () => {
      const all = await shifts.history(manager(), { page: 1, pageSize: 50 });
      check(all.total >= 4, `the manager sees the restaurant's shifts (got ${all.total})`);
      check(
        all.rows.every((row, index) =>
          index === 0 ? true : row.openedAt <= all.rows[index - 1]!.openedAt,
        ),
        "newest first",
      );

      const closed = await shifts.history(manager(), {
        status: "CLOSED", page: 1, pageSize: 50,
      });
      check(
        closed.rows.every((row) => row.status === "CLOSED"),
        "the status filter is applied in SQL",
      );

      const byRegister = await shifts.history(manager(), {
        cashRegisterId: ids.registerB, page: 1, pageSize: 50,
      });
      check(
        byRegister.rows.every((row) => row.cashRegisterId === ids.registerB),
        "the register filter is applied in SQL",
      );

      const byCashier = await shifts.history(manager(), {
        openedByStaffId: ids.cashier, page: 1, pageSize: 50,
      });
      check(
        byCashier.rows.every((row) => row.openedByStaffId === ids.cashier),
        "the cashier filter is applied in SQL",
      );

      const firstPage = await shifts.history(manager(), { page: 1, pageSize: 2 });
      const secondPage = await shifts.history(manager(), { page: 2, pageSize: 2 });
      check(firstPage.rows.length === 2, "the page size is honoured");
      check(
        firstPage.rows.every((row) => !secondPage.rows.some((other) => other.id === row.id)),
        "pages do not overlap",
      );

      const future = await shifts.history(manager(), {
        from: new Date(Date.now() + 86_400_000), page: 1, pageSize: 50,
      });
      check(future.total === 0, `a future window is empty (got ${future.total})`);
    });

    test("a deactivated register keeps its history readable", async () => {
      const [row] = await sql`
        select id, register_name_snapshot from cashier_shifts
        where restaurant_id = ${ids.restaurant} and cash_register_id = ${ids.registerA} limit 1`;
      await sql`update cash_registers set is_active = false where id = ${ids.registerA}`;

      const detail = await shifts.detail(manager(), String(row.id));
      check(
        detail.shift.register.name === String(row.register_name_snapshot),
        "the snapshot keeps the register's name on the old shift",
      );
      const history = await shifts.history(manager(), {
        cashRegisterId: ids.registerA, page: 1, pageSize: 10,
      });
      check(history.total > 0, "its shifts are still listable");
      await sql`update cash_registers set is_active = true where id = ${ids.registerA}`;
    });

    // -------------------------------------------------------------- retention
    test("maintenance never touches shift or drawer history", async () => {
      const countOf = async (table: string): Promise<number> => {
        const [row] = await sql.unsafe(
          `select count(*)::int as count from public.${table} where restaurant_id = $1::uuid`,
          [ids.restaurant],
        );
        return Number(row.count);
      };
      const before = {
        shifts: await countOf("cashier_shifts"),
        movements: await countOf("cash_drawer_movements"),
        registers: await countOf("cash_registers"),
        payments: await countOf("payments"),
        refunds: await countOf("payment_refunds"),
      };
      check(before.shifts > 0 && before.movements > 0, "there is history to protect");

      const result = await new DataMaintenanceService(db).run({ dryRun: false });
      check(result.errors.length === 0, `maintenance ran clean (${result.errors.join(", ")})`);
      check(
        result.operations.every(
          (operation) =>
            !["cashier_shifts", "cash_drawer_movements", "cash_registers"].includes(
              operation.table,
            ),
        ),
        "no cash table is even a cleanup target",
      );

      assert.deepEqual(
        {
          shifts: await countOf("cashier_shifts"),
          movements: await countOf("cash_drawer_movements"),
          registers: await countOf("cash_registers"),
          payments: await countOf("payments"),
          refunds: await countOf("payment_refunds"),
        },
        before,
        "cash history is untouched by retention maintenance",
      );
      assertions += 1;
    });

    test("shift lifecycle is audited and published, and never as an order event", async () => {
      const actions = await sql`
        select distinct action from audit_logs where restaurant_id = ${ids.restaurant}
          and (action like 'cashier_shift%' or action like 'cash_drawer%' or action like 'cash_register%')
        order by action`;
      const names = actions.map((row) => String(row.action));
      for (const expected of [
        "cash_drawer.cash_in",
        "cash_drawer.cash_out",
        "cashier_shift.closed",
        "cashier_shift.closed_by_supervisor",
        "cashier_shift.opened",
      ]) {
        check(names.includes(expected), `${expected} is audited (have ${names.join(", ")})`);
      }

      const events = await sql`
        select distinct event_type from outbox_events where restaurant_id = ${ids.restaurant}
          and aggregate_type = 'CASHIER_SHIFT' order by event_type`;
      const eventNames = events.map((row) => String(row.event_type));
      for (const expected of [
        "CASHIER_SHIFT_CLOSED",
        "CASHIER_SHIFT_OPENED",
        "CASH_DRAWER_MOVEMENT_RECORDED",
      ]) {
        check(eventNames.includes(expected), `${expected} is published`);
      }

      const [orderEvents] = await sql`
        select count(*)::int as count from order_events
        where restaurant_id = ${ids.restaurant} and event_type::text like '%SHIFT%'`;
      check(
        Number(orderEvents.count) === 0,
        "shift events stay out of the order-specific stream",
      );
    });

    test("historical pre-shift money keeps a null attribution rather than a fake one", async () => {
      const legacyId = randomUUID();
      const { orderId } = await newOrder(1);
      await sql`insert into payments (id, restaurant_id, order_id, amount, method, status,
          created_by_user_id, processed_at) values
        (${legacyId}, ${ids.restaurant}, ${orderId}, '100.00', 'CASH', 'COMPLETED',
         ${ids.cashier}, now())`;

      const [row] = await sql`select cashier_shift_id from payments where id = ${legacyId}`;
      check(row.cashier_shift_id === null, "a pre-shift row is allowed to have no shift");

      // And it is invisible to every shift summary, rather than landing on one.
      const [attributed] = await sql`
        select count(*)::int as count from payments
        where restaurant_id = ${ids.restaurant} and cashier_shift_id is null`;
      check(Number(attributed.count) === 1, `exactly the planted legacy row (got ${attributed.count})`);
    });
  });
}
