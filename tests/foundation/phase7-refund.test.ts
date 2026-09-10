import assert from "node:assert/strict";
import test from "node:test";

import { DomainError } from "../../lib/api/domain-error";
import {
  calculateOrderBalance,
  refundableAmount,
} from "../../lib/domain/financial-operations";
import {
  FakePaymentRepository,
  paymentService as service,
  principal,
} from "./phase7-payment-fixtures";

/** Collects the whole bill so there is something to refund. */
async function collected(repository: FakePaymentRepository) {
  return service(repository).collect(principal("CASHIER"), {
    orderId: "order-a",
    method: "CARD",
    idempotencyKey: "collect-key-0001",
  });
}

test("a full refund leaves the original payment untouched", async () => {
  const repository = new FakePaymentRepository();
  const payment = await collected(repository);

  const refund = await service(repository).refund(principal("MANAGER"), {
    paymentId: payment.paymentId,
    amount: "905.00",
    reasonCode: "CUSTOMER_COMPLAINT",
    idempotencyKey: "refund-key-0001",
  });

  assert.equal(refund.amount, "905.00");
  assert.equal(refund.refundedTotal, "905.00");
  assert.equal(refund.refundableRemaining, "0.00");
  // The historical payment keeps its original figure; only the cache moved.
  const stored = repository.transactionRepository.payments[0]!;
  assert.equal(stored.amount, "905.00");
  assert.equal(stored.refundedAmount, "905.00");
  assert.equal(repository.transactionRepository.refunds.length, 1);
});

test("partial refunds accumulate and the remainder shrinks", async () => {
  const repository = new FakePaymentRepository();
  const payment = await collected(repository);

  const first = await service(repository).refund(principal("MANAGER"), {
    paymentId: payment.paymentId,
    amount: "200.00",
    reasonCode: "QUALITY_ISSUE",
    idempotencyKey: "refund-key-0001",
  });
  assert.equal(first.refundedTotal, "200.00");
  assert.equal(first.refundableRemaining, "705.00");

  const second = await service(repository).refund(principal("MANAGER"), {
    paymentId: payment.paymentId,
    amount: "100.00",
    reasonCode: "QUALITY_ISSUE",
    idempotencyKey: "refund-key-0002",
  });
  assert.equal(second.refundedTotal, "300.00");
  assert.equal(second.refundableRemaining, "605.00");
  assert.equal(repository.transactionRepository.refunds.length, 2);
});

test("a refund over the refundable remainder is refused", async () => {
  const repository = new FakePaymentRepository();
  const payment = await collected(repository);
  await service(repository).refund(principal("MANAGER"), {
    paymentId: payment.paymentId,
    amount: "800.00",
    reasonCode: "STAFF_ERROR",
    idempotencyKey: "refund-key-0001",
  });

  await assert.rejects(
    () =>
      service(repository).refund(principal("MANAGER"), {
        paymentId: payment.paymentId,
        amount: "200.00",
        reasonCode: "STAFF_ERROR",
        idempotencyKey: "refund-key-0002",
      }),
    (error: unknown) =>
      error instanceof DomainError && error.code === "REFUND_EXCEEDS_REFUNDABLE",
  );
  assert.equal(repository.transactionRepository.refunds.length, 1);
});

test("two cashiers racing for the same remainder cannot both succeed", async () => {
  const repository = new FakePaymentRepository();
  const payment = await collected(repository);

  // Both see 905.00 refundable; the row lock serialises them, so the second
  // request now measures the remainder the first one left behind.
  await service(repository).refund(principal("CASHIER"), {
    paymentId: payment.paymentId,
    amount: "905.00",
    reasonCode: "CUSTOMER_COMPLAINT",
    idempotencyKey: "refund-key-A",
  });
  await assert.rejects(
    () =>
      service(repository).refund(principal("CASHIER"), {
        paymentId: payment.paymentId,
        amount: "905.00",
        reasonCode: "CUSTOMER_COMPLAINT",
        idempotencyKey: "refund-key-B",
      }),
    (error: unknown) =>
      error instanceof DomainError && error.code === "REFUND_EXCEEDS_REFUNDABLE",
  );
  assert.equal(repository.transactionRepository.refunds.length, 1);
});

test("the same key replays the refund instead of returning money twice", async () => {
  const repository = new FakePaymentRepository();
  const payment = await collected(repository);
  const command = {
    paymentId: payment.paymentId,
    amount: "150.00",
    reasonCode: "WRONG_CHARGE",
    idempotencyKey: "refund-key-0001",
  };

  const first = await service(repository).refund(principal("MANAGER"), command);
  const replay = await service(repository).refund(principal("MANAGER"), command);

  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(replay.refundId, first.refundId);
  assert.equal(repository.transactionRepository.refunds.length, 1);
  assert.equal(repository.transactionRepository.payments[0]?.refundedAmount, "150.00");
});

test("reusing a refund key with a different payload is a conflict", async () => {
  const repository = new FakePaymentRepository();
  const payment = await collected(repository);
  const refunds = service(repository);
  await refunds.refund(principal("MANAGER"), {
    paymentId: payment.paymentId,
    amount: "150.00",
    reasonCode: "WRONG_CHARGE",
    idempotencyKey: "refund-key-0001",
  });

  await assert.rejects(
    () =>
      refunds.refund(principal("MANAGER"), {
        paymentId: payment.paymentId,
        amount: "100.00",
        reasonCode: "WRONG_CHARGE",
        idempotencyKey: "refund-key-0001",
      }),
    (error: unknown) =>
      error instanceof DomainError && error.code === "IDEMPOTENCY_CONFLICT",
  );
  assert.equal(repository.transactionRepository.refunds.length, 1);
});

