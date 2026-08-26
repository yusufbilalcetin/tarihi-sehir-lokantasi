import assert from "node:assert/strict";
import test from "node:test";

import { DomainError } from "../../lib/api/domain-error";
import {
  FakePaymentRepository,
  paymentService as service,
  principal,
  servedOrder,
} from "./phase7-payment-fixtures";

/** A 1500.00 bill already split into 500 / 400 / 600. */
function splitBill() {
  const repository = new FakePaymentRepository();
  repository.transactionRepository.order = servedOrder({ total: "1500.00" });
  repository.transactionRepository.checks = [
    { id: "check-1", orderId: "order-a", label: "Hesap 1", status: "OPEN", total: "500.00" },
    { id: "check-2", orderId: "order-a", label: "Hesap 2", status: "OPEN", total: "400.00" },
    { id: "check-3", orderId: "order-a", label: "Hesap 3", status: "OPEN", total: "600.00" },
  ];
  return repository;
}

test("paying one check closes it while the others stay open", async () => {
  const repository = splitBill();
  const result = await service(repository).collect(principal("CASHIER"), {
    orderId: "order-a",
    method: "CASH",
    checkId: "check-1",
    idempotencyKey: "pay-key-0001",
  });

  // Omitting the amount takes the check's remainder, not the order's.
  assert.equal(result.amount, "500.00");
  assert.equal(result.balance.outstanding, "1000.00");
  assert.equal(result.balance.settled, false);

  const transaction = repository.transactionRepository;
  assert.deepEqual(transaction.paidChecks, ["check-1"]);
  assert.equal(transaction.checks[0]?.status, "PAID");
  assert.equal(transaction.checks[1]?.status, "OPEN");
  assert.equal(transaction.checks[2]?.status, "OPEN");
  // One paid check must never complete an order that still owes money.
  assert.equal(transaction.completed.length, 0);
  assert.deepEqual(transaction.freedTables, []);
  assert.equal(transaction.orderEvents.at(-1)?.eventType, "CHECK_PAID");
});

test("a check can itself be settled in two instalments", async () => {
  const repository = splitBill();
  const cashier = service(repository);

  await cashier.collect(principal("CASHIER"), {
    orderId: "order-a",
    method: "CASH",
    checkId: "check-3",
    amount: "200.00",
    idempotencyKey: "pay-key-0001",
  });
  assert.deepEqual(repository.transactionRepository.paidChecks, []);
  assert.equal(repository.transactionRepository.checks[2]?.status, "OPEN");

  await cashier.collect(principal("CASHIER"), {
    orderId: "order-a",
    method: "CARD",
    checkId: "check-3",
    amount: "400.00",
    idempotencyKey: "pay-key-0002",
  });
  assert.deepEqual(repository.transactionRepository.paidChecks, ["check-3"]);
  assert.equal(repository.transactionRepository.checks[2]?.status, "PAID");
});

test("a collection above the check's own remainder is refused", async () => {
  const repository = splitBill();
  await assert.rejects(
    () =>
      service(repository).collect(principal("CASHIER"), {
        orderId: "order-a",
        method: "CASH",
        checkId: "check-2",
        amount: "500.00",
        idempotencyKey: "pay-key-0001",
      }),
    (error: unknown) =>
      error instanceof DomainError &&
      error.code === "PAYMENT_EXCEEDS_BALANCE" &&
      error.message.includes("hesabın"),
  );
  assert.equal(repository.transactionRepository.payments.length, 0);
});

