import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ORDER_ITEM_STATUS_TRANSITIONS,
  canRoleTransitionOrderItemStatus,
  canTransitionOrderItemStatus,
  deriveKitchenStage,
  isOrderItemRollback,
  isOrderStageCompatibleWithItemTransition,
  type OrderItemStatus,
} from "../../lib/domain/status";
import { staffOrderItemStatusBodySchema } from "../../lib/validation/staff-orders";

/**
 * The kitchen's undo.
 *
 * A cook who starts the wrong dish or marks a plate ready too early must be
 * able to put it back, and must not be able to reach anything that has already
 * left the kitchen. Those two sentences are the whole feature, and they are
 * decided here rather than in the screen.
 */

// ------------------------------------------------------------- the two edges

test("only the two preparation steps can be undone", () => {
  assert.equal(isOrderItemRollback("PREPARING", "PENDING"), true);
  assert.equal(isOrderItemRollback("READY", "PREPARING"), true);
  // Everything else is either forward motion or not a status change at all.
  for (const [current, next] of [
    ["READY", "PENDING"],
    ["SERVED", "READY"],
    ["SERVED", "PREPARING"],
    ["PENDING", "PREPARING"],
    ["CANCELLED", "PENDING"],
    ["VOIDED", "SERVED"],
  ] as [OrderItemStatus, OrderItemStatus][]) {
    assert.equal(
      isOrderItemRollback(current, next),
      false,
      `${current} → ${next} is not an undo`,
    );
  }
});

test("a served, cancelled or voided line has no way back", () => {
  assert.deepEqual([...ORDER_ITEM_STATUS_TRANSITIONS.SERVED], ["VOIDED"]);
  assert.deepEqual([...ORDER_ITEM_STATUS_TRANSITIONS.CANCELLED], []);
  assert.deepEqual([...ORDER_ITEM_STATUS_TRANSITIONS.VOIDED], []);
  assert.equal(canTransitionOrderItemStatus("SERVED", "READY"), false);
  assert.equal(canTransitionOrderItemStatus("READY", "PENDING"), false, "one step at a time");
});

test("the forward path is unchanged", () => {
  assert.equal(canTransitionOrderItemStatus("PENDING", "PREPARING"), true);
  assert.equal(canTransitionOrderItemStatus("PREPARING", "READY"), true);
  assert.equal(canTransitionOrderItemStatus("READY", "SERVED"), true);
});

// -------------------------------------------------------------------- roles

test("the kitchen may undo its own steps; the floor and the till may not", () => {
  for (const [current, next] of [
    ["PREPARING", "PENDING"],
    ["READY", "PREPARING"],
  ] as [OrderItemStatus, OrderItemStatus][]) {
    assert.equal(canRoleTransitionOrderItemStatus("KITCHEN", current, next), true);
    assert.equal(canRoleTransitionOrderItemStatus("ADMIN", current, next), true);
    assert.equal(canRoleTransitionOrderItemStatus("MANAGER", current, next), true);
    assert.equal(
      canRoleTransitionOrderItemStatus("WAITER", current, next),
      false,
      "a waiter does not reach back into preparation",
    );
    assert.equal(canRoleTransitionOrderItemStatus("CASHIER", current, next), false);
  }
});

test("the kitchen still cannot serve, and still cannot unserve", () => {
  assert.equal(canRoleTransitionOrderItemStatus("KITCHEN", "READY", "SERVED"), false);
  assert.equal(canRoleTransitionOrderItemStatus("KITCHEN", "SERVED", "READY"), false);
  // Serving remains the floor's, exactly as before.
  assert.equal(canRoleTransitionOrderItemStatus("WAITER", "READY", "SERVED"), true);
});

test("cancelling and voiding are never reachable through the status route", () => {
  for (const role of ["KITCHEN", "ADMIN", "MANAGER", "WAITER", "CASHIER"] as const) {
    assert.equal(canRoleTransitionOrderItemStatus(role, "PENDING", "CANCELLED"), false);
    assert.equal(canRoleTransitionOrderItemStatus(role, "SERVED", "VOIDED"), false);
  }
});

// ------------------------------------------------------------ order stages

test("an undo is allowed while the order is still open, and only then", () => {
  for (const orderStatus of ["CONFIRMED", "PREPARING", "READY", "SERVED"] as const) {
    assert.equal(
      isOrderStageCompatibleWithItemTransition(orderStatus, "READY", "PREPARING"),
      true,
      `${orderStatus} still allows a correction`,
    );
  }
  // A closed or abandoned order is refused by the service before this point,
  // and the stage rule agrees.
  for (const orderStatus of ["NEW", "COMPLETED", "CANCELLED"] as const) {
    assert.equal(
      isOrderStageCompatibleWithItemTransition(orderStatus, "READY", "PREPARING"),
      false,
    );
  }
});

// ------------------------------------------------------- board placement