test("a zero or negative refund is refused", async () => {
  const repository = new FakePaymentRepository();
  const payment = await collected(repository);

  await assert.rejects(
    () =>
      service(repository).refund(principal("MANAGER"), {
        paymentId: payment.paymentId,
        amount: "0.00",
        reasonCode: "OTHER",
        note: "sıfır",
        idempotencyKey: "refund-key-0001",
      }),
    (error: unknown) => error instanceof DomainError && error.code === "VALIDATION_ERROR",
  );
  assert.equal(repository.transactionRepository.refunds.length, 0);
});

test("an unknown payment is not found", async () => {
  const repository = new FakePaymentRepository();
  await collected(repository);

  await assert.rejects(
    () =>
      service(repository).refund(principal("MANAGER"), {
        paymentId: "payment-does-not-exist",
        amount: "10.00",
        reasonCode: "OTHER",
        note: "yok",
        idempotencyKey: "refund-key-0001",
      }),
    (error: unknown) => error instanceof DomainError && error.code === "PAYMENT_NOT_FOUND",
  );
});

test("waiters and kitchen cannot refund", async () => {
  for (const role of ["WAITER", "KITCHEN"] as const) {
    const repository = new FakePaymentRepository();
    const payment = await collected(repository);
    await assert.rejects(
      () =>
        service(repository).refund(principal(role), {
          paymentId: payment.paymentId,
          amount: "10.00",
          reasonCode: "STAFF_ERROR",
          idempotencyKey: `refund-key-${role}`,
        }),
      (error: unknown) => error instanceof DomainError && error.code === "FORBIDDEN",
    );
    assert.equal(repository.transactionRepository.refunds.length, 0);
  }
});

test("another restaurant's manager cannot reach this payment", async () => {
  const repository = new FakePaymentRepository();
  const payment = await collected(repository);

  await assert.rejects(
    () =>
      service(repository).refund(
        { ...principal("MANAGER"), restaurantId: "restaurant-b" },
        {
          paymentId: payment.paymentId,
          amount: "10.00",
          reasonCode: "OTHER",
          note: "yabancı",
          idempotencyKey: "refund-key-x",
        },
      ),
    // The tenant predicate hides the row entirely; nothing leaks about it.
    (error: unknown) => error instanceof DomainError && error.code === "PAYMENT_NOT_FOUND",
  );
  assert.equal(repository.transactionRepository.refunds.length, 0);
});

test("the refund writes its event, outbox entry and audit record", async () => {
  const repository = new FakePaymentRepository();
  const payment = await collected(repository);
  const transaction = repository.transactionRepository;
  const eventsBefore = transaction.orderEvents.length;

  await service(repository).refund(principal("MANAGER"), {
    paymentId: payment.paymentId,
    amount: "200.00",
    reasonCode: "CUSTOMER_COMPLAINT",
    note: "tatlı beğenilmedi",
    idempotencyKey: "refund-key-0001",
    requestId: "req-77",
  });

  assert.equal(transaction.orderEvents[eventsBefore]?.eventType, "PAYMENT_REFUNDED");
  assert.equal(transaction.outbox.at(-1)?.eventType, "PAYMENT_REFUNDED");
  assert.equal(transaction.outbox.at(-1)?.aggregateType, "PAYMENT");
  const audit = transaction.audits.at(-1);
  assert.equal(audit?.action, "payment.refunded");
  assert.equal(audit?.metadata?.amount, "200.00");
  assert.equal(audit?.metadata?.reasonCode, "CUSTOMER_COMPLAINT");
  assert.equal(audit?.metadata?.originalAmount, "905.00");
  assert.equal(audit?.requestId, "req-77");
});

test("a refund is a money event and never re-opens the closed order", async () => {
  const repository = new FakePaymentRepository();
  const payment = await collected(repository);
  const transaction = repository.transactionRepository;
  assert.equal(transaction.order?.status, "COMPLETED");
  const freedBefore = transaction.freedTables.length;

  await service(repository).refund(principal("MANAGER"), {
    paymentId: payment.paymentId,
    amount: "905.00",
    reasonCode: "CUSTOMER_COMPLAINT",
    idempotencyKey: "refund-key-0001",
  });

  // The order keeps the lifecycle status it earned; a refunded bill must never
  // reappear as live work on the kitchen or waiter board.
  assert.equal(transaction.order?.status, "COMPLETED");
  assert.equal(transaction.occupiedTables.length, 0);
  assert.equal(transaction.freedTables.length, freedBefore);
});

test("the ledger reports gross, refunds and net separately", () => {
  const balance = calculateOrderBalance("1500.00", [
    { amount: "500.00", refundedAmount: "0.00", counted: true },
    { amount: "1000.00", refundedAmount: "200.00", counted: true },
    { amount: "9999.00", refundedAmount: "0.00", counted: false },
  ]);

  assert.equal(balance.paidTotal, "1500.00");
  assert.equal(balance.refundedTotal, "200.00");
  assert.equal(balance.outstanding, "200.00");
  assert.equal(balance.settled, false);
  assert.equal(refundableAmount({ amount: "1000.00", refundedAmount: "200.00" }), "800.00");
});
