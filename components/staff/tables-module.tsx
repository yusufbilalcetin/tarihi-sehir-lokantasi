"use client";

import { TableProperties } from "lucide-react";

import { ModuleWindow } from "@/components/shared/module-window";
import { StaffTablesView } from "@/components/staff/staff-tables-view";

/**
 * The floor plan as an application window.
 *
 * This wrapper exists because the window's icon is a React component, and a
 * server-rendered route cannot hand one to a client component. Keeping the
 * icon on this side of the boundary lets the page stay a server component and
 * keep its `metadata` export.
 */
export function TablesModule() {
  return (
    <ModuleWindow
      title="Masalar"
      description="Salonun tamamını izle, masa detaylarını aç ve servis işlemlerini tamamla."
      icon={TableProperties}
      size="workspace"
      closeHref="/staff/dashboard"
    >
      <div className="p-4 sm:p-6">
        <StaffTablesView inWindow />
      </div>
    </ModuleWindow>
  );
}
