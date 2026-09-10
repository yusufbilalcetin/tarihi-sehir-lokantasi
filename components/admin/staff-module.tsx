"use client";

import { UsersRound } from "lucide-react";

import { AdminModuleWindow } from "@/components/admin/admin-module-window";
import { StaffManager } from "@/components/admin/staff-manager";

/** Personel as an application window. Size per the module-size contract. */
export function StaffManagerModule() {
  return (
    <AdminModuleWindow
      title="Personel Listesi"
      description="Tüm personelinizi görüntüleyin ve yönetin."
      icon={UsersRound}
      size="xl"
    >
      <StaffManager />
    </AdminModuleWindow>
  );
}
