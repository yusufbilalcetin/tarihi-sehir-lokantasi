"use client";

import { Settings } from "lucide-react";

import { AdminModuleWindow } from "@/components/admin/admin-module-window";
import { SettingsManager } from "@/components/admin/settings-manager";

/** Ayarlar as an application window. Size per the module-size contract. */
export function SettingsManagerModule() {
  return (
    <AdminModuleWindow
      title="Ayarlar"
      description="Restoran, sipariş, servis ve yazdırma ayarları."
      icon={Settings}
      size="xl"
    >
      <SettingsManager />
    </AdminModuleWindow>
  );
}
