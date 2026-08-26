import assert from "node:assert/strict";
import test from "node:test";

import {
  REPORT_RANGE_PRESETS,
  ReportRangeError,
  addMonths,
  calculateTrend,
  formatDay,
  parseDay,
  resolveReportRange,
  startOfLocalDay,
  toLocalDay,
  weekdayLabel,
} from "../../lib/domain/report-range";

/** 14 August 2028, 09:00 Istanbul (06:00 UTC). */
const NOW = new Date("2028-08-14T06:00:00.000Z");

function range(preset: (typeof REPORT_RANGE_PRESETS)[number], extra = {}) {
  return resolveReportRange({ preset, now: NOW, ...extra });
}

function bounds(resolved: ReturnType<typeof resolveReportRange>) {
  return [formatDay(resolved.startDay), formatDay(resolved.endDayInclusive)];
}

test("a local day starts at Istanbul midnight, not UTC midnight", () => {
  // Türkiye is UTC+3, so 1 September starts at 21:00 UTC on 31 August.
  assert.equal(
    startOfLocalDay({ year: 2026, month: 9, day: 1 }).toISOString(),
    "2026-08-31T21:00:00.000Z",
  );
  // An instant just before that still belongs to the previous local day.
  assert.deepEqual(toLocalDay(new Date("2026-08-31T20:59:59.000Z")), {
    year: 2026,
    month: 8,
    day: 31,
  });
  assert.deepEqual(toLocalDay(new Date("2026-08-31T21:00:00.000Z")), {
    year: 2026,
    month: 9,
    day: 1,
  });
});

test("today covers exactly one local calendar day", () => {
  const today = range("TODAY");
  assert.deepEqual(bounds(today), ["2028-08-14", "2028-08-14"]);
  assert.equal(today.start.toISOString(), "2028-08-13T21:00:00.000Z");
  assert.equal(today.endExclusive.toISOString(), "2028-08-14T21:00:00.000Z");
});

test("yesterday ends where today starts", () => {
  const yesterday = range("YESTERDAY");
  assert.deepEqual(bounds(yesterday), ["2028-08-13", "2028-08-13"]);
  assert.equal(yesterday.endExclusive.getTime(), range("TODAY").start.getTime());
});

test("the rolling day presets include today", () => {
  assert.deepEqual(bounds(range("LAST_7_DAYS")), ["2028-08-08", "2028-08-14"]);
  assert.deepEqual(bounds(range("LAST_30_DAYS")), ["2028-07-16", "2028-08-14"]);
});

test("last 6 months is calendar arithmetic, not 180 days", () => {
  assert.deepEqual(bounds(range("LAST_6_MONTHS")), ["2028-02-14", "2028-08-14"]);
  assert.deepEqual(bounds(range("LAST_3_MONTHS")), ["2028-05-14", "2028-08-14"]);
});

test("month-end arithmetic clamps instead of rolling over", () => {
  // 31 March minus one month is 29 February in a leap year, never 2 March.
  assert.deepEqual(addMonths({ year: 2028, month: 3, day: 31 }, -1), {
    year: 2028,
    month: 2,
    day: 29,
  });
  assert.deepEqual(addMonths({ year: 2027, month: 3, day: 31 }, -1), {
    year: 2027,
    month: 2,
    day: 28,
  });
  assert.deepEqual(addMonths({ year: 2028, month: 1, day: 15 }, -1), {
    year: 2027,
    month: 12,
    day: 15,
  });
});

test("this month, previous month and this year follow the calendar", () => {
  assert.deepEqual(bounds(range("THIS_MONTH")), ["2028-08-01", "2028-08-14"]);
  assert.deepEqual(bounds(range("PREVIOUS_MONTH")), ["2028-07-01", "2028-07-31"]);
  assert.deepEqual(bounds(range("THIS_YEAR")), ["2028-01-01", "2028-08-14"]);
});

test("since system start uses the first real operation, never a hard-coded epoch", () => {
  const resolved = range("SINCE_SYSTEM_START", {
    systemStart: new Date("2026-09-01T08:00:00.000Z"),
  });
  assert.deepEqual(bounds(resolved), ["2026-09-01", "2028-08-14"]);
});

test("since system start with no operations yet is an empty period, not an error", () => {
  const resolved = range("SINCE_SYSTEM_START", { systemStart: null });
  assert.deepEqual(bounds(resolved), ["2028-08-14", "2028-08-14"]);
});

test("a custom historical range is honoured years after the fact", () => {
  const resolved = range("CUSTOM", { from: "2026-09-01", to: "2026-09-30" });
  assert.deepEqual(bounds(resolved), ["2026-09-01", "2026-09-30"]);
  assert.equal(resolved.start.toISOString(), "2026-08-31T21:00:00.000Z");
  // End is exclusive: the instant is midnight after the last included day.
  assert.equal(resolved.endExclusive.toISOString(), "2026-09-30T21:00:00.000Z");
});

test("the end boundary is exclusive to the minute", () => {
  const resolved = range("CUSTOM", { from: "2026-09-01", to: "2026-09-30" });
  const lastIncluded = new Date(resolved.endExclusive.getTime() - 1);
  assert.deepEqual(toLocalDay(lastIncluded), { year: 2026, month: 9, day: 30 });
  assert.deepEqual(toLocalDay(resolved.endExclusive), { year: 2026, month: 10, day: 1 });
});

