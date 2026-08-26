import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { DomainError } from "../../lib/api/domain-error";
import { CashierReportService } from "../../lib/services/cashier-report-service";
import {
  FakeShiftRepository,
  methodTotals,
  openShift,
  principal,
  totalsWith,
} from "./phase8a-shift-fixtures";
import { dailyCashReportQuerySchema } from "../../lib/validation/cashier-report";

/**
 * Phase 8B — who may read which report, and the shapes the routes accept.
 *
 * The daily report is the sensitive one: it aggregates the whole restaurant,
 * so a cashier must not reach it even though they may read their own shift.
 */

function service(repository: FakeShiftRepository): CashierReportService {
  return new CashierReportService(repository);
}

async function failure(work: () => Promise<unknown>): Promise<string> {
  try {
    await work();
    return "NO_ERROR";
  } catch (error) {
    return error instanceof DomainError ? error.code : `UNEXPECTED:${String(error)}`;
  }
}

function withOpenShift(): FakeShiftRepository {
  const repository = new FakeShiftRepository();
  repository.shifts.push(openShift());
  repository.totals = totalsWith({
    payments: methodTotals("1000.00", "600.00"),
    refunds: methodTotals("100.00", "50.00"),
    cashIn: "50.00",
    cashOut: "200.00",
    movementCount: 2,
  });
  return repository;
}

// -------------------------------------------------------------- X report RBAC

test("a cashier reads the X report of their own open drawer", async () => {
  const report = await service(withOpenShift()).xReport(principal("CASHIER"), "shift-1");
  assert.equal(report.reportType, "X");
  assert.equal(report.expectedCash, "1250.00");
  assert.equal(report.grossCollected, "1600.00");
});

test("reading an X report twice writes nothing and changes no state", async () => {
  const repository = withOpenShift();
  const reports = service(repository);

  const first = await reports.xReport(principal("CASHIER"), "shift-1");
  const second = await reports.xReport(principal("CASHIER"), "shift-1");

  assert.equal(repository.shifts[0]!.status, "OPEN", "the shift stays open");
  assert.equal(repository.closes.length, 0, "no close was attempted");
  assert.equal(repository.audits.length, 0, "a read is not an audited mutation");
  assert.equal(repository.outbox.length, 0);
  assert.equal(repository.movements.length, 0);
  assert.equal(first.expectedCash, second.expectedCash);
  assert.equal(first.grossCollected, second.grossCollected);
});

test("an X report reflects money that arrived since the previous one", async () => {
  const repository = withOpenShift();
  const before = await service(repository).xReport(principal("CASHIER"), "shift-1");

  // A further 200.00 cash is collected into the same drawer.
  repository.totals = totalsWith({
    payments: methodTotals("1200.00", "600.00"),
    refunds: methodTotals("100.00", "50.00"),
    cashIn: "50.00",
    cashOut: "200.00",
    movementCount: 2,
  });
  const after = await service(repository).xReport(principal("CASHIER"), "shift-1");

  assert.equal(before.expectedCash, "1250.00");
  assert.equal(after.expectedCash, "1450.00", "the live view moved with the drawer");
  assert.equal(after.grossCollected, "1800.00");
});

test("a cashier cannot read a colleague's X report", async () => {
  const repository = new FakeShiftRepository();
  repository.shifts.push(openShift({ openedByStaffId: "user-other-cashier" }));
  assert.equal(
    await failure(() => service(repository).xReport(principal("CASHIER"), "shift-1")),
    "NOT_FOUND",
  );
});

test("a supervisor reads any open drawer in the restaurant", async () => {
  const repository = new FakeShiftRepository();
  repository.shifts.push(openShift({ openedByStaffId: "user-other-cashier" }));
  for (const role of ["ADMIN", "MANAGER"] as const) {
    const report = await service(repository).xReport(principal(role), "shift-1");
    assert.equal(report.shiftId, "shift-1", `${role} may read it`);
  }
});

test("waiters and kitchen staff reach no cash report at all", async () => {
  const repository = withOpenShift();
  for (const role of ["WAITER", "KITCHEN"] as const) {
    assert.equal(
      await failure(() => service(repository).xReport(principal(role), "shift-1")),
      "FORBIDDEN",
      `${role} X`,
    );
    assert.equal(
      await failure(() => service(repository).zReport(principal(role), "shift-1")),
      "FORBIDDEN",
      `${role} Z`,
    );
    assert.equal(
      await failure(() =>
        service(repository).dailyReport(principal(role), { date: "2026-08-15" }),
      ),
      "FORBIDDEN",
      `${role} daily`,
    );
  }
});

