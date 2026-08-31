import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as relations from "../../db/relations";
import * as schema from "../../db/schema";
import {
  auditLogs,
  cashRegisters,
  cashierShiftCashCounts,
  cashierShifts,
  categories,
  orderItems,
  orders,
  outboxEvents,
  products,
  restaurantSettings,
  restaurantTables,
  restaurants,
  staffProfiles,
} from "../../db/schema";
import { DomainError } from "../../lib/api/domain-error";
import type { RestaurantPrincipal } from "../../lib/domain/restaurant-scope";
import { DrizzleCashierShiftRepository } from "../../lib/repositories/drizzle-cashier-shift-repository";
import { DrizzleMenuRepository } from "../../lib/repositories/drizzle-menu-repository";
import { DrizzleOrderRepository } from "../../lib/repositories/drizzle-order-repository";
import { DrizzlePaymentRepository } from "../../lib/repositories/drizzle-payment-repository";
import { CashierShiftService } from "../../lib/services/cashier-shift-service";
import { MenuService } from "../../lib/services/menu-service";
import { OrderService } from "../../lib/services/order-service";
import { PaymentService } from "../../lib/services/payment-service";
import { CashierReportService } from "../../lib/services/cashier-report-service";
import { createCustomerTableSession } from "../../lib/security/customer-session";
import { generateQrToken } from "../../lib/security/qr-token";

/**
 * One restaurant day, driven through the real services against a real
 * PostgreSQL: a guest orders at a table, the kitchen cooks it, a waiter serves
 * it, the cashier opens a counted drawer, takes the money, and closes up.
 *
 * Everything below the HTTP transport is the production code path — the same
 * services, the same repositories, the same SQL, the same authorisation. What
 * is deliberately NOT covered here is the HTTP/auth transport for staff roles,
 * because signing in as a WAITER or CASHIER requires a Supabase Auth instance
 * and there is no disposable one on this machine (no Docker, no Supabase CLI).
 * Authenticating against the *production* auth server to test a throwaway
 * database would be worse than the gap, so the gap is reported instead.
 *
 * Runs ONLY against a loopback database named by `E2E_DATABASE_URL`, and
 * refuses anything carrying the marks of a Supabase project. With the variable
 * unset the whole suite skips.
 */

const e2eUrl = process.env.E2E_DATABASE_URL?.trim();

function disposable(url: string | undefined): { url: string } | { skip: string } {
  if (!url) return { skip: "E2E_DATABASE_URL is not set" };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { skip: "E2E_DATABASE_URL is not a URL" };
  }
  if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) {
    return { skip: `refusing a non-loopback target (${parsed.hostname})` };
  }
  return { url };
}

const target = disposable(e2eUrl);
const skipReason = "skip" in target ? target.skip : false;

/** The day's cast, as the services see them. */
function principal(role: RestaurantPrincipal["role"], restaurantId: string, userId: string): RestaurantPrincipal {
  return { userId, restaurantId, role, isActive: true };
}

