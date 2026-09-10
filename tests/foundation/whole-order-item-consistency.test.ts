import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { DomainError } from "../../lib/api/domain-error";
import {
  ORDER_STAGE_ITEM_CASCADE,
  deriveOrderStatusFromItems,
  isOrderStageCompatibleWithItemTransition,
  itemsBlockingOrderStage,
  orderStageItemCascade,
} from "../../lib/domain/status";
import { line, order, principal, service, state } from "./phase6-order-fixtures";

/**
 * The order row is a summary of its lines. A whole-order command that moves the
 * summary on its own makes the order lie — READY with food still on the stove,
 * SERVED with a line the pass never started — and strands those lines, because
 * an item may not move under an order that has run ahead of it.
 *
 * So a whole-order command carries its lines with it, and refuses when a line
 * is too far behind to be swept up.
 */

// ------------------------------------------------- the summary cannot lie

test("a whole-order READY refuses while a line has not been started", async () => {
  const fixture = state({
    order: order({
      status: "PREPARING",
      items: [
        line({ id: "item-1", status: "PREPARING" }),
        // The guest ordered a cola after the round went in. Nobody poured it.
        line({ id: "item-2", status: "PENDING" }),
      ],
    }),
  });

  await assert.rejects(
    () =>
      service(fixture).updateStatus(principal("KITCHEN"), {
        restaurantId: "restaurant-1",
        orderId: "order-1",
        nextStatus: "READY",
      }),
    (error: unknown) =>
      error instanceof DomainError &&
      error.code === "INVALID_STATUS_TRANSITION" &&
      (error.details as { blockingItemIds?: string[] })?.blockingItemIds?.[0] === "item-2",
  );
  assert.equal(fixture.statusUpdates.length, 0, "the order stayed where its lines are");
});

test("a whole-order SERVED refuses while a line is still on the stove", async () => {
  const fixture = state({
    order: order({
      status: "READY",
      items: [line({ id: "item-1", status: "READY" }), line({ id: "item-2", status: "PREPARING" })],
    }),
  });

  await assert.rejects(
    () =>
      service(fixture).updateStatus(principal("WAITER"), {
        restaurantId: "restaurant-1",
        orderId: "order-1",
        nextStatus: "SERVED",
      }),
    (error: unknown) => error instanceof DomainError && error.code === "INVALID_STATUS_TRANSITION",
  );
  assert.equal(fixture.statusUpdates.length, 0);
  assert.equal(fixture.advancedItems.length, 0, "and nothing was swept up on the way out");
});

// ------------------------------------------------- the command carries the lines

test("a whole-order PREPARING starts every line that was waiting", async () => {
  const fixture = state({
    order: order({
      status: "CONFIRMED",
      items: [line({ id: "item-1", status: "PENDING" }), line({ id: "item-2", status: "PENDING" })],
    }),
  });

  await service(fixture).updateStatus(principal("KITCHEN"), {
    restaurantId: "restaurant-1",
    orderId: "order-1",
    nextStatus: "PREPARING",
  });

  assert.deepEqual(
    fixture.order?.items.map((item) => item.status),
    ["PREPARING", "PREPARING"],
  );
  assert.equal(fixture.statusUpdates[0]?.nextStatus, "PREPARING");
});

test("a whole-order READY takes the lines to the pass with it", async () => {
  const fixture = state({
    order: order({
      status: "PREPARING",
      items: [
        line({ id: "item-1", status: "PREPARING" }),
        // Already plated on its own; a second sweep must not disturb it.
        line({ id: "item-2", status: "READY" }),
      ],
    }),
  });

  await service(fixture).updateStatus(principal("KITCHEN"), {
    restaurantId: "restaurant-1",
    orderId: "order-1",
    nextStatus: "READY",
  });

  const statuses = fixture.order?.items.map((item) => item.status) ?? [];
  assert.deepEqual(statuses, ["READY", "READY"]);
  assert.equal(
    deriveOrderStatusFromItems("PREPARING", fixture.order?.items ?? []),
    "READY",
    "the lines now derive the very status the command claimed",
  );
});

test("a whole-order SERVED takes the lines to the table with it", async () => {
  const fixture = state({
    order: order({
      status: "READY",
      items: [line({ id: "item-1", status: "READY" }), line({ id: "item-2", status: "SERVED" })],
    }),
  });

  await service(fixture).updateStatus(principal("WAITER"), {
    restaurantId: "restaurant-1",
    orderId: "order-1",
    nextStatus: "SERVED",
  });

  assert.deepEqual(
    fixture.order?.items.map((item) => item.status),
    ["SERVED", "SERVED"],
  );
});

// ------------------------------------------ lines that are off the bill

test("cancelled and voided lines neither block a stage nor come back to life", async () => {
  const fixture = state({
    order: order({
      status: "READY",
      items: [
        line({ id: "item-1", status: "READY" }),
        // Cancelled before it was made: it looks like a line the kitchen never
        // started, and must not be mistaken for one.
        line({ id: "item-2", status: "CANCELLED" }),
        line({ id: "item-3", status: "VOIDED" }),
      ],
    }),
  });

  await service(fixture).updateStatus(principal("WAITER"), {
    restaurantId: "restaurant-1",
    orderId: "order-1",
    nextStatus: "SERVED",
  });

  assert.deepEqual(
    fixture.order?.items.map((item) => item.status),
    ["SERVED", "CANCELLED", "VOIDED"],
  );
  assert.equal(fixture.statusUpdates[0]?.nextStatus, "SERVED");
});

