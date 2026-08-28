"use client";

import { Printer, RefreshCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  REPORT_COMPARISONS,
  REPORT_RANGE_LABELS,
  REPORT_RANGE_PRESETS,
  type ReportComparison,
  type ReportRangePreset,
} from "@/lib/domain/report-range";
import { cn } from "@/lib/utils";

const COMPARISON_LABELS: Readonly<Record<ReportComparison, string>> = {
  NONE: "Karşılaştırma yok",
  PREVIOUS_PERIOD: "Önceki Eşit Dönem",
  PREVIOUS_YEAR: "Geçen Yıl Aynı Dönem",
};

export interface ReportFilterState {
  readonly range: ReportRangePreset;
  readonly from: string;
  readonly to: string;
  readonly comparison: ReportComparison;
}

/** Builds the query every report section shares, so a period means one thing. */
export function reportQuery(state: ReportFilterState): string {
  const params = new URLSearchParams({ range: state.range, comparison: state.comparison });
  if (state.range === "CUSTOM") {
    params.set("from", state.from);
    params.set("to", state.to);
  }
  return params.toString();
}

const selectClass =
  "min-h-11 rounded-lg border border-border bg-background px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function ReportFilters({
  state,
  resolvedLabel,
  clamped,
  refreshing,
  onChange,
  onRefresh,
}: {
  state: ReportFilterState;
  /** The period the server actually resolved, shown back to the admin. */
  resolvedLabel: string | null;
  clamped: boolean;
  refreshing: boolean;
  onChange: (next: ReportFilterState) => void;
  onRefresh: () => void;
}) {
  return (
    <div className="print:hidden space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="w-full space-y-1.5 sm:w-auto">
          <label className="text-sm font-semibold" htmlFor="report-range">
            Dönem
          </label>
          <select
            id="report-range"
            className={cn(selectClass, "w-full sm:w-auto")}
            value={state.range}
            onChange={(event) =>
              onChange({ ...state, range: event.target.value as ReportRangePreset })
            }
          >
            {REPORT_RANGE_PRESETS.map((preset) => (
              <option key={preset} value={preset}>
                {REPORT_RANGE_LABELS[preset]}
              </option>
            ))}
          </select>
        </div>

        {state.range === "CUSTOM" ? (
          <>
            <div className="w-full space-y-1.5 sm:w-auto">
              <label className="text-sm font-semibold" htmlFor="report-from">
                Başlangıç
              </label>
              <Input
                id="report-from"
                type="date"
                className="min-h-11"
                value={state.from}
                onChange={(event) => onChange({ ...state, from: event.target.value })}
              />
            </div>
            <div className="w-full space-y-1.5 sm:w-auto">
              <label className="text-sm font-semibold" htmlFor="report-to">
                Bitiş
              </label>
              <Input
                id="report-to"
                type="date"
                className="min-h-11"
                value={state.to}
                onChange={(event) => onChange({ ...state, to: event.target.value })}
              />
            </div>
          </>
        ) : null}

        <div className="w-full space-y-1.5 sm:w-auto">
          <label className="text-sm font-semibold" htmlFor="report-comparison">
            Karşılaştır
          </label>
          <select
            id="report-comparison"
            className={cn(selectClass, "w-full sm:w-auto")}
            value={state.comparison}
            onChange={(event) =>
              onChange({ ...state, comparison: event.target.value as ReportComparison })
            }
          >
            {REPORT_COMPARISONS.map((comparison) => (
              <option key={comparison} value={comparison}>
                {COMPARISON_LABELS[comparison]}
              </option>
            ))}
          </select>
        </div>

        <div className="grid w-full grid-cols-2 gap-2 sm:ml-auto sm:flex sm:w-auto">
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            aria-busy={refreshing}
            onClick={onRefresh}
          >
            <RefreshCcw className={cn("size-4", refreshing && "animate-spin")} strokeWidth={1.8} />
            Yenile
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={() => window.print()}
          >
            <Printer className="size-4" strokeWidth={1.8} />
            Yazdır
          </Button>
        </div>
      </div>

      {resolvedLabel ? (
        <p className="text-sm text-muted-foreground">
          Raporlanan dönem: <span className="font-semibold">{resolvedLabel}</span>
          {clamped ? " (bitiş tarihi bugüne çekildi)" : ""}
        </p>
      ) : null}
    </div>
  );
}
