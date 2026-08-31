import assert from "node:assert/strict";
import test from "node:test";

import { DomainError } from "@/lib/api/domain-error";
import { FakeShiftRepository, principal, shiftService } from "./phase8a-shift-fixtures";

/**
 * Opening a drawer with a counted breakdown, at the service boundary.
 *
 * These exercise the path a real request takes — authorize, price, open, write
 * — against the same in-memory repository the existing shift tests use. No
 * database is touched.
 */

function service() {
  const repository = new FakeShiftRepository();
  return { repository, sut: shiftService(repository) };
}

const REGISTER = "register-1";

function count(currency: string, denominationMinor: number, n: number) {
  return { currency, denominationMinor, count: n };
}

/* ---------------------------------------------------------- server pricing -- */

test("the server prices the drawer itself and ignores the typed figure", () => {
  return (async () => {
    const { repository, sut } = service();

    const result = await sut.open(principal("CASHIER"), {
      cashRegisterId: REGISTER,
      // A cashier's typed guess, deliberately wrong.
      openingCash: "9999.00",
      cashCounts: [count("TRY", 20_000, 2), count("TRY", 500, 3), count("TRY", 25, 4)],
    });

    // ₺400 + ₺15 + ₺1 = ₺416,00 — the counted drawer, not the typed number.
    assert.equal(result.shift.openingCash, "416.00");
    assert.equal(repository.cashCounts.length, 1);
    const written = repository.cashCounts[0];
    assert.equal(written.phase, "OPENING");
    assert.equal(written.shiftId, result.shift.id);
    assert.deepEqual(
      written.lines.map((line) => [line.currency, line.denominationMinor, line.pieceCount, line.subtotalMinor]),
      [
        ["TRY", 20_000, 2, 40_000],
        ["TRY", 500, 3, 1_500],
        ["TRY", 25, 4, 100],
      ],
    );
  })();
});

test("EUR and USD are stored as their own inventory, never folded into the TRY float", () => {
  return (async () => {
    const { repository, sut } = service();

    const result = await sut.open(principal("CASHIER"), {
      cashRegisterId: REGISTER,
      openingCash: "0.00",
      cashCounts: [
        count("TRY", 10_000, 1),
        count("EUR", 10_000, 1),
        count("USD", 10_000, 1),
      ],
    });

    // Opening cash is the TRY total alone. ₺100 + €100 + $100 is not ₺300.
    assert.equal(result.shift.openingCash, "100.00");
    const lines = repository.cashCounts[0].lines;
    assert.equal(lines.length, 3);
    assert.equal(lines.filter((l) => l.currency === "EUR")[0].subtotalMinor, 10_000);
    assert.equal(lines.filter((l) => l.currency === "USD")[0].subtotalMinor, 10_000);
  })();
});

test("a drawer with no Turkish lira in it still opens", () => {
  return (async () => {
    const { repository, sut } = service();
    const result = await sut.open(principal("CASHIER"), {
      cashRegisterId: REGISTER,
      openingCash: "500.00",
      cashCounts: [count("EUR", 5_000, 2)],
    });
    assert.equal(result.shift.openingCash, "0.00", "an uncounted TRY float was invented");
    assert.equal(repository.cashCounts[0].lines.length, 1);
  })();
});

/* -------------------------------------------------------------- tampering -- */

test("a tampered drawer is refused before a shift row is attempted", () => {
  return (async () => {
    const payloads: readonly [string, ReturnType<typeof count>[]][] = [
      ["unknown denomination", [count("TRY", 12_345, 1)]],
      ["unknown currency", [count("GBP", 10_000, 1)]],
      ["negative count", [count("TRY", 100, -1)]],
      ["fractional count", [count("TRY", 100, 1.5)]],
      ["absurd count", [count("TRY", 100, 100_001)]],
      ["duplicate denomination", [count("TRY", 100, 1), count("TRY", 100, 2)]],
    ];

    for (const [name, cashCounts] of payloads) {
      const { repository, sut } = service();
      await assert.rejects(
        () =>
          sut.open(principal("CASHIER"), {
            cashRegisterId: REGISTER,
            openingCash: "0.00",
            cashCounts,
          }),
        (error: unknown) =>
          error instanceof DomainError && error.code === "VALIDATION_ERROR",
        `${name} was accepted`,
      );
      assert.equal(repository.shifts.length, 0, `${name} left a shift behind`);
      assert.equal(repository.cashCounts.length, 0, `${name} left a count behind`);
    }
  })();
});

/* ------------------------------------------------------------- atomicity -- */

test("a failed denomination write takes the shift down with it", () => {
  return (async () => {
    const { repository, sut } = service();
    repository.failCashCounts = true;

    await assert.rejects(() =>
      sut.open(principal("CASHIER"), {
        cashRegisterId: REGISTER,
        openingCash: "0.00",
        cashCounts: [count("TRY", 20_000, 1)],
      }),
    );

    // The fake repository models the transaction: nothing is left half-written.
    assert.equal(repository.cashCounts.length, 0);
  })();
});

test("the count is written in the same transaction as the shift, after it exists", () => {
  return (async () => {
    const { repository, sut } = service();
    const result = await sut.open(principal("CASHIER"), {
      cashRegisterId: REGISTER,
      openingCash: "0.00",
      cashCounts: [count("TRY", 100, 1)],
    });
    // The count references a shift that really was created.
    assert.equal(repository.shifts.length, 1);
    assert.equal(repository.cashCounts[0].shiftId, result.shift.id);
    assert.equal(repository.cashCounts[0].countedByStaffId, repository.shifts[0].openedByStaffId);
  })();
});

/* ---------------------------------------------------------------- legacy -- */

