import assert from "node:assert/strict";
import test from "node:test";

import {
  ORDER_STATUS_TRANSITIONS,
  canTransitionOrderItemStatus,
  canTransitionOrderStatus,
  canTransitionPaymentStatus,
  canTransitionWaiterCallStatus,
  validateStatusTransition,
} from "../../lib/domain/status";

test("canonical order happy path is valid", () => {
  const path = ["NEW", "CONFIRMED", "PREPARING", "READY", "SERVED", "COMPLETED"] as const;

  for (let index = 0; index < path.length - 1; index += 1) {
    assert.equal(canTransitionOrderStatus(path[index], path[index + 1]), true);
  }
});

test("order status cannot skip stages, repeat, or leave a terminal status", () => {
  assert.equal(canTransitionOrderStatus("NEW", "READY"), false);
  assert.equal(canTransitionOrderStatus("READY", "READY"), false);
  assert.equal(canTransitionOrderStatus("COMPLETED", "NEW"), false);

  assert.deepEqual(validateStatusTransition(ORDER_STATUS_TRANSITIONS, "NEW", "NEW"), {
    valid: false,
    current: "NEW",
    next: "NEW",
    allowed: ["CONFIRMED", "CANCELLED"],
    reason: "SAME_STATUS",
  });
  const terminal = validateStatusTransition(ORDER_STATUS_TRANSITIONS, "COMPLETED", "NEW");
  assert.equal(terminal.valid, false);
  if (!terminal.valid) assert.equal(terminal.reason, "TERMINAL_STATUS");
});

test("cancellation and subsystem transition policies are explicit", () => {
  assert.equal(canTransitionOrderStatus("PREPARING", "CANCELLED"), true);
  assert.equal(canTransitionOrderItemStatus("PENDING", "PREPARING"), true);
  assert.equal(canTransitionOrderItemStatus("SERVED", "CANCELLED"), false);
  assert.equal(canTransitionWaiterCallStatus("OPEN", "ACKNOWLEDGED"), true);
  assert.equal(canTransitionWaiterCallStatus("RESOLVED", "OPEN"), false);
  assert.equal(canTransitionPaymentStatus("PENDING", "COMPLETED"), true);
  assert.equal(canTransitionPaymentStatus("COMPLETED", "REFUNDED"), true);
  assert.equal(canTransitionPaymentStatus("COMPLETED", "PENDING"), false);
});
