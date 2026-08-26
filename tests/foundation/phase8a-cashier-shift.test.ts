import assert from "node:assert/strict";
import { test } from "node:test";

import { DomainError } from "../../lib/api/domain-error";
import {
  FakePaymentRepository,
  paymentService,
  principal as paymentPrincipal,
} from "./phase7-payment-fixtures";
import {
  FakeShiftRepository,
  ZERO_TOTALS,
  openShift,
  principal,
  shiftService,
} from "./phase8a-shift-fixtures";

/**
 * Phase 8A — the shift service's rules, against a fake that models what the
 * database actually guarantees (partial unique indexes on the open shift, and
 * an UPDATE that only matches a shift still OPEN).
 */

function code(error: unknown): string {
  return error instanceof DomainError ? error.code : `UNEXPECTED:${String(error)}`;
}

async function failure(work: () => Promise<unknown>): Promise<string> {
  try {
    await work();
    return "NO_ERROR";
  } catch (error) {
    return code(error);
  }
}

// ------------------------------------------------------------------- opening

test("a cashier opens a shift on an active register with a stated float", async () => {
  const repository = new FakeShiftRepository();
  const result = await shiftService(repository).open(principal("CASHIER"), {
    cashRegisterId: "register-1",
    openingCash: "500.00",
  });

  assert.equal(result.shift.status, "OPEN");
  assert.equal(result.shift.openingCash, "500.00");
  assert.equal(result.shift.register.name, "Ana Kasa", "the register name is snapshotted");
  assert.equal(result.shift.openedBy.id, "user-cashier");
  assert.equal(result.summary.expectedCash, "500.00", "an empty shift expects its float");
  assert.equal(result.shift.closedAt, null);
  assert.equal(repository.audits[0]?.action, "cashier_shift.opened");
  assert.equal(repository.outbox[0]?.eventType, "CASHIER_SHIFT_OPENED");
});

test("a zero float is valid and a negative one is not", async () => {
  const repository = new FakeShiftRepository();
  const zero = await shiftService(repository).open(principal("CASHIER"), {
    cashRegisterId: "register-1",
    openingCash: "0.00",
  });
  assert.equal(zero.shift.openingCash, "0.00");

  assert.equal(
    await failure(() =>
      shiftService(new FakeShiftRepository()).open(principal("CASHIER"), {
        cashRegisterId: "register-1",
        openingCash: "-1.00",
      }),
    ),
    "VALIDATION_ERROR",
  );
});

test("waiters and kitchen staff cannot open a till", async () => {
  for (const role of ["WAITER", "KITCHEN"] as const) {
    assert.equal(
      await failure(() =>
        shiftService(new FakeShiftRepository()).open(principal(role), {
          cashRegisterId: "register-1",
          openingCash: "0.00",
        }),
      ),
      "FORBIDDEN",
      `${role} must be refused`,
    );
  }
});

test("admins and managers may run their own till", async () => {
  for (const role of ["ADMIN", "MANAGER"] as const) {
    const result = await shiftService(new FakeShiftRepository()).open(principal(role), {
      cashRegisterId: "register-1",
      openingCash: "100.00",
    });
    assert.equal(result.shift.status, "OPEN", `${role} may open a shift`);
  }
});

test("an inactive or unknown register cannot host a shift", async () => {
  const repository = new FakeShiftRepository();
  assert.equal(
    await failure(() =>
      shiftService(repository).open(principal("CASHIER"), {
        cashRegisterId: "register-2",
        openingCash: "0.00",
      }),
    ),
    "CONFLICT",
    "register-2 is deactivated",
  );
  assert.equal(
    await failure(() =>
      shiftService(repository).open(principal("CASHIER"), {
        cashRegisterId: "register-missing",
        openingCash: "0.00",
      }),
    ),
    "NOT_FOUND",
  );
  assert.equal(repository.shifts.length, 0, "no shift row was created either way");
});