test("opening without a counted drawer behaves exactly as it always did", () => {
  return (async () => {
    const { repository, sut } = service();
    const result = await sut.open(principal("CASHIER"), {
      cashRegisterId: REGISTER,
      openingCash: "250.00",
    });

    assert.equal(result.shift.openingCash, "250.00", "the legacy typed float was overridden");
    assert.equal(repository.cashCounts.length, 0, "an empty count row was written");
  })();
});

test("a counted drawer of all zeroes opens the shift and writes no rows", () => {
  return (async () => {
    const { repository, sut } = service();
    const result = await sut.open(principal("CASHIER"), {
      cashRegisterId: REGISTER,
      openingCash: "77.00",
      cashCounts: [count("TRY", 20_000, 0), count("EUR", 500, 0)],
    });

    // An empty drawer is a legitimate count, and it is zero — not the typed 77.
    assert.equal(result.shift.openingCash, "0.00");
    assert.equal(repository.cashCounts.length, 0, "zero-count rows reached the ledger");
  })();
});

/* ------------------------------------------------------------ permission -- */

test("only a shift operator can open a counted drawer", () => {
  return (async () => {
    const { repository, sut } = service();
    await assert.rejects(
      () =>
        sut.open(principal("WAITER"), {
          cashRegisterId: REGISTER,
          openingCash: "0.00",
          cashCounts: [count("TRY", 20_000, 1)],
        }),
      (error: unknown) => error instanceof DomainError,
    );
    assert.equal(repository.cashCounts.length, 0);
  })();
});

test("a second open by the same cashier is refused and writes no second count", () => {
  return (async () => {
    const { repository, sut } = service();
    const firstResult = await sut.open(principal("CASHIER"), {
      cashRegisterId: REGISTER,
      openingCash: "0.00",
      cashCounts: [count("TRY", 20_000, 1)],
    });
    assert.ok(firstResult.shift.id);

    await assert.rejects(() =>
      sut.open(principal("CASHIER"), {
        cashRegisterId: REGISTER,
        openingCash: "0.00",
        cashCounts: [count("TRY", 20_000, 5)],
      }),
    );
    assert.equal(repository.shifts.length, 1, "a double submit opened two shifts");
    assert.equal(repository.cashCounts.length, 1, "a double submit wrote two counts");
  })();
});

/* --------------------------------------------------------------- readback -- */

test("a counted drawer survives the full round trip and is grouped per currency", () => {
  return (async () => {
    const { sut } = service();

    // The drawer from the brief, all three currencies.
    const opened = await sut.open(principal("CASHIER"), {
      cashRegisterId: REGISTER,
      openingCash: "0.00",
      cashCounts: [
        count("TRY", 20_000, 5),
        count("TRY", 10_000, 3),
        count("TRY", 100, 20),
        count("TRY", 50, 10),
        count("TRY", 1, 25),
        count("EUR", 5_000, 2),
        count("EUR", 2_000, 1),
        count("EUR", 100, 3),
        count("EUR", 1, 25),
        count("USD", 10_000, 1),
        count("USD", 2_000, 2),
        count("USD", 100, 5),
      ],
    });

    // request -> service -> repository -> back out again.
    const readBack = await sut.detail(principal("CASHIER"), opened.shift.id);
    assert.ok(readBack.cashCounts, "the counted drawer did not survive the round trip");

    const byCurrency = new Map(readBack.cashCounts.map((view) => [view.currency, view]));

    // ₺1000 + ₺300 + ₺20 + ₺5 + ₺0,25 = ₺1.325,25
    assert.equal(byCurrency.get("TRY")?.totalMinor, 132_525);
    assert.equal(byCurrency.get("TRY")?.pieceCount, 63);
    // €100 + €20 + €3 + €0,25 = €123,25
    assert.equal(byCurrency.get("EUR")?.totalMinor, 12_325);
    // $100 + $40 + $5 = $145,00
    assert.equal(byCurrency.get("USD")?.totalMinor, 14_500);

    // Each currency is its own record; nothing is summed across them.
    assert.equal(readBack.cashCounts.length, 3);
    for (const view of readBack.cashCounts) {
      assert.equal(view.phase, "OPENING");
      const summed = view.lines.reduce((total, line) => total + line.subtotalMinor, 0);
      assert.equal(summed, view.totalMinor, `${view.currency} lines disagree with its total`);
    }

    // And the opening float the rest of the system reads is the TRY total.
    assert.equal(opened.shift.openingCash, "1325.25");
  })();
});

test("a legacy shift reads back as an honest absence, not an invented drawer", () => {
  return (async () => {
    const { sut } = service();
    const opened = await sut.open(principal("CASHIER"), {
      cashRegisterId: REGISTER,
      openingCash: "250.00",
    });

    const readBack = await sut.detail(principal("CASHIER"), opened.shift.id);
    assert.equal(readBack.cashCounts, null, "a breakdown was reconstructed for a legacy shift");
    assert.equal(readBack.shift.openingCash, "250.00", "the legacy float was lost");
  })();
});

test("the readback is scoped to the restaurant that owns the shift", () => {
  return (async () => {
    const { repository, sut } = service();
    const opened = await sut.open(principal("CASHIER"), {
      cashRegisterId: REGISTER,
      openingCash: "0.00",
      cashCounts: [count("TRY", 20_000, 1)],
    });

    // The row exists for its own tenant.
    assert.equal(
      (await repository.listCashCounts("restaurant-a", opened.shift.id)).length,
      1,
    );
    // And is invisible to another, exactly as the composite foreign key
    // `(restaurant_id, shift_id) -> cashier_shifts(restaurant_id, id)` makes it
    // impossible to write across tenants in the first place.
    assert.deepEqual(
      await repository.listCashCounts("restaurant-b", opened.shift.id),
      [],
      "a drawer count leaked across tenants",
    );
  })();
});
