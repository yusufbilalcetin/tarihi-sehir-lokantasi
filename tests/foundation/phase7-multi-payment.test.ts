import assert from "node:assert/strict";
import test from "node:test";

import { DomainError } from "../../lib/api/domain-error";
import { splitEvenly } from "../../lib/domain/financial-operations";
import {
  FakePaymentRepository,
  paymentService as service,
  principal,
  servedOrder,
} from "./phase7-payment-fixtures";

/** A 1500.00 bill, the worked example from the phase brief. */
function bill() {
  const repository = new FakePaymentRepository();
  repository.transactionRepository.order = servedOrder({ total: "1500.00" });
  return repository;
}

test("omitting the amount still settles the whole bill in one go", async () => {
  const repository = bill();
  const result = await service(repository).collect(principal("CASHIER"), {
    orderId: "order-a",
    method: "CARD",
    idempotencyKey: "pay-key-0001",
  });

  assert.equal(result.amount, "1500.00");
  assert.equal(result.balance.outstanding, "0.00");
  assert.equal(result.balance.settled, true);
  assert.deepEqual(repository.transactionRepository.freedTables, ["table-a"]);
});

test("a part payment leaves the order open and the table occupied", async () => {
  const repository = bill();
  const result = await service(repository).collect(principal("CASHIER"), {
    orderId: "order-a",
    method: "CASH",
    amount: "500.00",
    idempotencyKey: "pay-key-0001",
  });

  assert.equal(result.amount, "500.00");
  assert.equal(result.balance.paidTotal, "500.00");
  assert.equal(result.balance.outstanding, "1000.00");
  assert.equal(result.balance.settled, false);

  const transaction = repository.transactionRepository;
  assert.equal(transaction.completed.length, 0, "a part-paid order must not close");
  assert.deepEqual(transaction.freedTables, [], "a part-paid table must not be freed");
  assert.deepEqual(transaction.occupiedTables, ["table-a"]);
  assert.equal(transaction.orderEvents[0]?.eventType, "PAYMENT_RECORDED");
  assert.equal(transaction.audits[0]?.action, "payment.partial_completed");
});

test("cash then card settles the bill and closes the order", async () => {
  const repository = bill();
  const cashier = service(repository);
  await cashier.collect(principal("CASHIER"), {
    orderId: "order-a",
    method: "CASH",
    amount: "500.00",
    idempotencyKey: "pay-key-0001",
  });
  const second = await cashier.collect(principal("CASHIER"), {
    orderId: "order-a",
    method: "CARD",
    amount: "1000.00",
    idempotencyKey: "pay-key-0002",
  });

  assert.equal(second.balance.paidTotal, "1500.00");
  assert.equal(second.balance.outstanding, "0.00");
  assert.equal(second.balance.settled, true);

  const transaction = repository.transactionRepository;
  assert.equal(transaction.payments.length, 2);
  assert.deepEqual(
    transaction.payments.map((payment) => payment.method),
    ["CASH", "CARD"],
  );
  assert.equal(transaction.completed.length, 1);
  assert.deepEqual(transaction.freedTables, ["table-a"]);
  assert.equal(transaction.orderEvents.at(-1)?.eventType, "ORDER_COMPLETED");
});

test("the last payment may omit its amount and take exactly the remainder", async () => {
  const repository = bill();
  const cashier = service(repository);
  await cashier.collect(principal("CASHIER"), {
    orderId: "order-a",
    method: "CASH",
    amount: "400.00",
    idempotencyKey: "pay-key-0001",
  });
  const rest = await cashier.collect(principal("CASHIER"), {
    orderId: "order-a",
    method: "CARD",
    idempotencyKey: "pay-key-0002",
  });

  assert.equal(rest.amount, "1100.00");
  assert.equal(rest.balance.settled, true);
});

test("a collection above the remaining balance is refused", async () => {
  const repository = bill();
  const cashier = service(repository);
  await cashier.collect(principal("CASHIER"), {
    orderId: "order-a",
    method: "CASH",
    amount: "1200.00",
    idempotencyKey: "pay-key-0001",
  });

  await assert.rejects(
    () =>
      cashier.collect(principal("CASHIER"), {
        orderId: "order-a",
        method: "CASH",
        amount: "500.00",
        idempotencyKey: "pay-key-0002",
      }),
    (error: unknown) =>
      error instanceof DomainError && error.code === "PAYMENT_EXCEEDS_BALANCE",
  );
  assert.equal(repository.transactionRepository.payments.length, 1);
});

test("overpaying a fresh bill in one request is refused", async () => {
  const repository = bill();
  await assert.rejects(
    () =>
      service(repository).collect(principal("CASHIER"), {
        orderId: "order-a",
        method: "CARD",
        amount: "1500.01",
        idempotencyKey: "pay-key-0001",
      }),
    (error: unknown) =>
      error instanceof DomainError && error.code === "PAYMENT_EXCEEDS_BALANCE",
  );
  assert.equal(repository.transactionRepository.payments.length, 0);
});

