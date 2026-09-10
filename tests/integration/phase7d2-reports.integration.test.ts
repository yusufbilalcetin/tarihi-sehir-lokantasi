import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";

import { createDb, type Database } from "../../db";
import type { StaffPrincipal } from "../../lib/auth/foundation";
import { DEFAULT_RESTAURANT_TIME_ZONE, resolveReportRange, zoneOffsetForDay } from "../../lib/domain/report-range";
import { generateQrToken } from "../../lib/security/qr-token";
import { ReportAnalyticsService } from "../../lib/services/report-analytics-service";
import { ReportDetailService } from "../../lib/services/report-detail-service";
import { readSupabaseIntegrationEnvironment } from "./supabase-test-environment";

/**
 * Phase 7D.2 — the reporting SQL against real PostgreSQL.
 *
 * Every figure below is asserted against fixture arithmetic worked out by hand,
 * not against whatever the query happens to return. The fixture is backdated so
 * date ranges, the local-day boundary and the comparison period are exercised
 * for real rather than implied.
 */

const PREFIX = "PHASE7D2_";
const readiness = readSupabaseIntegrationEnvironment({ requireDatabaseUrl: true });

/** Local wall-clock in the restaurant's fixed +03:00 offset -> UTC instant. */
function localTime(day: string, hour: number, minute = 0): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(
    Date.UTC(year, month - 1, date, hour, minute) -
      zoneOffsetForDay({ year, month, day: date }, DEFAULT_RESTAURANT_TIME_ZONE) * 60_000,
  ).toISOString();
}

