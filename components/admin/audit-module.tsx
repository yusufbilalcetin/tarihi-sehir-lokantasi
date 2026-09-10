"use client";

import { History } from "lucide-react";

import { AdminModuleWindow } from "@/components/admin/admin-module-window";
import { AuditLogView } from "@/components/admin/audit-log-view";

/** İşlem Geçmişi as an application window. Size per the module-size contract. */
export function AuditLogModule() {
  return (
    <AdminModuleWindow
      title="İşlem Geçmişi"
      description="Kim, ne zaman, hangi kaydı değiştirdi. Bu ekran yalnızca okunur."
      icon={History}
      size="workspace"
    >
      <AuditLogView />
    </AdminModuleWindow>
  );
}
