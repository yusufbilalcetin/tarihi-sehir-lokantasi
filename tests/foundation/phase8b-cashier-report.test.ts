import assert from "node:assert/strict";
import { test } from "node:test";

import {
  NON_FISCAL_DISCLAIMER,
  UnsupportedSnapshotVersionError,
  Z_SNAPSHOT_VERSION,
  buildXReport,
  buildZSnapshot,
  countBreakdown,
  sumBreakdown,
  summaryFromMethodTotals,
  toMethodBreakdown,
} from "../../lib/domain/cashier-report";
import {
  dailyReportToCsv,
  xReportToCsv,
  zReportToCsv,
} from "../../lib/domain/cashier-report-csv";
import { PAYMENT_METHODS } from "../../lib/domain/status";
import {
  CorruptSnapshotError,
  parseZSnapshot,
} from "../../lib/validation/cashier-report";
import { methodTotals } from "./phase8a-shift-fixtures";

/**
 * Phase 8B — the report documents themselves, in isolation from any database.
 *
 * The invariants that matter here are that a breakdown always sums to its own
 * gross, that card money never reaches physical cash, and that a stored Z
 * report can be read back exactly as written.
 */

const AT = new Date("2026-08-15T18:00:00.000Z");
const OPENED_AT = "2026-08-15T09:00:00.000Z";

const IDENTITY = {
  restaurantId: "restaurant-a",
  restaurantNameSnapshot: "Tarihi Şehir Lokantası",
  registerId: "register-1",
  registerNameSnapshot: "Ana Kasa",
  shiftId: "shift-1",
  openedByStaffId: "user-cashier",
  openedByNameSnapshot: "Ayşe Kasiyer",
  openedAt: OPENED_AT,
};

/** The Phase 8A worked example: 500 + 1000 − 100 + 50 − 200 = 1250.00 */
function fixture() {
  const paymentsByMethod = methodTotals("1000.00", "600.00", "0.00", { cash: 3, card: 2 });
  const refundsByMethod = methodTotals("100.00", "50.00", "0.00", { cash: 1, card: 1 });
  return {
    identity: IDENTITY,
    summary: summaryFromMethodTotals({
      openingCash: "500.00",
      paymentsByMethod,
      refundsByMethod,
      cashIn: "50.00",
      cashOut: "200.00",
    }),
    paymentsByMethod,
    refundsByMethod,
    movementCount: 2,
  };
}

// ------------------------------------------------------------------ X report

test("the X report carries the shift's live money position exactly", () => {
  const report = buildXReport(fixture(), AT);

  assert.equal(report.reportType, "X");
  assert.equal(report.shiftStatus, "OPEN");
  assert.equal(report.openingCash, "500.00");
  assert.equal(report.expectedCash, "1250.00", "500 + 1000 − 100 + 50 − 200");
  assert.equal(report.grossCollected, "1600.00", "card is collected, just not in the drawer");
  assert.equal(report.totalRefunds, "150.00");
  assert.equal(report.netCollected, "1450.00");
  assert.equal(report.paymentCount, 5);
  assert.equal(report.refundCount, 2);
  assert.equal(report.cashIn, "50.00");
  assert.equal(report.cashOut, "200.00");
  assert.equal(report.movementCount, 2);
  assert.equal(report.openDurationMinutes, 540, "09:00 to 18:00");
  assert.equal(report.nonFiscalNotice, NON_FISCAL_DISCLAIMER);
});

test("the payment breakdown sums to gross and the refund breakdown to refunds", () => {
  const report = buildXReport(fixture(), AT);

  assert.equal(sumBreakdown(report.paymentMethodBreakdown), report.grossCollected);
  assert.equal(countBreakdown(report.paymentMethodBreakdown), report.paymentCount);
  assert.equal(sumBreakdown(report.refundMethodBreakdown), report.totalRefunds);
  assert.equal(countBreakdown(report.refundMethodBreakdown), report.refundCount);

  assert.deepEqual(
    report.paymentMethodBreakdown.map((row) => [row.method, row.amount, row.count]),
    [["CASH", "1000.00", 3], ["CARD", "600.00", 2], ["OTHER", "0.00", 0]],
  );
  assert.deepEqual(
    report.refundMethodBreakdown.map((row) => [row.method, row.amount]),
    [["CASH", "100.00"], ["CARD", "50.00"], ["OTHER", "0.00"]],
  );
});

test("the breakdown follows the payment-method enum, not a hand-written list", () => {
  const rows = toMethodBreakdown(methodTotals("1.00"));
  assert.deepEqual(
    rows.map((row) => row.method),
    [...PAYMENT_METHODS],
    "a method added to the enum must appear in every report automatically",
  );
  // A method with no rows is present with a zero, never missing.
  assert.equal(rows.find((row) => row.method === "OTHER")?.amount, "0.00");
});

