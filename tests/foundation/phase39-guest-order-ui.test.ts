import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * The public ordering screen.
 *
 * These are source guards rather than rendered assertions: what they protect
 * is that the page never learns anything it is not allowed to decide — a
 * price, a restaurant, a table — and that the QR flow beside it did not
 * quietly change shape while this one was built.
 */

const ui = readFileSync(new URL("../../components/guest/guest-order-experience.tsx", import.meta.url), "utf8");
const page = readFileSync(new URL("../../app/order/[restaurantSlug]/page.tsx", import.meta.url), "utf8");
const endpoints = readFileSync(new URL("../../lib/api/endpoints.ts", import.meta.url), "utf8");

/** The submit call, where an authoritative field would do the most damage. */
const submitBlock = ui.slice(ui.indexOf("async function submit()"), ui.indexOf("if (resource.loading"));

test("the public ordering route exists and takes only a slug", () => {
  assert.match(page, /GuestOrderExperience/);
  assert.match(page, /params: Promise<\{ restaurantSlug: string \}>/);
  // No tenant decision on the page: the slug is handed on to be resolved.
  assert.doesNotMatch(page, /restaurantId/);
});

test("the screen opens a guest session before it reads a menu", () => {
  const loader = ui.slice(ui.indexOf("const load = useCallback"), ui.indexOf("const resource = useApiResource"));
  assert.match(loader, /guestApi\.openSession\(restaurantSlug\)/);
  assert.match(loader, /guestApi\.menu\(signal\)/);
  assert.ok(
    loader.indexOf("openSession") < loader.indexOf("guestApi.menu"),
    "the menu is read before the session that authorises it exists",
  );
});

