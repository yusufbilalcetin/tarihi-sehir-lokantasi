"use client";

import { useCallback, useMemo } from "react";

import type { SalesPoint } from "@/components/admin/admin-charts";
import { adminApi } from "@/lib/api/endpoints";
import { useApiResource } from "@/lib/hooks/use-api-resource";
import type { ApiClientError } from "@/lib/api/client";
import type { AdminReportsResult } from "@/lib/services/admin-reports-service";

const REPORTS_POLL_MS = 60_000;

const dayFormatter = new Intl.DateTimeFormat("tr-TR", { weekday: "short" });

export interface AdminReportsState {
  readonly reports: AdminReportsResult | null;
  readonly salesSeries: readonly SalesPoint[];
  readonly loading: boolean;
  readonly error: ApiClientError | null;
  readonly refetch: () => Promise<void>;
}

export function useAdminReports(): AdminReportsState {
  const loadReports = useCallback((signal: AbortSignal) => adminApi.reports(signal), []);
  const resource = useApiResource(loadReports, { pollMs: REPORTS_POLL_MS });
  const reports = resource.data ?? null;

  const salesSeries = useMemo<SalesPoint[]>(
    () =>
      (reports?.daily ?? []).map((point) => ({
        label: dayFormatter.format(new Date(`${point.date}T12:00:00.000Z`)),
        sales: Number(point.revenue),
        orders: point.orderCount,
      })),
    [reports],
  );

  return {
    reports,
    salesSeries,
    loading: resource.loading,
    error: resource.error,
    refetch: resource.refetch,
  };
}
