"use client";

import { Armchair } from "lucide-react";

import { AdminModuleWindow } from "@/components/admin/admin-module-window";
import { TablesManager } from "@/components/admin/tables-manager";

/** Masalar as an application window. Size per the module-size contract. */
export function TablesManagerModule() {
  return (
    <AdminModuleWindow
      title="Masalar"
      description="Masaları tanımla, kapasite ve durumlarını yönet."
      icon={Armchair}
      size="xl"
    >
      <TablesManager />
    </AdminModuleWindow>
  );
}