test("both channels submit through the guest endpoint, never the table one", () => {
  assert.match(submitBlock, /guestApi\.createOrder\(/);
  // /api/orders belongs to the QR table flow and must not be reachable here.
  assert.doesNotMatch(ui, /orderApi\./);
  assert.doesNotMatch(ui, /"\/api\/orders"/);
  const guestApiBlock = endpoints.slice(endpoints.indexOf("export const guestApi"), endpoints.indexOf("export const orderApi"));
  assert.match(guestApiBlock, /"\/api\/guest-orders"/);
  assert.match(guestApiBlock, /"\/api\/guest-sessions"/);
  assert.match(guestApiBlock, /"\/api\/guest-menu"/);
});

test("the submit payload carries nothing the server is the authority on", () => {
  for (const forbidden of ["restaurantId", "tableId", "unitPrice", "lineTotal", "total:", "staffId"]) {
    assert.equal(submitBlock.includes(forbidden), false, `the guest submit sends ${forbidden}`);
  }
  // Only the three things a cart line legitimately carries.
  assert.match(submitBlock, /productId: item\.productId/);
  assert.match(submitBlock, /quantity: item\.quantity/);
  assert.match(submitBlock, /note: item\.note/);
});

test("a takeaway sends no address; a courier order cannot be sent without one", () => {
  assert.match(submitBlock, /channel === "DELIVERY" \? \{ address: address\.trim\(\) \} : \{\}/);
  // The submit button stays disabled until the channel's own rules are met.
  const gateStart = ui.indexOf("const nameValid");
  const gate = ui.slice(gateStart, ui.indexOf("return (", gateStart));
  assert.match(gate, /channel === "TAKEAWAY" \|\| address\.trim\(\)\.length > 0/);
  assert.match(gate, /ready = nameValid && contactValid && addressValid && cart\.length > 0/);
});

test("contact stays minimal: no identity documents, no account, no marketing", () => {
  for (const overreach of ["tcKimlik", "birthDate", "doğum", "password", "marketingConsent", "createAccount"]) {
    assert.equal(ui.includes(overreach), false, `the guest form asks for ${overreach}`);
  }
});

test("a retried submit reuses its key, so one order survives a timeout", () => {
  // `??=` keeps the key across retries; it is cleared only when the cart
  // changes, which makes the next submit a genuinely different request.
  assert.match(submitBlock, /idempotencyKeyRef\.current \?\?= newIdempotencyKey\(\)/);
  for (const mutation of ["addToCart", "changeQuantity", "removeFromCart"]) {
    const body = ui.slice(ui.indexOf(`function ${mutation}(`), ui.indexOf("}", ui.indexOf(`function ${mutation}(`)));
    assert.match(body, /resetIdempotency\(\)/, `${mutation} does not reset the idempotency key`);
  }
  // A double click cannot start a second request either.
  assert.match(submitBlock, /if \(!channel \|\| submitting \|\| cart\.length === 0\) return;/);
  assert.match(ui, /disabled=\{!ready \|\| submitting\}/);
});

test("the confirmation shows an order number and words, never an enum or a UUID", () => {
  const done = ui.slice(ui.indexOf('if (step === "done"'), ui.indexOf('if (step === "channel")'));
  // The words are looked up in the language the guest chose, not written here.
  assert.match(done, /\{t\("orderPlaced"\)\}/);
  assert.match(done, /t\(channel === "DELIVERY" \? "deliveryOrder" : "takeawayOrder"\)/);
  assert.match(done, /confirmation\.orderNumber/);
  // No identifier the guest cannot read out loud over the phone.
  assert.doesNotMatch(done, /orderId|\.id\b/);
});

test("no raw channel enum is ever rendered", () => {
  // The enum appears only as a value in code, never inside JSX text.
  const rendered = ui.match(/>[^<>{}]*\b(TAKEAWAY|DELIVERY|DINE_IN|FULFILLMENT)\b[^<>{}]*</g);
  assert.equal(rendered, null, `a raw channel reached the screen: ${rendered?.join(" | ")}`);
});

test("technical error codes never reach the guest", () => {
  for (const code of ["VALIDATION_ERROR", "AUTHENTICATION_REQUIRED", "INTERNAL_ERROR", "CONFLICT"]) {
    assert.equal(ui.includes(code), false, `${code} is shown to the guest`);
  }
  // The sentences moved into the shared dictionary, where all 109 languages
  // have one; the screen names the key rather than the sentence, and an
  // expired session is told apart from a refused order.
  assert.match(ui, /error instanceof ApiClientError && error\.status === 401/);
  assert.match(ui, /t\("sessionExpired"\)/);
  assert.match(ui, /t\("orderNotSent"\)/);
  assert.match(ui, /title=\{t\("orderingClosed"\)\}/);
});

test("the guest's contact details never reach a log or a telemetry payload", () => {
  for (const leak of ["console.log", "console.error", "console.warn", "navigator.sendBeacon"]) {
    assert.equal(ui.includes(leak), false, `the guest screen calls ${leak}`);
  }
  // The server side is where it would matter most: the route logs a name, not
  // a body.
  const route = readFileSync(new URL("../../app/api/guest-orders/route.ts", import.meta.url), "utf8");
  // The last catch is the request handler's; the first belongs to readJson.
  const handler = route.slice(route.lastIndexOf("catch (error)"));
  assert.match(handler, /errorName: error instanceof Error \? error\.name : "UnknownError"/);
  // Assert against the code, not the prose that explains why it is careful.
  const handlerCode = handler.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
  for (const personal of ["customerName", "contact", "address", "parsed.data"]) {
    assert.equal(handlerCode.includes(personal), false, `the error path logs ${personal}`);
  }
});

test("the guest screen reuses the menu components rather than copying them", () => {
  for (const component of ["ProductCard", "ProductDetailSheet", "CartItem", "MenuStateCard", "MenuPreferencesProvider"]) {
    assert.match(ui, new RegExp(`from "@/components/menu/[a-z-]+";`), "menu components are not imported");
    assert.ok(ui.includes(component), `${component} was not reused`);
  }
});

test("the guest browses the menu course by course, with nothing to decide first", () => {
  // A search field and a category rail used to sit above the dishes, so the
  // first thing a hungry stranger met was a choice about how to look. The menu
  // is presented the way the restaurant orders it instead — the same shape the
  // QR flow next door already uses.
  assert.match(ui, /\.filter\(\(section\) => section\.products\.length > 0\)/);
  assert.match(ui, /getMenuCategoryName\(category, language\)/);
  assert.equal(ui.includes("CategoryChips"), false, "the category chip rail came back");
  assert.equal(ui.includes('t("searchLabel")'), false, "the menu search field came back");
});

test("the QR table flow still opens dine-in orders and cannot open the guest channels", () => {
  const service = readFileSync(new URL("../../lib/services/order-service.ts", import.meta.url), "utf8");
  const customerEntry = service.slice(service.indexOf("createOrder(command: CreateCustomerOrderCommand)"), service.indexOf("createGuestOrder"));
  assert.match(customerEntry, /channel: "DINE_IN"/);
  assert.match(customerEntry, /kind: "CUSTOMER", tableAccessVersion: command\.tableAccessVersion/);

  // A table session reaching a guest channel is refused, and a guest session
  // reaching dine-in is refused: neither door opens the other.
  assert.match(service, /Masa oturumu paket sipariş açamaz/);
  assert.match(service, /Bu uç yalnızca paket ve kurye siparişi açar/);

  // The QR route itself is unchanged: still the table context, still /api/orders.
  const qrRoute = readFileSync(new URL("../../app/api/orders/route.ts", import.meta.url), "utf8");
  assert.match(qrRoute, /requireCustomerTableContext\(\)/);
  assert.match(qrRoute, /service\.createOrder\(/);
  assert.doesNotMatch(qrRoute, /channel/);
});

test("the guest menu is the same menu, read through the guest session", () => {
  const route = readFileSync(new URL("../../app/api/guest-menu/route.ts", import.meta.url), "utf8");
  assert.match(route, /requireGuestOrderContext\(\)/);
  assert.match(route, /service\.getPublicMenu\(context\.restaurantId\)/);
  // No table block, because there is no table.
  assert.doesNotMatch(route, /table:/);
});
