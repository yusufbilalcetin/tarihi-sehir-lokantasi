import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ERP_UI_CONFIG } from "../../lib/domain/erp-ui";
import { ERP_STATUS_LABELS, ERP_WORKSPACE_MODULES, assertFulfillmentTransition, erpEnumLabel } from "../../lib/domain/erp-workspaces";
import { erpCommandSchema } from "../../lib/validation/erp";
import { ORDER_CHANNELS, orderRequiresTable } from "../../lib/domain/status";
import { ORDER_CHANNEL_LABELS, orderPlaceLabel } from "../../lib/domain/display";

/**
 * Takeaway and courier orders.
 *
 * Two things here are worth protecting with a test rather than a review. The
 * first is that a customer-facing price never arrives from the client — the
 * server reads it from the product catalogue, so a tampered request cannot buy
 * a main course for one lira. The second is that the delivery states only move
 * forward, because "Teslim Edildi" is a claim about the physical world that
 * must not be reachable from a draft.
 */

const PRODUCT = "11111111-1111-4111-8111-111111111111";

function command(overrides: Record<string, unknown> = {}) {
  return {
    command: "CREATE_FULFILLMENT_REQUEST",
    channel: "TAKEAWAY",
    customerName: "Ayşe Yılmaz",
    contact: "05001234567",
    address: null,
    deliveryNotes: null,
    requestedAt: null,
    deliveryFee: "0",
    idempotencyKey: "fulfillment-0001",
    items: [{ productId: PRODUCT, quantity: 2, notes: null }],
    ...overrides,
  };
}

test("a courier order without an address is refused before it reaches the database", () => {
  const parsed = erpCommandSchema.safeParse(command({ channel: "DELIVERY", address: null }));
  assert.equal(parsed.success, false);
  assert.match(parsed.error!.issues.map((issue) => issue.message).join(" "), /adres/i);
});

test("a takeaway order carrying an address is refused; there is nowhere to deliver it", () => {
  const parsed = erpCommandSchema.safeParse(command({ address: "Atatürk Cd. 5" }));
  assert.equal(parsed.success, false);
});

test("both channels are accepted in their correct shape", () => {
  assert.equal(erpCommandSchema.safeParse(command()).success, true);
  assert.equal(erpCommandSchema.safeParse(command({ channel: "DELIVERY", address: "Atatürk Cd. 5" })).success, true);
});

test("the client cannot name a price: money fields are stripped from the command", () => {
  const parsed = erpCommandSchema.safeParse(
    command({ items: [{ productId: PRODUCT, quantity: 1, notes: null, unitPrice: "0.01", lineTotal: "0.01" }] }),
  );
  assert.equal(parsed.success, true);
  const item = (parsed.data as { items: readonly Record<string, unknown>[] }).items[0];
  assert.equal("unitPrice" in item, false);
  assert.equal("lineTotal" in item, false);
});