test("an X report is refused once the drawer is closed", async () => {
  const repository = new FakeShiftRepository();
  repository.shifts.push(openShift());
  const reports = service(repository);

  // Close it the way the shift service does, then ask for X again.
  repository.shifts[0] = { ...repository.shifts[0]!, status: "CLOSED" };
  assert.equal(
    await failure(() => reports.xReport(principal("CASHIER"), "shift-1")),
    "CASHIER_SHIFT_CLOSED",
  );
});

// -------------------------------------------------------------- Z report RBAC

test("a Z report cannot be taken before the drawer is closed", async () => {
  assert.equal(
    await failure(() => service(withOpenShift()).zReport(principal("CASHIER"), "shift-1")),
    "CASHIER_SHIFT_NOT_CLOSED",
  );
});

test("a shift closed before Phase 8B reports no Z rather than inventing one", async () => {
  const repository = new FakeShiftRepository();
  repository.shifts.push(
    openShift({
      status: "CLOSED",
      closedAt: new Date("2026-08-15T18:00:00.000Z"),
      closedByStaffId: "user-cashier",
      countedCashAtClose: "500.00",
      expectedCashAtClose: "500.00",
      cashVariance: "0.00",
      // Legacy: no snapshot was written when this shift closed.
      zReportSnapshot: null,
    }),
  );
  assert.equal(
    await failure(() => service(repository).zReport(principal("CASHIER"), "shift-1")),
    "LEGACY_SHIFT_WITHOUT_Z_SNAPSHOT",
  );
});

test("a cashier cannot read a colleague's Z report", async () => {
  const repository = new FakeShiftRepository();
  repository.shifts.push(
    openShift({ openedByStaffId: "user-other-cashier", status: "CLOSED" }),
  );
  assert.equal(
    await failure(() => service(repository).zReport(principal("CASHIER"), "shift-1")),
    "NOT_FOUND",
  );
});

test("another restaurant's reports are simply not there", async () => {
  const repository = withOpenShift();
  const foreign = { ...principal("MANAGER"), restaurantId: "restaurant-b" };
  assert.equal(await failure(() => service(repository).xReport(foreign, "shift-1")), "NOT_FOUND");
  assert.equal(await failure(() => service(repository).zReport(foreign, "shift-1")), "NOT_FOUND");
});

// ------------------------------------------------------------------ daily RBAC

test("the end-of-day report is supervisory only", async () => {
  const repository = withOpenShift();
  assert.equal(
    await failure(() =>
      service(repository).dailyReport(principal("CASHIER"), { date: "2026-08-15" }),
    ),
    "FORBIDDEN",
    "a cashier must not see the whole restaurant's takings",
  );
  for (const role of ["ADMIN", "MANAGER"] as const) {
    const report = await service(repository).dailyReport(principal(role), {
      date: "2026-08-15",
    });
    assert.equal(report.businessDate, "2026-08-15", `${role} may read it`);
    assert.equal(report.timezoneOffsetMinutes, 180, "the restaurant's own timezone");
  }
});

test("the daily query rejects a client-named tenant outright", () => {
  const spoofed = dailyCashReportQuerySchema.safeParse({
    date: "2026-08-15",
    restaurantId: "restaurant-b",
  });
  assert.equal(spoofed.success, false, "an unknown key must be rejected, not ignored");

  const valid = dailyCashReportQuerySchema.safeParse({ date: "2026-08-15" });
  assert.equal(valid.success, true);
  assert.equal(valid.success && valid.data.format, "json", "JSON is the default");

  for (const invalid of ["2026-8-15", "15-08-2026", "", "yesterday"]) {
    assert.equal(
      dailyCashReportQuerySchema.safeParse({ date: invalid }).success,
      false,
      `${invalid} must be refused`,
    );
  }
});

test("an impossible calendar date is refused rather than rolled over", async () => {
  assert.equal(
    await failure(() =>
      service(withOpenShift()).dailyReport(principal("ADMIN"), { date: "2026-02-31" }),
    ),
    // ReportRangeError is not a DomainError; what matters is that it throws
    // rather than silently reporting on 3 March.
    "UNEXPECTED:ReportRangeError: Geçerli bir tarih girin.",
  );
});

// ----------------------------------------------------------------- no printers

test("Phase 8B ships no printer transport", () => {
  const files = [
    "lib/services/cashier-report-service.ts",
    "lib/domain/cashier-report.ts",
    "lib/domain/cashier-report-csv.ts",
  ];
  for (const file of files) {
    const source = readFileSync(path.join(process.cwd(), file), "utf8");
    assert.ok(
      !/ESC\/POS|escpos|SerialPort|usb|node-thermal|printer-queue/i.test(source),
      `${file} must not contain printer transport code`,
    );
  }
});
