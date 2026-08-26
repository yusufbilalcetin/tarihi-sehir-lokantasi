"use client";

import { Printer } from "lucide-react";

import { AdminModuleWindow } from "@/components/admin/admin-module-window";
import { PrintersManager } from "@/components/admin/printers-manager";

/** Yazıcılar as an application window. Size per the module-size contract. */
export function PrintersManagerModule() {
  return (
    <AdminModuleWindow
      title="Yazıcılar"
      description="Yazıcı ajanları, yazıcılar, yönlendirmeler ve baskı kuyruğu."
      icon={Printer}
      size="workspace"
    >
      <PrintersManager />
    </AdminModuleWindow>
  );
}