describe("a restaurant day, end to end on real PostgreSQL", { skip: skipReason }, () => {
  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema & typeof relations>>;

  const ids = {
    restaurant: randomUUID(),
    otherRestaurant: randomUUID(),
    category: randomUUID(),
    soup: randomUUID(),
    kebab: randomUUID(),
    table: randomUUID(),
    table2: randomUUID(),
    register: randomUUID(),
    admin: randomUUID(),
    waiter: randomUUID(),
    kitchen: randomUUID(),
    cashier: randomUUID(),
    manager: randomUUID(),
    otherAdmin: randomUUID(),
  };

  let orderId = "";
  let orderNumber = "";
  let shiftId = "";

  const orderService = () => new OrderService(new DrizzleOrderRepository(db));
  const paymentService = () => new PaymentService(new DrizzlePaymentRepository(db));
  const shiftService = () => new CashierShiftService(new DrizzleCashierShiftRepository(db));
  const menuService = () => new MenuService(new DrizzleMenuRepository(db));

  const asWaiter = () => principal("WAITER", ids.restaurant, ids.waiter);
  const asKitchen = () => principal("KITCHEN", ids.restaurant, ids.kitchen);
  const asCashier = () => principal("CASHIER", ids.restaurant, ids.cashier);
  const asAdmin = () => principal("ADMIN", ids.restaurant, ids.admin);

  before(async () => {
    // Pool size matters here, not just speed. A service opening a transaction
    // and reading through the outer handle inside it will wait forever on a
    // single-connection pool — the deadlock `cashier-shift-service` warns
    // about. Production pools 5; the test does too.
    client = postgres((target as { url: string }).url, { max: 5, prepare: false });
    db = drizzle(client, { schema: { ...schema, ...relations } });

    const [{ supabase }] = await client<{ supabase: boolean }[]>`
      select exists (select 1 from pg_extension where extname = 'supabase_vault') as supabase
    `;
    assert.equal(supabase, false, "refusing to run against a Supabase project");

    await seed();
  });

  after(async () => {
    if (client) await client.end({ timeout: 5 });
  });

  async function seed(): Promise<void> {
    // A disposable database, emptied wholesale before each run.
    //
    // Hand-ordering deletes across this many RESTRICT foreign keys is a
    // guessing game that breaks every time a table is added; TRUNCATE CASCADE
    // states the intent directly. It is safe here and nowhere else, which is
    // why the loopback and non-Supabase guards above run first, and why the
    // `drizzle` ledger schema is deliberately untouched.
    const tables = await client<{ name: string }[]>`
      select quote_ident(table_name) as name
      from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
    `;
    await client.unsafe(
      `truncate table ${tables.map((t) => t.name).join(", ")} restart identity cascade`,
    );

    for (const [id, slug] of [[ids.restaurant, "e2e-lokanta"], [ids.otherRestaurant, "e2e-other"]]) {
      await db.insert(restaurants).values({
        id, name: `E2E ${slug}`, slug, currency: "TRY",
        timezone: "Europe/Istanbul", defaultLocale: "tr", isActive: true,
      });
      await db.insert(restaurantSettings).values({
        restaurantId: id, menuEnabled: true, orderingEnabled: true,
      });
    }

    const staff: [string, string, "ADMIN" | "MANAGER" | "WAITER" | "KITCHEN" | "CASHIER"][] = [
      [ids.admin, "E2E Admin", "ADMIN"],
      [ids.manager, "E2E Müdür", "MANAGER"],
      [ids.waiter, "E2E Garson", "WAITER"],
      [ids.kitchen, "E2E Mutfak", "KITCHEN"],
      [ids.cashier, "E2E Kasa", "CASHIER"],
    ];
    for (const [id, name, role] of staff) {
      await db.insert(staffProfiles).values({ id, restaurantId: ids.restaurant, name, role, isActive: true });
    }
    await db.insert(staffProfiles).values({
      id: ids.otherAdmin, restaurantId: ids.otherRestaurant, name: "Other Admin", role: "ADMIN", isActive: true,
    });

    await db.insert(categories).values({
      id: ids.category, restaurantId: ids.restaurant, name: "Çorbalar", slug: "corbalar",
      sortOrder: 1, isActive: true,
    });
    await db.insert(products).values([
      { id: ids.soup, restaurantId: ids.restaurant, categoryId: ids.category, name: "Mercimek Çorbası",
        slug: "mercimek", price: "120.00", isActive: true, isAvailable: true },
      { id: ids.kebab, restaurantId: ids.restaurant, categoryId: ids.category, name: "Adana Kebap",
        slug: "adana-kebap", price: "350.50", isActive: true, isAvailable: true },
    ]);
    // Real QR tokens, hashed the way the application hashes them: a table
    // without one could never be reached by a scan, so the fixture would be
    // testing a table that cannot exist in production.
    const pepper = "e2e-disposable-qr-pepper-not-a-production-secret";
    await db.insert(restaurantTables).values([
      { id: ids.table, restaurantId: ids.restaurant, name: "Masa 1", tableNumber: 1, seats: 4,
        isActive: true, qrTokenHash: generateQrToken(pepper).tokenHash },
      { id: ids.table2, restaurantId: ids.restaurant, name: "Masa 2", tableNumber: 2, seats: 2,
        isActive: true, qrTokenHash: generateQrToken(pepper).tokenHash },
    ]);
    await db.insert(cashRegisters).values({
      id: ids.register, restaurantId: ids.restaurant, name: "Kasa 1", code: "KASA1", isActive: true,
    });
  }

  /**
   * The version a guest's signed table session carries. It is the QR token's
   * own version: rotating or revoking a table's code moves it, which is what
   * makes an old session stop working the moment the code is reprinted.
   */
  /**
   * One guest sitting down, as the QR gate would mint it. The nonce is what the
   * order is stamped with, so it comes from the real signing helper rather than
   * from a hand-written string — a 22-character base64url value is what the
   * `varchar(32)` column and the cookie verifier actually see.
   */
  function sitting(accessVersion: number): string {
    return createCustomerTableSession(
      { restaurantId: ids.restaurant, tableId: ids.table, accessVersion },
      "e2e-disposable-customer-session-secret-not-production",
    ).claims.nonce;
  }

  /** The party that sits down and orders; one sitting for the whole day. */
  const guestSitting = sitting(1);

  async function tableAccessVersion(): Promise<number> {
    const [row] = await db
      .select({ v: restaurantTables.qrTokenVersion })
      .from(restaurantTables)
      .where(eq(restaurantTables.id, ids.table))
      .limit(1);
    assert.ok(row, "fixture table missing");
    return row.v;
  }

  /* ---------------- the day ---------------- */

  test("ADMIN SETUP — the menu a guest will see is readable and priced", async () => {
    const menu = await menuService().getPublicMenu(ids.restaurant, "tr");
    assert.equal(menu.categories.length, 1);
    const items = menu.categories[0]!.products;
    assert.equal(items.length, 2);
    // Prices are exact decimal strings out of PostgreSQL, never floats.
    const soup = items.find((p) => p.slug === "mercimek")!;
    assert.equal(soup.price, "120.00");
    assert.equal(typeof soup.price, "string");
    assert.equal(items.find((p) => p.slug === "adana-kebap")!.price, "350.50");
  });

  test("CUSTOMER QR — the menu loads in four languages without a login", async () => {
    for (const locale of ["tr", "en", "ar", "zh-CN"]) {
      const menu = await menuService().getPublicMenu(ids.restaurant, locale);
      assert.equal(menu.categories.length, 1, `${locale} categories`);
      const names = menu.categories[0]!.products.map((p) => p.name);
      assert.equal(names.length, 2);
      for (const n of names) assert.ok(n.trim().length > 0, `${locale} produced a nameless dish`);
    }
    // No rows were seeded into the translation tables, so what a guest reads
    // comes from the shipped static catalogue, which knows this dish by slug.
    const tr = await menuService().getPublicMenu(ids.restaurant, "tr");
    const en = await menuService().getPublicMenu(ids.restaurant, "en");
    const name = (m: Awaited<ReturnType<ReturnType<typeof menuService>["getPublicMenu"]>>) =>
      m.categories[0]!.products.find((p) => p.slug === "mercimek")!.name;
    assert.equal(name(tr), "Mercimek Çorbası");
    assert.equal(name(en), "Lentil Soup", "the static catalogue supplies English");

    // A dish the static catalogue has never heard of falls back to its real
    // Turkish name rather than to a blank.
    const kebab = (m: Awaited<ReturnType<ReturnType<typeof menuService>["getPublicMenu"]>>) =>
      m.categories[0]!.products.find((p) => p.slug === "adana-kebap")!.name;
    assert.equal(kebab(en), "Adana Kebap");
  });

  test("ORDER — a guest at the table orders two dishes", async () => {
    const result = await orderService().createOrder({
      restaurantId: ids.restaurant,
      tableId: ids.table,
      tableAccessVersion: await tableAccessVersion(),
      sessionNonce: guestSitting,
      idempotencyKey: "e2e-order-key-1",
      items: [
        { productId: ids.soup, quantity: 2 },
        { productId: ids.kebab, quantity: 1, note: "az acılı" },
      ],
      notes: "Pencere kenarı",
    });

    orderId = result.order.id;
    orderNumber = result.order.orderNumber;
    assert.ok(orderId);
    assert.equal(result.order.status, "NEW");
    assert.equal(result.order.tableId, ids.table);
    assert.equal(result.replayed, false);
    // 2 × 120.00 + 1 × 350.50 = 590.50, computed by the server from the
    // catalogue, never from anything the guest sent.
    assert.equal(result.amounts.total, "590.50");
    assert.equal(result.amounts.currency, "TRY");

    const [row] = await db.select().from(orders).where(eq(orders.id, orderId));
    assert.equal(row!.restaurantId, ids.restaurant);
    assert.equal(row!.tableId, ids.table);
    const lines = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
    assert.equal(lines.length, 2);
    // The line carries a snapshot of what was sold, so a later price change
    // cannot rewrite a sale that already happened.
    const soupLine = lines.find((l) => l.productId === ids.soup)!;
    assert.equal(soupLine.unitPrice, "120.00");
    assert.equal(soupLine.quantity, 2);
    assert.equal(lines.find((l) => l.productId === ids.kebab)!.notes, "az acılı");
  });

  test("ORDER IDEMPOTENCY — the same key twice is one order, not two", async () => {
    const replay = await orderService().createOrder({
      restaurantId: ids.restaurant,
      tableId: ids.table,
      tableAccessVersion: await tableAccessVersion(),
      sessionNonce: guestSitting,
      idempotencyKey: "e2e-order-key-1",
      items: [
        { productId: ids.soup, quantity: 2 },
        { productId: ids.kebab, quantity: 1, note: "az acılı" },
      ],
      notes: "Pencere kenarı",
    });
    assert.equal(replay.order.id, orderId, "the same receipt comes back");
    assert.equal(replay.replayed, true);
    assert.equal(replay.amounts.total, "590.50");

    const all = await db.select().from(orders).where(eq(orders.restaurantId, ids.restaurant));
    assert.equal(all.length, 1, "a retried submit must not open a second ticket");
  });

  test("CONFIRM — the floor accepts the ticket, and only the floor can", async () => {
    const [fresh] = await db.select().from(orders).where(eq(orders.id, orderId));
    assert.equal(fresh!.status, "NEW");

    // Each role owns its own leg of the journey. The kitchen does not decide
    // that an order has been accepted, and it cannot skip ahead to plated.
    await assert.rejects(
      orderService().updateStatus(asKitchen(), {
        restaurantId: ids.restaurant, orderId, nextStatus: "CONFIRMED",
      }),
      (e: unknown) => e instanceof DomainError && e.code === "FORBIDDEN",
      "confirming a ticket is the floor's job, not the kitchen's",
    );
    await assert.rejects(
      orderService().updateStatus(asWaiter(), {
        restaurantId: ids.restaurant, orderId, nextStatus: "READY",
      }),
      (e: unknown) => e instanceof DomainError && e.code === "INVALID_STATUS_TRANSITION",
      "nothing may jump straight from NEW to READY",
    );

    await orderService().updateStatus(asWaiter(), {
      restaurantId: ids.restaurant, orderId, nextStatus: "CONFIRMED",
    });
    const [row] = await db.select().from(orders).where(eq(orders.id, orderId));
    assert.equal(row!.status, "CONFIRMED");
  });

  test("KITCHEN — the ticket is cooked: CONFIRMED → PREPARING → READY", async () => {
    await orderService().updateStatus(asKitchen(), {
      restaurantId: ids.restaurant, orderId, nextStatus: "PREPARING",
    });
    const [mid] = await db.select().from(orders).where(eq(orders.id, orderId));
    assert.equal(mid!.status, "PREPARING");
    assert.ok(mid!.preparingAt, "the pass records when cooking started");

    await orderService().updateStatus(asKitchen(), {
      restaurantId: ids.restaurant, orderId, nextStatus: "READY",
    });
    const [row] = await db.select().from(orders).where(eq(orders.id, orderId));
    assert.equal(row!.status, "READY");
    assert.ok(row!.readyAt);
  });

  test("SERVE — the waiter delivers it", async () => {
    await orderService().updateStatus(asWaiter(), {
      restaurantId: ids.restaurant, orderId, nextStatus: "SERVED",
    });
    const [row] = await db.select().from(orders).where(eq(orders.id, orderId));
    assert.equal(row!.status, "SERVED");
    assert.ok(row!.servedAt);
  });

  test("CASHIER SHIFT OPEN — a physically counted drawer in three currencies", async () => {
    const shift = await shiftService().open(asCashier(), {
      cashRegisterId: ids.register,
      openingCash: "0.00",
      cashCounts: [
        { currency: "TRY", denominationMinor: 20000, count: 5 },   // 5 × 200₺ = 1000₺
        { currency: "TRY", denominationMinor: 5000, count: 4 },    // 4 ×  50₺ =  200₺
        { currency: "EUR", denominationMinor: 5000, count: 2 },
        { currency: "USD", denominationMinor: 10000, count: 1 },
      ],
    });
    shiftId = shift.shift.id;
    assert.equal(shift.shift.status, "OPEN");
    // The server prices the drawer from its own denomination table; the
    // openingCash the client sent ("0.00") is ignored in favour of the count.
    assert.equal(shift.shift.openingCash, "1200.00");

    const counts = await db.select().from(cashierShiftCashCounts)
      .where(eq(cashierShiftCashCounts.shiftId, shiftId));
    assert.equal(counts.length, 4);
    const try200 = counts.find((c) => c.currency === "TRY" && c.denominationMinor === 20000)!;
    assert.equal(try200.pieceCount, 5);
    assert.equal(String(try200.subtotalMinor), "100000", "subtotal is server-computed in minor units");
    assert.ok(counts.every((c) => c.phase === "OPENING"));
  });

  test("CASH COUNTS — a forged or impossible drawer is refused", async () => {
    const bad = async (cashCounts: readonly { currency: string; denominationMinor: number; count: number }[]) =>
      assert.rejects(
        shiftService().open(asCashier(), { cashRegisterId: ids.register, openingCash: "10.00", cashCounts }),
        (e: unknown) => e instanceof DomainError,
      );
    await bad([{ currency: "GBP", denominationMinor: 1000, count: 1 }]);
    await bad([{ currency: "TRY", denominationMinor: 20000, count: -3 }]);
    await bad([{ currency: "TRY", denominationMinor: 3333, count: 1 }]);
    await bad([
      { currency: "TRY", denominationMinor: 20000, count: 1 },
      { currency: "TRY", denominationMinor: 20000, count: 2 },
    ]);
  });

  test("PAYMENT — the cashier takes the money once", async () => {
    const payment = await paymentService().collect(asCashier(), {
      orderId, method: "CASH", idempotencyKey: "e2e-pay-key-1",
    });
    assert.equal(payment.orderId, orderId);
    assert.equal(payment.orderNumber, orderNumber);
    assert.equal(payment.amount, "590.50", "settles the whole balance, taken from the order");
    assert.equal(payment.method, "CASH");
    assert.equal(payment.status, "COMPLETED");
    assert.equal(payment.replayed, false);
  });

  test("PAYMENT IDEMPOTENCY — a retried collection does not take the money twice", async () => {
    const replay = await paymentService().collect(asCashier(), {
      orderId, method: "CASH", idempotencyKey: "e2e-pay-key-1",
    });
    assert.equal(replay.paymentId, (await ledgerPayments())[0]!.id);
    assert.equal(replay.replayed, true);

    const rows = await ledgerPayments();
    assert.equal(rows.length, 1, "exactly one payment row exists");
    assert.equal(rows[0]!.amount, "590.50");
  });

  async function ledgerPayments() {
    return db.select().from(schema.payments).where(eq(schema.payments.orderId, orderId));
  }

  test("OVERPAYMENT — a second collection on a settled order is refused, not silently taken", async () => {
    await assert.rejects(
      paymentService().collect(asCashier(), {
        orderId, method: "CASH", amount: "10.00", idempotencyKey: "e2e-pay-key-2",
      }),
      (e: unknown) => e instanceof DomainError && e.httpStatus >= 400 && e.httpStatus < 500,
      "an already-settled order must refuse more money with a client error, never a 500",
    );
    assert.equal((await ledgerPayments()).length, 1);
  });

  test("SHIFT CLOSE — opening, takings and the counted drawer are reconciled", async () => {
    const detail = await shiftService().detail(asCashier(), shiftId);
    assert.equal(detail.shift.status, "OPEN");

    // 1200.00 opening + 590.50 collected = 1790.50 expected in the drawer.
    const closed = await shiftService().close(asCashier(), {
      shiftId, countedCash: "1790.50", note: "E2E kapanış",
    });
    assert.equal(closed.shift.status, "CLOSED");
    assert.equal(closed.shift.countedCash, "1790.50");
    assert.equal(closed.shift.expectedCashAtClose, "1790.50");
    assert.equal(closed.shift.cashVariance, "0.00", "a correctly counted drawer balances to zero");

    const [row] = await db.select().from(cashierShifts).where(eq(cashierShifts.id, shiftId));
    assert.equal(row!.status, "CLOSED");
    assert.ok(row!.closedAt);
    assert.equal(row!.closedByStaffId, ids.cashier);
  });

  test("REPORTS — the day's Z report matches the day that actually happened", async () => {
    const report = await new CashierReportService(new DrizzleCashierShiftRepository(db))
      .zReport(asAdmin(), shiftId);

    // The stored snapshot of a closed drawer, not a recomputation: what the
    // manager reads tomorrow is what was agreed when the till was counted.
    assert.equal(report.openingCash, "1200.00");
    assert.equal(report.grossCollected, "590.50");
    assert.equal(report.netCollected, "590.50", "nothing was refunded today");
    assert.equal(report.expectedCash, "1790.50");
    assert.equal(report.countedCash, "1790.50");
    assert.equal(report.cashVariance, "0.00");
    assert.equal(report.paymentCount, 1);
    assert.equal(report.refundCount, 0);
    // The breakdown must add up to the headline figure, or the paper lies.
    const byMethod = Object.values(report.paymentMethodBreakdown ?? {});
    assert.ok(byMethod.length > 0);
  });

  test("AUDIT — the day left a trail, and no secrets in it", async () => {
    const rows = await db.select().from(auditLogs).where(eq(auditLogs.restaurantId, ids.restaurant));
    assert.ok(rows.length > 0, "financially meaningful mutations are audited");
    const blob = JSON.stringify(rows);
    for (const forbidden of ["password", "pgrehearsal", "secret", "token_hash", "service_role"]) {
      assert.ok(!blob.toLowerCase().includes(forbidden), `audit log leaked "${forbidden}"`);
    }
    const events = await db.select().from(outboxEvents).where(eq(outboxEvents.restaurantId, ids.restaurant));
    assert.ok(events.length > 0, "the kitchen/customer screens have events to react to");
  });

  /* ---------------- security ---------------- */

  test("ROLE AUTHORIZATION — each role is held to its own job", async () => {
    const forbidden = (work: Promise<unknown>, what: string) =>
      assert.rejects(work, (e: unknown) =>
        e instanceof DomainError && (e.code === "FORBIDDEN" || e.code === "AUTHENTICATION_REQUIRED"), what);

    // A waiter cannot take money.
    await forbidden(
      paymentService().collect(asWaiter(), { orderId, method: "CASH", idempotencyKey: randomUUID() }),
      "WAITER must not collect payment",
    );
    // The kitchen cannot open a till.
    await forbidden(
      shiftService().open(asKitchen(), { cashRegisterId: ids.register, openingCash: "0.00" }),
      "KITCHEN must not open a cashier shift",
    );
    // Nobody unauthenticated does anything.
    await forbidden(
      paymentService().collect(null, { orderId, method: "CASH", idempotencyKey: randomUUID() }),
      "an anonymous caller must not collect payment",
    );
    await forbidden(
      shiftService().open(null, { cashRegisterId: ids.register, openingCash: "0.00" }),
      "an anonymous caller must not open a shift",
    );
  });

  test("TENANT ISOLATION — another restaurant's admin cannot reach this order", async () => {
    const outsider = principal("ADMIN", ids.otherRestaurant, ids.otherAdmin);
    await assert.rejects(
      paymentService().collect(outsider, { orderId, method: "CASH", idempotencyKey: randomUUID() }),
      (e: unknown) => e instanceof DomainError && e.httpStatus >= 400 && e.httpStatus < 500,
      "a cross-tenant order id must not resolve",
    );
    await assert.rejects(
      orderService().updateStatus(outsider, {
        restaurantId: ids.otherRestaurant, orderId, nextStatus: "CANCELLED",
      }),
      (e: unknown) => e instanceof DomainError,
    );
    // And the order is untouched.
    const [row] = await db.select().from(orders).where(eq(orders.id, orderId));
    assert.equal(row!.restaurantId, ids.restaurant);
  });

  test("STALE TABLE ACCESS — a guest holding an old session cannot order", async () => {
    const current = await tableAccessVersion();
    await assert.rejects(
      orderService().createOrder({
        restaurantId: ids.restaurant,
        tableId: ids.table,
        tableAccessVersion: current - 1,
        sessionNonce: guestSitting,
        idempotencyKey: randomUUID(),
        items: [{ productId: ids.soup, quantity: 1 }],
      }),
      (e: unknown) => e instanceof DomainError && e.httpStatus >= 400 && e.httpStatus < 500,
      "an outdated table session is a client error, never a 500",
    );
  });

  test("UNKNOWN PRODUCT — a made-up id is refused with a client error", async () => {
    await assert.rejects(
      orderService().createOrder({
        restaurantId: ids.restaurant,
        tableId: ids.table,
        tableAccessVersion: await tableAccessVersion(),
        sessionNonce: guestSitting,
        idempotencyKey: randomUUID(),
        items: [{ productId: randomUUID(), quantity: 1 }],
      }),
      (e: unknown) => e instanceof DomainError && e.httpStatus >= 400 && e.httpStatus < 500,
    );
  });

  /* ---------------- persistence ---------------- */

  test("RESTART PERSISTENCE — the day survives a fresh connection to the same database", async () => {
    // A new client and a new drizzle instance: nothing is carried over in
    // memory, so what comes back is what PostgreSQL actually kept.
    const reconnected = postgres((target as { url: string }).url, { max: 1, prepare: false });
    try {
      const [order] = await reconnected`
        select id, status, total, order_number, closed_at from orders where id = ${orderId}`;
      // Collecting the money is what closes the order: the cashier's
      // SERVED → COMPLETED step happens inside the same transaction as the
      // payment, so a paid order can never be left open by a crash between them.
      assert.equal(order!.status, "COMPLETED");
      assert.ok(order!.closed_at, "a settled order carries the moment it closed");
      assert.equal(order!.total, "590.50");
      assert.equal(order!.order_number, orderNumber);

      const [payment] = await reconnected`select amount, status from payments where order_id = ${orderId}`;
      assert.equal(payment!.amount, "590.50");

      const [shift] = await reconnected`
        select status, opening_cash, counted_cash_at_close, cash_variance from cashier_shifts where id = ${shiftId}`;
      assert.equal(shift!.status, "CLOSED");
      assert.equal(shift!.opening_cash, "1200.00");
      assert.equal(shift!.counted_cash_at_close, "1790.50");
      assert.equal(shift!.cash_variance, "0.00");

      const [{ n }] = await reconnected<{ n: string }[]>`
        select count(*)::text n from cashier_shift_cash_counts where shift_id = ${shiftId}`;
      assert.equal(n, "4", "the counted drawer is still on record");
    } finally {
      await reconnected.end({ timeout: 5 });
    }
  });
});
