import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { orderTrackingTimeline } from "../../lib/domain/display";
import type {
  CustomerOrderQueryRepository,
  CustomerTrackedOrderRecord,
} from "../../lib/repositories/customer-order-query-repository";
import { createCustomerTableSession } from "../../lib/security/customer-session";
import { createGuestOrderSession } from "../../lib/security/guest-order-session";
import {
  ORDER_TRACKING_MAX_TTL_SECONDS,
  ORDER_TRACKING_TTL_SECONDS,
  createOrderTrackingToken,
  verifyOrderTrackingToken,
} from "../../lib/security/order-tracking-token";
import { CustomerOrderQueryService } from "../../lib/services/customer-order-query-service";
import { menuTranslations } from "../../lib/i18n/menu-translations";

/**
 * Watching a takeaway or courier order you placed without an account.
 *
 * The thing being protected here is that ORD-000105 stays what it is — a
 * number printed on a receipt, sequential and guessable — and never becomes a
 * key to somebody else's order. What authorises is a signature over one order,
 * minted by the server when the order was created.
 */

const SECRET = "x".repeat(32);
const RESTAURANT = "11111111-1111-4111-8111-111111111111";
const OTHER_RESTAURANT = "99999999-9999-4999-8999-999999999999";
const ORDER = "22222222-2222-4222-8222-222222222222";
const OTHER_ORDER = "33333333-3333-4333-8333-333333333333";
const NOW = 1_800_000_000;

const tokenSource = readFileSync(
  new URL("../../lib/security/order-tracking-token.ts", import.meta.url),
  "utf8",
);
const context = readFileSync(
  new URL("../../lib/auth/order-tracking-context.ts", import.meta.url),
  "utf8",
);
const route = readFileSync(
  new URL("../../app/api/guest-orders/tracking/route.ts", import.meta.url),
  "utf8",
);
const createRoute = readFileSync(
  new URL("../../app/api/guest-orders/route.ts", import.meta.url),
  "utf8",
);
const repository = readFileSync(
  new URL("../../lib/repositories/drizzle-customer-order-query-repository.ts", import.meta.url),
  "utf8",
);
const trackingUi = readFileSync(
  new URL("../../components/guest/order-tracking.tsx", import.meta.url),
  "utf8",
);
const orderingUi = readFileSync(
  new URL("../../components/guest/guest-order-experience.tsx", import.meta.url),
  "utf8",
);

/* ------------------------------------------------------- the capability --- */

test("a tracking capability round-trips and names one order in one restaurant", () => {
  const { token, claims } = createOrderTrackingToken(
    { restaurantId: RESTAURANT, orderId: ORDER, nowSeconds: NOW },
    SECRET,
  );
  assert.equal(claims.restaurantId, RESTAURANT);
  assert.equal(claims.orderId, ORDER);
  assert.deepEqual(verifyOrderTrackingToken(token, SECRET, NOW), claims);
});

test("the capability carries no person in it", () => {
  const { token, claims } = createOrderTrackingToken(
    { restaurantId: RESTAURANT, orderId: ORDER, nowSeconds: NOW },
    SECRET,
  );
  assert.deepEqual(Object.keys(claims).sort(), [
    "expiresAt",
    "issuedAt",
    "nonce",
    "orderId",
    "restaurantId",
    "version",
  ]);
  // The payload is only base64: anything put in it travels in the clear to
  // anyone who reads the cookie jar.
  const payload = Buffer.from(token.split(".")[1], "base64url").toString("utf8");
  for (const field of ["customerName", "contact", "address", "deliveryNotes", "phone"]) {
    assert.equal(payload.includes(field), false, `the token carries ${field}`);
  }
  // The claim shape above is the guarantee; the prose in that file is free to
  // name what it deliberately leaves out.
});

