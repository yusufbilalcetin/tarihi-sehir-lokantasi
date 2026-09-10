import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";

import { createDb, type Database } from "../../db";
import { isDomainError } from "../../lib/api/domain-error";
import type { RestaurantPrincipal } from "../../lib/domain/restaurant-scope";
import { sumBreakdown } from "../../lib/domain/cashier-report";
import { DrizzleCashierShiftRepository } from "../../lib/repositories/drizzle-cashier-shift-repository";
import { DrizzlePaymentRepository } from "../../lib/repositories/drizzle-payment-repository";
import { generateQrToken } from "../../lib/security/qr-token";
import { CashierReportService } from "../../lib/services/cashier-report-service";
import { CashierShiftService } from "../../lib/services/cashier-shift-service";
import { DataMaintenanceService } from "../../lib/services/data-maintenance-service";
import { PaymentService } from "../../lib/services/payment-service";
import { readSupabaseIntegrationEnvironment } from "./supabase-test-environment";

/**
 * Phase 8B — operational X/Z and end-of-day cash reporting on real PostgreSQL.
 *
 * The two properties this suite exists to prove:
 *
 * 1. **A Z report never moves.** It is written inside the closing transaction
 *    and read back verbatim, so a refund issued by a later shift changes
 *    today's drawer and leaves yesterday's report byte-identical.
 * 2. **A day is a local calendar day.** Money is attributed to the day it was
 *    taken on, not the day its shift happened to close on, so a shift running
 *    past midnight splits across two reports exactly as the cash did.
 */

const PREFIX = "PHASE8B_";
const readiness = readSupabaseIntegrationEnvironment({ requireDatabaseUrl: true });

/** Türkiye is a fixed UTC+3, so a local wall-clock time is exact arithmetic. */
function localTime(date: string, hour: number, minute = 0): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - 180 * 60_000);
}

/**
 * The same instant as ISO text, for raw SQL. A `Date` interpolated into a raw
 * fragment carries no column type and the driver cannot bind it, so every raw
 * timestamp below is sent as text and cast explicitly.
 */
function at(date: string, hour: number, minute = 0): string {
  return localTime(date, hour, minute).toISOString();
}

