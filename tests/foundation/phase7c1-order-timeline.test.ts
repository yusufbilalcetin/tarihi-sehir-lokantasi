import assert from "node:assert/strict";
import test from "node:test";

import {
  DEDUP_WINDOW_MS,
  auditMirrorType,
  mergeTimeline,
  orderEventTitle,
  orderEventType,
  type OrderTimelineEntry,
  type TimelineSource,
} from "../../lib/domain/order-timeline";

function entry(
  overrides: Partial<OrderTimelineEntry> & { id: string; at: string; type: string },
): OrderTimelineEntry {
  return {
    title: overrides.type,
    description: null,
    actorName: null,
    actorRole: null,
    amount: null,
    productName: null,
    reason: null,
    source: "ORDER_EVENT" as TimelineSource,
    ...overrides,
  };
}

test("the timeline reads in chronological order", () => {
  const merged = mergeTimeline([
    entry({ id: "c", at: "2026-09-01T20:47:00.000Z", type: "PAYMENT", source: "PAYMENT" }),
    entry({ id: "a", at: "2026-09-01T20:00:00.000Z", type: "ORDER_STATUS" }),
    entry({ id: "b", at: "2026-09-01T20:30:00.000Z", type: "ITEM_STATUS" }),
  ]);

  assert.deepEqual(
    merged.map((item) => item.id),
    ["a", "b", "c"],
  );
});

test("an audit row that only mirrors an order event is folded away", () => {
  // Both are written inside the same transaction, milliseconds apart.
  const merged = mergeTimeline([
    entry({ id: "event", at: "2026-09-01T20:00:00.000Z", type: "ORDER_STATUS" }),
    entry({
      id: "audit",
      at: "2026-09-01T20:00:00.400Z",
      type: "ORDER_STATUS",
      source: "AUDIT_LOG",
    }),
  ]);

  assert.deepEqual(
    merged.map((item) => item.id),
    ["event"],
  );
});

test("an audit row with no matching event is kept", () => {
  // Table transfers are audited but write no order event; losing them would
  // silently drop a real action from the history.
  const merged = mergeTimeline([
    entry({ id: "event", at: "2026-09-01T20:00:00.000Z", type: "ORDER_STATUS" }),
    entry({
      id: "transfer",
      at: "2026-09-01T20:05:00.000Z",
      type: "TABLE_TRANSFERRED",
      source: "AUDIT_LOG",
    }),
  ]);

  assert.deepEqual(
    merged.map((item) => item.id),
    ["event", "transfer"],
  );
});

test("a repeat of the same action far apart in time is a real second action", () => {
  const merged = mergeTimeline([
    entry({ id: "first", at: "2026-09-01T20:00:00.000Z", type: "PAYMENT", source: "PAYMENT" }),
    entry({
      id: "later-audit",
      at: "2026-09-01T20:40:00.000Z",
      type: "PAYMENT",
      source: "AUDIT_LOG",
    }),
  ]);

  assert.equal(merged.length, 2, "a payment 40 minutes later is not a duplicate");
});

test("the dedup window is a transaction window, not a general tolerance", () => {
  const justInside = mergeTimeline([
    entry({ id: "event", at: "2026-09-01T20:00:00.000Z", type: "PAYMENT", source: "PAYMENT" }),
    entry({
      id: "audit",
      at: new Date(Date.parse("2026-09-01T20:00:00.000Z") + DEDUP_WINDOW_MS).toISOString(),
      type: "PAYMENT",
      source: "AUDIT_LOG",
    }),
  ]);
  assert.equal(justInside.length, 1);

  const justOutside = mergeTimeline([
    entry({ id: "event", at: "2026-09-01T20:00:00.000Z", type: "PAYMENT", source: "PAYMENT" }),
    entry({
      id: "audit",
      at: new Date(Date.parse("2026-09-01T20:00:00.000Z") + DEDUP_WINDOW_MS + 1).toISOString(),
      type: "PAYMENT",
      source: "AUDIT_LOG",
    }),
  ]);
  assert.equal(justOutside.length, 2);
});

