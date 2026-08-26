"use client";

import { ReceiptText } from "lucide-react";

import { AdminModuleWindow } from "@/components/admin/admin-module-window";
import { OrdersManager } from "@/components/admin/orders-manager";

/** Siparişler as an application window. Size per the module-size contract. */
export function OrdersManagerModule() {
  return (
    <AdminModuleWindow
      title="Siparişler"
      description="Sipariş geçmişini incele ve detayları görüntüle."
      icon={ReceiptText}
      size="xl"
    >
      <OrdersManager />
    </AdminModuleWindow>
  );
}