// --------------------------------------------- a late line is still cookable

test("a line added after the ticket was finished can still be cooked", () => {
  // Masa 7: everything ready, then the guest orders a cola. Adding the line
  // does not move the order back, so the pass sees a PENDING line under a
  // READY — and later a SERVED — order. Refusing to start it would strand it
  // for ever: the kitchen has no whole-order command out of those stages.
  for (const orderStatus of ["CONFIRMED", "PREPARING", "READY", "SERVED"] as const) {
    assert.equal(
      isOrderStageCompatibleWithItemTransition(orderStatus, "PENDING", "PREPARING"),
      true,
      `${orderStatus} must still let the kitchen start a late line`,
    );
  }
  for (const orderStatus of ["NEW", "COMPLETED", "CANCELLED"] as const) {
    assert.equal(
      isOrderStageCompatibleWithItemTransition(orderStatus, "PENDING", "PREPARING"),
      false,
      `${orderStatus} is not the kitchen's to work on`,
    );
  }
  // And starting it derives the parent back to where the work actually is.
  assert.equal(
    deriveOrderStatusFromItems("READY", [{ status: "READY" }, { status: "PREPARING" }]),
    "PREPARING",
  );
});

// ------------------------------------------------- preparation is not money

test("settling and cancelling an order sweep no lines", () => {
  // COMPLETED is a payment outcome and CANCELLED is a financial correction.
  // Neither is a kitchen step, so neither may quietly mark food as made.
  assert.equal(orderStageItemCascade("COMPLETED"), null);
  assert.equal(orderStageItemCascade("CANCELLED"), null);
  assert.equal(orderStageItemCascade("CONFIRMED"), null);
  assert.equal(orderStageItemCascade("NEW"), null);
  for (const stage of Object.values(ORDER_STAGE_ITEM_CASCADE)) {
    for (const from of stage.advance) {
      assert.ok(
        from !== "CANCELLED" && from !== "VOIDED" && from !== "SERVED",
        "a sweep never reaches a line that is off the bill or already at the table",
      );
    }
  }
});

test("a cashier closing a served order leaves every line alone", async () => {
  const fixture = state({
    order: order({
      status: "SERVED",
      items: [line({ id: "item-1", status: "SERVED" })],
    }),
  });

  await service(fixture).updateStatus(principal("CASHIER"), {
    restaurantId: "restaurant-1",
    orderId: "order-1",
    nextStatus: "COMPLETED",
  });

  assert.equal(fixture.advancedItems.length, 0);
  assert.deepEqual(fixture.order?.items.map((item) => item.status), ["SERVED"]);
});

// --------------------------------------------------------------- the record

test("the sweep is on the event, the outbox and the audit trail", async () => {
  const fixture = state({
    order: order({
      status: "PREPARING",
      items: [line({ id: "item-1", status: "PREPARING" }), line({ id: "item-2", status: "PREPARING" })],
    }),
  });

  await service(fixture).updateStatus(principal("KITCHEN"), {
    restaurantId: "restaurant-1",
    orderId: "order-1",
    nextStatus: "READY",
    requestId: "request-cascade",
  });

  assert.deepEqual(fixture.events[0]?.payload.cascadedItemIds, ["item-1", "item-2"]);
  assert.deepEqual(fixture.outbox[0]?.payload.cascadedItemIds, ["item-1", "item-2"]);
  assert.deepEqual(fixture.audits[0]?.metadata?.cascadedItemIds, ["item-1", "item-2"]);
  assert.equal(fixture.audits[0]?.metadata?.cascadedItemStatus, "READY");
});

// -------------------------------------------------- the screen agrees

test("the kitchen board hides a whole-ticket action the server would refuse", () => {
  const board = readFileSync(
    new URL("../../components/kitchen/kitchen-board.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    board,
    /itemsBlockingOrderStage\(/,
    "a visible button must never be a guaranteed 409",
  );

  // And the rule it calls is the same one the service refuses on.
  assert.deepEqual(
    itemsBlockingOrderStage("READY", [
      { id: "a", status: "PREPARING" },
      { id: "b", status: "PENDING" },
      { id: "c", status: "CANCELLED" },
    ]).map((item) => item.id),
    ["b"],
  );
  assert.deepEqual(itemsBlockingOrderStage("COMPLETED", [{ id: "a", status: "PENDING" }]), []);
});

test("a ticket's button follows the lane its lines put it in", () => {
  const ticket = readFileSync(
    new URL("../../components/kitchen/kitchen-ticket.tsx", import.meta.url),
    "utf8",
  );
  // Masa 7 is plated, then the guest orders a cola. The lines put the ticket
  // back in the queue; reading the action off the order header would offer
  // "servise teslim et" for a drink nobody has poured.
  assert.doesNotMatch(
    ticket,
    /order\.status as KitchenStage/,
    "the ticket read its stage off the order header again",
  );
  assert.match(ticket, /stage: KitchenStage;/, "the lane is passed in, not guessed");
});