test("a zero or negative collection is refused", async () => {
  const repository = bill();
  await assert.rejects(
    () =>
      service(repository).collect(principal("CASHIER"), {
        orderId: "order-a",
        method: "CASH",
        amount: "0.00",
        idempotencyKey: "pay-key-0001",
      }),
    (error: unknown) => error instanceof DomainError && error.code === "VALIDATION_ERROR",
  );
});

test("two cashiers cannot together collect more than the bill", async () => {
  const repository = bill();
  const cashier = service(repository);
  // The order row lock serialises them, so the second request measures the
  // balance the first one left rather than the one it originally read.
  await cashier.collect(principal("CASHIER"), {
    orderId: "order-a",
    method: "CASH",
    amount: "1000.00",
    idempotencyKey: "pay-key-A",
  });
  await assert.rejects(
    () =>
      cashier.collect(principal("CASHIER"), {
        orderId: "order-a",
        method: "CARD",
        amount: "1000.00",
        idempotencyKey: "pay-key-B",
      }),
    (error: unknown) =>
      error instanceof DomainError && error.code === "PAYMENT_EXCEEDS_BALANCE",
  );

  const paid = repository.transactionRepository.payments.reduce(
    (total, payment) => total + Number(payment.amount),
    0,
  );
  assert.equal(paid, 1000);
});

test("a replayed part payment does not collect a second share", async () => {
  const repository = bill();
  const cashier = service(repository);
  const command = {
    orderId: "order-a",
    method: "CASH" as const,
    amount: "500.00",
    idempotencyKey: "pay-key-0001",
  };
  const first = await cashier.collect(principal("CASHIER"), command);
  const replay = await cashier.collect(principal("CASHIER"), command);

  assert.equal(replay.replayed, true);
  assert.equal(replay.paymentId, first.paymentId);
  assert.equal(repository.transactionRepository.payments.length, 1);
  assert.equal(replay.balance.outstanding, "1000.00");
});

test("reusing a key against a different order is a conflict", async () => {
  const repository = bill();
  await service(repository).collect(principal("CASHIER"), {
    orderId: "order-a",
    method: "CASH",
    amount: "500.00",
    idempotencyKey: "pay-key-0001",
  });
  repository.transactionRepository.order = servedOrder({ id: "order-b", total: "300.00" });

  await assert.rejects(
    () =>
      service(repository).collect(principal("CASHIER"), {
        orderId: "order-b",
        method: "CASH",
        amount: "100.00",
        idempotencyKey: "pay-key-0001",
      }),
    (error: unknown) =>
      error instanceof DomainError && error.code === "IDEMPOTENCY_CONFLICT",
  );
});

test("the payment carries the check it settled when one is named", async () => {
  const repository = bill();
  repository.transactionRepository.checks = [
    { id: "check-a", orderId: "order-a", label: "Hesap 1", status: "OPEN", total: "500.00" },
  ];
  await service(repository).collect(principal("CASHIER"), {
    orderId: "order-a",
    method: "CASH",
    amount: "500.00",
    checkId: "check-a",
    idempotencyKey: "pay-key-0001",
  });
  assert.equal(repository.transactionRepository.payments[0]?.checkId, "check-a");
});

test("a payment naming an unknown check is refused", async () => {
  const repository = bill();
  await assert.rejects(
    () =>
      service(repository).collect(principal("CASHIER"), {
        orderId: "order-a",
        method: "CASH",
        amount: "100.00",
        checkId: "check-does-not-exist",
        idempotencyKey: "pay-key-0001",
      }),
    (error: unknown) => error instanceof DomainError && error.code === "CHECK_NOT_FOUND",
  );
  assert.equal(repository.transactionRepository.payments.length, 0);
});

test("an even split never loses a minor unit", () => {
  assert.deepEqual(splitEvenly("100.00", 3), ["33.34", "33.33", "33.33"]);
  assert.deepEqual(splitEvenly("1200.01", 3), ["400.01", "400.00", "400.00"]);
  assert.deepEqual(splitEvenly("905.00", 2), ["452.50", "452.50"]);
  assert.deepEqual(splitEvenly("0.01", 2), ["0.01", "0.00"]);

  for (const [total, shares] of [["100.00", 3], ["1200.01", 7], ["905.00", 4]] as const) {
    const parts = splitEvenly(total, shares);
    const sum = parts.reduce((accumulated, part) => accumulated + Number(part) * 100, 0);
    assert.equal(Math.round(sum), Math.round(Number(total) * 100), `${total}/${shares}`);
  }
});