test("a tampered capability is refused", () => {
  const { token } = createOrderTrackingToken(
    { restaurantId: RESTAURANT, orderId: ORDER, nowSeconds: NOW },
    SECRET,
  );
  const [version, payload, signature] = token.split(".");
  // Re-pointing the claim at another order invalidates the signature: the
  // order id is signed, not merely carried.
  const swapped = Buffer.from(
    Buffer.from(payload, "base64url").toString("utf8").replace(ORDER, OTHER_ORDER),
    "utf8",
  ).toString("base64url");
  assert.equal(verifyOrderTrackingToken(`${version}.${swapped}.${signature}`, SECRET, NOW), null);
  assert.equal(verifyOrderTrackingToken(`${version}.${payload}.${"A".repeat(43)}`, SECRET, NOW), null);
  assert.equal(verifyOrderTrackingToken(token, "y".repeat(32), NOW), null);
  assert.equal(verifyOrderTrackingToken(`${token}.extra`, SECRET, NOW), null);
});

test("a capability expires, and cannot be minted to outlive the day", () => {
  const { token, claims } = createOrderTrackingToken(
    { restaurantId: RESTAURANT, orderId: ORDER, nowSeconds: NOW },
    SECRET,
  );
  assert.equal(claims.expiresAt - claims.issuedAt, ORDER_TRACKING_TTL_SECONDS);
  assert.ok(verifyOrderTrackingToken(token, SECRET, NOW + ORDER_TRACKING_TTL_SECONDS - 120));
  assert.equal(verifyOrderTrackingToken(token, SECRET, NOW + ORDER_TRACKING_TTL_SECONDS + 3_600), null);
  assert.throws(() =>
    createOrderTrackingToken(
      { restaurantId: RESTAURANT, orderId: ORDER, ttlSeconds: ORDER_TRACKING_MAX_TTL_SECONDS + 1 },
      SECRET,
    ),
  );
  // Long enough to outlive the ordering session it follows, short enough not
  // to become a standing identity.
  assert.ok(ORDER_TRACKING_TTL_SECONDS >= 8 * 60 * 60);
  assert.ok(ORDER_TRACKING_MAX_TTL_SECONDS <= 24 * 60 * 60);
});

test("no other session kind can act as a tracking capability", () => {
  const table = createCustomerTableSession(
    { restaurantId: RESTAURANT, tableId: ORDER, accessVersion: 1, nowSeconds: NOW },
    SECRET,
  );
  const ordering = createGuestOrderSession({ restaurantId: RESTAURANT, nowSeconds: NOW }, SECRET);
  // Same secret, different signing context, so neither signature crosses over.
  assert.equal(verifyOrderTrackingToken(table.token, SECRET, NOW), null);
  assert.equal(verifyOrderTrackingToken(ordering.token, SECRET, NOW), null);
  const tracking = createOrderTrackingToken(
    { restaurantId: RESTAURANT, orderId: ORDER, nowSeconds: NOW },
    SECRET,
  );
  assert.match(tokenSource, /order-tracking:v1/);
  assert.notEqual(tracking.token.split(".")[2], ordering.token.split(".")[2]);
});

/* ---------------------------------------------------------- the boundary --- */

test("the order number is never accepted as authorisation", () => {
  // Nothing the caller sends decides which order is read: the route takes no
  // body, no query and no parameter at all.
  assert.match(route, /export async function GET\(\): Promise<NextResponse>/);
  assert.doesNotMatch(route, /orderNumber|searchParams|request\./);
  assert.match(route, /requireOrderTrackingContext\(\)/);
  assert.match(route, /getTrackedOrder\(context\.restaurantId, context\.orderId\)/);
  // And the boundary itself reads the cookie, never the request.
  assert.match(context, /readOrderTrackingToken\(cookieStore\.get\(ORDER_TRACKING_COOKIE\)\?\.value\)/);
  assert.doesNotMatch(context, /orderNumber|body|searchParams/);
});

test("one capability reads one order, in one restaurant", () => {
  // Both halves of the claim are predicates on the query, so a capability from
  // another deployment cannot read across tenants even with a valid signature.
  const query = repository.slice(repository.indexOf("async findTrackedOrder"));
  assert.match(query, /eq\(orders\.restaurantId, restaurantId\), eq\(orders\.id, orderId\)/);
  assert.match(query, /eq\(orderItems\.restaurantId, restaurantId\)/);
  assert.match(query, /eq\(restaurants\.isActive, true\)/);
  // The context re-checks the restaurant is still trading before anything is read.
  assert.match(context, /eq\(restaurants\.isActive, true\)/);
});