test("card money changes collection but never the drawer", () => {
  const cashOnly = summaryFromMethodTotals({
    openingCash: "500.00",
    paymentsByMethod: methodTotals("1000.00"),
    refundsByMethod: methodTotals("100.00"),
    cashIn: "50.00",
    cashOut: "200.00",
  });
  const withCard = fixture().summary;

  assert.equal(cashOnly.expectedCash, withCard.expectedCash, "the drawer is identical");
  assert.notEqual(cashOnly.grossCollected, withCard.grossCollected, "collection is not");
});

// ------------------------------------------------------------------ Z report

function zFixture() {
  return buildZSnapshot(
    {
      ...fixture(),
      closedByStaffId: "user-cashier",
      closedByNameSnapshot: "Ayşe Kasiyer",
      closedAt: "2026-08-15T18:00:00.000Z",
      countedCash: "1240.00",
      cashVariance: "-10.00",
      closeNote: "Bozuk para eksik sayıldı.",
    },
    AT,
  );
}

test("the Z snapshot freezes the counted drawer and its variance", () => {
  const snapshot = zFixture();

  assert.equal(snapshot.reportType, "Z");
  assert.equal(snapshot.version, Z_SNAPSHOT_VERSION);
  assert.equal(snapshot.expectedCash, "1250.00");
  assert.equal(snapshot.countedCash, "1240.00");
  assert.equal(snapshot.cashVariance, "-10.00");
  assert.equal(snapshot.managerOverride, false, "the cashier closed their own drawer");
  assert.equal(snapshot.closeNote, "Bozuk para eksik sayıldı.");
  assert.equal(snapshot.restaurantNameSnapshot, "Tarihi Şehir Lokantası");
  assert.equal(snapshot.registerNameSnapshot, "Ana Kasa");
  assert.equal(snapshot.openedByNameSnapshot, "Ayşe Kasiyer");
  assert.equal(snapshot.nonFiscalNotice, NON_FISCAL_DISCLAIMER);
  assert.equal(sumBreakdown(snapshot.paymentMethodBreakdown), snapshot.grossCollected);
  assert.equal(sumBreakdown(snapshot.refundMethodBreakdown), snapshot.totalRefunds);
});

test("a supervisor close is recorded as an override", () => {
  const snapshot = buildZSnapshot(
    {
      ...fixture(),
      closedByStaffId: "user-manager",
      closedByNameSnapshot: "Müdür",
      closedAt: "2026-08-15T18:00:00.000Z",
      countedCash: "1250.00",
      cashVariance: "0.00",
      closeNote: "Kasiyer erken ayrıldı.",
    },
    AT,
  );
  assert.equal(snapshot.managerOverride, true);
  assert.equal(snapshot.openedByStaffId, "user-cashier", "ownership never moves");
  assert.equal(snapshot.closedByStaffId, "user-manager");
});

test("a stored snapshot round-trips through validation unchanged", () => {
  const snapshot = zFixture();
  const parsed = parseZSnapshot(JSON.parse(JSON.stringify(snapshot)));
  assert.deepEqual(parsed, snapshot, "reading a Z report must return what was written");
});

test("a snapshot from a newer version is refused rather than mis-parsed", () => {
  const future = { ...zFixture(), version: Z_SNAPSHOT_VERSION + 1 };
  assert.throws(() => parseZSnapshot(future), UnsupportedSnapshotVersionError);
  assert.throws(() => parseZSnapshot({ version: undefined }), UnsupportedSnapshotVersionError);
});

test("a corrupt snapshot fails loudly instead of rendering half a report", () => {
  const broken = { ...zFixture(), expectedCash: "not-money" };
  assert.throws(() => parseZSnapshot(broken), CorruptSnapshotError);

  const missing: Record<string, unknown> = { ...zFixture() };
  delete missing.countedCash;
  assert.throws(() => parseZSnapshot(missing), CorruptSnapshotError);

  // An unexpected extra field is a schema drift signal, not something to ignore.
  assert.throws(
    () => parseZSnapshot({ ...zFixture(), somethingNew: 1 }),
    CorruptSnapshotError,
  );
});

test("a negative expectation and variance survive the round trip", () => {
  // A drawer emptied by a large cash-out is a real state, and its report must
  // be storable and readable.
  const paymentsByMethod = methodTotals();
  const negative = buildZSnapshot(
    {
      identity: IDENTITY,
      summary: summaryFromMethodTotals({
        openingCash: "100.00",
        paymentsByMethod,
        refundsByMethod: methodTotals(),
        cashIn: "0.00",
        cashOut: "150.00",
      }),
      paymentsByMethod,
      refundsByMethod: methodTotals(),
      movementCount: 1,
      closedByStaffId: "user-cashier",
      closedByNameSnapshot: "Ayşe Kasiyer",
      closedAt: "2026-08-15T18:00:00.000Z",
      countedCash: "0.00",
      cashVariance: "50.00",
      closeNote: "Kasa devri yapıldı.",
    },
    AT,
  );
  assert.equal(negative.expectedCash, "-50.00");
  assert.deepEqual(parseZSnapshot(JSON.parse(JSON.stringify(negative))), negative);
});

