"use client";

import { Factory } from "lucide-react";
import { AdminModuleWindow } from "@/components/admin/admin-module-window";
import { ErpOperationsManager } from "@/components/admin/erp-operations-manager";

export function ErpOperationsModule() {
  return <AdminModuleWindow title="İşletme ERP" description="Stok, maliyet, üretim, satın alma ve personel karar merkezi." icon={Factory} size="workspace"><ErpOperationsManager /></AdminModuleWindow>;
}
