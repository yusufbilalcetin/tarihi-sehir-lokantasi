"use client";

import { ReceiptText } from "lucide-react";

import { ModuleWindow } from "@/components/shared/module-window";
import { OrdersList } from "@/components/staff/orders-list";

/** Orders as an application window. See TablesModule for why this wrapper exists. */
export function OrdersModule() {
  return (
    <ModuleWindow
      title="Siparişler"
      description="Salon siparişlerini filtrele, mutfak durumunu takip et ve servis akışını güncelle."
      icon={ReceiptText}
      size="xl"
      closeHref="/staff/dashboard"
    >
      <div className="p-4 sm:p-6">
        <OrdersList />
      </div>
    </ModuleWindow>
  );
}
