"use client";

import { BellRing } from "lucide-react";

import { ModuleWindow } from "@/components/shared/module-window";
import { WaiterCallsList } from "@/components/staff/waiter-calls-list";

/** Service requests as an application window. */
export function CallsModule() {
  return (
    <ModuleWindow
      title="Garson Çağrıları"
      description="Masa taleplerini önem sırasına göre üstlen ve tamamlanan çağrıları kapat."
      icon={BellRing}
      size="lg"
      closeHref="/staff/dashboard"
    >
      <div className="p-4 sm:p-6">
        <WaiterCallsList />
      </div>
    </ModuleWindow>
  );
}