const line = (status: OrderItemStatus) => ({ status });

test("a ticket sits in the column its outstanding lines put it in", () => {
  assert.equal(deriveKitchenStage([line("PENDING"), line("PENDING")]), "PENDING");
  assert.equal(deriveKitchenStage([line("PREPARING"), line("READY")]), "PREPARING");
  assert.equal(deriveKitchenStage([line("READY"), line("READY")]), "READY");
  // The earliest outstanding stage wins, because that is the work not yet done.
  assert.equal(deriveKitchenStage([line("READY"), line("PENDING")]), "PENDING");
  assert.equal(deriveKitchenStage([line("READY"), line("PREPARING")]), "PREPARING");
});

test("a late line pulls a finished ticket back to the queue", () => {
  // Masa 7: everything served, then the guest orders a cola.
  const served = [line("SERVED"), line("SERVED")];
  assert.equal(deriveKitchenStage(served), null, "nothing left for the kitchen");
  assert.equal(
    deriveKitchenStage([...served, line("PENDING")]),
    "PENDING",
    "the late line is the kitchen's work now",
  );
});

test("cancelled and voided lines are not kitchen work", () => {
  assert.equal(deriveKitchenStage([line("SERVED"), line("CANCELLED")]), null);
  assert.equal(deriveKitchenStage([line("VOIDED"), line("VOIDED")]), null);
  assert.equal(deriveKitchenStage([line("CANCELLED"), line("PENDING")]), "PENDING");
  assert.equal(deriveKitchenStage([]), null);
});

test("undoing one line of a ready ticket takes the whole ticket back", () => {
  const ticket = [line("READY"), line("READY"), line("READY")];
  assert.equal(deriveKitchenStage(ticket), "READY");
  const corrected = [line("READY"), line("PREPARING"), line("READY")];
  assert.equal(deriveKitchenStage(corrected), "PREPARING", "no longer fully ready");
  // And putting it back finishes the ticket again.
  assert.equal(deriveKitchenStage(ticket), "READY");
});

// -------------------------------------------------------------- validation

test("the status body accepts the undo targets and an optional reason", () => {
  assert.equal(staffOrderItemStatusBodySchema.safeParse({ status: "PENDING" }).success, true);
  assert.equal(staffOrderItemStatusBodySchema.safeParse({ status: "PREPARING" }).success, true);
  assert.equal(
    staffOrderItemStatusBodySchema.safeParse({ status: "READY", reasonCode: "REHEAT" }).success,
    true,
  );
  assert.equal(
    staffOrderItemStatusBodySchema.safeParse({
      status: "PREPARING",
      reasonCode: "MARKED_BY_MISTAKE",
      reasonNote: "Yanlış masaya bakıldı",
    }).success,
    true,
  );

  // What it must not accept: a financial correction, an unknown reason, or a
  // client trying to tell the server where the line is coming from.
  assert.equal(staffOrderItemStatusBodySchema.safeParse({ status: "CANCELLED" }).success, false);
  assert.equal(staffOrderItemStatusBodySchema.safeParse({ status: "VOIDED" }).success, false);
  assert.equal(
    staffOrderItemStatusBodySchema.safeParse({ status: "PREPARING", reasonCode: "BECAUSE" })
      .success,
    false,
  );
  for (const field of ["fromStatus", "restaurantId", "actorId", "userId"]) {
    assert.equal(
      staffOrderItemStatusBodySchema.safeParse({ status: "PREPARING", [field]: "x" }).success,
      false,
      `${field} must not be accepted from the client`,
    );
  }
});

// ------------------------------------------------- malformed identifiers

test("a malformed identifier is a bad request, not a server fault", async () => {
  const { apiFailureFromUnknown } = await import("../../lib/api/response");
  const driverError = Object.assign(new Error("invalid input syntax for type uuid"), {
    code: "22P02",
  });

  const direct = apiFailureFromUnknown(driverError);
  assert.equal(direct.status, 400, "the driver error becomes a 400");
  assert.equal(direct.body.success, false);
  assert.equal(
    (direct.body as { error: { code: string; message: string } }).error.code,
    "VALIDATION_ERROR",
  );
  assert.ok(
    !JSON.stringify(direct.body).includes("uuid"),
    "and the driver's own wording never reaches the caller",
  );

  // The query layer wraps driver errors, so the cause chain must be followed.
  const wrapped = apiFailureFromUnknown(
    Object.assign(new Error("Failed query"), { cause: driverError }),
  );
  assert.equal(wrapped.status, 400, "a wrapped driver error is recognised too");

  // Anything else is still an internal error, still unexposed.
  const unrelated = apiFailureFromUnknown(new Error("something else"));
  assert.equal(unrelated.status, 500);
  assert.equal(
    (unrelated.body as { error: { code: string } }).error.code,
    "INTERNAL_ERROR",
  );
});