// ----------------------------------------------------------------------- CSV

test("every CSV export neutralises spreadsheet formulas", () => {
  const hostile = {
    ...zFixture(),
    registerNameSnapshot: "=1+1",
    openedByNameSnapshot: "@cmd",
    closedByNameSnapshot: "-2+3",
    closeNote: "+SUM(A1:A9)",
  };
  const csv = zReportToCsv(hostile);

  for (const dangerous of ["=1+1", "@cmd", "-2+3", "+SUM(A1:A9)"]) {
    assert.ok(csv.includes(dangerous), `${dangerous} still appears verbatim to a reader`);
    assert.ok(
      !csv.includes(`"${dangerous}`) || csv.includes(`"'${dangerous}`),
      `${dangerous} must be quoted with a leading apostrophe, never left executable`,
    );
  }
  assert.ok(csv.startsWith("﻿"), "a BOM keeps Turkish characters readable in Excel");
});

test("CSV money stays machine-parseable, never locale-formatted", () => {
  const csv = xReportToCsv(buildXReport(fixture(), AT));
  assert.ok(csv.includes('"1250.00"'), "expected cash is an exact decimal");
  assert.ok(csv.includes('"1600.00"'), "gross is an exact decimal");
  assert.ok(!csv.includes("1.250,00"), "no thousands separator or decimal comma");
  assert.ok(csv.includes("OPERASYONEL X RAPORU"));
  assert.ok(csv.includes(NON_FISCAL_DISCLAIMER), "the non-fiscal notice travels with the file");
});

test("the daily CSV carries its totals, breakdowns and warnings", () => {
  const csv = dailyReportToCsv({
    restaurantName: "Tarihi Şehir Lokantası",
    businessDate: "2026-08-15",
    generatedAt: AT.toISOString(),
    paymentMethodBreakdown: toMethodBreakdown(methodTotals("300.00", "200.00")),
    grossCollected: "500.00",
    paymentCount: 2,
    refundMethodBreakdown: toMethodBreakdown(methodTotals("25.00")),
    totalRefunds: "25.00",
    refundCount: 1,
    netCollected: "475.00",
    cashIn: "10.00",
    cashOut: "5.00",
    openedShiftCount: 2,
    closedShiftCount: 1,
    openShiftCount: 1,
    zReportCount: 1,
    closedShiftVarianceTotal: "-3.00",
    registerBreakdown: [
      {
        name: "=Ana Kasa",
        grossCollected: "500.00",
        totalRefunds: "25.00",
        netCollected: "475.00",
        cashIn: "10.00",
        cashOut: "5.00",
      },
    ],
    cashierBreakdown: [
      {
        name: "Ayşe",
        grossCollected: "500.00",
        totalRefunds: "25.00",
        netCollected: "475.00",
      },
    ],
    warnings: ["Gün sonu tamamlanmamış: 1 açık kasa vardiyası mevcut."],
  });

  assert.ok(csv.includes("GÜN SONU KASA RAPORU"));
  assert.ok(csv.includes('"475.00"'));
  assert.ok(csv.includes("Ayşe"), "Turkish characters survive");
  assert.ok(csv.includes("açık kasa vardiyası"), "the warning is exported too");
  // The name occupies a cell of its own, so the escaper sees the `=` at the
  // start of the value and neutralises it.
  assert.ok(csv.includes(`"'=Ana Kasa"`), "a hostile register name is neutralised");
  assert.ok(!csv.includes(`,"=Ana Kasa"`), "no cell may start with a bare formula trigger");
});

test("no report ever reports profit", () => {
  const documents = [
    JSON.stringify(buildXReport(fixture(), AT)),
    JSON.stringify(zFixture()),
    xReportToCsv(buildXReport(fixture(), AT)),
    zReportToCsv(zFixture()),
  ];
  for (const document of documents) {
    assert.ok(
      !/profit|margin|kâr|kar marj/i.test(document),
      "there is no cost model, so nothing may be presented as profit",
    );
  }
});

test("the reports never call themselves fiscal", () => {
  const csv = zReportToCsv(zFixture());
  assert.ok(csv.includes("OPERASYONEL Z RAPORU"));
  assert.ok(
    /mali cihaz\/ÖKC Z raporu değildir/.test(csv),
    "the file states plainly that it is not a fiscal document",
  );
  assert.ok(!/resmi mali|vergi Z raporu|ÖKC Z raporudur/i.test(csv));
});