test("a second shift is refused, per register and per cashier", async () => {
  const repository = new FakeShiftRepository();
  const service = shiftService(repository);
  await service.open(principal("CASHIER"), {
    cashRegisterId: "register-1",
    openingCash: "0.00",
  });

  // Same cashier, same register.
  assert.equal(
    await failure(() =>
      service.open(principal("CASHIER"), { cashRegisterId: "register-1", openingCash: "0.00" }),
    ),
    "CASHIER_SHIFT_ALREADY_OPEN",
  );
  // A different operator on the same register: the register is taken.
  repository.registers.push({
    id: "register-3", name: "Teras", code: "TER", isActive: true, deletedAt: null,
  });
  assert.equal(
    await failure(() =>
      service.open(principal("MANAGER"), { cashRegisterId: "register-1", openingCash: "0.00" }),
    ),
    "CASHIER_SHIFT_ALREADY_OPEN",
  );
  // The same cashier on a *different* register is still one shift too many.
  assert.equal(
    await failure(() =>
      service.open(principal("CASHIER"), { cashRegisterId: "register-3", openingCash: "0.00" }),
    ),
    "CASHIER_SHIFT_ALREADY_OPEN",
  );
  assert.equal(repository.shifts.length, 1, "exactly one shift exists");
});

// ------------------------------------------------------------------- closing

test("closing snapshots the derived expectation, the count and the variance", async () => {
  const repository = new FakeShiftRepository();
  repository.shifts.push(openShift());
  repository.totals = {
    ...ZERO_TOTALS,
    cashPayments: "1000.00",
    cardPayments: "600.00",
    cashRefunds: "100.00",
    cardRefunds: "50.00",
    cashIn: "50.00",
    cashOut: "200.00",
    paymentCount: 5,
    refundCount: 2,
  };

  const result = await shiftService(repository).close(principal("CASHIER"), {
    shiftId: "shift-1",
    countedCash: "1240.00",
    note: "Bozukluk eksik sayıldı.",
  });

  assert.equal(result.shift.status, "CLOSED");
  assert.equal(result.shift.expectedCashAtClose, "1250.00");
  assert.equal(result.shift.countedCash, "1240.00");
  assert.equal(result.shift.cashVariance, "-10.00");
  assert.equal(result.shift.closedBy?.id, "user-cashier");
  assert.equal(result.summary.grossCollected, "1600.00");
  assert.equal(result.summary.netCollected, "1450.00");
  // The expected figure is derived, never taken from the request.
  assert.equal(repository.closes[0]?.expectedCash, "1250.00");
  assert.equal(repository.audits.at(-1)?.action, "cashier_shift.closed");
});

test("a discrepancy needs an explanation and a matching one closes", async () => {
  const repository = new FakeShiftRepository();
  repository.shifts.push(openShift());

  assert.equal(
    await failure(() =>
      shiftService(repository).close(principal("CASHIER"), {
        shiftId: "shift-1",
        countedCash: "499.00",
      }),
    ),
    "CASHIER_SHIFT_NOTE_REQUIRED",
  );
  assert.equal(repository.shifts[0]!.status, "OPEN", "a refused close writes nothing");

  const exact = await shiftService(repository).close(principal("CASHIER"), {
    shiftId: "shift-1",
    countedCash: "500.00",
  });
  assert.equal(exact.shift.cashVariance, "0.00", "no note needed when it balances");
});

test("a shift with a payment still in flight cannot be closed", async () => {
  const repository = new FakeShiftRepository();
  repository.shifts.push(openShift());
  repository.totals = { ...ZERO_TOTALS, pendingPaymentCount: 1 };

  assert.equal(
    await failure(() =>
      shiftService(repository).close(principal("CASHIER"), {
        shiftId: "shift-1",
        countedCash: "500.00",
      }),
    ),
    "CASHIER_SHIFT_HAS_PENDING_PAYMENT",
  );
  assert.equal(repository.shifts[0]!.status, "OPEN");
});

