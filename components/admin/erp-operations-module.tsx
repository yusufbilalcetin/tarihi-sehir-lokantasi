"use client";

import { Factory } from "lucide-react";
import { AdminModuleWindow } from "@/components/admin/admin-module-window";
import { ErpOperationsManager } from "@/components/admin/erp-operations-manager";

export function ErpOperationsModule() {
  return <AdminModuleWindow title="ERP / Gelişmiş" description="Stok, üretim, satın alma ve misafir kayıtlarının bulunduğu ileri düzey ekranlar." icon={Factory} size="workspace"><ErpOperationsManager /></AdminModuleWindow>;
}
