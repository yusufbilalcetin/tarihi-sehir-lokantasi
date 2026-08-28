"use client";

import { QrCode } from "lucide-react";

import { AdminModuleWindow } from "@/components/admin/admin-module-window";
import { QrManager } from "@/components/admin/qr-manager";

/** QR Kodlar as an application window. Size per the module-size contract. */
export function QrManagerModule() {
  return (
    <AdminModuleWindow
      title="QR Kodlar"
      description="Masa QR menülerini görüntüle, indir ve yazdır."
      icon={QrCode}
      size="xl"
    >
      <QrManager />
    </AdminModuleWindow>
  );
}