test("a closed shift is frozen: no re-close and no movement", async () => {
  const repository = new FakeShiftRepository();
  repository.shifts.push(openShift());
  const service = shiftService(repository);
  await service.close(principal("CASHIER"), { shiftId: "shift-1", countedCash: "500.00" });

  assert.equal(
    await failure(() =>
      service.close(principal("CASHIER"), { shiftId: "shift-1", countedCash: "900.00" }),
    ),
    "CASHIER_SHIFT_CLOSED",
  );
  assert.equal(
    await failure(() =>
      service.recordMovement(principal("CASHIER"), {
        shiftId: "shift-1",
        type: "CASH_IN",
        amount: "10.00",
        reason: "Sonradan",
      }),
    ),
    "CASHIER_SHIFT_CLOSED",
  );
  assert.equal(repository.shifts[0]!.countedCashAtClose, "500.00", "the count is unchanged");
  assert.equal(repository.movements.length, 0);
});

test("a cashier cannot close a colleague's shift, and is not told it exists", async () => {
  const repository = new FakeShiftRepository();
  repository.shifts.push(openShift({ openedByStaffId: "user-other-cashier" }));

  assert.equal(
    await failure(() =>
      shiftService(repository).close(principal("CASHIER"), {
        shiftId: "shift-1",
        countedCash: "500.00",
      }),
    ),
    "NOT_FOUND",
    "identical to the answer for a shift that does not exist",
  );
  assert.equal(repository.shifts[0]!.status, "OPEN");
});

test("a manager may close another cashier's shift, with a note and their own name", async () => {
  const repository = new FakeShiftRepository();
  repository.shifts.push(openShift({ openedByStaffId: "user-cashier" }));

  assert.equal(
    await failure(() =>
      shiftService(repository).close(principal("MANAGER"), {
        shiftId: "shift-1",
        countedCash: "500.00",
      }),
    ),
    "CASHIER_SHIFT_NOTE_REQUIRED",
    "an override is never silent, even when the drawer balances",
  );

  const result = await shiftService(repository).close(principal("MANAGER"), {
    shiftId: "shift-1",
    countedCash: "500.00",
    note: "Kasiyer vardiya sonunda ayrıldı.",
  });
  assert.equal(result.shift.closedBy?.id, "user-manager");
  assert.equal(result.shift.openedBy.id, "user-cashier", "ownership never moves");
  assert.equal(repository.audits.at(-1)?.action, "cashier_shift.closed_by_supervisor");
});

// ----------------------------------------------------------------- movements

test("cash in and cash out both move the drawer, and both need a reason", async () => {
  const repository = new FakeShiftRepository();
  repository.shifts.push(openShift());
  const service = shiftService(repository);

  await service.recordMovement(principal("CASHIER"), {
    shiftId: "shift-1", type: "CASH_IN", amount: "50.00", reason: "Bozuk para takviyesi",
  });
  repository.totals = { ...ZERO_TOTALS, cashIn: "50.00" };
  await service.recordMovement(principal("CASHIER"), {
    shiftId: "shift-1", type: "CASH_OUT", amount: "20.00", reason: "Tedarikçi ödemesi",
  });
  repository.totals = { ...ZERO_TOTALS, cashIn: "50.00", cashOut: "20.00" };

  assert.equal(repository.movements.length, 2);
  assert.equal(repository.movements[0]!.type, "CASH_IN");
  assert.equal(repository.audits.at(-1)?.action, "cash_drawer.cash_out");

  const { summary } = await service.recordMovement(principal("CASHIER"), {
    shiftId: "shift-1", type: "CASH_IN", amount: "0.01", reason: "Yuvarlama",
  });
  assert.equal(summary.expectedCash, "530.00", "500 float + 50 in − 20 out");
});

