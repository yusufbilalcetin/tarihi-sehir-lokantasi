"use client";

import { ChartColumn } from "lucide-react";

import { AdminModuleWindow } from "@/components/admin/admin-module-window";
import { AdvancedReportsView } from "@/components/admin/advanced-reports-view";

/** Raporlar as an application window. Size per the module-size contract. */
export function AdvancedReportsViewModule() {
  return (
    <AdminModuleWindow
      title="Raporlar"
      description="Satış, tahsilat ve operasyon analizleri."
      icon={ChartColumn}
      size="workspace"
    >
      <AdvancedReportsView />
    </AdminModuleWindow>
  );
}