test("settling every check completes the order and frees the table", async () => {
  const repository = splitBill();
  const cashier = service(repository);

  await cashier.collect(principal("CASHIER"), {
    orderId: "order-a",
    method: "CASH",
    checkId: "check-1",
    idempotencyKey: "pay-key-0001",
  });
  await cashier.collect(principal("CASHIER"), {
    orderId: "order-a",
    method: "CASH",
    checkId: "check-2",
    amount: "200.00",
    idempotencyKey: "pay-key-0002",
  });
  await cashier.collect(principal("CASHIER"), {
    orderId: "order-a",
    method: "CARD",
    checkId: "check-2",
    amount: "200.00",
    idempotencyKey: "pay-key-0003",
  });
  const last = await cashier.collect(principal("CASHIER"), {
    orderId: "order-a",
    method: "CARD",
    checkId: "check-3",
    idempotencyKey: "pay-key-0004",
  });

  assert.equal(last.balance.paidTotal, "1500.00");
  assert.equal(last.balance.outstanding, "0.00");
  assert.equal(last.balance.settled, true);

  const transaction = repository.transactionRepository;
  assert.deepEqual(transaction.paidChecks, ["check-1", "check-2", "check-3"]);
  assert.equal(transaction.completed.length, 1);
  assert.deepEqual(transaction.freedTables, ["table-a"]);
  assert.equal(transaction.orderEvents.at(-1)?.eventType, "ORDER_COMPLETED");
  assert.equal(transaction.payments.length, 4);
});

test("an already paid check refuses further collection", async () => {
  const repository = splitBill();
  const cashier = service(repository);
  await cashier.collect(principal("CASHIER"), {
    orderId: "order-a",
    method: "CASH",
    checkId: "check-1",
    idempotencyKey: "pay-key-0001",
  });

  await assert.rejects(
    () =>
      cashier.collect(principal("CASHIER"), {
        orderId: "order-a",
        method: "CASH",
        checkId: "check-1",
        amount: "10.00",
        idempotencyKey: "pay-key-0002",
      }),
    (error: unknown) => error instanceof DomainError && error.code === "CHECK_ALREADY_PAID",
  );
});

test("a cancelled check cannot be collected against", async () => {
  const repository = splitBill();
  repository.transactionRepository.checks[1] = {
    ...repository.transactionRepository.checks[1]!,
    status: "CANCELLED",
  };

  await assert.rejects(
    () =>
      service(repository).collect(principal("CASHIER"), {
        orderId: "order-a",
        method: "CASH",
        checkId: "check-2",
        amount: "100.00",
        idempotencyKey: "pay-key-0001",
      }),
    (error: unknown) => error instanceof DomainError && error.code === "CHECK_NOT_FOUND",
  );
});

test("two cashiers cannot over-collect the same check", async () => {
  const repository = splitBill();
  const cashier = service(repository);
  // The check row lock serialises them, so the second request measures the
  // remainder the first one left rather than the one it first read.
  await cashier.collect(principal("CASHIER"), {
    orderId: "order-a",
    method: "CASH",
    checkId: "check-1",
    amount: "500.00",
    idempotencyKey: "pay-key-A",
  });
  await assert.rejects(
    () =>
      cashier.collect(principal("CASHIER"), {
        orderId: "order-a",
        method: "CARD",
        checkId: "check-1",
        amount: "500.00",
        idempotencyKey: "pay-key-B",
      }),
    (error: unknown) =>
      error instanceof DomainError && error.code === "CHECK_ALREADY_PAID",
  );

  const collected = repository.transactionRepository.payments.reduce(
    (total, payment) => total + Number(payment.amount),
    0,
  );
  assert.equal(collected, 500);
});

test("a check belonging to another order is refused", async () => {
  const repository = splitBill();
  repository.transactionRepository.checks[0] = {
    ...repository.transactionRepository.checks[0]!,
    orderId: "order-somewhere-else",
  };

  await assert.rejects(
    () =>
      service(repository).collect(principal("CASHIER"), {
        orderId: "order-a",
        method: "CASH",
        checkId: "check-1",
        amount: "100.00",
        idempotencyKey: "pay-key-0001",
      }),
    (error: unknown) => error instanceof DomainError && error.code === "CHECK_NOT_FOUND",
  );
});

test("another restaurant's cashier cannot reach a check", async () => {
  const repository = splitBill();
  await assert.rejects(
    () =>
      service(repository).collect(
        { ...principal("CASHIER"), restaurantId: "restaurant-b" },
        {
          orderId: "order-a",
          method: "CASH",
          checkId: "check-1",
          amount: "100.00",
          idempotencyKey: "pay-key-0001",
        },
      ),
    (error: unknown) => error instanceof DomainError && error.code === "ORDER_NOT_FOUND",
  );
});