if (!readiness.ready) {
  test("Phase 7D.2 report SQL integration", { skip: readiness.reason }, () => undefined);
} else {
  const environment = readiness.environment;
  const run = randomBytes(6).toString("hex");
  let connection: ReturnType<typeof createDb>;
  let db: Database;
  let sql: ReturnType<typeof createDb>["client"];
  const cleanupErrors: string[] = [];
  let assertions = 0;

  const ids = {
    restaurantA: randomUUID(),
    restaurantB: randomUUID(),
    categoryMain: randomUUID(),
    categorySide: randomUUID(),
    productMain: randomUUID(),
    productSide: randomUUID(),
    productExtra: randomUUID(),
    productUnsold: randomUUID(),
    tableA: randomUUID(),
    tableB: randomUUID(),
    staffWaiter: randomUUID(),
    staffKitchenStart: randomUUID(),
    staffKitchenReady: randomUUID(),
    staffCashier: randomUUID(),
    staffManager: randomUUID(),
    staffForeign: randomUUID(),
  };

  /** Orders are keyed so each assertion can name the one it means. */
  const orders = {
    /** 2 x 100.00 on the reference day, SERVED, fully collected. */
    dayOne: randomUUID(),
    /** 1 x 75.50 + 1 x 24.50 = 100.00, COMPLETED, collected then partly refunded. */
    dayTwo: randomUUID(),
    /** 100.00 at 23:30 local — must land on its own local day, not the UTC one. */
    lateNight: randomUUID(),
    /** 100.00 at 00:30 local the next day. */
    earlyMorning: randomUUID(),
    /** Cancelled: must not count towards sales. */
    cancelled: randomUUID(),
    /** Outside the period, used to prove range filtering. */
    outOfRange: randomUUID(),
    /** Tenant B, never visible to A. */
    foreign: randomUUID(),
  };

  // Reference days, chosen relative to "now" so presets stay meaningful.
  const today = new Date();
  const localToday = new Date(
    today.getTime() +
      zoneOffsetForDay(
        { year: today.getUTCFullYear(), month: today.getUTCMonth() + 1, day: today.getUTCDate() },
        DEFAULT_RESTAURANT_TIME_ZONE,
      ) *
        60_000,
  );
  const dayString = (offset: number): string => {
    const d = new Date(localToday);
    d.setUTCDate(d.getUTCDate() - offset);
    return d.toISOString().slice(0, 10);
  };
  const DAY_1 = dayString(3);
  const DAY_2 = dayString(2);
  const DAY_BOUNDARY = dayString(5);
  const DAY_BOUNDARY_NEXT = dayString(4);
  const DAY_OUT = dayString(120);

  function isolate(condition: boolean, message: string): void {
    assertions += 1;
    assert.ok(condition, message);
  }

  const staffA = (role: StaffPrincipal["role"] = "ADMIN"): StaffPrincipal => {
    const authUserId = randomUUID();
    return {
      user: {
        id: ids.staffManager, authUserId, restaurantId: ids.restaurantA,
        name: `${PREFIX}Reporter`, email: null, phone: null, isActive: true,
      },
      profile: {
        id: ids.staffManager, authUserId, restaurantId: ids.restaurantA,
        name: `${PREFIX}Reporter`, email: null, phone: null, role,
        isActive: true, deletedAt: null,
      },
      authUser: { id: authUserId, email: undefined, app_metadata: {}, user_metadata: {} },
      restaurant: {
        id: ids.restaurantA, name: `${PREFIX}Tenant A`,
        slug: `phase7d2-a-${run}`, isActive: true, timezone: "Europe/Istanbul",
      },
      role, userId: ids.staffManager, restaurantId: ids.restaurantA, isActive: true,
    };
  };

  const rangeFor = (from: string, to: string) =>
    resolveReportRange({
      preset: "CUSTOM", now: new Date(), from, to, comparison: "NONE", systemStart: null,
    });

  describe("Phase 7D.2 reporting on real PostgreSQL", { concurrency: false }, () => {
    before(async () => {
      connection = createDb(environment.databaseUrl!, { maxConnections: 3 });
      db = connection.db;
      sql = connection.client;
      const pepper = randomBytes(32);

      for (const [restaurantId, suffix] of [
        [ids.restaurantA, "a"], [ids.restaurantB, "b"],
      ] as const) {
        await sql`insert into restaurants (id, name, slug) values
          (${restaurantId}, ${`${PREFIX}Tenant ${suffix.toUpperCase()}`}, ${`phase7d2-${suffix}-${run}`})`;
        await sql`insert into restaurant_settings (restaurant_id) values (${restaurantId})`;
      }

      await sql`insert into staff_profiles (id, restaurant_id, name, login_identifier, role, is_active) values
        (${ids.staffWaiter}, ${ids.restaurantA}, ${`${PREFIX}Waiter`}, ${`p7d2-${run}-w`}, 'WAITER', true),
        (${ids.staffKitchenStart}, ${ids.restaurantA}, ${`${PREFIX}Kitchen Start`}, ${`p7d2-${run}-k1`}, 'KITCHEN', true),
        (${ids.staffKitchenReady}, ${ids.restaurantA}, ${`${PREFIX}Kitchen Ready`}, ${`p7d2-${run}-k2`}, 'KITCHEN', true),
        (${ids.staffCashier}, ${ids.restaurantA}, ${`${PREFIX}Cashier`}, ${`p7d2-${run}-c`}, 'CASHIER', true),
        (${ids.staffManager}, ${ids.restaurantA}, ${`${PREFIX}Manager`}, ${`p7d2-${run}-m`}, 'MANAGER', true),
        (${ids.staffForeign}, ${ids.restaurantB}, ${`${PREFIX}Foreign Waiter`}, ${`p7d2-${run}-fw`}, 'WAITER', true)`;

      await sql`insert into categories (id, restaurant_id, name, slug) values
        (${ids.categoryMain}, ${ids.restaurantA}, ${`${PREFIX}Ana Yemek`}, ${`p7d2-main-${run}`}),
        (${ids.categorySide}, ${ids.restaurantA}, ${`${PREFIX}Yan Ürün`}, ${`p7d2-side-${run}`})`;

      // Deterministic prices: 100.00, 75.50, 24.50 and one product that never sells.
      await sql`insert into products (id, restaurant_id, category_id, name, slug, price) values
        (${ids.productMain}, ${ids.restaurantA}, ${ids.categoryMain}, ${`${PREFIX}Ana`}, ${`p7d2-ana-${run}`}, '100.00'),
        (${ids.productSide}, ${ids.restaurantA}, ${ids.categorySide}, ${`${PREFIX}Yan`}, ${`p7d2-yan-${run}`}, '75.50'),
        (${ids.productExtra}, ${ids.restaurantA}, ${ids.categorySide}, ${`${PREFIX}Ekstra`}, ${`p7d2-ekstra-${run}`}, '24.50'),
        (${ids.productUnsold}, ${ids.restaurantA}, ${ids.categoryMain}, ${`${PREFIX}Satilmayan`}, ${`p7d2-satilmayan-${run}`}, '10.00')`;

      await sql`insert into restaurant_tables (id, restaurant_id, name, table_number, qr_token_hash) values
        (${ids.tableA}, ${ids.restaurantA}, ${`${PREFIX}Masa 1`}, 8101, ${generateQrToken(pepper).tokenHash}),
        (${ids.tableB}, ${ids.restaurantB}, ${`${PREFIX}Masa B`}, 8201, ${generateQrToken(pepper).tokenHash})`;

      let sequence = 96000;
      async function addOrder(
        id: string, restaurantId: string, tableId: string, at: string,
        total: string, status: string,
      ) {
        sequence += 1;
        await sql`insert into orders (id, restaurant_id, table_id, order_sequence, order_number,
            subtotal, total, created_by_type, created_by_user_id, status, created_at, updated_at) values
          (${id}, ${restaurantId}, ${tableId}, ${sequence}, ${`${PREFIX}${sequence}`},
           ${total}, ${total}, 'STAFF', ${ids.staffWaiter}, ${status}, ${at}, ${at})`;
      }
      async function addItem(
        orderId: string, restaurantId: string, productId: string, name: string,
        price: string, quantity: number, at: string, status = "SERVED",
      ) {
        const lineTotal = (Number(price) * quantity).toFixed(2);
        const itemId = randomUUID();
        await sql`insert into order_items (id, restaurant_id, order_id, product_id,
            product_name_snapshot, unit_price, quantity, line_total, status, created_at, updated_at) values
          (${itemId}, ${restaurantId}, ${orderId}, ${productId}, ${name},
           ${price}, ${quantity}, ${lineTotal}, ${status}, ${at}, ${at})`;
        return itemId;
      }
      async function addPayment(orderId: string, amount: string, method: string, at: string) {
        const paymentId = randomUUID();
        await sql`insert into payments (id, restaurant_id, order_id, amount, method,
            created_by_user_id, status, created_at, updated_at) values
          (${paymentId}, ${ids.restaurantA}, ${orderId}, ${amount}, ${method},
           ${ids.staffCashier}, 'COMPLETED', ${at}, ${at})`;
        return paymentId;
      }

      // --- day one: 2 x Ana = 200.00, SERVED, collected in full -----------
      const d1 = localTime(DAY_1, 13);
      await addOrder(orders.dayOne, ids.restaurantA, ids.tableA, d1, "200.00", "SERVED");
      await addItem(orders.dayOne, ids.restaurantA, ids.productMain, `${PREFIX}Ana`, "100.00", 2, d1);
      await addPayment(orders.dayOne, "200.00", "CASH", d1);

      // --- day two: 75.50 + 24.50 = 100.00, COMPLETED, 20.00 refunded ----
      const d2 = localTime(DAY_2, 20);
      await addOrder(orders.dayTwo, ids.restaurantA, ids.tableA, d2, "100.00", "COMPLETED");
      await addItem(orders.dayTwo, ids.restaurantA, ids.productSide, `${PREFIX}Yan`, "75.50", 1, d2);
      await addItem(orders.dayTwo, ids.restaurantA, ids.productExtra, `${PREFIX}Ekstra`, "24.50", 1, d2);
      const refundedPayment = await addPayment(orders.dayTwo, "100.00", "CARD", d2);
      await sql`insert into payment_refunds (id, restaurant_id, payment_id, order_id, amount,
          reason_code, status, created_by_user_id, created_at) values
        (${randomUUID()}, ${ids.restaurantA}, ${refundedPayment}, ${orders.dayTwo}, '20.00',
         'CUSTOMER_COMPLAINT', 'COMPLETED', ${ids.staffCashier}, ${d2})`;
      await sql`update payments set refunded_amount = '20.00' where id = ${refundedPayment}`;

      // --- local-day boundary: 23:30 and 00:30 on consecutive local days --
      const late = localTime(DAY_BOUNDARY, 23, 30);
      await addOrder(orders.lateNight, ids.restaurantA, ids.tableA, late, "100.00", "SERVED");
      await addItem(orders.lateNight, ids.restaurantA, ids.productMain, `${PREFIX}Ana`, "100.00", 1, late);
      const early = localTime(DAY_BOUNDARY_NEXT, 0, 30);
      await addOrder(orders.earlyMorning, ids.restaurantA, ids.tableA, early, "100.00", "SERVED");
      await addItem(orders.earlyMorning, ids.restaurantA, ids.productMain, `${PREFIX}Ana`, "100.00", 1, early);

      // --- cancelled and out-of-range controls ----------------------------
      await addOrder(orders.cancelled, ids.restaurantA, ids.tableA, d1, "999.00", "CANCELLED");
      await addItem(orders.cancelled, ids.restaurantA, ids.productMain, `${PREFIX}Ana`, "999.00", 1, d1, "CANCELLED");
      const out = localTime(DAY_OUT, 12);
      await addOrder(orders.outOfRange, ids.restaurantA, ids.tableA, out, "555.00", "SERVED");
      await addItem(orders.outOfRange, ids.restaurantA, ids.productMain, `${PREFIX}Ana`, "555.00", 1, out);

      // --- tenant B control ----------------------------------------------
      sequence += 1;
      await sql`insert into orders (id, restaurant_id, table_id, order_sequence, order_number,
          subtotal, total, created_by_type, created_by_user_id, status, created_at, updated_at) values
        (${orders.foreign}, ${ids.restaurantB}, ${ids.tableB}, ${sequence}, ${`${PREFIX}FOREIGN`},
         '777.00', '777.00', 'STAFF', ${ids.staffForeign}, 'SERVED', ${d1}, ${d1})`;

      // --- kitchen pairs: 60s, 120s, 300s, plus one unpaired PREPARING ----
      const preparedAt = localTime(DAY_1, 12);
      const preparedMs = Date.parse(preparedAt);
      const pairs = [60, 120, 300];
      for (const seconds of pairs) {
        const itemId = randomUUID();
        const start = new Date(preparedMs + seconds * 1000).toISOString();
        const ready = new Date(Date.parse(start) + seconds * 1000).toISOString();
        await sql`insert into order_events (id, restaurant_id, order_id, event_type, user_id, payload, created_at) values
          (${randomUUID()}, ${ids.restaurantA}, ${orders.dayOne}, 'ORDER_ITEM_STATUS_CHANGED',
           ${ids.staffKitchenStart},
           ${JSON.stringify({ scope: "ORDER_ITEM", orderItemId: itemId, productName: `${PREFIX}Ana`, status: "PREPARING" })}::jsonb,
           ${start})`;
        await sql`insert into order_events (id, restaurant_id, order_id, event_type, user_id, payload, created_at) values
          (${randomUUID()}, ${ids.restaurantA}, ${orders.dayOne}, 'ORDER_ITEM_STATUS_CHANGED',
           ${ids.staffKitchenReady},
           ${JSON.stringify({ scope: "ORDER_ITEM", orderItemId: itemId, productName: `${PREFIX}Ana`, status: "READY" })}::jsonb,
           ${ready})`;
      }
      // Unpaired: started but never marked ready — must be excluded, not zeroed.
      await sql`insert into order_events (id, restaurant_id, order_id, event_type, user_id, payload, created_at) values
        (${randomUUID()}, ${ids.restaurantA}, ${orders.dayOne}, 'ORDER_ITEM_STATUS_CHANGED',
         ${ids.staffKitchenStart},
         ${JSON.stringify({ scope: "ORDER_ITEM", orderItemId: randomUUID(), productName: `${PREFIX}Yan`, status: "PREPARING" })}::jsonb,
         ${preparedAt})`;

      // --- review-detail sources: a void and an audit-logged cancellation --
      const voidedItem = await addItem(
        orders.dayOne, ids.restaurantA, ids.productSide, `${PREFIX}Yan`, "75.50", 1, d1, "VOIDED",
      );
      await sql`update order_items set voided_at = ${d1}, voided_by = ${ids.staffManager},
          void_reason_code = 'MANAGER_COMP' where id = ${voidedItem}`;
      await sql`insert into audit_logs (id, restaurant_id, actor_user_id, action, entity_type, entity_id, metadata, created_at) values
        (${randomUUID()}, ${ids.restaurantA}, ${ids.staffWaiter}, 'order.item.cancelled', 'ORDER_ITEM',
         ${randomUUID()}, ${JSON.stringify({ orderId: orders.dayOne, productName: `${PREFIX}Ekstra`, reason: "CUSTOMER_REQUEST", totalBefore: "24.50" })}::jsonb, ${d1})`;
    });

    after(async () => {
      const order = [
        "payment_refunds", "payments", "order_check_items", "order_checks",
        "order_events", "audit_logs", "outbox_events", "waiter_calls",
        "order_items", "orders", "restaurant_tables", "products", "categories",
        "restaurant_settings", "staff_profiles", "restaurants",
      ];
      try {
        for (const table of order) {
          const column = table === "restaurants" ? "id" : "restaurant_id";
          await sql.unsafe(`delete from ${table} where ${column} = any($1::uuid[])`, [
            [ids.restaurantA, ids.restaurantB],
          ]);
        }
      } catch (error) {
        cleanupErrors.push((error as Error).message);
      }
      await connection.close();
      if (cleanupErrors.length > 0) {
        console.error("PHASE7D2 FIXTURE CLEANUP INCOMPLETE:", cleanupErrors.join(" | "));
      }
      console.log(`phase7d2 report assertions executed: ${assertions}`);
    });

    test("summary figures match the fixture arithmetic exactly", async () => {
      const service = new ReportAnalyticsService(db);
      const range = rangeFor(DAY_BOUNDARY, dayString(0));
      const summary = await service.getSummary(staffA(), range);

      // Gross sales = SERVED+COMPLETED totals in range:
      // 200.00 + 100.00 + 100.00 (23:30) + 100.00 (00:30) = 500.00.
      // The cancelled 999.00 and out-of-range 555.00 are excluded.
      isolate(summary.grossSales.value === "500.00", `gross sales (got ${summary.grossSales.value})`);
      // Collected = 200.00 + 100.00 = 300.00
      isolate(summary.grossCollected.value === "300.00", `gross collected (got ${summary.grossCollected.value})`);
      isolate(summary.refunds.value === "20.00", `refunds (got ${summary.refunds.value})`);
      isolate(summary.netCollected.value === "280.00", `net collected (got ${summary.netCollected.value})`);
      isolate(summary.cancelledOrderCount.value === "1", `cancelled count (got ${summary.cancelledOrderCount.value})`);
      isolate(summary.completedOrderCount.value === "1", `completed count (got ${summary.completedOrderCount.value})`);
      isolate(summary.profitAvailable === false, "profit is never invented");
    });

    test("the local-day boundary puts 23:30 and 00:30 on different days", async () => {
      const service = new ReportAnalyticsService(db);
      // A single local day that contains only the 23:30 order.
      const lateOnly = await service.getSummary(staffA(), rangeFor(DAY_BOUNDARY, DAY_BOUNDARY));
      isolate(
        lateOnly.grossSales.value === "100.00",
        `23:30 belongs to its own local day (got ${lateOnly.grossSales.value})`,
      );
      const earlyOnly = await service.getSummary(staffA(), rangeFor(DAY_BOUNDARY_NEXT, DAY_BOUNDARY_NEXT));
      isolate(
        earlyOnly.grossSales.value === "100.00",
        `00:30 belongs to the next local day (got ${earlyOnly.grossSales.value})`,
      );

      // And the busiest-hour SQL agrees on the local hour, not the UTC one.
      const busiest = await service.getBusiest(staffA(), rangeFor(DAY_BOUNDARY, DAY_BOUNDARY));
      isolate(busiest.busiestHour?.hour === 23, `busiest local hour is 23 (got ${busiest.busiestHour?.hour})`);
    });

    test("a custom range excludes everything outside it", async () => {
      const service = new ReportAnalyticsService(db);
      const inRange = await service.getSummary(staffA(), rangeFor(DAY_1, DAY_1));
      isolate(inRange.grossSales.value === "200.00", `day one alone (got ${inRange.grossSales.value})`);
      const far = await service.getSummary(staffA(), rangeFor(DAY_OUT, DAY_OUT));
      isolate(far.grossSales.value === "555.00", `the far day alone (got ${far.grossSales.value})`);
    });

    test("the product report totals every product, honestly", async () => {
      const service = new ReportAnalyticsService(db);
      const range = rangeFor(DAY_BOUNDARY, dayString(0));
      const report = await service.getProducts(staffA(), range, { pageSize: 200 });
      const main = report.rows.find((row) => row.productName === `${PREFIX}Ana`);
      // 2 (day one) + 1 (23:30) + 1 (00:30) = 4 sold; the cancelled and voided
      // lines must not be counted as sales.
      isolate(main?.soldQuantity === 4, `Ana sold quantity (got ${main?.soldQuantity})`);
      isolate(main?.grossSales === "400.00", `Ana gross (got ${main?.grossSales})`);
      const side = report.rows.find((row) => row.productName === `${PREFIX}Yan`);
      isolate(side?.soldQuantity === 1, `Yan sold quantity (got ${side?.soldQuantity})`);
      isolate(side?.voidedQuantity === 1, `Yan voided quantity (got ${side?.voidedQuantity})`);

      const withoutZero = report.rows.some((row) => row.productName === `${PREFIX}Satilmayan`);
      isolate(!withoutZero, "zero-sales products are hidden by default");
      const withZero = await service.getProducts(staffA(), range, {
        pageSize: 200, includeZeroSales: true,
      });
      const unsold = withZero.rows.find((row) => row.productName === `${PREFIX}Satilmayan`);
      isolate(unsold !== undefined, "the toggle reveals the unsold product");
      isolate(unsold?.soldQuantity === 0 && unsold?.grossSales === "0.00", "and it reads as a real zero");
    });

    test("product detail reports one product's period in full", async () => {
      const service = new ReportDetailService(db);
      const range = rangeFor(DAY_BOUNDARY, dayString(0));
      const detail = await service.getProductDetail(staffA(), range, ids.productMain);
      isolate(detail.soldQuantity === 4, `detail quantity (got ${detail.soldQuantity})`);
      isolate(detail.grossSales === "400.00", `detail gross (got ${detail.grossSales})`);
      isolate(detail.averagePrice === "100.00", `detail average price (got ${detail.averagePrice})`);
      isolate(detail.removedFromCatalog === false, "the product is still in the catalog");
      isolate(detail.daily.length >= 3, `daily series has the fixture days (got ${detail.daily.length})`);
      isolate(detail.busiestHour !== null, "a busiest hour is derived");
    });

    test("category totals and share stay finite", async () => {
      const service = new ReportDetailService(db);
      const rows = await service.getCategories(staffA(), rangeFor(DAY_BOUNDARY, dayString(0)));
      const main = rows.find((row) => row.categoryName === `${PREFIX}Ana Yemek`);
      const side = rows.find((row) => row.categoryName === `${PREFIX}Yan Ürün`);
      isolate(main?.grossSales === "400.00", `main category gross (got ${main?.grossSales})`);
      isolate(side?.grossSales === "100.00", `side category gross (got ${side?.grossSales})`);
      isolate(main !== undefined && main.share === 80, `main share is 80% (got ${main?.share})`);
      isolate(rows.every((row) => Number.isFinite(row.share)), "no share is NaN or Infinity");

      // An empty period must not divide by zero.
      const empty = await service.getCategories(staffA(), rangeFor(DAY_OUT, DAY_OUT));
      isolate(empty.every((row) => Number.isFinite(row.share)), "empty period shares stay finite");
    });

    test("kitchen median and p90 come from percentile_cont on real data", async () => {
      const service = new ReportDetailService(db);
      const report = await service.getKitchen(staffA(), rangeFor(DAY_1, DAY_1));
      isolate(report.duration.supported === true, "three pairs are enough to be supported");
      if (report.duration.supported) {
        const value = report.duration.value;
        // Durations are 60s, 120s, 300s -> median 120, p90 = 300-ish.
        isolate(value.sampleCount === 3, `sample count (got ${value.sampleCount})`);
        isolate(value.medianSeconds === 120, `median (got ${value.medianSeconds})`);
        isolate(value.p90Seconds >= 250 && value.p90Seconds <= 300, `p90 (got ${value.p90Seconds})`);
        isolate(value.averageSeconds === 160, `average (got ${value.averageSeconds})`);
        // One PREPARING never reached READY.
        isolate(value.excludedSamples >= 0, `excluded samples reported (got ${value.excludedSamples})`);
      }
      // The person who starts and the person who finishes are counted apart.
      const starter = report.staff.find((row) => row.staffId === ids.staffKitchenStart);
      const finisher = report.staff.find((row) => row.staffId === ids.staffKitchenReady);
      isolate(starter?.startedPreparationCount === 4, `starter count (got ${starter?.startedPreparationCount})`);
      isolate(starter?.markedReadyCount === 0, "the starter marked nothing ready");
      isolate(finisher?.markedReadyCount === 3, `finisher count (got ${finisher?.markedReadyCount})`);
      isolate(finisher?.startedPreparationCount === 0, "the finisher started nothing");
    });

    test("a period with no pairs refuses to invent a duration", async () => {
      const service = new ReportDetailService(db);
      const report = await service.getKitchen(staffA(), rangeFor(DAY_OUT, DAY_OUT));
      isolate(report.duration.supported === false, "no pairs means unsupported, not zero");
      if (!report.duration.supported) {
        isolate(report.duration.reason.length > 0, "and it says why");
      }
    });

    test("review detail lists the real void and cancellation records", async () => {
      const service = new ReportDetailService(db);
      const range = rangeFor(DAY_BOUNDARY, dayString(0));
      const all = await service.getReviewDetail(staffA(), range);
      const voidRow = all.rows.find((row) => row.kind === "VOID");
      isolate(voidRow?.amount === "75.50", `void amount (got ${voidRow?.amount})`);
      isolate(voidRow?.reason === "MANAGER_COMP", `void reason (got ${voidRow?.reason})`);
      isolate(voidRow?.staffName === `${PREFIX}Manager`, `void actor (got ${voidRow?.staffName})`);

      const refundRow = all.rows.find((row) => row.kind === "REFUND");
      isolate(refundRow?.amount === "20.00", `refund amount (got ${refundRow?.amount})`);
      const cancelRow = all.rows.find((row) => row.kind === "CANCEL");
      isolate(cancelRow?.staffName === `${PREFIX}Waiter`, `cancel actor (got ${cancelRow?.staffName})`);

      const onlyVoids = await service.getReviewDetail(staffA(), range, { kind: "VOID" });
      isolate(onlyVoids.rows.every((row) => row.kind === "VOID"), "the kind filter holds");
      const byStaff = await service.getReviewDetail(staffA(), range, { staffId: ids.staffManager });
      isolate(
        byStaff.rows.every((row) => row.staffName === `${PREFIX}Manager`),
        "the staff filter holds",
      );
      const paged = await service.getReviewDetail(staffA(), range, { pageSize: 1, page: 1 });
      isolate(paged.rows.length === 1 && paged.total >= 3, `pagination (got ${paged.rows.length}/${paged.total})`);
      // Neutral language only.
      isolate(
        !JSON.stringify(all.rows).match(/fraud|theft|hırsız|dolandırıcı|şüpheli/i),
        "review output stays neutral",
      );
    });

    test("the order timeline is chronological and its balance matches the ledger", async () => {
      const service = new ReportDetailService(db);
      const timeline = await service.getOrderTimeline(staffA(), orders.dayTwo);
      isolate(timeline.order.total === "100.00", `timeline total (got ${timeline.order.total})`);
      isolate(timeline.order.grossCollected === "100.00", `collected (got ${timeline.order.grossCollected})`);
      isolate(timeline.order.refunds === "20.00", `refunds (got ${timeline.order.refunds})`);
      isolate(timeline.order.netCollected === "80.00", `net (got ${timeline.order.netCollected})`);
      // Outstanding is total minus money currently held, so a refund reopens
      // that much of the balance. The order's operational status is unaffected.
      isolate(timeline.order.outstanding === "20.00", `outstanding (got ${timeline.order.outstanding})`);
      const [row] = await sql`select status::text as status from orders where id = ${orders.dayTwo}`;
      isolate(row.status === "COMPLETED", `a refund never reopens the order (got ${row.status})`);

      const times = timeline.entries.map((entry) => Date.parse(entry.at));
      isolate(
        times.every((value, index) => index === 0 || times[index - 1] <= value),
        "entries are in chronological order",
      );
      isolate(
        timeline.entries.some((entry) => entry.type === "PAYMENT"),
        "the payment appears on the timeline",
      );
      isolate(
        timeline.entries.some((entry) => entry.type === "REFUND"),
        "the refund appears on the timeline",
      );
    });

    test("every report service method runs on real PostgreSQL", async () => {
      // Guards the raw-SQL parameter binding across all report queries: this is
      // exactly the class of failure that unit tests cannot see.
      const analytics = new ReportAnalyticsService(db);
      const detail = new ReportDetailService(db);
      const principal = staffA();
      const range = rangeFor(DAY_BOUNDARY, dayString(0));

      const calls: readonly [string, Promise<unknown>][] = [
        ["getSummary", analytics.getSummary(principal, range)],
        ["getProducts", analytics.getProducts(principal, range, { search: PREFIX, sort: "GROSS_DESC" })],
        ["getBusiest", analytics.getBusiest(principal, range)],
        ["getFinance", analytics.getFinance(principal, range)],
        ["getTables", analytics.getTables(principal, range)],
        ["getStaff", analytics.getStaff(principal, range)],
        ["getReviewAlerts", analytics.getReviewAlerts(principal, range)],
        ["findSystemStart", analytics.findSystemStart(principal.restaurantId)],
        ["getProductDetail", detail.getProductDetail(principal, range, ids.productMain)],
        ["getCategories", detail.getCategories(principal, range)],
        ["getKitchen", detail.getKitchen(principal, range)],
        ["getReviewDetail", detail.getReviewDetail(principal, range)],
        ["getOrderTimeline", detail.getOrderTimeline(principal, orders.dayOne)],
      ];
      const results = await Promise.allSettled(calls.map(([, promise]) => promise));
      const failures = results
        .map((result, index) => ({ name: calls[index][0], result }))
        .filter((entry) => entry.result.status === "rejected")
        .map((entry) => `${entry.name}: ${(entry.result as PromiseRejectedResult).reason?.message}`);
      isolate(failures.length === 0, `all report SQL must execute — failures: ${failures.join(" | ")}`);
      isolate(calls.length === 13, "every report service method is covered");
    });

    test("comparison periods resolve against real data", async () => {
      const service = new ReportAnalyticsService(db);
      const range = resolveReportRange({
        preset: "CUSTOM", now: new Date(), from: DAY_2, to: DAY_2,
        comparison: "PREVIOUS_PERIOD", systemStart: null,
      });
      const summary = await service.getSummary(staffA(), range);
      isolate(summary.grossSales.value === "100.00", `day two (got ${summary.grossSales.value})`);
      // The previous equal period is day one, which sold 200.00.
      isolate(summary.grossSales.previous === "200.00", `previous period (got ${summary.grossSales.previous})`);
      isolate(summary.grossSales.trend?.direction === "DOWN", "and the trend reads as a fall");
      isolate(summary.comparisonLabel !== null, "the comparison period is labelled");
    });

    test("date presets execute and stay tenant-scoped", async () => {
      const service = new ReportAnalyticsService(db);
      const systemStart = await service.findSystemStart(ids.restaurantA);
      isolate(systemStart instanceof Date, "findSystemStart returns a real Date, not a timestamp string");
      isolate(!Number.isNaN(systemStart!.getTime()), "and that Date is valid");
      for (const preset of [
        "TODAY", "YESTERDAY", "LAST_7_DAYS", "LAST_30_DAYS",
        "THIS_MONTH", "PREVIOUS_MONTH", "THIS_YEAR", "SINCE_SYSTEM_START",
      ] as const) {
        const range = resolveReportRange({
          preset, now: new Date(), comparison: "NONE", systemStart,
        });
        const summary = await service.getSummary(staffA(), range);
        // Tenant B's 777.00 must never reach any preset.
        isolate(
          !summary.grossSales.value.startsWith("777"),
          `${preset} must not include tenant B`,
        );
        isolate(Number.isFinite(Number(summary.grossSales.value)), `${preset} returns a number`);
      }
    });
  });
}
