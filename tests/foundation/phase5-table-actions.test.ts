import assert from "node:assert/strict";
import test from "node:test";

import {
  TABLE_QUICK_ACTION_IDS,
  resolveTableQuickActions,
  type TableQuickAction,
  type TableQuickActionContext,
  type TableQuickActionId,
} from "../../lib/domain/table-actions";

function context(overrides: Partial<TableQuickActionContext> = {}): TableQuickActionContext {
  return {
    role: "WAITER",
    tableActive: true,
    order: null,
    openCalls: [],
    ...overrides,
  };
}

function action(
  actions: readonly TableQuickAction[],
  id: TableQuickActionId,
): TableQuickAction {
  const found = actions.find((candidate) => candidate.id === id);
  assert.ok(found, `${id} action is missing`);
  return found;
}

test("the table card exposes exactly the six shortcuts, always in order", () => {
  const actions = resolveTableQuickActions(context());
  assert.deepEqual(
    actions.map((item) => item.id),
    [...TABLE_QUICK_ACTION_IDS],
  );
});

test("order shortcuts stay closed while the table has no open order", () => {
  const actions = resolveTableQuickActions(context());
  const confirm = action(actions, "confirm-order");
  const served = action(actions, "mark-served");

  assert.equal(confirm.enabled, false);
  assert.equal(confirm.disabledReason, "Onaylanacak sipariş yok.");
  assert.equal(served.enabled, false);
  assert.equal(served.disabledReason, "Servis edilecek sipariş yok.");
});

test("a waiter may confirm a NEW order but not serve it yet", () => {
  const actions = resolveTableQuickActions(
    context({ order: { id: "order-a", status: "NEW" } }),
  );
  const confirm = action(actions, "confirm-order");

  assert.equal(confirm.enabled, true);
  assert.deepEqual(confirm.intent, {
    kind: "ORDER_STATUS",
    orderId: "order-a",
    nextStatus: "CONFIRMED",
  });
  assert.equal(action(actions, "mark-served").enabled, false);
});

test("serving unlocks only once the kitchen has marked the order READY", () => {
  const preparing = resolveTableQuickActions(
    context({ order: { id: "order-a", status: "PREPARING" } }),
  );
  assert.equal(action(preparing, "mark-served").enabled, false);
  assert.equal(
    action(preparing, "mark-served").disabledReason,
    "Sipariş henüz servise hazır değil.",
  );

  const ready = resolveTableQuickActions(
    context({ order: { id: "order-a", status: "READY" } }),
  );
  const served = action(ready, "mark-served");
  assert.equal(served.enabled, true);
  assert.deepEqual(served.intent, {
    kind: "ORDER_STATUS",
    orderId: "order-a",
    nextStatus: "SERVED",
  });
});

test("a completed order offers no further status shortcut", () => {
  const actions = resolveTableQuickActions(
    context({ order: { id: "order-a", status: "COMPLETED" } }),
  );
  assert.equal(action(actions, "confirm-order").enabled, false);
  assert.equal(action(actions, "mark-served").enabled, false);
});

test("call shortcuts open a request when none is active", () => {
  const actions = resolveTableQuickActions(context());
  assert.deepEqual(action(actions, "waiter-call").intent, {
    kind: "CREATE_CALL",
    callType: "WAITER_CALL",
  });
  assert.deepEqual(action(actions, "bill-request").intent, {
    kind: "CREATE_CALL",
    callType: "BILL_REQUEST",
  });
  assert.deepEqual(action(actions, "table-note").intent, {
    kind: "CREATE_CALL",
    callType: "OTHER",
  });
});

test("an already-open request resolves instead of opening a duplicate", () => {
  const actions = resolveTableQuickActions(
    context({
      openCalls: [
        { id: "call-bill", type: "BILL_REQUEST" },
        { id: "call-note", type: "OTHER" },
      ],
    }),
  );

  assert.deepEqual(action(actions, "bill-request").intent, {
    kind: "RESOLVE_CALL",
    callId: "call-bill",
    callType: "BILL_REQUEST",
  });
  assert.deepEqual(action(actions, "table-note").intent, {
    kind: "RESOLVE_CALL",
    callId: "call-note",
    callType: "OTHER",
  });
  // The untouched type still offers creation.
  assert.equal(action(actions, "waiter-call").intent.kind, "CREATE_CALL");
});

test("a cashier only ever reaches the bill request", () => {
  const actions = resolveTableQuickActions(context({ role: "CASHIER" }));

  assert.equal(action(actions, "bill-request").enabled, true);
  assert.equal(action(actions, "waiter-call").enabled, false);
  assert.equal(
    action(actions, "waiter-call").disabledReason,
    "Kasa yalnızca hesap taleplerini yönetebilir.",
  );
  assert.equal(action(actions, "table-note").enabled, false);
  assert.equal(action(actions, "add-order").enabled, false);
});

test("the kitchen role gets no table-side shortcut at all", () => {
  const actions = resolveTableQuickActions(
    context({ role: "KITCHEN", order: { id: "order-a", status: "READY" } }),
  );
  assert.deepEqual(
    actions.filter((item) => item.enabled).map((item) => item.id),
    [],
  );
});

test("a manager keeps every shortcut a waiter has", () => {
  const actions = resolveTableQuickActions(
    context({ role: "MANAGER", order: { id: "order-a", status: "NEW" } }),
  );
  assert.equal(action(actions, "add-order").enabled, true);
  assert.equal(action(actions, "confirm-order").enabled, true);
  assert.equal(action(actions, "waiter-call").enabled, true);
});

test("an out-of-service table disables every shortcut with one reason", () => {
  const actions = resolveTableQuickActions(
    context({ tableActive: false, order: { id: "order-a", status: "READY" } }),
  );
  for (const item of actions) {
    assert.equal(item.enabled, false, `${item.id} must be closed on an inactive table`);
    assert.equal(item.disabledReason, "Masa servis dışı.");
  }
});
