import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { ClaimedOutboxEvent } from "../../lib/repositories/outbox-repository";
import { RestaurantEventPublisher } from "../../lib/realtime/restaurant-event-publisher";
import { createSafeRealtimeEnvelope } from "../../lib/realtime/safe-event";
import {
  orderChannelName,
  restaurantStaffChannelName,
} from "../../lib/supabase/channels";

const RESTAURANT_ID = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
const ORDER_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const EVENT_ID = "6ba7b810-9dad-41d1-80b4-00c04fd430c8";

test("the actual subscription callback resyncs both first connection and reconnect", () => {
  // Execute the production callback with a fake transport, not a copied policy.
  // This does not claim to exercise a real Supabase socket or React lifecycle.
  const source = readFileSync("lib/realtime/use-staff-realtime.ts", "utf8");
  const body = source.match(/channel\.subscribe\(\(channelStatus\) => \{([\s\S]*?)\n    \}\);/)?.[1];
  assert.ok(body, "subscription callback must be found");
  let snapshots = 0;
  const statuses: string[] = [];
  const callback = new Function("setStatus", "handlersRef", `let connectedOnce = false; return (channelStatus) => {${body}};`)(
    (status: string) => statuses.push(status),
    { current: { onResync: () => { snapshots += 1; } } },
  );
  callback("SUBSCRIBED");
  assert.equal(snapshots, 1, "cover events missed between initial snapshot and subscription");
  callback("CHANNEL_ERROR");
  callback("SUBSCRIBED");
  assert.equal(snapshots, 2);
  assert.deepEqual(statuses, ["connected", "reconnecting", "connected"]);
});

function orderEvent(): ClaimedOutboxEvent {
  return {
    id: EVENT_ID,
    restaurantId: RESTAURANT_ID,
    aggregateType: "ORDER",
    aggregateId: ORDER_ID,
    eventType: "ORDER_READY",
    payload: {
      orderId: ORDER_ID,
      orderNumber: "TS-1042",
      tableId: "16fd2706-8baf-433b-82eb-8c7fada847da",
      status: "READY",
      notes: "Musterinin gizli notu",
      rawQrToken: "A".repeat(43),
      customerPhone: "+90 555 000 00 00",
    },
    attempts: 0,
    createdAt: new Date("2026-08-13T12:00:00.000Z"),
  };
}

test("Realtime envelope is minimal, de-duplicable, and drops sensitive fields", () => {
  const envelope = createSafeRealtimeEnvelope(orderEvent());
  assert.equal(envelope.eventId, EVENT_ID);
  assert.equal(envelope.occurredAt, "2026-08-13T12:00:00.000Z");
  assert.deepEqual(envelope.data, {
    orderId: ORDER_ID,
    orderNumber: "TS-1042",
    tableId: "16fd2706-8baf-433b-82eb-8c7fada847da",
    status: "READY",
  });
  const serialized = JSON.stringify(envelope);
  assert.doesNotMatch(serialized, /gizli|rawQrToken|customerPhone|A{43}/);
  assert.doesNotMatch(serialized, new RegExp(RESTAURANT_ID));
});

test("unknown event types trigger a cache invalidation without forwarding arbitrary data", () => {
  const event = { ...orderEvent(), eventType: "MENU_INVALIDATED" };
  assert.deepEqual(createSafeRealtimeEnvelope(event).data, {});
});

test("restaurant publisher always targets the private staff transport contract", async () => {
  const sent: Array<{ topic: string; event: string; payload: unknown }> = [];
  const publisher = new RestaurantEventPublisher({
    async sendPrivate(topic, event, payload) {
      sent.push({ topic, event, payload });
    },
  });

  await publisher.publish(orderEvent());
  assert.equal(sent[0]?.topic, `restaurant:${RESTAURANT_ID}:staff`);
  assert.equal(sent[0]?.event, "ORDER_READY");
});

test("channel helpers accept UUID identifiers and reject raw QR-shaped segments", () => {
  assert.equal(
    restaurantStaffChannelName(RESTAURANT_ID),
    `restaurant:${RESTAURANT_ID}:staff`,
  );
  assert.equal(
    orderChannelName(RESTAURANT_ID, ORDER_ID),
    `restaurant:${RESTAURANT_ID}:order:${ORDER_ID}`,
  );
  assert.throws(() => restaurantStaffChannelName("A".repeat(43)), /invalid realtime/);
});