test("the capability is minted by the server on the order it just created", () => {
  assert.match(createRoute, /issueOrderTrackingToken\(\{\s*restaurantId: context\.restaurantId,\s*orderId: created\.order\.id,\s*\}\)/);
  assert.match(createRoute, /httpOnly: true/);
  assert.match(createRoute, /sameSite: "lax"/);
  assert.match(createRoute, /maxAge: ORDER_TRACKING_TTL_SECONDS/);
  // The browser is never handed the token to keep or to put in a URL.
  assert.doesNotMatch(createRoute, /token: tracking\.token|trackingToken:/);
});

/* --------------------------------------------------------- what is shown --- */

function repositoryReturning(
  record: CustomerTrackedOrderRecord | null,
): CustomerOrderQueryRepository & { calls: { restaurantId: string; orderId: string }[] } {
  const calls: { restaurantId: string; orderId: string }[] = [];
  return {
    calls,
    async findActiveByTable() {
      return { orders: [], items: [] };
    },
    async findTrackedOrder(restaurantId: string, orderId: string) {
      calls.push({ restaurantId, orderId });
      return record;
    },
  };
}

const placedAt = new Date("2026-08-26T11:00:00.000Z");

function trackedOrder(
  overrides: Partial<CustomerTrackedOrderRecord> = {},
): CustomerTrackedOrderRecord {
  return {
    orderNumber: "ORD-000105",
    channel: "TAKEAWAY",
    status: "PREPARING",
    fulfillmentStatus: "PLACED",
    total: "240.00",
    currency: "TRY",
    createdAt: placedAt,
    updatedAt: placedAt,
    items: [
      { productNameSnapshot: "Mercimek Çorbası", quantity: 2, status: "PREPARING" },
      { productNameSnapshot: "Ayran", quantity: 1, status: "CANCELLED" },
    ],
    ...overrides,
  };
}

test("the tracked response carries no identifier and no person", async () => {
  const repo = repositoryReturning(trackedOrder());
  const result = await new CustomerOrderQueryService(repo).getTrackedOrder(RESTAURANT, ORDER);
  assert.deepEqual(repo.calls, [{ restaurantId: RESTAURANT, orderId: ORDER }]);
  assert.deepEqual(Object.keys(result).sort(), [
    "cancelled",
    "channel",
    "current",
    "items",
    "orderNumber",
    "placedAt",
    "steps",
    "total",
    "updatedAt",
    "currency",
  ].sort());
  const serialised = JSON.stringify(result);
  for (const forbidden of [RESTAURANT, ORDER, "customerName", "contact", "address", "staff", "payment", "audit"]) {
    assert.equal(serialised.includes(forbidden), false, `the response carries ${forbidden}`);
  }
  // A line the kitchen struck off is not part of what is coming.
  assert.deepEqual(result.items, [{ name: "Mercimek Çorbası", quantity: 2 }]);
});

test("a missing order and another restaurant's order answer the same way", async () => {
  const service = new CustomerOrderQueryService(repositoryReturning(null));
  await assert.rejects(() => service.getTrackedOrder(OTHER_RESTAURANT, ORDER), /Sipariş bulunamadı/);
  // A dine-in order is not trackable through this surface either.
  const dineIn = new CustomerOrderQueryService(
    repositoryReturning(trackedOrder({ channel: "DINE_IN" })),
  );
  await assert.rejects(() => dineIn.getTrackedOrder(RESTAURANT, ORDER), /Sipariş bulunamadı/);
});

/* ------------------------------------------------------------- timelines --- */

test("the takeaway timeline is the three stages that actually exist", () => {
  const received = orderTrackingTimeline({
    channel: "TAKEAWAY",
    orderStatus: "NEW",
    fulfillmentStatus: "PLACED",
  });
  assert.equal(received.current, "trackReceived");
  assert.deepEqual(
    received.steps.map((step) => step.key),
    ["trackReceived", "trackPreparing", "trackReady"],
  );
  assert.equal(
    orderTrackingTimeline({ channel: "TAKEAWAY", orderStatus: "PREPARING", fulfillmentStatus: "PLACED" })
      .current,
    "trackPreparing",
  );
  assert.equal(
    orderTrackingTimeline({ channel: "TAKEAWAY", orderStatus: "READY", fulfillmentStatus: "PLACED" })
      .current,
    "trackReady",
  );
  // No courier stage is ever shown to someone collecting their own food.
  assert.equal(received.steps.some((step) => step.key === "trackOnTheWay"), false);
});

