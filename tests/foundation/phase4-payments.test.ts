import assert from "node:assert/strict";
import test from "node:test";

import { DomainError } from "../../lib/api/domain-error";
import {
  FakePaymentRepository,
  paymentService as service,
  principal,
  servedOrder,
} from "./phase7-payment-fixtures";

// Phase 4 regression suite. Phase 7 made an order able to hold several
// payments, so the fake below is a real ledger; every assertion here is the
// original Phase 4 guarantee re-checked against that model.
const FakeRepository = FakePaymentRepository;

test("cashier collection uses the database total, not a client amount", async () => {
  const repository = new FakeRepository();
  const result = await service(repository).collect(principal("CASHIER"), {
    orderId: "order-a",
    method: "CARD",
    idempotencyKey: "key-000000001",
  });

  assert.equal(result.amount, "905.00");
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.replayed, false);
  assert.equal(repository.transactionRepository.insertedPayments[0]?.amount, "905.00");
});

test("payment closes the order, frees the table and writes event, outbox and audit", async () => {
  const repository = new FakeRepository();
  await service(repository).collect(principal("CASHIER"), {
    orderId: "order-a",
    method: "CASH",
    idempotencyKey: "key-000000001",
  });

  const transaction = repository.transactionRepository;
  assert.equal(transaction.completed[0]?.currentVersion, 3);
  assert.deepEqual(transaction.freedTables, ["table-a"]);
  assert.equal(transaction.orderEvents[0]?.eventType, "ORDER_COMPLETED");
  assert.equal(transaction.outbox[0]?.eventType, "ORDER_COMPLETED");
  assert.equal(transaction.audits[0]?.action, "payment.completed");
});

test("the same idempotency key replays the original receipt", async () => {
  const repository = new FakeRepository();
  const first = await service(repository).collect(principal("CASHIER"), {
    orderId: "order-a",
    method: "CARD",
    idempotencyKey: "key-000000001",
  });

  // The ledger already holds the first payment; the replay is found by its key.
  const replay = await service(repository).collect(principal("CASHIER"), {
    orderId: "order-a",
    method: "CARD",
    idempotencyKey: "key-000000001",
  });

  assert.equal(replay.replayed, true);
  assert.equal(replay.paymentId, first.paymentId);
  assert.equal(repository.transactionRepository.insertedPayments.length, 1);
});

// Phase 4 rejected this because an order could hold only one payment. Phase 7
// allows several, so the same guarantee is now expressed through the balance:
// once the bill is fully settled there is nothing left to collect.
test("a second collection on a fully settled order is rejected", async () => {
  const repository = new FakeRepository();
  await service(repository).collect(principal("CASHIER"), {
    orderId: "order-a",
    method: "CARD",
    idempotencyKey: "key-000000001",
  });

  await assert.rejects(
    () => service(repository).collect(principal("CASHIER"), {
      orderId: "order-a",
      method: "CASH",
      idempotencyKey: "key-000000002",
    }),
    (error: unknown) =>
      error instanceof DomainError && error.code === "ORDER_ALREADY_SETTLED",
  );
  assert.equal(repository.transactionRepository.insertedPayments.length, 1);
});

test("a racing insert blocked by the unique index fails instead of double charging", async () => {
  const repository = new FakeRepository();
  repository.transactionRepository.insertConflicts = true;

  await assert.rejects(
    () => service(repository).collect(principal("CASHIER"), {
      orderId: "order-a",
      method: "CASH",
      idempotencyKey: "key-000000003",
    }),
    (error: unknown) => error instanceof DomainError && error.code === "CONFLICT",
  );
  assert.equal(repository.transactionRepository.completed.length, 0);
});

test("an order that was never served cannot be collected", async () => {
  const repository = new FakeRepository();
  repository.transactionRepository.order = servedOrder({ status: "PREPARING" });

  await assert.rejects(
    () => service(repository).collect(principal("CASHIER"), {
      orderId: "order-a",
      method: "CARD",
      idempotencyKey: "key-000000004",
    }),
    (error: unknown) =>
      error instanceof DomainError && error.code === "INVALID_STATUS_TRANSITION",
  );
});

test("kitchen and waiter roles cannot take payments", async () => {
  for (const role of ["KITCHEN", "WAITER"] as const) {
    await assert.rejects(
      () => service(new FakeRepository()).collect(principal(role), {
        orderId: "order-a",
        method: "CARD",
        idempotencyKey: "key-000000005",
      }),
      (error: unknown) => error instanceof DomainError && error.code === "FORBIDDEN",
    );
  }
});

test("another restaurant's cashier cannot reach this order", async () => {
  await assert.rejects(
    () => service(new FakeRepository()).collect(
      { ...principal("CASHIER"), restaurantId: "restaurant-b" },
      { orderId: "order-a", method: "CARD", idempotencyKey: "key-000000006" },
    ),
    (error: unknown) => error instanceof DomainError && error.code === "ORDER_NOT_FOUND",
  );
});

test("a table with a second bill running is not handed back to the floor", async () => {
  // Two open orders on one table is ordinary: drinks first, then the food. The
  // till settling the first one closes that bill, not the table — a table shown
  // as free while it still owes money invites the floor to seat somebody on top
  // of the guests who are still eating.
  const repository = new FakeRepository();
  repository.transactionRepository.otherOpenOrders = true;

  await service(repository).collect(principal("CASHIER"), {
    orderId: "order-a",
    method: "CASH",
    idempotencyKey: "key-000000002",
  });

  const transaction = repository.transactionRepository;
  assert.equal(transaction.completed.length, 1, "the paid bill still closes");
  assert.deepEqual(transaction.freedTables, [], "but the table is not released");
  assert.deepEqual(transaction.occupiedTables, ["table-a"], "it stays occupied");
});
