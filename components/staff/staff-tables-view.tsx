"use client";

import { useMemo } from "react";

import { PageHeader } from "@/components/shared/page-header";
import { StaffAttendanceCard } from "@/components/staff/staff-attendance-card";
import { StaffFloor } from "@/components/staff/staff-floor";
import { useStaffFloor } from "@/components/staff/use-staff-floor";
import { Badge } from "@/components/ui/badge";

/**
 * The floor plan, as a page.
 *
 * It used to take an `inWindow` flag that suppressed this header, back when the
 * route was rendered inside a window that carried its own. The route is a page
 * now, so the header belongs here and there is nothing to suppress.
 */
export function StaffTablesView() {
  const floor = useStaffFloor();

  const counts = useMemo(() => {
    const free = floor.tables.filter((table) => table.status === "available").length;
    const serving = floor.tables.filter(
      (table) => table.status === "dining" || table.status === "occupied" || table.status === "ordering",
    ).length;
    const waiting = floor.tables.filter((table) => table.status === "waiting").length;
    const priority = floor.tables.filter(
      (table) => table.status === "waiter-call" || table.status === "bill-requested",
    ).length;
    return { free, serving, waiting, priority };
  }, [floor.tables]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Masalar"
        description="Bir masaya dokunarak sipariş ve servis işlemlerini aç."
        action={
          <Badge variant="outline" className="h-8 border-copper/40 bg-card px-3 text-sm text-burgundy">
            {floor.tables.length} masa
          </Badge>
        }
      />

      <div className="flex flex-wrap gap-2 text-xs font-semibold text-muted-foreground" aria-label="Masa durum özeti">
        {/* Same four tones the table cards use, so the summary and the floor
            plan below it agree on what each colour means. */}
        <span className="rounded-lg border border-status-success/25 bg-status-success-tint px-2.5 py-1.5 text-status-success">{counts.free} boş</span>
        <span className="rounded-lg border border-order-served/25 bg-order-served-tint px-2.5 py-1.5 text-order-served">{counts.serving} serviste</span>
        <span className="rounded-lg border border-order-new/25 bg-order-new-tint px-2.5 py-1.5 text-order-new">{counts.waiting} bekliyor</span>
        <span className="rounded-lg border border-status-danger/25 bg-status-danger-tint px-2.5 py-1.5 text-status-danger">{counts.priority} öncelikli</span>
      </div>

      <StaffFloor floor={floor} />

      {/* Clocking in is a daily task and this is the screen a waiter starts on,
          so it lives here rather than behind a tab of its own. */}
      <StaffAttendanceCard />
    </div>
  );
}