test("the delivery timeline follows the fulfillment machine, not an invented one", () => {
  const steps = ["trackReceived", "trackPreparing", "trackWaitingCourier", "trackOnTheWay", "trackDelivered"];
  assert.deepEqual(
    orderTrackingTimeline({ channel: "DELIVERY", orderStatus: "NEW", fulfillmentStatus: "PLACED" })
      .steps.map((step) => step.key),
    steps,
  );
  const cases: [string, string, string][] = [
    ["PREPARING", "PLACED", "trackPreparing"],
    ["READY", "WAITING_FOR_COURIER", "trackWaitingCourier"],
    ["READY", "OUT_FOR_DELIVERY", "trackOnTheWay"],
    ["SERVED", "DELIVERED", "trackDelivered"],
  ];
  for (const [orderStatus, fulfillmentStatus, expected] of cases) {
    assert.equal(
      orderTrackingTimeline({
        channel: "DELIVERY",
        orderStatus: orderStatus as "PREPARING",
        fulfillmentStatus: fulfillmentStatus as "PLACED",
      }).current,
      expected,
      `${orderStatus}/${fulfillmentStatus}`,
    );
  }
});

test("a cancelled order says so instead of pretending to progress", () => {
  for (const cancelled of [
    { orderStatus: "CANCELLED" as const, fulfillmentStatus: "PLACED" as const },
    { orderStatus: "PREPARING" as const, fulfillmentStatus: "CANCELLED" as const },
  ]) {
    const timeline = orderTrackingTimeline({ channel: "DELIVERY", ...cancelled });
    assert.equal(timeline.current, "trackCancelled");
    assert.equal(timeline.steps.at(-1)?.key, "trackCancelled");
    assert.equal(timeline.steps.at(-1)?.state, "current");
    // Nothing beyond the point it stopped is claimed as done.
    assert.equal(timeline.steps.some((step) => step.state === "current" && step.key !== "trackCancelled"), false);
  }
});

/* ------------------------------------------------------------- the words --- */

test("every step the server can send has a word in every language", () => {
  const keys = [
    "trackReceived",
    "trackPreparing",
    "trackReady",
    "trackWaitingCourier",
    "trackOnTheWay",
    "trackDelivered",
    "trackCancelled",
  ];
  for (const [locale, dictionary] of Object.entries(menuTranslations)) {
    for (const key of keys) {
      const label = dictionary[key as keyof typeof dictionary];
      assert.ok(label?.trim(), `${locale}.${key} is missing`);
      // The step keys are presentation keys, and the words are words: no
      // response and no screen ever shows PREPARING or OUT_FOR_DELIVERY.
      assert.doesNotMatch(label, /^[A-Z_]+$/, `${locale}.${key} is an enum name`);
    }
  }
});

test("the tracking screen speaks the language the guest chose for the menu", () => {
  assert.match(trackingUi, /useMenuPreferences\(\)/);
  assert.match(trackingUi, /MenuPreferencesProvider/);
  assert.match(trackingUi, /\{t\(step\.key as MenuTranslationKey\)\}/);
  // It keeps no dictionary of its own; the words come from the shared one.
  assert.doesNotMatch(trackingUi, /STATUS_LABELS|Record<string, string>/);
  // No raw enum and no identifier is rendered.
  for (const raw of ["PREPARING", "OUT_FOR_DELIVERY", "WAITING_FOR_COURIER", "DELIVERED", "TAKEAWAY\"", "orderId"]) {
    assert.equal(trackingUi.includes(raw), false, `the screen shows ${raw}`);
  }
  assert.doesNotMatch(trackingUi, /undefined<|null</);
});

