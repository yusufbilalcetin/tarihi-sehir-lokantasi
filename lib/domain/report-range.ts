/**
 * Report periods are calendar periods in the restaurant's own timezone, not
 * rolling windows of milliseconds. Every preset resolves to the same shape so
 * the services, the API and the tests share one definition of "the period".
 */

export const REPORT_RANGE_PRESETS = [
  "TODAY",
  "YESTERDAY",
  "LAST_7_DAYS",
  "LAST_30_DAYS",
  "LAST_3_MONTHS",
  "LAST_6_MONTHS",
  "THIS_MONTH",
  "PREVIOUS_MONTH",
  "THIS_YEAR",
  "SINCE_SYSTEM_START",
  "CUSTOM",
] as const;

export type ReportRangePreset = (typeof REPORT_RANGE_PRESETS)[number];

export const REPORT_COMPARISONS = ["NONE", "PREVIOUS_PERIOD", "PREVIOUS_YEAR"] as const;
export type ReportComparison = (typeof REPORT_COMPARISONS)[number];

export const REPORT_RANGE_LABELS: Readonly<Record<ReportRangePreset, string>> = {
  TODAY: "Bugün",
  YESTERDAY: "Dün",
  LAST_7_DAYS: "Son 7 Gün",
  LAST_30_DAYS: "Son 30 Gün",
  LAST_3_MONTHS: "Son 3 Ay",
  LAST_6_MONTHS: "Son 6 Ay",
  THIS_MONTH: "Bu Ay",
  PREVIOUS_MONTH: "Geçen Ay",
  THIS_YEAR: "Bu Yıl",
  SINCE_SYSTEM_START: "Sistem Başlangıcından İtibaren",
  CUSTOM: "Özel Tarih Aralığı",
};

/**
 * The zone every calendar boundary in this file is measured in.
 *
 * It is the restaurant's own `timezone` column, not a constant: a fixed +03:00
 * is exact for Türkiye and wrong for anywhere that keeps daylight saving, and
 * the day a report covers is the day the restaurant actually worked.
 *
 * Used only as the last-resort default when a caller has no restaurant in
 * hand — the column's own default is the same value.
 */
export const DEFAULT_RESTAURANT_TIME_ZONE = "Europe/Istanbul";

/**
 * How far the zone is from UTC at a given instant, in minutes.
 *
 * Derived by formatting the instant in the zone and reading it back as though
 * it were UTC: the gap is the offset. That makes daylight saving a property of
 * the instant rather than something this file has to know about.
 */
function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  const asIfUtc = Date.UTC(
    value("year"),
    value("month") - 1,
    value("day"),
    // A zone that formats midnight as "24" would otherwise jump a day.
    value("hour") % 24,
    value("minute"),
    value("second"),
  );
  return Math.round((asIfUtc - instant.getTime()) / 60_000);
}

export interface CalendarDay {
  readonly year: number;
  /** 1-12, as a human writes it. */
  readonly month: number;
  readonly day: number;
}

export interface ResolvedReportRange {
  readonly preset: ReportRangePreset;
  readonly label: string;
  /**
   * The zone the boundaries were measured in, carried so that whatever groups
   * rows *inside* the period groups them by the same day the period is bounded
   * by. Without it a caller has the right window and still has to guess the
   * zone to bucket by, and guessing is how a fixed `+03:00` survived.
   */
  readonly timeZone: string;
  readonly start: Date;
  /** Exclusive, so a day boundary is never counted twice or missed. */
  readonly endExclusive: Date;
  /** Local calendar bounds, for display and for building the comparison. */
  readonly startDay: CalendarDay;
  /** The last day actually included (endExclusive minus one day). */
  readonly endDayInclusive: CalendarDay;
  readonly comparison: ReportComparisonRange | null;
  /** True when the requested end was in the future and got clamped to today. */
  readonly clampedToToday: boolean;
}

export interface ReportComparisonRange {
  readonly kind: Exclude<ReportComparison, "NONE">;
  readonly label: string;
  readonly start: Date;
  readonly endExclusive: Date;
}

export class ReportRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportRangeError";
  }
}

/**
 * Midnight of a local calendar day, as the UTC instant it actually is.
 *
 * Resolved twice on purpose: the offset that applies at the guessed instant can
 * differ from the offset that applies at the real midnight — which is exactly
 * what happens on the night a zone changes its clocks.
 */
export function startOfLocalDay(
  day: CalendarDay,
  timeZone: string = DEFAULT_RESTAURANT_TIME_ZONE,
): Date {
  const naive = Date.UTC(day.year, day.month - 1, day.day);
  const guess = new Date(naive - zoneOffsetMinutes(new Date(naive), timeZone) * 60_000);
  return new Date(naive - zoneOffsetMinutes(guess, timeZone) * 60_000);
}