test("a single-day custom range covers that one day", () => {
  const resolved = range("CUSTOM", { from: "2026-09-15", to: "2026-09-15" });
  assert.deepEqual(bounds(resolved), ["2026-09-15", "2026-09-15"]);
  assert.equal(resolved.endExclusive.getTime() - resolved.start.getTime(), 86_400_000);
});

test("a future end is clamped to today and reported as clamped", () => {
  const resolved = range("CUSTOM", { from: "2028-08-01", to: "2030-01-01" });
  assert.deepEqual(bounds(resolved), ["2028-08-01", "2028-08-14"]);
  assert.equal(resolved.clampedToToday, true);
  assert.equal(range("THIS_MONTH").clampedToToday, false);
});

test("an entirely future range collapses to an empty period", () => {
  const resolved = range("CUSTOM", { from: "2029-01-01", to: "2029-02-01" });
  assert.equal(resolved.start.getTime(), resolved.endExclusive.getTime());
});

test("an inverted or malformed custom range is rejected", () => {
  assert.throws(
    () => range("CUSTOM", { from: "2026-10-01", to: "2026-09-01" }),
    ReportRangeError,
  );
  assert.throws(() => range("CUSTOM", { from: "01.09.2026", to: "2026-09-30" }), ReportRangeError);
  assert.throws(() => parseDay("2026-02-31"), ReportRangeError);
  assert.throws(() => range("CUSTOM", { from: "2026-09-01" }), ReportRangeError);
});

test("the previous equal period has exactly the same length", () => {
  const resolved = range("CUSTOM", {
    from: "2026-09-01",
    to: "2026-09-30",
    comparison: "PREVIOUS_PERIOD",
  });
  const comparison = resolved.comparison;
  assert.ok(comparison);
  assert.equal(comparison.kind, "PREVIOUS_PERIOD");
  // 30 days before, ending exactly where the selected period starts.
  assert.equal(comparison.endExclusive.getTime(), resolved.start.getTime());
  assert.equal(
    comparison.endExclusive.getTime() - comparison.start.getTime(),
    resolved.endExclusive.getTime() - resolved.start.getTime(),
  );
  assert.deepEqual(toLocalDay(comparison.start), { year: 2026, month: 8, day: 2 });
});

test("the previous year comparison shifts by twelve calendar months", () => {
  const resolved = range("CUSTOM", {
    from: "2027-09-01",
    to: "2027-09-30",
    comparison: "PREVIOUS_YEAR",
  });
  const comparison = resolved.comparison;
  assert.ok(comparison);
  assert.deepEqual(toLocalDay(comparison.start), { year: 2026, month: 9, day: 1 });
  assert.deepEqual(toLocalDay(new Date(comparison.endExclusive.getTime() - 1)), {
    year: 2026,
    month: 9,
    day: 30,
  });
});

test("a leap day compared against a common year does not roll into March", () => {
  const resolved = resolveReportRange({
    preset: "CUSTOM",
    now: new Date("2028-03-05T06:00:00.000Z"),
    from: "2028-02-29",
    to: "2028-02-29",
    comparison: "PREVIOUS_YEAR",
  });
  const comparison = resolved.comparison;
  assert.ok(comparison);
  assert.deepEqual(toLocalDay(comparison.start), { year: 2027, month: 2, day: 28 });
});

test("no comparison is the default", () => {
  assert.equal(range("THIS_MONTH").comparison, null);
});

test("trends never divide by zero", () => {
  assert.deepEqual(calculateTrend(120, 100), { direction: "UP", percentage: 20 });
  assert.deepEqual(calculateTrend(96, 100), { direction: "DOWN", percentage: -4 });
  assert.deepEqual(calculateTrend(100, 100), { direction: "FLAT", percentage: 0 });
  // A baseline of zero has no percentage to report.
  assert.deepEqual(calculateTrend(500, 0), { direction: "NEW", percentage: null });
  assert.deepEqual(calculateTrend(0, 0), { direction: "NONE", percentage: null });
  assert.equal(Number.isFinite(calculateTrend(1, 0).percentage ?? 0), true);
});

test("every preset resolves without throwing", () => {
  for (const preset of REPORT_RANGE_PRESETS) {
    const resolved = resolveReportRange({
      preset,
      now: NOW,
      from: "2026-09-01",
      to: "2026-09-30",
      systemStart: new Date("2026-09-01T08:00:00.000Z"),
    });
    assert.ok(resolved.start instanceof Date, `${preset} produced no start`);
    assert.ok(
      resolved.endExclusive.getTime() >= resolved.start.getTime(),
      `${preset} produced a negative period`,
    );
  }
});

test("weekday labels follow PostgreSQL's Sunday-first numbering", () => {
  assert.equal(weekdayLabel(0), "Pazar");
  assert.equal(weekdayLabel(1), "Pazartesi");
  assert.equal(weekdayLabel(6), "Cumartesi");
  assert.equal(weekdayLabel(9), "Bilinmiyor");
});