if (!readiness.ready) {
  test("Phase 8B cashier report integration", { skip: readiness.reason }, () => undefined);
} else {
  const environment = readiness.environment;
  const run = randomBytes(6).toString("hex");
  let connection: ReturnType<typeof createDb>;
  let db: Database;
  let sql: ReturnType<typeof createDb>["client"];
  let shifts: CashierShiftService;
  let reports: CashierReportService;
  const cleanupErrors: string[] = [];
  let assertions = 0;

  /**
   * Fixed local days, so "today" can never interfere. Each case owns its own
   * dates: a shift planted by one case must not be counted by another.
   */
  const LEGACY_DAY = "2026-03-01";
  const DAY_ONE = "2026-03-10";
  const DAY_TWO = "2026-03-11";

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
    foreignCashier: randomUUID(),
  };
  let sequence = 91000;

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

  /** Services pinned to a wall-clock instant, so timestamps are deterministic. */
  const shiftsAt = (at: Date) =>
    new CashierShiftService(new DrizzleCashierShiftRepository(db), { clock: () => at });
  const paymentsAt = (at: Date) =>
    new PaymentService(new DrizzlePaymentRepository(db), { clock: () => at });

  async function code(work: () => Promise<unknown>): Promise<string> {
    try {
      await work();
      return "OK";
    } catch (error) {
      return isDomainError(error) ? error.code : `UNEXPECTED:${(error as Error).message}`;
    }
  }

  async function newOrder(total: number): Promise<string> {
    const orderId = randomUUID();
    sequence += 1;
    const amount = total.toFixed(2);
    await sql`insert into orders (id, restaurant_id, table_id, order_sequence, order_number,
        subtotal, total, created_by_type, created_by_user_id, status) values
      (${orderId}, ${ids.restaurant}, ${ids.table}, ${sequence}, ${`${PREFIX}${sequence}`},
       ${amount}, ${amount}, 'STAFF', ${ids.waiter}, 'SERVED')`;
    await sql`insert into order_items (id, restaurant_id, order_id, product_id,
        product_name_snapshot, unit_price, quantity, line_total, status) values
      (${randomUUID()}, ${ids.restaurant}, ${orderId}, ${ids.product},
       ${`${PREFIX}Ana`}, ${amount}, 1, ${amount}, 'SERVED')`;
    return orderId;
  }

  /** Ends whatever the given staff member has open, so cases stay isolated. */
  async function forceClose(staffId: string): Promise<void> {
    await sql`
      update cashier_shifts set status = 'CLOSED', closed_at = now(), closed_by_staff_id = ${staffId},
        counted_cash_at_close = coalesce(counted_cash_at_close, '0.00'),
        expected_cash_at_close = coalesce(expected_cash_at_close, '0.00'),
        cash_variance = coalesce(cash_variance, '0.00'),
        close_note = coalesce(close_note, ${`${PREFIX}teardown`})
      where restaurant_id = ${ids.restaurant} and opened_by_staff_id = ${staffId}
        and status = 'OPEN'`;
  }

  describe("Phase 8B operational X/Z and end-of-day reporting", { concurrency: false }, () => {
    before(async () => {
      connection = createDb(environment.databaseUrl!, { maxConnections: 8 });
      db = connection.db;
      sql = connection.client;
      shifts = new CashierShiftService(new DrizzleCashierShiftRepository(db));
      reports = new CashierReportService(new DrizzleCashierShiftRepository(db));

      await sql`insert into restaurants (id, name, slug) values
        (${ids.restaurant}, ${`${PREFIX}Tenant`}, ${`phase8b-a-${run}`}),
        (${ids.foreignRestaurant}, ${`${PREFIX}Tenant B`}, ${`phase8b-b-${run}`})`;
      await sql`insert into restaurant_settings (restaurant_id) values
        (${ids.restaurant}), (${ids.foreignRestaurant})`;
      await sql`insert into staff_profiles (id, restaurant_id, name, login_identifier, role, is_active) values
        (${ids.cashier}, ${ids.restaurant}, ${`${PREFIX}Kasiyer`}, ${`p8b-${run}-c1`}, 'CASHIER', true),
        (${ids.otherCashier}, ${ids.restaurant}, ${`${PREFIX}Kasiyer 2`}, ${`p8b-${run}-c2`}, 'CASHIER', true),
        (${ids.manager}, ${ids.restaurant}, ${`${PREFIX}Mudur`}, ${`p8b-${run}-m`}, 'MANAGER', true),
        (${ids.waiter}, ${ids.restaurant}, ${`${PREFIX}Garson`}, ${`p8b-${run}-w`}, 'WAITER', true),
        (${ids.foreignCashier}, ${ids.foreignRestaurant}, ${`${PREFIX}B Kasiyer`}, ${`p8b-${run}-fb`}, 'CASHIER', true)`;
      await sql`insert into cash_registers (id, restaurant_id, name, code) values
        (${ids.registerA}, ${ids.restaurant}, ${`${PREFIX}Ana Kasa`}, ${`P8BA${run.slice(0, 6).toUpperCase()}`}),
        (${ids.registerB}, ${ids.restaurant}, ${`${PREFIX}Bar Kasa`}, ${`P8BB${run.slice(0, 6).toUpperCase()}`})`;
      await sql`insert into categories (id, restaurant_id, name, slug) values
        (${ids.category}, ${ids.restaurant}, ${`${PREFIX}Kategori`}, ${`p8b-cat-${run}`})`;
      await sql`insert into products (id, restaurant_id, category_id, name, slug, price) values
        (${ids.product}, ${ids.restaurant}, ${ids.category}, ${`${PREFIX}Ana`}, ${`p8b-ana-${run}`}, '100.00')`;
      await sql`insert into restaurant_tables (id, restaurant_id, name, table_number, qr_token_hash) values
        (${ids.table}, ${ids.restaurant}, ${`${PREFIX}Masa`}, 9101, ${generateQrToken(randomBytes(32)).tokenHash})`;
    });

    after(async () => {
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
        console.error("PHASE8B FIXTURE CLEANUP INCOMPLETE:", cleanupErrors.join(" | "));
      }
      console.log(`phase8b assertions executed: ${assertions}`);
    });

    // -------------------------------------------------------------- X report
    test("the X report is exact, and taking it twice changes nothing", async () => {
      await forceClose(ids.cashier);
      const opened = await shifts.open(cashier(), {
        cashRegisterId: ids.registerA,
        openingCash: "500.00",
      });
      const shiftId = opened.shift.id;

      // The Phase 8A worked example, driven through the real services.
      const cashOrder = await newOrder(1000);
      const cashPayment = await paymentsAt(new Date()).collect(cashier(), {
        orderId: cashOrder, method: "CASH", idempotencyKey: `${run}-x-cash`,
      });
      const cardOrder = await newOrder(600);
      const cardPayment = await paymentsAt(new Date()).collect(cashier(), {
        orderId: cardOrder, method: "CARD", idempotencyKey: `${run}-x-card`,
      });
      await paymentsAt(new Date()).refund(cashier(), {
        paymentId: cashPayment.paymentId, amount: "100.00",
        reasonCode: "CUSTOMER_COMPLAINT", idempotencyKey: `${run}-x-refund-cash`,
      });
      await paymentsAt(new Date()).refund(cashier(), {
        paymentId: cardPayment.paymentId, amount: "50.00",
        reasonCode: "WRONG_CHARGE", idempotencyKey: `${run}-x-refund-card`,
      });
      await shifts.recordMovement(cashier(), {
        shiftId, type: "CASH_IN", amount: "50.00", reason: `${PREFIX}Bozuk para`,
        idempotencyKey: `${run}-x-movement-in`,
      });
      await shifts.recordMovement(cashier(), {
        shiftId, type: "CASH_OUT", amount: "200.00", reason: `${PREFIX}Tedarikci`,
        idempotencyKey: `${run}-x-movement-out`,
      });

      const report = await reports.xReport(cashier(), shiftId);
      check(report.reportType === "X" && report.shiftStatus === "OPEN", "it is a live X report");
      check(report.openingCash === "500.00", `opening (got ${report.openingCash})`);
      check(
        report.expectedCash === "1250.00",
        `500 + 1000 − 100 + 50 − 200 (got ${report.expectedCash})`,
      );
      check(report.grossCollected === "1600.00", `gross (got ${report.grossCollected})`);
      check(report.totalRefunds === "150.00", `refunds (got ${report.totalRefunds})`);
      check(report.netCollected === "1450.00", `net (got ${report.netCollected})`);
      check(
        sumBreakdown(report.paymentMethodBreakdown) === report.grossCollected,
        "the payment breakdown reconciles to gross",
      );
      check(
        sumBreakdown(report.refundMethodBreakdown) === report.totalRefunds,
        "the refund breakdown reconciles to refunds",
      );
      const cash = report.paymentMethodBreakdown.find((row) => row.method === "CASH");
      const card = report.paymentMethodBreakdown.find((row) => row.method === "CARD");
      check(cash?.amount === "1000.00" && card?.amount === "600.00", "per-method amounts");
      check(cash?.count === 1 && card?.count === 1, "per-method counts");

      // Side-effect freedom, checked against the database rather than by hope.
      const before = await sql`
        select
          (select count(*)::int from payments where restaurant_id = ${ids.restaurant}) as payments,
          (select count(*)::int from payment_refunds where restaurant_id = ${ids.restaurant}) as refunds,
          (select count(*)::int from cash_drawer_movements where restaurant_id = ${ids.restaurant}) as movements,
          (select count(*)::int from audit_logs where restaurant_id = ${ids.restaurant}) as audits,
          (select status::text from cashier_shifts where id = ${shiftId}) as status`;
      const second = await reports.xReport(cashier(), shiftId);
      const afterRows = await sql`
        select
          (select count(*)::int from payments where restaurant_id = ${ids.restaurant}) as payments,
          (select count(*)::int from payment_refunds where restaurant_id = ${ids.restaurant}) as refunds,
          (select count(*)::int from cash_drawer_movements where restaurant_id = ${ids.restaurant}) as movements,
          (select count(*)::int from audit_logs where restaurant_id = ${ids.restaurant}) as audits,
          (select status::text from cashier_shifts where id = ${shiftId}) as status`;

      assert.deepEqual(afterRows[0], before[0], "a second X report writes nothing at all");
      assertions += 1;
      check(second.expectedCash === report.expectedCash, "and reports the same figures");
      check(second.shiftStatus === "OPEN", "the shift is still collectable");

      // A collection after the report shows up in the next one.
      const extraOrder = await newOrder(200);
      await paymentsAt(new Date()).collect(cashier(), {
        orderId: extraOrder, method: "CASH", idempotencyKey: `${run}-x-extra`,
      });
      const third = await reports.xReport(cashier(), shiftId);
      check(third.expectedCash === "1450.00", `the live view moved (got ${third.expectedCash})`);
    });

    test("every money field is exact two-decimal money, even at zero", async () => {
      // Regression: `coalesce(sum(x), 0)` coalesces to an *integer* literal, so
      // an empty aggregate returned "0" while a populated one returned "0.00".
      // A report is a financial document; its zeros must look like its totals.
      await forceClose(ids.otherCashier);
      const empty = await shifts.open(otherCashier(), {
        cashRegisterId: ids.registerB,
        openingCash: "0.00",
      });
      const report = await reports.xReport(otherCashier(), empty.shift.id);

      const moneyFields: Record<string, string> = {
        openingCash: report.openingCash,
        grossCollected: report.grossCollected,
        totalRefunds: report.totalRefunds,
        netCollected: report.netCollected,
        cashIn: report.cashIn,
        cashOut: report.cashOut,
        expectedCash: report.expectedCash,
        ...Object.fromEntries(
          report.paymentMethodBreakdown.map((row) => [`payment.${row.method}`, row.amount]),
        ),
        ...Object.fromEntries(
          report.refundMethodBreakdown.map((row) => [`refund.${row.method}`, row.amount]),
        ),
      };
      for (const [field, value] of Object.entries(moneyFields)) {
        check(
          /^-?\d+\.\d{2}$/.test(value),
          `${field} must be exact money (got ${JSON.stringify(value)})`,
        );
      }

      // And the same holds for the frozen Z report of an empty drawer.
      const closed = await shifts.close(otherCashier(), {
        shiftId: empty.shift.id,
        countedCash: "0.00",
      });
      const z = await reports.zReport(otherCashier(), closed.shift.id);
      for (const [field, value] of Object.entries({
        expectedCash: z.expectedCash,
        countedCash: z.countedCash,
        cashVariance: z.cashVariance,
        grossCollected: z.grossCollected,
        totalRefunds: z.totalRefunds,
        cashIn: z.cashIn,
        cashOut: z.cashOut,
      })) {
        check(
          /^-?\d+\.\d{2}$/.test(value),
          `stored ${field} must be exact money (got ${JSON.stringify(value)})`,
        );
      }
      await forceClose(ids.otherCashier);
    });

    test("a Z report cannot be taken while the drawer is open", async () => {
      const [row] = await sql`
        select id from cashier_shifts where restaurant_id = ${ids.restaurant}
          and opened_by_staff_id = ${ids.cashier} and status = 'OPEN'`;
      check(
        (await code(() => reports.zReport(cashier(), String(row.id)))) ===
          "CASHIER_SHIFT_NOT_CLOSED",
        "Z belongs to a closed shift only",
      );
    });

    // -------------------------------------------------------------- Z report
    test("closing writes the Z report atomically, and it reads back identically", async () => {
      const [open] = await sql`
        select id from cashier_shifts where restaurant_id = ${ids.restaurant}
          and opened_by_staff_id = ${ids.cashier} and status = 'OPEN'`;
      const shiftId = String(open.id);

      const closed = await shifts.close(cashier(), {
        shiftId, countedCash: "1440.00", note: `${PREFIX}Bozuk para eksik.`,
      });
      check(closed.shift.status === "CLOSED", "the shift closed");

      // The snapshot exists in the same row the close wrote.
      const [stored] = await sql`
        select z_report_version, z_report_generated_at is not null as has_generated,
          z_report_snapshot is not null as has_snapshot
        from cashier_shifts where id = ${shiftId}`;
      check(Number(stored.z_report_version) === 1, `snapshot version 1 (got ${stored.z_report_version})`);
      check(stored.has_snapshot === true && stored.has_generated === true, "written with the close");

      const report = await reports.zReport(cashier(), shiftId);
      check(report.reportType === "Z", "it is a Z report");
      check(report.expectedCash === "1450.00", `expected (got ${report.expectedCash})`);
      check(report.countedCash === "1440.00", `counted (got ${report.countedCash})`);
      check(report.cashVariance === "-10.00", `variance (got ${report.cashVariance})`);
      check(report.grossCollected === "1800.00", `gross (got ${report.grossCollected})`);
      check(report.totalRefunds === "150.00", `refunds (got ${report.totalRefunds})`);
      check(report.netCollected === "1650.00", `net (got ${report.netCollected})`);
      check(
        sumBreakdown(report.paymentMethodBreakdown) === report.grossCollected,
        "the stored breakdown reconciles to its own gross",
      );
      check(
        sumBreakdown(report.refundMethodBreakdown) === report.totalRefunds,
        "and the refund breakdown to its own total",
      );
      check(report.managerOverride === false, "the cashier closed their own drawer");
      check(report.closeNote === `${PREFIX}Bozuk para eksik.`, "the note is kept");
      check(
        report.registerNameSnapshot === `${PREFIX}Ana Kasa` &&
          report.restaurantNameSnapshot === `${PREFIX}Tenant`,
        "identity is snapshotted, not looked up later",
      );
      check(
        report.openedByNameSnapshot === `${PREFIX}Kasiyer`,
        `the cashier's name is frozen (got ${report.openedByNameSnapshot})`,
      );

      // Repeating the request returns the identical stored document.
      const again = await reports.zReport(cashier(), shiftId);
      assert.deepEqual(again, report, "a Z report is read, never recomputed");
      assertions += 1;

      // And an X report is refused now that the drawer is closed.
      check(
        (await code(() => reports.xReport(cashier(), shiftId))) === "CASHIER_SHIFT_CLOSED",
        "X is for an open drawer only",
      );
    });

    test("a later shift's refund changes today's drawer and not yesterday's report", async () => {
      const [previous] = await sql`
        select id from cashier_shifts where restaurant_id = ${ids.restaurant}
          and opened_by_staff_id = ${ids.cashier} and status = 'CLOSED'
        order by closed_at desc limit 1`;
      const oldShiftId = String(previous.id);
      const before = await reports.zReport(cashier(), oldShiftId);
      const [beforeRaw] = await sql`
        select z_report_snapshot::text as snapshot from cashier_shifts where id = ${oldShiftId}`;

      // A new drawer refunds money the closed one collected.
      await forceClose(ids.cashier);
      const evening = await shifts.open(cashier(), {
        cashRegisterId: ids.registerA, openingCash: "0.00",
      });
      const [collected] = await sql`
        select id from payments where restaurant_id = ${ids.restaurant}
          and cashier_shift_id = ${oldShiftId} and method = 'CASH' and amount = '1000.00'`;
      await paymentsAt(new Date()).refund(cashier(), {
        paymentId: String(collected.id), amount: "40.00",
        reasonCode: "QUALITY_ISSUE", idempotencyKey: `${run}-later-refund`,
      });

      const after = await reports.zReport(cashier(), oldShiftId);
      const [afterRaw] = await sql`
        select z_report_snapshot::text as snapshot from cashier_shifts where id = ${oldShiftId}`;
      assert.deepEqual(after, before, "the historical Z report is unchanged");
      check(
        String(afterRaw.snapshot) === String(beforeRaw.snapshot),
        "the stored JSON is byte-identical",
      );
      assertions += 1;

      // The refund lands on the drawer that issued it.
      const live = await reports.xReport(cashier(), evening.shift.id);
      check(
        live.totalRefunds === "40.00",
        `the evening drawer carries the refund (got ${live.totalRefunds})`,
      );
      check(
        live.expectedCash === "-40.00",
        `and it lowers the evening drawer (got ${live.expectedCash})`,
      );
      const [refundRow] = await sql`
        select cashier_shift_id from payment_refunds where payment_id = ${String(collected.id)}
          and amount = '40.00'`;
      check(
        String(refundRow.cashier_shift_id) === evening.shift.id,
        "the refund row points at the refunding shift",
      );
      await forceClose(ids.cashier);
    });

    test("a shift closed before Phase 8B reports no Z rather than a reconstructed one", async () => {
      // A synthetic legacy row: closed, but with no snapshot, exactly as rows
      // closed before this migration look.
      const legacyId = randomUUID();
      await sql`insert into cashier_shifts (id, restaurant_id, cash_register_id,
          register_name_snapshot, opened_by_staff_id, opened_at, opening_cash, status,
          closed_at, closed_by_staff_id, counted_cash_at_close, expected_cash_at_close,
          cash_variance, close_note) values
        (${legacyId}, ${ids.restaurant}, ${ids.registerB}, ${`${PREFIX}Bar Kasa`},
         ${ids.otherCashier}, ${at(LEGACY_DAY, 9)}::timestamptz, '100.00', 'CLOSED',
         ${at(LEGACY_DAY, 17)}::timestamptz, ${ids.otherCashier}, '100.00', '100.00', '0.00',
         ${`${PREFIX}legacy`})`;

      check(
        (await code(() => reports.zReport(manager(), legacyId))) ===
          "LEGACY_SHIFT_WITHOUT_Z_SNAPSHOT",
        "no report is invented for it",
      );
      const [row] = await sql`
        select z_report_snapshot from cashier_shifts where id = ${legacyId}`;
      check(row.z_report_snapshot === null, "and nothing was back-filled either");
    });

    // ----------------------------------------------------------- concurrency
    test("close versus payment: the Z report matches what actually committed", async () => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await forceClose(ids.otherCashier);
        const opened = await shifts.open(otherCashier(), {
          cashRegisterId: ids.registerB, openingCash: "0.00",
        });
        const shiftId = opened.shift.id;
        const orderId = await newOrder(100);

        const [closeResult, payResult] = await Promise.all([
          code(() => shifts.close(otherCashier(), { shiftId, countedCash: "0.00", note: `${PREFIX}race` })),
          code(() =>
            paymentsAt(new Date()).collect(otherCashier(), {
              orderId, method: "CASH", idempotencyKey: `${run}-zrace-${attempt}`,
            }),
          ),
        ]);
        check(
          closeResult === "OK" || closeResult === "CASHIER_SHIFT_CLOSED",
          `attempt ${attempt}: close outcome (got ${closeResult})`,
        );

        const [row] = await sql`
          select status::text as status, z_report_snapshot is not null as has_z,
            (z_report_snapshot->>'grossCollected') as gross,
            (z_report_snapshot->>'expectedCash') as expected
          from cashier_shifts where id = ${shiftId}`;
        const [attached] = await sql`
          select count(*)::int as count from payments where cashier_shift_id = ${shiftId}`;

        if (row.status === "CLOSED") {
          check(row.has_z === true, `attempt ${attempt}: a closed shift always has its Z`);
          if (payResult === "OK") {
            check(
              String(row.gross) === "100.00" && Number(attached.count) === 1,
              `attempt ${attempt}: a committed payment is inside the Z (gross ${row.gross})`,
            );
            check(
              String(row.expected) === "100.00",
              `attempt ${attempt}: and inside the expectation (${row.expected})`,
            );
          } else {
            check(
              payResult === "CASHIER_SHIFT_REQUIRED",
              `attempt ${attempt}: a late payment is refused (got ${payResult})`,
            );
            check(
              String(row.gross) === "0.00" && Number(attached.count) === 0,
              `attempt ${attempt}: and is in neither the Z nor the shift`,
            );
          }
        }
        await forceClose(ids.otherCashier);
      }
    });

    test("close versus refund and close versus movement keep the Z honest", async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        // ---- refund race
        await forceClose(ids.otherCashier);
        const setup = await shifts.open(otherCashier(), {
          cashRegisterId: ids.registerB, openingCash: "0.00",
        });
        const orderId = await newOrder(100);
        const payment = await paymentsAt(new Date()).collect(otherCashier(), {
          orderId, method: "CASH", idempotencyKey: `${run}-zr-setup-${attempt}`,
        });
        await shifts.close(otherCashier(), { shiftId: setup.shift.id, countedCash: "100.00" });

        const refundShift = await shifts.open(otherCashier(), {
          cashRegisterId: ids.registerB, openingCash: "0.00",
        });
        const [, refundResult] = await Promise.all([
          code(() =>
            shifts.close(otherCashier(), {
              shiftId: refundShift.shift.id, countedCash: "0.00", note: `${PREFIX}race`,
            }),
          ),
          code(() =>
            paymentsAt(new Date()).refund(otherCashier(), {
              paymentId: payment.paymentId, amount: "10.00", reasonCode: "OTHER",
              idempotencyKey: `${run}-zr-race-${attempt}`,
            }),
          ),
        ]);
        const [refundRow] = await sql`
          select (z_report_snapshot->>'totalRefunds') as refunds,
            (z_report_snapshot->>'expectedCash') as expected
          from cashier_shifts where id = ${refundShift.shift.id}`;
        check(
          refundResult === "OK"
            ? String(refundRow.refunds) === "10.00" && String(refundRow.expected) === "-10.00"
            : String(refundRow.refunds) === "0.00",
          `attempt ${attempt}: refund race Z agrees with the outcome (${refundResult}, ${refundRow.refunds})`,
        );

        // ---- movement race
        await forceClose(ids.otherCashier);
        const movementShift = await shifts.open(otherCashier(), {
          cashRegisterId: ids.registerB, openingCash: "100.00",
        });
        const [, movementResult] = await Promise.all([
          code(() =>
            shifts.close(otherCashier(), {
              shiftId: movementShift.shift.id, countedCash: "100.00", note: `${PREFIX}race`,
            }),
          ),
          code(() =>
            shifts.recordMovement(otherCashier(), {
              shiftId: movementShift.shift.id, type: "CASH_OUT", amount: "25.00",
              reason: `${PREFIX}race`,
              idempotencyKey: `${run}-movement-race-${attempt}`,
            }),
          ),
        ]);
        const [movementRow] = await sql`
          select (z_report_snapshot->>'cashOut') as cash_out,
            (z_report_snapshot->>'expectedCash') as expected
          from cashier_shifts where id = ${movementShift.shift.id}`;
        check(
          movementResult === "OK"
            ? String(movementRow.cash_out) === "25.00" && String(movementRow.expected) === "75.00"
            : String(movementRow.cash_out) === "0.00" && String(movementRow.expected) === "100.00",
          `attempt ${attempt}: movement race Z agrees (${movementResult}, out ${movementRow.cash_out})`,
        );
        await forceClose(ids.otherCashier);
      }
    });

    test("two parallel closes produce exactly one Z report", async () => {
      await forceClose(ids.otherCashier);
      const opened = await shifts.open(otherCashier(), {
        cashRegisterId: ids.registerB, openingCash: "250.00",
      });
      const counts = ["250.00", "999.00"] as const;
      const results = await Promise.all(
        counts.map((countedCash) =>
          code(() =>
            shifts.close(otherCashier(), {
              shiftId: opened.shift.id, countedCash, note: `${PREFIX}race`,
            }),
          ),
        ),
      );
      const winners = results
        .map((result, index) => (result === "OK" ? index : -1))
        .filter((index) => index >= 0);
      check(winners.length === 1, `exactly one close won (got ${results.join(", ")})`);

      const report = await reports.zReport(otherCashier(), opened.shift.id);
      check(
        report.countedCash === counts[winners[0]!],
        `the single Z carries the winner's count (got ${report.countedCash})`,
      );
      const [row] = await sql`
        select z_report_version, jsonb_typeof(z_report_snapshot) as kind
        from cashier_shifts where id = ${opened.shift.id}`;
      check(
        Number(row.z_report_version) === 1 && row.kind === "object",
        "one snapshot object, not an array of attempts",
      );
      await forceClose(ids.otherCashier);
    });

    // ----------------------------------------------------------- daily report
    test("the day is a local calendar day, and a shift across midnight splits", async () => {
      // One drawer opened at 23:00 on day one and closed at 02:00 on day two,
      // taking money on both sides of local midnight.
      await forceClose(ids.cashier);
      const opened = await shiftsAt(localTime(DAY_ONE, 23)).open(cashier(), {
        cashRegisterId: ids.registerA, openingCash: "0.00",
      });
      const shiftId = opened.shift.id;

      const nightOrder = await newOrder(300);
      await paymentsAt(localTime(DAY_ONE, 23, 30)).collect(cashier(), {
        orderId: nightOrder, method: "CASH", idempotencyKey: `${run}-night`,
      });
      const dawnOrder = await newOrder(500);
      await paymentsAt(localTime(DAY_TWO, 1)).collect(cashier(), {
        orderId: dawnOrder, method: "CARD", idempotencyKey: `${run}-dawn`,
      });

      const dayOne = await reports.dailyReport(manager(), { date: DAY_ONE });
      const dayTwo = await reports.dailyReport(manager(), { date: DAY_TWO });

      check(
        dayOne.grossCollected === "300.00",
        `23:30 belongs to day one (got ${dayOne.grossCollected})`,
      );
      check(
        dayTwo.grossCollected === "500.00",
        `01:00 belongs to day two (got ${dayTwo.grossCollected})`,
      );
      check(
        dayOne.cashPaymentTotal === "300.00" && dayTwo.cashPaymentTotal === "0.00",
        `the cash half lands on day one only (got ${dayOne.cashPaymentTotal} / ${dayTwo.cashPaymentTotal})`,
      );
      check(dayOne.timezoneOffsetMinutes === 180, "reported in the restaurant's timezone");

      // The shift itself appears on both days; it opened on one and is still
      // running through the other.
      check(
        dayOne.shifts.some((shift) => shift.id === shiftId),
        "the shift is listed on the day it opened",
      );
      check(
        dayTwo.shifts.some((shift) => shift.id === shiftId),
        "and on the day it ran into",
      );
      check(dayOne.openedShiftCount === 1, `opened on day one (got ${dayOne.openedShiftCount})`);
      check(dayTwo.openedShiftCount === 0, `not opened on day two (got ${dayTwo.openedShiftCount})`);
      check(dayOne.openShiftCount === 1 && dayTwo.openShiftCount === 1, "still open on both");
      check(
        dayOne.warnings.some((warning) => warning.includes("açık kasa vardiyası")),
        `an open drawer is flagged neutrally (got ${JSON.stringify(dayOne.warnings)})`,
      );

      // Closing it on day two puts the Z on day two, while the money stays split.
      await shiftsAt(localTime(DAY_TWO, 2)).close(cashier(), {
        shiftId, countedCash: "300.00",
      });
      const dayOneAfter = await reports.dailyReport(manager(), { date: DAY_ONE });
      const dayTwoAfter = await reports.dailyReport(manager(), { date: DAY_TWO });
      check(
        dayOneAfter.grossCollected === "300.00" && dayTwoAfter.grossCollected === "500.00",
        "closing does not move the takings between days",
      );
      check(
        dayOneAfter.closedShiftCount === 0 && dayTwoAfter.closedShiftCount === 1,
        "the close belongs to day two",
      );
      check(
        dayTwoAfter.zReportCount === 1 && dayOneAfter.zReportCount === 0,
        "and so does its Z report",
      );
      check(dayTwoAfter.openShiftCount === 0, "no open drawer remains");
    });

    test("a multi-shift, multi-register day reconciles to its parts", async () => {
      const DAY = "2026-03-12";
      await forceClose(ids.cashier);
      await forceClose(ids.otherCashier);

      // Two cashiers, two registers, three shifts across one local day.
      const first = await shiftsAt(localTime(DAY, 8)).open(cashier(), {
        cashRegisterId: ids.registerA, openingCash: "100.00",
      });
      const orderA = await newOrder(400);
      const paymentA = await paymentsAt(localTime(DAY, 9)).collect(cashier(), {
        orderId: orderA, method: "CASH", idempotencyKey: `${run}-day-a`,
      });
      await shiftsAt(localTime(DAY, 10)).recordMovement(cashier(), {
        shiftId: first.shift.id, type: "CASH_OUT", amount: "30.00", reason: `${PREFIX}gider`,
        idempotencyKey: `${run}-day-movement-a`,
      });
      await shiftsAt(localTime(DAY, 12)).close(cashier(), {
        shiftId: first.shift.id, countedCash: "470.00",
      });

      const second = await shiftsAt(localTime(DAY, 12, 30)).open(cashier(), {
        cashRegisterId: ids.registerA, openingCash: "0.00",
      });
      const orderB = await newOrder(250);
      await paymentsAt(localTime(DAY, 13)).collect(cashier(), {
        orderId: orderB, method: "CARD", idempotencyKey: `${run}-day-b`,
      });
      await paymentsAt(localTime(DAY, 14)).refund(cashier(), {
        paymentId: paymentA.paymentId, amount: "50.00",
        reasonCode: "CUSTOMER_COMPLAINT", idempotencyKey: `${run}-day-refund`,
      });

      const third = await shiftsAt(localTime(DAY, 9)).open(otherCashier(), {
        cashRegisterId: ids.registerB, openingCash: "0.00",
      });
      const orderC = await newOrder(150);
      await paymentsAt(localTime(DAY, 11)).collect(otherCashier(), {
        orderId: orderC, method: "CASH", idempotencyKey: `${run}-day-c`,
      });
      await shiftsAt(localTime(DAY, 16)).close(otherCashier(), {
        shiftId: third.shift.id, countedCash: "140.00", note: `${PREFIX}on lira eksik`,
      });

      const daily = await reports.dailyReport(manager(), { date: DAY });

      check(daily.grossCollected === "800.00", `400 + 250 + 150 (got ${daily.grossCollected})`);
      check(daily.totalRefunds === "50.00", `refunds (got ${daily.totalRefunds})`);
      check(daily.netCollected === "750.00", `net (got ${daily.netCollected})`);
      check(
        sumBreakdown(daily.paymentMethodBreakdown) === daily.grossCollected,
        "the method breakdown reconciles to gross",
      );
      check(
        sumBreakdown(daily.refundMethodBreakdown) === daily.totalRefunds,
        "and the refund breakdown to refunds",
      );
      check(daily.cashPaymentTotal === "550.00", `cash taken (got ${daily.cashPaymentTotal})`);
      check(daily.cashRefundTotal === "50.00", `cash returned (got ${daily.cashRefundTotal})`);
      check(
        daily.cashOut === "30.00" && daily.cashIn === "0.00",
        `drawer movements (in ${daily.cashIn} / out ${daily.cashOut})`,
      );
      check(daily.openedShiftCount === 3, `three shifts opened (got ${daily.openedShiftCount})`);
      check(daily.closedShiftCount === 2, `two closed (got ${daily.closedShiftCount})`);
      check(daily.openShiftCount === 1, `one still open (got ${daily.openShiftCount})`);
      check(daily.zReportCount === 2, `two Z reports (got ${daily.zReportCount})`);
      check(
        daily.closedShiftVarianceTotal === "-10.00",
        `only the second drawer was short (got ${daily.closedShiftVarianceTotal})`,
      );

      // Register and cashier breakdowns must add back up to the whole.
      const registerGross = daily.registerBreakdown.map((row) => row.grossCollected);
      check(
        sumBreakdown(
          daily.registerBreakdown.map((row) => ({
            method: "CASH" as const, amount: row.grossCollected, count: 0,
          })),
        ) === daily.grossCollected,
        `registers reconcile to the restaurant (${registerGross.join(" + ")})`,
      );
      check(
        sumBreakdown(
          daily.cashierBreakdown.map((row) => ({
            method: "CASH" as const, amount: row.grossCollected, count: 0,
          })),
        ) === daily.grossCollected,
        "cashiers reconcile to the restaurant",
      );
      check(daily.registerBreakdown.length === 2, `both registers appear (got ${daily.registerBreakdown.length})`);
      check(daily.cashierBreakdown.length === 2, `both cashiers appear (got ${daily.cashierBreakdown.length})`);

      const barRegister = daily.registerBreakdown.find(
        (row) => row.id === ids.registerB,
      );
      check(barRegister?.grossCollected === "150.00", `bar register total (got ${barRegister?.grossCollected})`);
      check(barRegister?.totalRefunds === "0.00", "and no refunds against it");

      // A filter narrows the whole report, server-side.
      const filtered = await reports.dailyReport(manager(), {
        date: DAY, registerId: ids.registerB,
      });
      check(
        filtered.grossCollected === "150.00",
        `the register filter is applied in SQL (got ${filtered.grossCollected})`,
      );
      const byCashier = await reports.dailyReport(manager(), {
        date: DAY, cashierId: ids.otherCashier,
      });
      check(
        byCashier.grossCollected === "150.00",
        `the cashier filter is applied in SQL (got ${byCashier.grossCollected})`,
      );

      // Every drawer is settled before the quiet day is asked for: a shift left
      // open would still be open on any later date, and would rightly warn.
      await forceClose(ids.cashier);
      await forceClose(ids.otherCashier);

      // An unrelated day is empty rather than leaking neighbouring totals.
      const quiet = await reports.dailyReport(manager(), { date: "2026-03-20" });
      check(quiet.grossCollected === "0.00", `a quiet day is zero (got ${quiet.grossCollected})`);
      check(quiet.netCollected === "0.00", "and its net is zero, not an empty string");
      check(quiet.openedShiftCount === 0, "no drawer was opened on it");
      check(quiet.closedShiftCount === 0 && quiet.zReportCount === 0, "and none closed");
      check(quiet.openShiftCount === 0, "and none was left running");
      check(quiet.warnings.length === 0, "so it carries no warning");
      check(
        quiet.registerBreakdown.length === 0 && quiet.cashierBreakdown.length === 0,
        "and no register or cashier appears in it",
      );
      void second;
    });

    test("VOID and CANCEL are reported for the day, never blamed on a drawer", async () => {
      const DAY = "2026-03-13";
      const orderId = await newOrder(100);
      const [item] = await sql`
        select id from order_items where order_id = ${orderId} limit 1`;
      await sql`update order_items set voided_at = ${at(DAY, 15)}::timestamptz,
        voided_by = ${ids.manager}, void_reason_code = 'MANAGER_COMP', status = 'VOIDED'
        where id = ${String(item.id)}`;

      const daily = await reports.dailyReport(manager(), { date: DAY });
      const voided = daily.exceptions.find((row) => row.kind === "VOID");
      check(voided?.count === 1, `the void is counted (got ${voided?.count})`);
      check(voided?.amount === "100.00", `with its amount (got ${voided?.amount})`);
      check(
        daily.grossCollected === "0.00",
        "a void moves no cash, so collection is untouched",
      );
      check(
        !JSON.stringify(daily.registerBreakdown).includes("VOID"),
        "and it is never attributed to a register or drawer",
      );
    });

    // -------------------------------------------------------------- isolation
    test("another restaurant reaches none of this", async () => {
      const foreign = as("CASHIER", ids.foreignCashier, ids.foreignRestaurant);
      const foreignManager = as("MANAGER", ids.foreignCashier, ids.foreignRestaurant);
      const [mine] = await sql`
        select id from cashier_shifts where restaurant_id = ${ids.restaurant}
          and status = 'CLOSED' limit 1`;
      const shiftId = String(mine.id);

      check((await code(() => reports.xReport(foreign, shiftId))) === "NOT_FOUND", "X");
      check((await code(() => reports.zReport(foreign, shiftId))) === "NOT_FOUND", "Z");
      check(
        (await code(() => reports.zReport(foreignManager, shiftId))) === "NOT_FOUND",
        "even for their manager",
      );
      const theirDay = await reports.dailyReport(foreignManager, { date: "2026-03-12" });
      check(theirDay.grossCollected === "0.00", `no figures leak (got ${theirDay.grossCollected})`);
      check(theirDay.shifts.length === 0, "and no shifts");
      check(
        (await code(() => reports.zReport(manager(), randomUUID()))) === "NOT_FOUND",
        "a nonexistent shift answers identically",
      );
    });

    // -------------------------------------------------------------- retention
    test("maintenance never removes a Z report", async () => {
      const [before] = await sql`
        select count(*)::int as shifts,
          count(*) filter (where z_report_snapshot is not null)::int as with_z
        from cashier_shifts where restaurant_id = ${ids.restaurant}`;
      check(Number(before.with_z) > 0, "there are Z reports to protect");

      const result = await new DataMaintenanceService(db).run({ dryRun: false });
      check(result.errors.length === 0, `maintenance ran clean (${result.errors.join(", ")})`);

      const [after] = await sql`
        select count(*)::int as shifts,
          count(*) filter (where z_report_snapshot is not null)::int as with_z
        from cashier_shifts where restaurant_id = ${ids.restaurant}`;
      assert.deepEqual(after, before, "shift and Z counts are untouched by retention");
      assertions += 1;
    });

    test("the database refuses a Z report on an open shift, or a half-written one", async () => {
      await forceClose(ids.cashier);
      const opened = await shifts.open(cashier(), {
        cashRegisterId: ids.registerA, openingCash: "0.00",
      });
      // The consistency check constraint, not application code.
      const onOpen = await sql`
        update cashier_shifts set z_report_snapshot = '{}'::jsonb, z_report_version = 1,
          z_report_generated_at = now() where id = ${opened.shift.id}`.catch(
        (error: Error) => error.message,
      );
      check(typeof onOpen === "string", "an open shift cannot hold a Z report");

      const [closedRow] = await sql`
        select id from cashier_shifts where restaurant_id = ${ids.restaurant}
          and z_report_snapshot is not null limit 1`;
      const halfWritten = await sql`
        update cashier_shifts set z_report_version = null where id = ${String(closedRow.id)}`.catch(
        (error: Error) => error.message,
      );
      check(typeof halfWritten === "string", "the three snapshot columns move together");
      await forceClose(ids.cashier);
    });
  });
}