test("an unexplained or non-positive movement is refused", async () => {
  const repository = new FakeShiftRepository();
  repository.shifts.push(openShift());
  const service = shiftService(repository);

  for (const invalid of [
    { amount: "0.00", reason: "Gerekçe" },
    { amount: "-5.00", reason: "Gerekçe" },
    { amount: "10.00", reason: "   " },
    { amount: "10.00", reason: "x".repeat(121) },
  ]) {
    assert.equal(
      await failure(() =>
        service.recordMovement(principal("CASHIER"), {
          shiftId: "shift-1",
          type: "CASH_OUT",
          ...invalid,
        }),
      ),
      "VALIDATION_ERROR",
      `${JSON.stringify(invalid)} must be refused`,
    );
  }
  assert.equal(repository.movements.length, 0);
});

test("a cashier cannot move cash in a colleague's drawer", async () => {
  const repository = new FakeShiftRepository();
  repository.shifts.push(openShift({ openedByStaffId: "user-other-cashier" }));

  assert.equal(
    await failure(() =>
      shiftService(repository).recordMovement(principal("CASHIER"), {
        shiftId: "shift-1", type: "CASH_OUT", amount: "100.00", reason: "Alma",
      }),
    ),
    "NOT_FOUND",
  );
  assert.equal(repository.movements.length, 0);

  // A supervisor may, because they are accountable for the whole floor.
  const allowed = await shiftService(repository).recordMovement(principal("MANAGER"), {
    shiftId: "shift-1", type: "CASH_OUT", amount: "100.00", reason: "Kasa devri",
  });
  assert.equal(allowed.movement.amount, "100.00");
});

// -------------------------------------------------------------- tenant scope

test("another restaurant's shift simply is not there", async () => {
  const repository = new FakeShiftRepository();
  repository.shifts.push(openShift());
  const foreign = { ...principal("MANAGER"), restaurantId: "restaurant-b" };
  const service = shiftService(repository);

  assert.equal(await failure(() => service.detail(foreign, "shift-1")), "NOT_FOUND");
  assert.equal(
    await failure(() =>
      service.close(foreign, { shiftId: "shift-1", countedCash: "0.00", note: "n" }),
    ),
    "NOT_FOUND",
  );
  assert.equal(
    await failure(() =>
      service.recordMovement(foreign, {
        shiftId: "shift-1", type: "CASH_IN", amount: "1.00", reason: "x",
      }),
    ),
    "NOT_FOUND",
  );
  assert.equal(
    await failure(() =>
      service.open(foreign, { cashRegisterId: "register-1", openingCash: "0.00" }),
    ),
    "NOT_FOUND",
    "a foreign register is invisible too",
  );
  assert.equal(repository.shifts[0]!.status, "OPEN");
  assert.equal(repository.movements.length, 0);
});

// ------------------------------------------------------------------- reading

test("current reports the closed-till state with the registers to open", async () => {
  const repository = new FakeShiftRepository();
  const result = await shiftService(repository).current(principal("CASHIER"));
  assert.equal(result.shift, null);
  assert.equal(result.summary, null);
  assert.deepEqual(
    result.availableRegisters.map((register) => register.id),
    ["register-1"],
    "only active registers are offered",
  );
});

test("a cashier's history is pinned to their own shifts", async () => {
  const repository = new FakeShiftRepository();
  repository.shifts.push(
    openShift({ id: "shift-1", openedByStaffId: "user-cashier" }),
    openShift({ id: "shift-2", openedByStaffId: "user-other" }),
  );

  const own = await shiftService(repository).history(principal("CASHIER"), {
    // Even when the client asks for somebody else's shifts.
    openedByStaffId: "user-other",
    page: 1,
    pageSize: 20,
  });
  assert.deepEqual(own.rows.map((row) => row.id), ["shift-1"]);

  const supervisor = await shiftService(repository).history(principal("MANAGER"), {
    page: 1,
    pageSize: 20,
  });
  assert.equal(supervisor.rows.length, 2, "a manager sees the whole restaurant");
});

// ------------------------------------------- money requires an open drawer

