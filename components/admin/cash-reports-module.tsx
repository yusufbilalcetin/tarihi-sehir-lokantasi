"use client";

import { CalendarClock } from "lucide-react";

import { AdminModuleWindow } from "@/components/admin/admin-module-window";
import { CashDayReportView } from "@/components/admin/cash-day-report-view";

/** Gün Sonu Kasa Raporu as an application window. Size per the module-size contract. */
export function CashDayReportViewModule() {
  return (
    <AdminModuleWindow
      title="Gün Sonu Kasa Raporu"
      description="Günlük kasa hareketleri ve kapanış özeti."
      icon={CalendarClock}
      size="workspace"
    >
      <CashDayReportView />
    </AdminModuleWindow>
  );
}
