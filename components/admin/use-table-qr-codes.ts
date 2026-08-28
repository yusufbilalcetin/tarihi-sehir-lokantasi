"use client";

import { useCallback } from "react";

import { adminApi, type TableQrCodeRow } from "@/lib/api/endpoints";
import { useApiResource } from "@/lib/hooks/use-api-resource";

/**
 * Every table's current QR address.
 *
 * A plain read, and deliberately so: drawing, downloading and printing a code
 * must never change it, or opening this screen would void the cards already on
 * the tables. Renewal is a separate, explicit request.
 */
export function useTableQrCodes() {
  const load = useCallback((signal: AbortSignal) => adminApi.tableQrCodes(signal), []);
  const resource = useApiResource(load);

  const byTableId = useCallback(
    (tableId: string): TableQrCodeRow | null =>
      resource.data?.tables.find((table) => table.tableId === tableId) ?? null,
    [resource.data],
  );

  return {
    restaurantName: resource.data?.restaurantName ?? "Tarihi Şehir Lokantası",
    codes: resource.data?.tables ?? [],
    loading: resource.loading,
    error: resource.error,
    refetch: resource.refetch,
    byTableId,
  };
}
