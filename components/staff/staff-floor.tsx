"use client";

import { TableProperties } from "lucide-react";

import { EmptyState } from "@/components/shared/data-states";
import { RealtimeStatus } from "@/components/staff/realtime-status";
import { TableGrid } from "@/components/staff/table-grid";
import type { StaffFloorState } from "@/components/staff/use-staff-floor";

export function StaffFloor({
  floor,
  limit,
  compact = false,
}: {
  floor: StaffFloorState;
  limit?: number;
  compact?: boolean;
}) {
  if (floor.error && !floor.tables.length) {
    return (
      <EmptyState
        icon={TableProperties}
        title="Masalar yüklenemedi"
        description={floor.error.message}
      />
    );
  }

  const visibleTables = typeof limit === "number" ? floor.tables.slice(0, limit) : floor.tables;

  return (
    <div className="space-y-3">
      <RealtimeStatus status={floor.realtimeStatus} />
      {visibleTables.length ? (
        <TableGrid
          tables={[...visibleTables]}
          orders={floor.orders}
          calls={floor.calls}
          onChanged={floor.refetch}
          compact={compact}
        />
      ) : (
        <EmptyState
          icon={TableProperties}
          title={floor.loading ? "Masalar yükleniyor…" : "Masa bulunamadı"}
          description={
            floor.loading
              ? "Salon durumu hazırlanıyor."
              : "Yönetici panelinden masa ekleyerek başlayın."
          }
        />
      )}
    </div>
  );
}