test("no open shift means no collection and no refund", async () => {
  const repository = new FakePaymentRepository();
  repository.transactionRepository.activeShift = null;

  assert.equal(
    await failure(() =>
      paymentService(repository).collect(paymentPrincipal("CASHIER"), {
        orderId: "order-a",
        method: "CASH",
        idempotencyKey: "no-shift-collect",
      }),
    ),
    "CASHIER_SHIFT_REQUIRED",
  );
  assert.equal(repository.transactionRepository.payments.length, 0, "no payment row");
  assert.equal(repository.transactionRepository.completed.length, 0, "the order is untouched");

  // Give it a shift, collect, then take the shift away and try to refund.
  repository.transactionRepository.activeShift = { id: "shift-9", cashRegisterId: "register-1" };
  const payment = await paymentService(repository).collect(paymentPrincipal("CASHIER"), {
    orderId: "order-a",
    method: "CASH",
    idempotencyKey: "with-shift-collect",
  });
  assert.equal(
    repository.transactionRepository.insertedPayments[0]?.cashierShiftId,
    "shift-9",
    "the collection is attributed to the actor's own drawer",
  );

  repository.transactionRepository.activeShift = null;
  assert.equal(
    await failure(() =>
      paymentService(repository).refund(paymentPrincipal("CASHIER"), {
        paymentId: payment.paymentId,
        amount: "1.00",
        reasonCode: "OTHER",
        idempotencyKey: "no-shift-refund",
      }),
    ),
    "CASHIER_SHIFT_REQUIRED",
  );
  assert.equal(repository.transactionRepository.refunds.length, 0, "no refund row");
});

test("a refund is attributed to the refunding shift, not the collecting one", async () => {
  const repository = new FakePaymentRepository();
  repository.transactionRepository.activeShift = { id: "shift-morning", cashRegisterId: "r1" };
  const payment = await paymentService(repository).collect(paymentPrincipal("CASHIER"), {
    orderId: "order-a",
    method: "CARD",
    idempotencyKey: "morning-collect",
  });

  // The morning till is long closed; the evening one gives the money back.
  repository.transactionRepository.activeShift = { id: "shift-evening", cashRegisterId: "r1" };
  await paymentService(repository).refund(paymentPrincipal("CASHIER"), {
    paymentId: payment.paymentId,
    amount: "5.00",
    reasonCode: "CUSTOMER_COMPLAINT",
    idempotencyKey: "evening-refund",
  });

  assert.equal(repository.transactionRepository.insertedPayments[0]?.cashierShiftId, "shift-morning");
  assert.equal(
    repository.transactionRepository.insertedRefunds[0]?.cashierShiftId,
    "shift-evening",
    "the money left today's drawer, so today's shift is accountable",
  );
});

test("a client cannot name the shift its money lands in", async () => {
  const repository = new FakePaymentRepository();
  repository.transactionRepository.activeShift = { id: "shift-real", cashRegisterId: "r1" };

  await paymentService(repository).collect(
    paymentPrincipal("CASHIER"),
    // A forged field on the request body has nowhere to go: the command type
    // has no shift, and the service reads it from the principal.
    {
      orderId: "order-a",
      method: "CASH",
      idempotencyKey: "spoof-attempt",
      ...({ cashierShiftId: "shift-foreign" } as unknown as Record<string, never>),
    },
  );

  assert.equal(
    repository.transactionRepository.insertedPayments[0]?.cashierShiftId,
    "shift-real",
    "the server-resolved shift wins",
  );
});

test("a closed shift reports the drawer it was counted against, not a recomputation", async () => {
  const repository = new FakeShiftRepository();
  repository.shifts.push(
    openShift({
      status: "CLOSED",
      closedAt: new Date("2026-08-15T17:00:00.000Z"),
      closedByStaffId: "user-cashier",
      countedCashAtClose: "1250.00",
      expectedCashAtClose: "1250.00",
      cashVariance: "0.00",
    }),
  );
  // A refund taken later moved the live totals; the snapshot must not follow.
  repository.totals = { ...ZERO_TOTALS, cashRefunds: "300.00" };

  const detail = await shiftService(repository).detail(principal("CASHIER"), "shift-1");
  assert.equal(detail.summary.expectedCash, "1250.00");
  assert.equal(detail.shift.cashVariance, "0.00");
});