test("the repository prices lines from the product catalogue, not from its input", () => {
  const source = readFileSync(new URL("../../lib/repositories/drizzle-erp-repository.ts", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("createFulfillmentRequest(input"), source.indexOf("async refreshPopularProducts("));
  // The unit price is read off the catalogue row and the line total is derived
  // from it, so nothing the caller sends can influence what is charged. The
  // assertion is scoped to the block that builds the priced lines: elsewhere
  // in the method `line` is a row read back from the database, which may
  // legitimately carry money.
  const pricing = body.slice(body.indexOf("input.items.map("), body.indexOf("tx.insert(fulfillmentRequests)"));
  assert.match(pricing, /products?\.price|priceById/);
  assert.match(pricing, /unitMinor \* BigInt\(line\.quantity\)/);
  assert.doesNotMatch(pricing, /line\.unitPrice|line\.lineTotal|line\.price/);
  assert.match(body, /products\.price/);
  // Tenant scope is on every read and write inside the transaction.
  assert.match(body, /eq\(products\.restaurantId, input\.restaurantId\)/);
  assert.match(body, /eq\(fulfillmentRequests\.restaurantId, input\.restaurantId\)/);
});

test("the audit trail records the transaction, not the customer's personal data", () => {
  const source = readFileSync(new URL("../../lib/repositories/drizzle-erp-repository.ts", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("createFulfillmentRequest(input"), source.indexOf("async refreshPopularProducts("));
  const audit = body.slice(body.indexOf("erp.fulfillment.created"), body.indexOf("requestId: input.audit.requestId", body.indexOf("erp.fulfillment.created")));
  for (const personal of ["customerName", "contact", "address", "deliveryNotes"]) {
    assert.equal(audit.includes(personal), false, `audit log must not carry ${personal}`);
  }
});

test("delivery states only move forward", () => {
  const path = ["DRAFT", "PLACED", "WAITING_FOR_COURIER", "OUT_FOR_DELIVERY", "DELIVERED"] as const;
  for (let index = 0; index < path.length - 1; index += 1) {
    assert.doesNotThrow(() => assertFulfillmentTransition(path[index], path[index + 1]));
  }
  assert.throws(() => assertFulfillmentTransition("DRAFT", "DELIVERED"));
  assert.throws(() => assertFulfillmentTransition("DELIVERED", "OUT_FOR_DELIVERY"));
  assert.throws(() => assertFulfillmentTransition("CANCELLED", "PLACED"));
});

test("every delivery state reads as Turkish the courier and the guest would use", () => {
  assert.equal(ERP_STATUS_LABELS.WAITING_FOR_COURIER, "Kurye Bekleniyor");
  assert.equal(ERP_STATUS_LABELS.OUT_FOR_DELIVERY, "Yola Çıktı");
  assert.equal(ERP_STATUS_LABELS.DELIVERED, "Teslim Edildi");
  for (const status of ERP_UI_CONFIG.fulfillment.statuses ?? []) {
    assert.equal(ERP_STATUS_LABELS[status.value], status.label, `${status.value} label disagrees with the shared vocabulary`);
  }
});

test("the module is reachable: registered, described and routed", () => {
  assert.ok(ERP_WORKSPACE_MODULES.includes("fulfillment"));
  assert.ok(ERP_UI_CONFIG.fulfillment.columns.length > 0);
  const page = readFileSync(new URL("../../app/admin/fulfillment/page.tsx", import.meta.url), "utf8");
  assert.match(page, /module="fulfillment"/);
  const navigation = readFileSync(new URL("../../components/admin/admin-navigation.ts", import.meta.url), "utf8");
  assert.match(navigation, /\/admin\/fulfillment/);
});

test("no raw enum reaches the fulfillment table: every value it can show has a word", () => {
  // The columns marked `status` are rendered through the shared vocabulary.
  // Whatever the database can put in them must have a Turkish label, or the
  // screen falls back to printing WAITING_FOR_COURIER at a human being.
  const shown = {
    channel: ["TAKEAWAY", "DELIVERY"],
    status: ["DRAFT", "PLACED", "WAITING_FOR_COURIER", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"],
    order_status: ["NEW", "CONFIRMED", "PREPARING", "READY", "SERVED", "COMPLETED", "CANCELLED"],
    kitchen_link: ["LINKED", "NOT_LINKED"],
  } as const;
  const statusColumns = ERP_UI_CONFIG.fulfillment.columns.filter((column) => column.kind === "status").map((column) => column.key);
  assert.deepEqual(statusColumns.sort(), Object.keys(shown).sort(), "a status column exists with no vocabulary behind it");
  for (const [column, values] of Object.entries(shown)) {
    for (const value of values) {
      // `erpEnumLabel` is the single vocabulary every ERP surface reads, so
      // asking it is the same question the screen and the CSV both ask.
      const known = erpEnumLabel(value) !== null;
      assert.ok(known, `${column} can show ${value}, which has no Turkish label`);
    }
  }
});

test("the fulfillment line table ships with a migration, not only a TypeScript definition", () => {
  const migration = readFileSync(new URL("../../db/migrations/0014_phase39_fulfillment_items.sql", import.meta.url), "utf8");
  assert.doesNotMatch(migration, /DROP\s+(?:TABLE|COLUMN|TYPE)/i);
  assert.match(migration, /CREATE TABLE "fulfillment_request_items"/);
  // The restaurant travels inside the foreign key, so a line cannot be
  // attached to another tenant's request or priced from their catalogue.
  assert.match(migration, /FOREIGN KEY \("restaurant_id", "fulfillment_request_id"\) REFERENCES "fulfillment_requests"\("restaurant_id", "id"\)/);
  assert.match(migration, /FOREIGN KEY \("restaurant_id", "product_id"\) REFERENCES "products"\("restaurant_id", "id"\)/);
  assert.match(migration, /REVOKE ALL ON TABLE "fulfillment_request_items" FROM anon, authenticated/);
  assert.match(migration, /ALTER TABLE "fulfillment_request_items" ENABLE ROW LEVEL SECURITY/);
  // The database, not the application, is the last word on what a line costs.
  assert.match(migration, /line_total" = round\(/);
});

test("module shells that hand an icon to a window stay on the client side of the boundary", () => {
  // Every ERP page is `<ErpWorkspaceModule module="…"/>`, and that component
  // looks an icon component out of a map and passes it to a client window.
  // A function cannot cross the server/client boundary, so the whole ERP UI
  // fails to prerender the moment this file becomes a Server Component.
  for (const shell of ["erp-workspace-module.tsx", "erp-operations-module.tsx"]) {
    const source = readFileSync(new URL(`../../components/admin/${shell}`, import.meta.url), "utf8");
    assert.match(source.trimStart().slice(0, 20), /^"use client"/, `${shell} must be a Client Component`);
  }
});

test("the kitchen bridge reuses the order domain instead of duplicating it", () => {
  const source = readFileSync(new URL("../../lib/repositories/drizzle-erp-workspace-repository.ts", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("private linkFulfillmentOrder"), source.indexOf("private setFulfillmentStatus"));
  // A request may only be handed to an order that is still open, is not
  // already spoken for, and belongs to this restaurant.
  assert.match(body, /OPEN_ORDER_STATUSES\.includes\(order\.status\)/);
  assert.match(body, /eq\(orders\.restaurantId, input\.restaurantId\)/);
  assert.match(body, /\.for\("update"\)/);
  assert.match(body, /zaten bir siparişe bağlı|başka bir paket kaydına bağlı/);
  // No second payment or refund path: the bridge only sets order_id.
  assert.doesNotMatch(body, /payments|refund|cashierShift|cash_movements/i);
});

test("linked requests read their total from the order, not from their own lines", () => {
  const source = readFileSync(new URL("../../lib/repositories/drizzle-erp-workspace-repository.ts", import.meta.url), "utf8");
  const query = source.slice(source.indexOf('case "fulfillment":'), source.indexOf('case "customers":'));
  assert.match(query, /coalesce\(o\.total, coalesce\(sum\(fi\.line_total\),0\)\)/);
  assert.match(query, /left join orders o on o\.restaurant_id=fr\.restaurant_id/);
});

test("every registered ERP module is actually reachable: read, screen, route and nav", () => {
  const repo = readFileSync(new URL("../../lib/repositories/drizzle-erp-workspace-repository.ts", import.meta.url), "utf8");
  const navigation = readFileSync(new URL("../../components/admin/admin-navigation.ts", import.meta.url), "utf8");
  const readBlock = repo.slice(repo.indexOf("switch (query.module)"));
  for (const name of ERP_WORKSPACE_MODULES) {
    assert.ok(readBlock.includes(`case "${name}":`), `${name} has no read branch`);
    assert.ok(ERP_UI_CONFIG[name].columns.length > 0 || name === "loyalty", `${name} has no columns`);
    assert.ok(navigation.includes(`/admin/${name}"`), `${name} is not in the admin navigation`);
  }
});

test("purchase price history is read from what was paid, not from what was quoted", () => {
  const repo = readFileSync(new URL("../../lib/repositories/drizzle-erp-workspace-repository.ts", import.meta.url), "utf8");
  const query = repo.slice(repo.indexOf('case "price-history":'), repo.indexOf('case "forecast":'));
  // Goods receipts hold the price actually paid; purchase order lines hold
  // the quote. The trend must come from the former.
  assert.match(query, /from goods_receipt_items/);
  assert.doesNotMatch(query, /from purchase_order_items/);
  assert.match(query, /lag\(gri\.unit_price\) over \(partition by gri\.inventory_item_id/);
  assert.match(query, /gri\.restaurant_id=\$\{restaurantId\}|restaurant_id=\$\{restaurantId\}/);
  assert.match(query, /limit \$\{pageSize\} offset \$\{offset\}/);
});

test("a marketing consent flag is never stored without the moment it was given", () => {
  const repo = readFileSync(new URL("../../lib/repositories/drizzle-erp-repository.ts", import.meta.url), "utf8");
  const body = repo.slice(repo.indexOf("createCustomerAccount(input"), repo.indexOf("Opens a takeaway or courier order"));
  // customer_accounts_consent_check enforces this in the database; the
  // timestamp is taken here rather than accepted from the caller.
  assert.match(body, /marketingConsentAt: input\.marketingConsent \? new Date\(\) : null/);
  assert.doesNotMatch(body, /input\.marketingConsentAt/);
  const audit = body.slice(body.indexOf("erp.customer_account.created"));
  for (const personal of ["input.email", "input.phone", "input.name"]) {
    assert.equal(audit.includes(personal), false, `audit log must not carry ${personal}`);
  }
});

test("only dine-in orders have a table, and only they may claim one", () => {
  assert.deepEqual([...ORDER_CHANNELS], ["DINE_IN", "TAKEAWAY", "DELIVERY"]);
  assert.equal(orderRequiresTable("DINE_IN"), true);
  assert.equal(orderRequiresTable("TAKEAWAY"), false);
  assert.equal(orderRequiresTable("DELIVERY"), false);
});

test("the order channel migration is additive and backfills every existing row", () => {
  const migration = readFileSync(new URL("../../db/migrations/0015_phase39_order_channel.sql", import.meta.url), "utf8");
  assert.doesNotMatch(migration, /DROP\s+(?:TABLE|COLUMN|TYPE)/i);
  // Existing rows are all dine-in; the default is what backfills them.
  assert.match(migration, /ADD COLUMN "channel" "order_channel" DEFAULT 'DINE_IN' NOT NULL/);
  assert.match(migration, /ALTER COLUMN "table_id" DROP NOT NULL/);
  assert.match(migration, /CONSTRAINT "orders_channel_table_check"/);
  // The column must exist with its default before the check can pass.
  assert.ok(migration.indexOf("ADD COLUMN \"channel\"") < migration.indexOf("orders_channel_table_check"));
  // Both halves of the invariant.
  assert.match(migration, /"orders"\."channel" = 'DINE_IN' and "orders"\."table_id" is not null/);
  assert.match(migration, /in \('TAKEAWAY', 'DELIVERY'\) and "orders"\."table_id" is null/);
});

test("no screen has to know about channels: one label says where an order is", () => {
  assert.equal(orderPlaceLabel("DINE_IN", "Masa 7"), "Masa 7");
  assert.equal(orderPlaceLabel("TAKEAWAY", null), "Paket Sipariş");
  assert.equal(orderPlaceLabel("DELIVERY", null), "Kurye Siparişi");
  // A raw enum must never reach a person.
  for (const channel of ORDER_CHANNELS) {
    assert.ok(ORDER_CHANNEL_LABELS[channel] && !/[A-Z_]{4,}/.test(ORDER_CHANNEL_LABELS[channel]));
  }
});

test("a takeaway order cannot be dropped by a join or move a table", () => {
  const files = {
    "lib/services/kitchen-print.ts": "the kitchen ticket",
    "lib/services/print-document-service.ts": "the printed bill",
    "lib/repositories/drizzle-payment-repository.ts": "the till",
    "lib/repositories/drizzle-staff-order-repository.ts": "the order list the kitchen reads",
  };
  for (const [file, what] of Object.entries(files)) {
    const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
    const linkIndex = source.indexOf("eq(restaurantTables.id, orders.tableId)");
    assert.ok(linkIndex > 0, `${file} no longer joins orders to tables`);
    const before = source.slice(0, linkIndex);
    assert.ok(
      before.lastIndexOf(".leftJoin(") > before.lastIndexOf(".innerJoin("),
      `${what} inner-joins the table, so takeaway orders vanish from it`,
    );
  }
  // Settling a takeaway order must not touch the floor plan.
  const payment = readFileSync(new URL("../../lib/services/payment-service.ts", import.meta.url), "utf8");
  assert.match(payment, /if \(order\.tableId !== null\)/);
});