test("the tracking screen is readable without colour and announces the step", () => {
  assert.match(trackingUi, /aria-current=\{step\.state === "current" \? "step" : undefined\}/);
  assert.match(trackingUi, /trackStepDone/);
  assert.match(trackingUi, /trackStepCurrent/);
  assert.match(trackingUi, /trackStepUpcoming/);
  // Each step carries an icon and a word, so colour is never the only signal.
  assert.match(trackingUi, /STEP_ICON = \{ done: Check, current: CircleDot, upcoming: Circle \}/);
  assert.match(trackingUi, /role="status"/);
  assert.match(trackingUi, /aria-busy="true"/);
});

test("the tracking screen refreshes the way the rest of the product does", () => {
  // One refresh model: REST is the truth, and the shared hook already pauses
  // on a hidden tab, revalidates on focus and coalesces overlapping runs.
  assert.match(trackingUi, /useApiResource\(load, \{ pollMs: 30_000 \}\)/);
  assert.doesNotMatch(trackingUi, /setInterval|EventSource|new WebSocket|supabase/);
  // A permanent answer is not offered a retry that could never work.
  assert.match(trackingUi, /resource\.error\.status >= 400 && resource\.error\.status < 500/);
});

test("the confirmation offers tracking without asking anyone to copy an identifier", () => {
  assert.match(orderingUi, /href="\/order\/track"/);
  assert.match(orderingUi, /\{t\("trackMyOrder"\)\}/);
  // The order number is shown to be read aloud, not typed into a tracking form.
  assert.match(orderingUi, /\{confirmation\.orderNumber\}/);
  assert.doesNotMatch(orderingUi, /order\/track\?|orderId=|token=/);
});

test("the ordering chrome is translated rather than written in one language", () => {
  const keys = [
    "guestChannelQuestion",
    "takeawayOption",
    "deliveryOption",
    "takeawayOrder",
    "deliveryOrder",
    "cart",
    "fullName",
    "phone",
    "deliveryAddress",
    "deliveryNote",
    "sendOrder",
    "orderPlaced",
    "trackMyOrder",
    "orderingClosed",
    "tryAgain",
    "menuLoading",
  ];
  for (const key of keys) {
    assert.match(orderingUi, new RegExp(`t\\("${key}"\\)|"${key}"`), `${key} is not used`);
    assert.ok(menuTranslations.tr[key as "cart"]?.trim(), `tr.${key} is missing`);
    assert.ok(menuTranslations.en[key as "cart"]?.trim(), `en.${key} is missing`);
  }
  // The sentences that used to live in the file are gone from it.
  for (const literal of [
    "Nasıl sipariş vermek istersiniz?",
    "Paket Al",
    "Kurye ile Gelsin",
    "Siparişiniz alındı",
    "Sepetiniz",
    "Siparişi Gönder",
    "Şu anda online sipariş alınmıyor.",
  ]) {
    assert.equal(orderingUi.includes(literal), false, `the screen still hardcodes ${literal}`);
  }
});

test("both guest screens read one language preference, not two", () => {
  // Same provider, same storage key, same dictionary: the language chosen for
  // the menu is the language of the buttons, the confirmation and the status.
  for (const source of [orderingUi, trackingUi]) {
    assert.match(source, /MenuPreferencesProvider/);
    assert.match(source, /useMenuPreferences\(\)/);
  }
});

/* ------------------------------------------------------ the QR flow again --- */

test("the dine-in QR flow is untouched by any of this", () => {
  const menuRoute = readFileSync(new URL("../../app/api/menu/route.ts", import.meta.url), "utf8");
  assert.match(menuRoute, /requireCustomerTableContext\(\)/);
  const tableContext = readFileSync(
    new URL("../../lib/auth/customer-table-context.ts", import.meta.url),
    "utf8",
  );
  assert.match(tableContext, /row\.tokenVersion !== claims\.accessVersion/);
  assert.match(tableContext, /row\.tokenRevokedAt/);
  // The tracking capability is not accepted anywhere a table is required.
  assert.doesNotMatch(tableContext, /ORDER_TRACKING_COOKIE|readOrderTrackingToken/);
  const activeOrders = readFileSync(
    new URL("../../app/api/orders/active/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(activeOrders, /requireCustomerTableContext\(\)/);
  assert.doesNotMatch(activeOrders, /Tracking/);
});
