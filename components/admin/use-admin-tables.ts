"use client";

import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { staffTableToViewModel } from "@/lib/adapters/staff-view-model";
import { ApiClientError } from "@/lib/api/client";
import { staffApi } from "@/lib/api/endpoints";
import { useApiResource } from "@/lib/hooks/use-api-resource";
import { useStaffRealtime, type StaffRealtimeStatus } from "@/lib/realtime/use-staff-realtime";
import type { StaffTableResult } from "@/lib/services/staff-table-service";
import type { RestaurantTable } from "@/types";

const ADMIN_TABLE_POLL_MS = 30_000;
const EMPTY_TABLES: readonly StaffTableResult[] = [];

export interface AdminTablesState {
  readonly tables: readonly StaffTableResult[];
  readonly tableViews: readonly RestaurantTable[];
  readonly loading: boolean;
  readonly error: ApiClientError | null;
  readonly saving: boolean;
  readonly realtimeStatus: StaffRealtimeStatus;
  readonly refetch: () => Promise<void>;
  readonly run: <TResult>(
    work: () => Promise<TResult>,
    successMessage: string,
  ) => Promise<TResult | null>;
}

export function useAdminTables(): AdminTablesState {
  const [saving, setSaving] = useState(false);
  const loadTables = useCallback((signal: AbortSignal) => staffApi.tables(signal), []);
  const resource = useApiResource(loadTables, { pollMs: ADMIN_TABLE_POLL_MS });
  const { refetch } = resource;
  const realtimeStatus = useStaffRealtime({
    onEvent: useCallback(() => void refetch(), [refetch]),
    onResync: useCallback(() => void refetch(), [refetch]),
  });

  const tables = resource.data?.tables ?? EMPTY_TABLES;
  const tableViews = useMemo(
    () => tables.map((table) => staffTableToViewModel(table)),
    [tables],
  );

  const run = useCallback(
    async <TResult>(work: () => Promise<TResult>, successMessage: string) => {
      if (saving) return null;
      setSaving(true);
      try {
        const result = await work();
        await refetch();
        toast.success(successMessage);
        return result;
      } catch (error) {
        toast.error(error instanceof ApiClientError ? error.message : "İşlem tamamlanamadı.");
        return null;
      } finally {
        setSaving(false);
      }
    },
    [refetch, saving],
  );

  return {
    tables,
    tableViews,
    loading: resource.loading,
    error: resource.error,
    saving,
    realtimeStatus,
    refetch,
    run,
  };
}