/** Which local calendar day an instant falls on. */
export function toLocalDay(
  instant: Date,
  timeZone: string = DEFAULT_RESTAURANT_TIME_ZONE,
): CalendarDay {
  const shifted = new Date(instant.getTime() + zoneOffsetMinutes(instant, timeZone) * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/** The offset that applied in this zone on this calendar day, in minutes. */
export function zoneOffsetForDay(day: CalendarDay, timeZone: string): number {
  return zoneOffsetMinutes(startOfLocalDay(day, timeZone), timeZone);
}

export function addDays(day: CalendarDay, days: number): CalendarDay {
  const moved = new Date(Date.UTC(day.year, day.month - 1, day.day + days));
  return {
    year: moved.getUTCFullYear(),
    month: moved.getUTCMonth() + 1,
    day: moved.getUTCDate(),
  };
}

/**
 * Calendar-month arithmetic that never rolls over: 31 March minus one month is
 * 28/29 February, not 2/3 March. This is what "Son 6 Ay" has to mean.
 */
export function addMonths(day: CalendarDay, months: number): CalendarDay {
  const totalMonths = day.year * 12 + (day.month - 1) + months;
  const year = Math.floor(totalMonths / 12);
  const month = totalMonths - year * 12 + 1;
  const lastDayOfTarget = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { year, month, day: Math.min(day.day, lastDayOfTarget) };
}

export function compareDays(left: CalendarDay, right: CalendarDay): number {
  if (left.year !== right.year) return left.year - right.year;
  if (left.month !== right.month) return left.month - right.month;
  return left.day - right.day;
}

export function formatDay(day: CalendarDay): string {
  const month = String(day.month).padStart(2, "0");
  const dayOfMonth = String(day.day).padStart(2, "0");
  return `${day.year}-${month}-${dayOfMonth}`;
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseDay(value: string): CalendarDay {
  const match = ISO_DAY.exec(value.trim());
  if (!match) {
    throw new ReportRangeError("Tarih YYYY-AA-GG biçiminde olmalıdır.");
  }
  const [, year, month, day] = match;
  const parsed = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
  };
  // Reject 2026-02-31 and friends rather than silently rolling them over.
  const roundTrip = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
  if (
    roundTrip.getUTCFullYear() !== parsed.year ||
    roundTrip.getUTCMonth() + 1 !== parsed.month ||
    roundTrip.getUTCDate() !== parsed.day
  ) {
    throw new ReportRangeError("Geçerli bir tarih girin.");
  }
  return parsed;
}

export interface ResolveReportRangeInput {
  readonly preset: ReportRangePreset;
  readonly now: Date;
  /** Required for CUSTOM; ignored otherwise. Both bounds are inclusive days. */
  readonly from?: string;
  readonly to?: string;
  /** First real operation date, for SINCE_SYSTEM_START. */
  readonly systemStart?: Date | null;
  readonly comparison?: ReportComparison;
  /** The restaurant's own zone; every boundary below is measured in it. */
  readonly timeZone?: string;
}

/** Days between two calendar days, used to build an equal previous period. */
function dayCount(start: CalendarDay, endExclusive: CalendarDay): number {
  const startMs = Date.UTC(start.year, start.month - 1, start.day);
  const endMs = Date.UTC(endExclusive.year, endExclusive.month - 1, endExclusive.day);
  return Math.round((endMs - startMs) / 86_400_000);
}

function presetBounds(
  input: ResolveReportRangeInput,
  today: CalendarDay,
): { start: CalendarDay; endExclusive: CalendarDay } {
  switch (input.preset) {
    case "TODAY":
      return { start: today, endExclusive: addDays(today, 1) };
    case "YESTERDAY":
      return { start: addDays(today, -1), endExclusive: today };
    case "LAST_7_DAYS":
      return { start: addDays(today, -6), endExclusive: addDays(today, 1) };
    case "LAST_30_DAYS":
      return { start: addDays(today, -29), endExclusive: addDays(today, 1) };
    case "LAST_3_MONTHS":
      return { start: addMonths(today, -3), endExclusive: addDays(today, 1) };
    case "LAST_6_MONTHS":
      return { start: addMonths(today, -6), endExclusive: addDays(today, 1) };
    case "THIS_MONTH":
      return {
        start: { ...today, day: 1 },
        endExclusive: addDays(today, 1),
      };
    case "PREVIOUS_MONTH": {
      const firstOfThisMonth = { ...today, day: 1 };
      return {
        start: addMonths(firstOfThisMonth, -1),
        endExclusive: firstOfThisMonth,
      };
    }
    case "THIS_YEAR":
      return { start: { year: today.year, month: 1, day: 1 }, endExclusive: addDays(today, 1) };
    case "SINCE_SYSTEM_START": {
      // No hard-coded epoch: without a first operation the period is empty.
      const start = input.systemStart ? toLocalDay(input.systemStart) : today;
      return { start, endExclusive: addDays(today, 1) };
    }
    default: {
      if (!input.from || !input.to) {
        throw new ReportRangeError("Özel aralık için başlangıç ve bitiş tarihi gereklidir.");
      }
      const start = parseDay(input.from);
      const end = parseDay(input.to);
      if (compareDays(start, end) > 0) {
        throw new ReportRangeError("Başlangıç tarihi bitiş tarihinden sonra olamaz.");
      }
      return { start, endExclusive: addDays(end, 1) };
    }
  }
}

function comparisonOf(
  kind: ReportComparison,
  start: CalendarDay,
  endExclusive: CalendarDay,
  timeZone: string,
): ReportComparisonRange | null {
  if (kind === "NONE") return null;

  if (kind === "PREVIOUS_PERIOD") {
    const length = dayCount(start, endExclusive);
    const previousStart = addDays(start, -length);
    return {
      kind,
      label: "Önceki Eşit Dönem",
      start: startOfLocalDay(previousStart, timeZone),
      endExclusive: startOfLocalDay(start, timeZone),
    };
  }

  // Calendar-safe: 29 February compared against 28 February in a common year.
  return {
    kind: "PREVIOUS_YEAR",
    label: "Geçen Yıl Aynı Dönem",
    start: startOfLocalDay(addMonths(start, -12), timeZone),
    endExclusive: startOfLocalDay(addMonths(endExclusive, -12), timeZone),
  };
}

/**
 * The one place a report period is decided. A future end is clamped to today
 * and reported as such rather than silently returning an empty period.
 */
export function resolveReportRange(input: ResolveReportRangeInput): ResolvedReportRange {
  const timeZone = input.timeZone ?? DEFAULT_RESTAURANT_TIME_ZONE;
  const today = toLocalDay(input.now, timeZone);
  const bounds = presetBounds(input, today);

  const tomorrow = addDays(today, 1);
  const clampedToToday = compareDays(bounds.endExclusive, tomorrow) > 0;
  const endExclusive = clampedToToday ? tomorrow : bounds.endExclusive;
  // A start after today yields an empty period rather than a negative one.
  const start = compareDays(bounds.start, endExclusive) > 0 ? endExclusive : bounds.start;

  return {
    preset: input.preset,
    label: REPORT_RANGE_LABELS[input.preset],
    timeZone,
    start: startOfLocalDay(start, timeZone),
    endExclusive: startOfLocalDay(endExclusive, timeZone),
    startDay: start,
    endDayInclusive: addDays(endExclusive, -1),
    comparison: comparisonOf(input.comparison ?? "NONE", start, endExclusive, timeZone),
    clampedToToday,
  };
}

/** Percentage change, with the zero-baseline cases named rather than Infinity. */
export type TrendDirection = "UP" | "DOWN" | "FLAT" | "NEW" | "NONE";

export interface Trend {
  readonly direction: TrendDirection;
  /** Null when a percentage would be meaningless (no baseline). */
  readonly percentage: number | null;
}

export function calculateTrend(current: number, previous: number): Trend {
  if (previous === 0) {
    if (current === 0) return { direction: "NONE", percentage: null };
    return { direction: "NEW", percentage: null };
  }
  const change = ((current - previous) / Math.abs(previous)) * 100;
  const rounded = Math.round(change * 10) / 10;
  if (rounded === 0) return { direction: "FLAT", percentage: 0 };
  return { direction: rounded > 0 ? "UP" : "DOWN", percentage: rounded };
}

export const WEEKDAY_LABELS = [
  "Pazar",
  "Pazartesi",
  "Salı",
  "Çarşamba",
  "Perşembe",
  "Cuma",
  "Cumartesi",
] as const;

/** 0 = Sunday, matching PostgreSQL's `extract(dow ...)`. */
export function weekdayLabel(index: number): string {
  return WEEKDAY_LABELS[index] ?? "Bilinmiyor";
}

/**
 * Today, as the restaurant counts it, in its own zone.
 *
 * The day-end report and the manager's home both need this, and two copies of
 * it are two ways to disagree about which day a payment belongs to. The zone
 * comes from the restaurant, so a London or New York restaurant rolls its day
 * over when it actually closes rather than when Istanbul does.
 */
export function restaurantToday(
  timeZone: string = DEFAULT_RESTAURANT_TIME_ZONE,
  now: Date = new Date(),
): string {
  const day = toLocalDay(now, timeZone);
  return `${day.year}-${String(day.month).padStart(2, "0")}-${String(day.day).padStart(2, "0")}`;
}
