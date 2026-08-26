"use client";

import { Wallet } from "lucide-react";

import { AdminModuleWindow } from "@/components/admin/admin-module-window";
import { CashRegistersManager } from "@/components/admin/cash-registers-manager";

/** Kasa ve Vardiyalar as an application window. Size per the module-size contract. */
export function CashRegistersManagerModule() {
  return (
    <AdminModuleWindow
      title="Kasa ve Vardiyalar"
      description="Kasaları tanımla ve vardiya kayıtlarını izle."
      icon={Wallet}
      size="xl"
    >
      <CashRegistersManager />
    </AdminModuleWindow>
  );
}
