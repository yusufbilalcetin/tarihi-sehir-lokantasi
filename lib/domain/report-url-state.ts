import {
  REPORT_COMPARISONS,
  REPORT_RANGE_PRESETS,
  type ReportComparison,
  type ReportRangePreset,
} from "./report-range";

/**
 * The report view's shareable state. A pasted link must reproduce a colleague's
 * screen, and a hand-edited or stale link must still render something valid
 * rather than an error — every unknown value falls back to the default.
 */

export const REPORT_TABS = [
  "overview",
  "products",
  "categories",
  "staff",
  "kitchen",
  "finance",
  "tables",
  "review",
] as const;

export type ReportTab = (typeof REPORT_TABS)[number];

export interface ReportUrlState {
  readonly range: ReportRangePreset;
  readonly from: string;
  readonly to: string;
  readonly comparison: ReportComparison;
  readonly tab: ReportTab;
}

/** ISO calendar day, the only shape the custom range accepts. */
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function pick<T extends string>(
  value: string | null,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export function parseReportUrlState(
  search: string,
  defaults: { readonly today: string },
): ReportUrlState {
  const params = new URLSearchParams(search);
  const range = pick(params.get("range"), REPORT_RANGE_PRESETS, "LAST_30_DAYS");
  const from = params.get("from");
  const to = params.get("to");

  return {
    range,
    from: from && DAY.test(from) ? from : defaults.today,
    to: to && DAY.test(to) ? to : defaults.today,
    comparison: pick(params.get("comparison"), REPORT_COMPARISONS, "NONE"),
    tab: pick(params.get("tab"), REPORT_TABS, "overview"),
  };
}

/** Only the custom range carries its dates, so ordinary links stay short. */
export function serializeReportUrlState(state: ReportUrlState): string {
  const params = new URLSearchParams({
    range: state.range,
    comparison: state.comparison,
    tab: state.tab,
  });
  if (state.range === "CUSTOM") {
    params.set("from", state.from);
    params.set("to", state.to);
  }
  return params.toString();
}
