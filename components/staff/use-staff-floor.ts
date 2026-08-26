"use client";

import { useCallback, useMemo } from "react";

import { staffOrderToViewModel, staffTableToViewModel } from "@/lib/adapters/staff-view-model";
import { staffApi, type StaffCallPayload } from "@/lib/api/endpoints";
import { useApiResource } from "@/lib/hooks/use-api-resource";
import { useStaffRealtime, type StaffRealtimeStatus } from "@/lib/realtime/use-staff-realtime";
import type { ApiClientError } from "@/lib/api/client";
import type { Order, RestaurantTable } from "@/types";

const FLOOR_POLL_MS = 20_000;

export interface StaffFloorState {
  readonly tables: readonly RestaurantTable[];
  readonly orders: readonly Order[];
  /** Raw calls: the table card needs the API type/status, not the view label. */
  readonly calls: readonly StaffCallPayload[];
  readonly summary: {
    readonly tableCount: number;
    readonly activeTableCount: number;
    readonly newOrderCount: number;
    readonly readyOrderCount: number;
    readonly openCallCount: number;
    readonly billRequestCount: number;
  };
  readonly loading: boolean;
  readonly error: ApiClientError | null;
  readonly realtimeStatus: StaffRealtimeStatus;
  /** Re-reads the floor after a mutation; the API stays the source of truth. */
  readonly refetch: () => Promise<void>;
}

/**
 * One loader for the floor view: the dashboard and the tables page share it so
 * a waiter panel holds a single Realtime subscription and one polling timer.
 */
export function useStaffFloor(): StaffFloorState {
  const loadFloor = useCallback(async (signal: AbortSignal) => {
    const [tables, orders, calls] = await Promise.all([
      staffApi.tables(signal),
      // The floor view shows what is still running; settled orders are history.
      staffApi.orders({ open: true }, signal),
      staffApi.calls(undefined, signal),
    ]);
    return { tables: tables.tables, orders: orders.orders, calls: calls.calls };
  }, []);

  const resource = useApiResource(loadFloor, { pollMs: FLOOR_POLL_MS });
  const { refetch } = resource;
  const realtimeStatus = useStaffRealtime({
    onEvent: useCallback(() => void refetch(), [refetch]),
    onResync: useCallback(() => void refetch(), [refetch]),
  });

  const tables = useMemo(
    () => (resource.data?.tables ?? []).map((table) => staffTableToViewModel(table)),
    [resource.data],
  );
  const orders = useMemo(
    () => (resource.data?.orders ?? []).map((order) => staffOrderToViewModel(order)),
    [resource.data],
  );

  const calls = useMemo(() => resource.data?.calls ?? [], [resource.data]);

  const summary = useMemo(() => {
    const openCalls = calls.filter(
      (call) => call.status === "OPEN" || call.status === "ACKNOWLEDGED",
    );
    return {
      tableCount: tables.length,
      activeTableCount: tables.filter(
        (table) => table.status !== "available" && table.status !== "inactive",
      ).length,
      newOrderCount: orders.filter((order) => order.status === "pending").length,
      readyOrderCount: orders.filter((order) => order.status === "ready").length,
      openCallCount: openCalls.filter((call) => call.type === "WAITER_CALL").length,
      billRequestCount: openCalls.filter((call) => call.type === "BILL_REQUEST").length,
    };
  }, [calls, orders, tables]);

  return {
    tables,
    orders,
    calls,
    summary,
    loading: resource.loading,
    error: resource.error,
    realtimeStatus,
    refetch,
  };
}
