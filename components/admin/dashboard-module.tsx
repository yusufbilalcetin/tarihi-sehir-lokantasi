"use client";

import { LayoutDashboard } from "lucide-react";

import { AdminModuleWindow } from "@/components/admin/admin-module-window";
import { DashboardView } from "@/components/admin/dashboard-view";

/** Yönetim Özeti as an application window. Size per the module-size contract. */
export function DashboardViewModule() {
  return (
    <AdminModuleWindow
      title="Genel Bakış"
      description="Bugünün satışı ve salonun anlık durumu."
      icon={LayoutDashboard}
      size="workspace"
    >
      <DashboardView />
    </AdminModuleWindow>
  );
}