test("two audit rows never cancel each other out", () => {
  // Only a non-audit source can absorb an audit row.
  const merged = mergeTimeline([
    entry({ id: "a1", at: "2026-09-01T20:00:00.000Z", type: "ITEM_VOIDED", source: "AUDIT_LOG" }),
    entry({ id: "a2", at: "2026-09-01T20:00:00.500Z", type: "ITEM_VOIDED", source: "AUDIT_LOG" }),
  ]);
  assert.equal(merged.length, 2);
});

test("two separate part payments both survive", () => {
  const merged = mergeTimeline([
    entry({
      id: "cash",
      at: "2026-09-01T20:45:00.000Z",
      type: "PAYMENT",
      source: "PAYMENT",
      amount: "500.00",
    }),
    entry({
      id: "card",
      at: "2026-09-01T20:47:00.000Z",
      type: "PAYMENT",
      source: "PAYMENT",
      amount: "1000.00",
    }),
  ]);

  assert.deepEqual(
    merged.map((item) => item.amount),
    ["500.00", "1000.00"],
  );
});

test("a refund keeps its own actor, not the collector's", () => {
  const merged = mergeTimeline([
    entry({
      id: "payment",
      at: "2026-09-01T20:45:00.000Z",
      type: "PAYMENT",
      source: "PAYMENT",
      actorName: "Kasiyer Ayşe",
    }),
    entry({
      id: "refund",
      at: "2026-09-01T21:10:00.000Z",
      type: "REFUND",
      source: "REFUND",
      actorName: "Yönetici Mehmet",
      reason: "CUSTOMER_COMPLAINT",
      amount: "200.00",
    }),
  ]);

  const refund = merged.find((item) => item.type === "REFUND");
  assert.equal(refund?.actorName, "Yönetici Mehmet");
  assert.equal(refund?.reason, "CUSTOMER_COMPLAINT");
});

test("a richer source wins when two entries share a timestamp", () => {
  const merged = mergeTimeline([
    entry({ id: "event", at: "2026-09-01T20:00:00.000Z", type: "PAYMENT" }),
    entry({
      id: "payment",
      at: "2026-09-01T20:00:00.000Z",
      type: "PAYMENT",
      source: "PAYMENT",
      amount: "500.00",
    }),
  ]);
  assert.equal(merged[0]?.id, "payment", "the payment row carries the money detail");
});

test("audit actions map onto the event types they mirror", () => {
  assert.equal(auditMirrorType("payment.completed"), "PAYMENT");
  assert.equal(auditMirrorType("payment.refunded"), "REFUND");
  assert.equal(auditMirrorType("order.item.voided"), "ITEM_VOIDED");
  // A table transfer mirrors nothing, so it must reach the timeline on its own.
  assert.equal(auditMirrorType("table.transferred"), null);
  assert.equal(auditMirrorType("table.merged"), null);
});

test("order events map to stable timeline types and Turkish titles", () => {
  assert.equal(orderEventType("ORDER_CONFIRMED"), "ORDER_STATUS");
  assert.equal(orderEventType("ORDER_ITEMS_ADDED"), "ITEMS_ADDED");
  assert.equal(orderEventType("ORDER_ITEM_VOIDED"), "ITEM_VOIDED");
  assert.equal(orderEventType("PAYMENT_REFUNDED"), "REFUND");
  assert.equal(orderEventType("CHECK_PAID"), "CHECK");

  assert.equal(orderEventTitle("ORDER_SERVED"), "Servis edildi");
  assert.equal(orderEventTitle("ORDER_ITEM_VOIDED"), "Ürün hesaptan çıkarıldı");
  // An unknown event still renders rather than disappearing.
  assert.equal(orderEventTitle("SOMETHING_NEW"), "SOMETHING_NEW");
});

test("an empty history produces an empty timeline", () => {
  assert.deepEqual(mergeTimeline([]), []);
});
